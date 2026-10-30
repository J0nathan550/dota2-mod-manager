/* Everybody playing a hero wears the user's look for it, not only the user.
 *
 * The builder puts a pick's model under the stock item's path, and an arcana base its body under
 * the hero's. A match loads each wearable from the path the server's own item table names
 * (src/item-builder.ts, withoutFileSwaps), so another player's Juggernaut with a sword of his own
 * was drawn with that sword, on the base's body when one was on: the body is at the hero's path,
 * which is everybody's, and the sword at its own, which nothing of ours filled. A persona's body
 * with a plain item hanging off it, the thing src/item-builder-personas.ts keeps off the user's
 * own hero, is what everybody else's looked like.
 *
 * So a hero the build dresses (a pick, or a base's part, at one of his stock paths) is worn by
 * everybody exactly as the user's is, slot by slot. Every other wearable of his goes under the
 * file the user's hero wears in its slot, at each model path its block names, its styles' included:
 * - the build's, where it fills the stock path (a pick's model, else a base's part);
 * - the game's own stock item, where it does not: the Planetfall base fills Earthshaker's totem and
 *   bracers, and his belt is the plain one, so a store belt was drawn on the arcana (J0nathan550,
 *   2026-10-30, with the Intergalactic Orbliterator on);
 * - nothing, where the stock item has no model: Earthshaker's head is his body's, and a store head
 *   sat on the arcana's. Nothing is Valve's own invisible box, the one Monkey King's transformation
 *   hides his wearables with.
 * Its block in the table becomes the pick's, else the stock item's, keeping its own name and
 * picture, so its own particles do not hang off our model. Left alone: a slot with no stock item,
 * items shared with other heroes, and any that changes the hero itself (an arcana's model, a
 * persona), whose body the server sets.
 *
 * For a persona the stock paths hold the empty models its base puts there, so another player's plain
 * items go the way the user's own do, and the persona's body is not dressed in them.
 *
 * The bytes are one buffer under many paths, and the pak stores them once (src/vpk-write.ts). Tried
 * on Juggernaut first (five slots, about 140 wearables), then every hero (2026-10-30). The table is
 * walked once whatever the number of heroes: a walk a hero was 118 ms each.
 */
import { listItems, inferredItemSlot, type SchemaItem, type SchemaPatch } from './schema.ts';
import { canonicalItemSlot, isPersonaItem, itemHeroes } from './item-builder-slots.ts';
import { asItem } from './item-builder.ts';
import { normalizeAssetPath } from './item-builder-assets.ts';
import { entryAt, entryPath, type VpkEntry } from './vpk.ts';

/** Visuals that change the hero, not only what he wears. */
const CHANGES_HERO = /"type"\s+"(entity_model|hero_model_change|persona)"/i;
/** Every model a block names: its own, and each of its styles'. */
const MODELS = /"model_player\d*"\s+"([^"]+)"/gi;

/** What a slot whose stock item has no model is worn as: Valve's invisible box, the first the game has. */
const NOTHING = ['models/heroes/monkey_king/transform_invisiblebox.vmdl_c', 'models/development/invisiblebox.vmdl_c'];

/** The first hero an item's used_by_heroes names. */
const FIRST_HERO = /"(npc_dota_hero_\w+)"\s+"1"/i;

const compiled = (p: string) => `${normalizeAssetPath(p)}_c`;

/** The same bytes under another path: the pak writes them once (buildVpk). */
function under(path: string, en: VpkEntry): VpkEntry {
  return { ...entryAt(path, Buffer.alloc(0)), data: en.data, crc: en.crc, preload: en.preload };
}

/**
 * The patches that dress every other wearable of each hero the build dresses as the user's hero is
 * dressed. Merged after the build's own, whose files and blocks win where both name one.
 * @param list     the build's patches (src/schema-build.ts buildSteps)
 * @param beneath  the arcana bases' files, under every pick's
 * @param read     a file of the game's pak01, for its stock items and the invisible box
 * @param heroes   only these, as items_game names them without npc_dota_hero_; none: all of them
 */
export function everyoneWears(text: string, list: SchemaPatch[], beneath: VpkEntry[], read: (path: string) => Buffer | null, heroes?: string[]): SchemaPatch[] {
  const files = new Map<string, VpkEntry>();
  for (const en of [...list.flatMap((p) => p.assets || []), ...beneath]) {
    const key = entryPath(en).toLowerCase();
    if (!files.has(key)) files.set(key, en);
  }
  // the last block of an id is the one the merge keeps (mergeSchema)
  const blocks = new Map(list.map((p) => [String(p.id), p.block]));
  const only = heroes && new Set(heroes.map((h) => `npc_dota_hero_${h}`));
  const items = listItems(text);
  const heroOf = (i: SchemaItem) => {
    const h = itemHeroes(text, i);
    return h.length === 1 && (!only || only.has(h[0])) && !isPersonaItem(i) ? h[0] : null;
  };
  const slotKey = (hero: string, i: SchemaItem) => `${hero}|${canonicalItemSlot(inferredItemSlot(i))}`;

  // the heroes the build dresses, found by path first: a lookup, before any item's heroes are read
  const stocks = items.filter((i) => i.prefab === 'default_item');
  const wanted = new Set(stocks.filter((i) => i.model && files.has(compiled(i.model).toLowerCase())).map(heroOf).filter((h) => h !== null));
  if (!wanted.size) return [];
  const stockOf = new Map<string, SchemaItem>();
  for (const i of stocks) {
    const named = FIRST_HERO.exec(text.slice(i.start, i.end))?.[1].toLowerCase();
    const hero = named && wanted.has(named) ? heroOf(i) : null;
    if (hero) stockOf.set(slotKey(hero, i), i);
  }
  // what the user's hero wears in a slot, the same entry for every item of it so the pak has it once
  const worn = new Map<string, VpkEntry | null>();
  const wornIn = (stock: SchemaItem): VpkEntry | null => {
    if (!worn.has(stock.id)) {
      const at = stock.model ? compiled(stock.model).toLowerCase() : null;
      const own = at ? files.get(at) ?? null : null;
      const gameAt = at ?? NOTHING.find((p) => read(p));
      const data = own ? null : gameAt ? read(gameAt) : null;
      worn.set(stock.id, own ?? (gameAt && data ? entryAt(gameAt, data) : null));
    }
    return worn.get(stock.id)!;
  };

  const out: SchemaPatch[] = [];
  for (const item of items) {
    // a block somebody else's mod lifted is that mod's (src/schema-build.ts rec.schema)
    if (item.prefab === 'default_item' || !item.model || blocks.has(item.id)) continue;
    const raw = text.slice(item.start, item.end);
    // the first hero it names, by a regex: reading every item's heroes properly is the slow part
    const named = FIRST_HERO.exec(raw)?.[1].toLowerCase();
    if (!named || !wanted.has(named) || CHANGES_HERO.test(raw)) continue;
    const hero = heroOf(item);
    const stock = hero && stockOf.get(slotKey(hero, item));
    const ours = stock && wornIn(stock);
    if (!stock || !ours) continue;
    const paths = [...new Set([...raw.matchAll(MODELS)].map((m) => compiled(m[1]).toLowerCase()))].filter((p) => !files.has(p));
    if (!paths.length) continue;
    out.push({
      id: item.id,
      block: asItem(blocks.get(stock.id) ?? text.slice(stock.start, stock.end), text, item, item.model),
      assets: paths.map((p) => under(p, ours)),
      source: `${stock.name}: everybody's`,
    });
  }
  return out;
}
