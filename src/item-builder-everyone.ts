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
 * So, for each slot whose stock path the build fills (a pick's model, else a base's part), the same
 * bytes go under every other wearable of that hero and slot, at each model path its block names,
 * its styles' included. Its block in the table becomes the pick's (else the stock item's), keeping
 * its own name and picture, so its own particles do not hang off our model. Left alone: items
 * shared with other heroes, and any that changes the hero itself (an arcana's model, a persona),
 * whose body the server sets.
 *
 * The bytes are one buffer under many paths, and the pak stores them once (src/vpk-write.ts).
 * Tried on Juggernaut first: five slots of models, about 140 wearables (2026-10-30).
 */
import { listItems, inferredItemSlot, type SchemaPatch } from './schema.ts';
import { canonicalItemSlot, isPersonaItem, itemHeroes } from './item-builder-slots.ts';
import { asItem } from './item-builder.ts';
import { normalizeAssetPath } from './item-builder-assets.ts';
import { entryAt, entryPath, type VpkEntry } from './vpk.ts';

/** The heroes it is tried on, as items_game names them without npc_dota_hero_. */
export const EVERYONE_HEROES = ['juggernaut'];

/** Visuals that change the hero, not only what he wears. */
const CHANGES_HERO = /"type"\s+"(entity_model|hero_model_change|persona)"/i;
/** Every model a block names: its own, and each of its styles'. */
const MODELS = /"model_player\d*"\s+"([^"]+)"/gi;

const compiled = (p: string) => `${normalizeAssetPath(p)}_c`;

/** The same bytes under another path: the pak writes them once (buildVpk). */
function under(path: string, en: VpkEntry): VpkEntry {
  return { ...entryAt(path, Buffer.alloc(0)), data: en.data, crc: en.crc, preload: en.preload };
}

/**
 * The patches that dress every other wearable of these heroes as the build dresses the stock item
 * of its slot. Merged after the build's own, whose files and blocks win where both name one.
 * @param list     the build's patches (src/schema-build.ts buildSteps)
 * @param beneath  the arcana bases' files, under every pick's
 */
export function everyoneWears(text: string, list: SchemaPatch[], beneath: VpkEntry[], heroes: string[] = EVERYONE_HEROES): SchemaPatch[] {
  const files = new Map<string, VpkEntry>();
  for (const en of [...list.flatMap((p) => p.assets || []), ...beneath]) {
    const key = entryPath(en).toLowerCase();
    if (!files.has(key)) files.set(key, en);
  }
  // the last block of an id is the one the merge keeps (mergeSchema)
  const blocks = new Map(list.map((p) => [String(p.id), p.block]));
  const items = listItems(text);
  const out: SchemaPatch[] = [];
  for (const hero of heroes) {
    const npc = `npc_dota_hero_${hero}`;
    const own = items.filter((i) => {
      const h = itemHeroes(text, i);
      return h.length === 1 && h[0] === npc && !isPersonaItem(i);
    });
    for (const stock of own.filter((i) => i.prefab === 'default_item' && i.model)) {
      const ours = files.get(compiled(stock.model));
      if (!ours) continue;
      const slot = canonicalItemSlot(inferredItemSlot(stock));
      const block = blocks.get(stock.id) ?? text.slice(stock.start, stock.end);
      for (const item of own) {
        // a block somebody else's mod lifted is that mod's (src/schema-build.ts rec.schema)
        if (item.prefab === 'default_item' || blocks.has(item.id) || canonicalItemSlot(inferredItemSlot(item)) !== slot) continue;
        const raw = text.slice(item.start, item.end);
        if (CHANGES_HERO.test(raw)) continue;
        const paths = [...new Set([...raw.matchAll(MODELS)].map((m) => compiled(m[1]).toLowerCase()))].filter((p) => !files.has(p));
        if (!paths.length) continue;
        out.push({
          id: item.id,
          block: asItem(block, text, item, item.model || null),
          assets: paths.map((p) => under(p, ours)),
          source: `${stock.name}: everybody's`,
        });
      }
    }
  }
  return out;
}
