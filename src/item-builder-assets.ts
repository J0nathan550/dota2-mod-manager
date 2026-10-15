/**
 * What an item builder pick needs beyond its block in items_game: the game's files it puts under
 * the plain paths (models, particles, the hero's own model), and the sounds and voice it makes the
 * hero's own (src/item-sounds.ts writes those). src/item-builder.ts makes the block and asks this
 * for the rest; the build reads the files out of pak01 here, in gameAssetEntries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openVpkIndex, entryAt, type VpkEntry } from './vpk.ts';
import { t } from './i18n.ts';
import { listItems, eachChild, blockBounds } from './schema.ts';
import { itemHeroes, type AssetCopy } from './item-builder-slots.ts';
import { asModel } from './arcana.ts';
import type { SoundSwap, VoiceCue } from './item-sounds.ts';

/** What a pick asks of the game's files, beside its block. */
export interface ItemAssets { assetCopies: AssetCopy[]; sounds: SoundSwap[]; voices: VoiceCue[] }

export function normalizeAssetPath(p: unknown): string {
  return String(p || '').toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
}

function compiledAssetPath(p: unknown): string {
  const clean = normalizeAssetPath(p);
  return clean.endsWith('_c') ? clean : `${clean}_c`;
}

/** The models of the stock items any of these heroes wears, as normalizeAssetPath writes them. */
function stockModelsOf(text: string, heroes: string[]): Set<string> {
  return new Set(listItems(text)
    .filter((i) => i.prefab === 'default_item' && i.model && itemHeroes(text, i).some((h) => heroes.includes(h)))
    .map((i) => normalizeAssetPath(i.model)));
}

/**
 * The files an item's visuals swap, to stage under the plain paths: particles, models, and the
 * hero's own model (an arcana's entity_model) with the item's activity modifiers to take off it;
 * and the sound events and voice it switches, which the server only switches for its owner.
 *
 * Only the first style's: the patch leaves the item in its first style, which is the chosen one
 * written as the first (src/item-builder-styles.ts). Bladeform Legacy swaps every one of its
 * particles twice, once per style, and the second would have won.
 *
 * Only what the hero has on without the item. An entity_model for another unit is left alone:
 * Rubick's arcana reshapes Spirit Bear and a dozen other heroes' summons for when he steals them.
 * So is a model swap for anything but a stock item of the hero's: Queen of Pain's arcana lists 40,
 * nearly all refits of paid shoulders to its body, and under their plain paths everyone wearing
 * one would have the refit (and one of them is not in the game's files at all). The stock ones are
 * what is worn under the arcana: Zeus's vest and bracers become an invisible box, its body has them.
 * Some items number their entries (asset_modifier0, asset_modifier1: Zeus's and Phantom Assassin's
 * arcanas), and those were read as no entries at all.
 * @param text  items_game, for the hero's stock models
 * @param heroes  the item's heroes, npc_dota_hero_*
 */
export function itemAssets(text: string, visuals: string, heroes: string[]): ItemAssets {
  const mods: Map<string, string>[] = [];
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || !/^asset_modifier\d*$/i.test(c.key)) return;
    const fields = new Map<string, string>();
    eachChild(visuals, c.body, (f) => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    const style = fields.get('style');
    if (!style || style === '0') mods.push(fields);
  });
  const typed = (type: string, ...keys: string[]) => mods.filter((f) => (f.get('type') || '').toLowerCase() === type && keys.every((k) => f.get(k)));
  const activities = [...new Set(typed('activity', 'modifier').map((f) => f.get('modifier')!))];
  const stock = stockModelsOf(text, heroes);
  return {
    assetCopies: [
      ...typed('entity_model', 'asset', 'modifier').filter((f) => heroes.includes(f.get('asset')!.toLowerCase()))
        .map((f) => ({ from: f.get('modifier')!, hero: f.get('asset')!.toLowerCase(), activities })),
      ...typed('model', 'asset', 'modifier').filter((f) => stock.has(normalizeAssetPath(f.get('asset'))))
        .map((f) => ({ from: f.get('modifier')!, to: f.get('asset')! })),
      ...typed('particle', 'asset', 'modifier').map((f) => ({ from: f.get('modifier')!, to: f.get('asset')! })),
    ],
    sounds: typed('sound', 'asset', 'modifier').map((f) => ({ sound: f.get('asset')!, as: f.get('modifier')! })),
    // a persona's criterion "is_target" is said of the hero it targets, not of the one wearing it
    voices: typed('response_criteria', 'asset').filter((f) => !f.get('is_target'))
      .flatMap((f) => heroes.map((hero) => ({ hero, key: f.get('modifier') || 'customresponse', value: f.get('asset')! }))),
  };
}

/**
 * Where a hero's own model lives: the first "Model" in its script, which is the hero's (the ones
 * after it are its summons'). Shadow Fiend is npc_dota_hero_nevermore in models/heroes/shadow_fiend,
 * so the path cannot be made from the name.
 */
function heroModelPath(ix: ReturnType<typeof openVpkIndex>, hero: string): string {
  const script = ix.read(`scripts/npc/heroes/${hero}.txt`);
  const model = script?.toString('latin1').match(/^\s*"Model"\s+"([^"]+)"/mi)?.[1];
  if (!model) throw new Error(t('Не найдена модель героя {0}', hero));
  return model;
}

/**
 * A hero model as it goes under the plain hero's path: its animations that need the item's
 * activity modifiers made the ones it plays without them. Online the server keeps the plain hero
 * and never switches the modifier on, and without this Terrorblade's arcana stood still through
 * its attacks (issue #118). A model the reader cannot open (Phantom Assassin's, KV3 compressed
 * with zstd before version 5) goes in as it is: it still looks right, and plays right offline.
 */
function heroModelBytes(data: Buffer, activities: string[]): Buffer {
  try {
    return activities.reduce((model, modifier) => asModel(model, modifier), data);
  } catch {
    return data;
  }
}

/** Read compiled asset bytes out of pak01 and stage them under the renamed path in our VPK. */
export function gameAssetEntries(gamePath: string, assetCopies: AssetCopy[] | null | undefined): VpkEntry[] {
  const pak = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(pak)) throw new Error(t('Не найден {0}', pak));
  const ix = openVpkIndex(pak);
  const out: VpkEntry[] = [];
  const seen = new Set<string>();
  for (const copy of assetCopies || []) {
    const from = compiledAssetPath(copy.from);
    const to = compiledAssetPath('hero' in copy ? heroModelPath(ix, copy.hero) : copy.to);
    if (!from || !to || seen.has(to)) continue;
    const data = ix.read(from);
    if (!data) throw new Error(t('Не найден {0}', from));
    out.push(entryAt(to, 'hero' in copy ? heroModelBytes(data, copy.activities) : data));
    seen.add(to);
  }
  return out;
}
