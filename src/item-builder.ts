/* The item builder: a hero's stock item built from one of its wearables, with an effect on top.
 *
 * For each hero and slot the free cosmetics offer that hero's wearables. Picking one rewrites its
 * block in items_game under the stock item's id, name and prefab=default_item, drops the styles
 * and unlocks a free base item cannot use, adds the chosen particle effect to its visuals, and
 * lists the model and particles to copy out of the game's pak01 under the stock paths, so the
 * game draws the wearable where the stock item was. An arcana that swaps the whole hero brings its
 * hero model too, under the plain hero's. src/schema-service.ts applies it along with
 * the rest of the free cosmetics; src/schema.ts reads and merges the table.
 *
 * What the builder offers (slots, sets, effects) is src/item-builder-slots.ts, re-exported here;
 * this file is what a pick writes.
 *
 * Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
 * (https://github.com/TheFleece).
 * Copyright (C) 2026 h6rd
 * Copyright (C) 2026 TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
 * the credits of the program it goes into.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openVpkIndex, entryAt, type VpkEntry } from './vpk.ts';
import { t } from './i18n.ts';
import {
  findItem, itemFields, listItems, eachChild, blockBounds, stripKeyBlocks, inferredItemSlot,
  type SchemaItem,
} from './schema.ts';
import {
  canonicalItemSlot, isPersonaItem, itemHeroes, matchItemSlot, type AssetCopy,
} from './item-builder-slots.ts';
import { ITEM_EFFECTS, type ItemEffect } from './item-builder-effects.ts';
import { asModel } from './arcana.ts';

export { itemSlots, itemSets, itemOptions } from './item-builder-slots.ts';
export { itemEffects } from './item-builder-effects.ts';
export type { ItemSlot, ItemSet, AssetCopy } from './item-builder-slots.ts';

// ---------- reading the game's own schema ----------

function setScalarField(blockText: string, key: string, value: string): string {
  const body = blockBounds(blockText, 0);
  let hit = null as { start: number; end: number } | null;
  eachChild(blockText, body, (c) => {
    if (!hit && !c.isBlock && c.key.toLowerCase() === key.toLowerCase()) hit = c;
  });
  const line = `"${key}"\t\t"${value}"`;
  if (hit) return blockText.slice(0, hit.start) + line + blockText.slice(hit.end);
  const close = blockText.lastIndexOf('}');
  return close === -1 ? blockText : `${blockText.slice(0, close)}\r\n\t${line}\r\n${blockText.slice(close)}`;
}

function setVisualsBlock(blockText: string, visuals: string): string {
  const body = blockBounds(blockText, 0);
  let hit = null as { start: number; end: number } | null;
  eachChild(blockText, body, (c) => {
    if (!hit && c.isBlock && c.key.toLowerCase() === 'visuals') hit = c;
  });
  const clean = visuals.trim();
  if (hit) return blockText.slice(0, hit.start) + clean + blockText.slice(hit.end);
  const close = blockText.lastIndexOf('}');
  return close === -1 ? blockText : `${blockText.slice(0, close)}\r\n\t${clean}\r\n${blockText.slice(close)}`;
}

function itemEffectById(effectId: unknown): ItemEffect | null {
  const want = String(effectId || '').trim().toLowerCase();
  return ITEM_EFFECTS.find((e) => e.id === want) || null;
}

/**
 * The effects of one pick as one string: ids in the order ITEM_EFFECTS lists them, each once,
 * comma separated, '' for none. A pick carries several (the window says "you can pick several"),
 * and this is how a record stores them and how two picks are told apart, so "fire,snow" and
 * "snow,fire" are the same pick.
 */
export function effectKey(effectIds: string | string[] | null | undefined): string {
  const want = new Set((Array.isArray(effectIds) ? effectIds : String(effectIds || '').split(','))
    .map((id) => String(id).trim().toLowerCase())
    .filter(Boolean));
  const known = ITEM_EFFECTS.map((e) => e.id).filter((id) => want.has(id));
  // an id nobody offers stays in, at the end, so the build can say which one it did not know
  const unknown = [...want].filter((id) => !known.includes(id)).sort();
  return [...known, ...unknown].join(',');
}

function setBlockId(blockText: string, id: string): string {
  return String(blockText).replace(/^\s*"\d+"/, `"${id}"`);
}


function itemBlock(text: string, item: { start: number; end: number }): string {
  return text.slice(item.start, item.end);
}

function itemVisuals(text: string, item: { start: number }): string | null {
  let visuals = null as string | null;
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (c.isBlock && c.key.toLowerCase() === 'visuals') visuals = text.slice(c.start, c.end);
  });
  return visuals;
}

function normalizeAssetPath(p: unknown): string {
  return String(p || '').toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
}

function compiledAssetPath(p: unknown): string {
  const clean = normalizeAssetPath(p);
  return clean.endsWith('_c') ? clean : `${clean}_c`;
}

function sameHeroes(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

/** The stock default_item that matches a wearable by slot and by the hero(es) that can equip it. */
export function defaultItemForWearable(text: string, sourceId: string | number): SchemaItem | null {
  const source = findItem(text, sourceId);
  if (!source) throw new Error(t('items_game: предмет {0} не найден', sourceId));
  const sourceFields = itemFields(text, source);
  const sourceLite = listItems(text).find((i) => i.id === source.id) || null;
  if (sourceLite && isPersonaItem(sourceLite)) return null;
  const sourceSlot = canonicalItemSlot(sourceFields.get('item_slot') || inferredItemSlot(sourceLite));
  if (!sourceSlot) return null;
  const sourceMatchSlot = matchItemSlot(sourceSlot);
  const sourceHeroes = itemHeroes(text, source);
  const exact = listItems(text)
    .filter((i) => i.id !== source.id && canonicalItemSlot(inferredItemSlot(i)) === sourceSlot && i.prefab === 'default_item' && !isPersonaItem(i))
    .map((i) => ({ item: i, heroes: itemHeroes(text, i) }))
    .filter((x) => sameHeroes(x.heroes, sourceHeroes))
    .map((x) => x.item)
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (exact.length) return exact[0];
  return listItems(text)
    .filter((i) => i.id !== source.id && matchItemSlot(inferredItemSlot(i)) === sourceMatchSlot && i.prefab === 'default_item' && !isPersonaItem(i))
    .map((i) => ({ item: i, heroes: itemHeroes(text, i) }))
    .filter((x) => sameHeroes(x.heroes, sourceHeroes))
    .map((x) => x.item)
    .sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
}

/**
 * The files an item's visuals swap, to stage under the plain paths: particles, models, and the
 * hero's own model (an arcana's entity_model) with the item's activity modifiers to take off it.
 *
 * Only the first style's: the patch drops the styles, so the item is in its first. Bladeform
 * Legacy swaps every one of its particles twice, once per style, and the second would have won.
 *
 * Only what the hero has on without the item. An entity_model for another unit is left alone:
 * Rubick's arcana reshapes Spirit Bear and a dozen other heroes' summons for when he steals them.
 * So is a model swap for anything but a stock item of the hero's: Queen of Pain's arcana lists 40,
 * nearly all refits of paid shoulders to its body, and under their plain paths everyone wearing
 * one would have the refit (and one of them is not in the game's files at all). The stock ones are
 * what is worn under the arcana: Zeus's vest and bracers become an invisible box, its body has them.
 * Some items number their entries (asset_modifier0, asset_modifier1: Zeus's and Phantom Assassin's
 * arcanas), and those were read as no entries at all.
 */
function visualCopies(visuals: string, heroes: string[], stockModels: Set<string>): AssetCopy[] {
  const mods: Map<string, string>[] = [];
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || !/^asset_modifier\d*$/i.test(c.key)) return;
    const fields = new Map<string, string>();
    eachChild(visuals, c.body, (f) => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    const style = fields.get('style');
    if (!style || style === '0') mods.push(fields);
  });
  const typed = (type: string) => mods.filter((f) => (f.get('type') || '').toLowerCase() === type && f.get('asset') && f.get('modifier'));
  const activities = [...new Set(typed('activity').map((f) => f.get('modifier')!))];
  return [
    ...typed('entity_model').filter((f) => heroes.includes(f.get('asset')!.toLowerCase()))
      .map((f) => ({ from: f.get('modifier')!, hero: f.get('asset')!.toLowerCase(), activities })),
    ...typed('model').filter((f) => stockModels.has(normalizeAssetPath(f.get('asset'))))
      .map((f) => ({ from: f.get('modifier')!, to: f.get('asset')! })),
    ...typed('particle').map((f) => ({ from: f.get('modifier')!, to: f.get('asset')! })),
  ];
}

/** The models of the stock items any of these heroes wears, as normalizeAssetPath writes them. */
function stockModelsOf(text: string, heroes: string[]): Set<string> {
  return new Set(listItems(text)
    .filter((i) => i.prefab === 'default_item' && i.model && itemHeroes(text, i).some((h) => heroes.includes(h)))
    .map((i) => normalizeAssetPath(i.model)));
}

function appendItemEffect(visuals: string, effect: ItemEffect): string {
  const needle = String(effect.modifier || '').toLowerCase();
  if (needle && visuals.toLowerCase().includes(needle)) return visuals;
  const block = `"asset_modifier"\r\n{\r\n\t"type"\t\t"${effect.type}"\r\n\t"modifier"\t\t"${effect.modifier}"\r\n}`;
  // set from inside the walk, which is why they are widened by hand
  let after = null as number | null;
  let before = null as number | null;
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'asset_modifier') return;
    const fields = new Map<string, string>();
    eachChild(visuals, c.body, (f) => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    const type = (fields.get('type') || '').toLowerCase();
    if (type === 'particle_create') after = c.end;
    else if (after !== null && before === null) before = c.start;
  });
  const close = visuals.lastIndexOf('}');
  const at = before ?? after ?? close;
  if (at === -1) return visuals;
  const prefix = '\r\n\t';
  const suffix = before === null ? '\r\n' : '\r\n\t';
  return `${visuals.slice(0, at)}${prefix}${block}${suffix}${visuals.slice(at)}`;
}

/* Turn one paid wearable into the hero's stock item for that slot.
 *
 * The block stays the donor item almost verbatim: only the header is rewritten to the matching
 * default_item (id + name + prefab), styles/unlocks that cannot be used on a free base item are
 * dropped, and the chosen effect is inserted into visuals. The donor model/particles stay named
 * as the paid item in items_game, while assetCopies still describe the stock-path overrides the
 * built VPK should carry.
 */
export function itemEffectPatch(baseText: string, itemId: string | number, effectIds: string | string[] | null | undefined): { id: string; block: string; assetCopies: AssetCopy[] } {
  const source = findItem(baseText, itemId);
  if (!source) throw new Error(t('items_game: предмет {0} не найден', itemId));
  const target = defaultItemForWearable(baseText, itemId);
  if (!target) throw new Error(t('items_game: default_item для предмета {0} не найден', itemId));
  // several at once: the window offers them that way, and one unknown id refuses the whole pick
  const effects = effectKey(effectIds).split(',').filter(Boolean).map((id) => {
    const effect = itemEffectById(id);
    if (!effect) throw new Error(t('items_game: эффект {0} не найден', id));
    return effect;
  });

  const sourceFields = itemFields(baseText, source);
  const targetFields = itemFields(baseText, target);
  let visuals = itemVisuals(baseText, source) || '"visuals"\r\n{\r\n}';

  const assetCopies: AssetCopy[] = [];
  const sourceModel = sourceFields.get('model_player') || '';
  const targetModel = targetFields.get('model_player') || '';
  if (sourceModel && targetModel && normalizeAssetPath(sourceModel) !== normalizeAssetPath(targetModel)) {
    assetCopies.push({ from: sourceModel, to: targetModel });
  }
  const heroes = itemHeroes(baseText, source);
  assetCopies.push(...visualCopies(visuals, heroes, stockModelsOf(baseText, heroes)));

  visuals = stripKeyBlocks(visuals, 'unlock');
  visuals = stripKeyBlocks(visuals, 'styles');
  for (const effect of effects) visuals = appendItemEffect(visuals, effect);

  let patched = setBlockId(itemBlock(baseText, source), target.id);
  patched = setScalarField(patched, 'name', targetFields.get('name') || target.name || target.id);
  patched = setScalarField(patched, 'prefab', 'default_item');
  patched = setVisualsBlock(patched, visuals);
  return { id: target.id, block: patched, assetCopies };
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
