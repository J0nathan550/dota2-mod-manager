/* The item builder's look on everybody playing the hero (src/item-builder-everyone.ts): which of
 * a hero's wearables are dressed as the user's hero, with which files and block, and which are left
 * alone; and the pak holding one model under many paths once.
 *
 * The promise to the user: another player of a hero the user built looks like the user's hero, slot
 * by slot (his pick, else the stock item, else nothing), never his own store items on the user's
 * body, and nothing outside those heroes changes. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { everyoneWears } from '../src/item-builder-everyone.ts';
import { findItem, mergeSchema, type SchemaPatch } from '../src/schema.ts';
import { buildVpk, entryAt, entryPath, readVpkEntries } from '../src/vpk.ts';

const heroes = (...names: string[]) => `"used_by_heroes"\n\t\t\t{\n${names.map((n) => `\t\t\t\t"npc_dota_hero_${n}"\t\t"1"`).join('\n')}\n\t\t\t}`;
const item = (id: string, name: string, prefab: string, slot: string, model: string, extra = '', who = ['juggernaut']) => [
  `\t\t"${id}"`, '\t\t{',
  `\t\t\t"name"\t\t"${name}"`, `\t\t\t"prefab"\t\t"${prefab}"`,
  `\t\t\t"image_inventory"\t\t"econ/items/${id}"`,
  ...(slot ? [`\t\t\t"item_slot"\t\t"${slot}"`] : []),
  ...(model ? [`\t\t\t"model_player"\t\t"${model}"`] : []),
  `\t\t\t${heroes(...who)}`,
  ...(extra ? [`\t\t\t"visuals"\n\t\t\t{\n${extra}\n\t\t\t}`] : []),
  '\t\t}',
].join('\n');
const modifier = (fields: Record<string, string>) => `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n${Object.entries(fields).map(([k, v]) => `\t\t\t\t\t"${k}"\t\t"${v}"`).join('\n')}\n\t\t\t\t}`;
const styles = (...models: string[]) => `\t\t\t\t"styles"\n\t\t\t\t{\n${models.map((m, i) => `\t\t\t\t\t"${i}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"model_player"\t\t"${m}"\n\t\t\t\t\t}`).join('\n')}\n\t\t\t\t}`;

/** Juggernaut as the game has him, cut down: stock items, and a wearable for each case; and Sven's sword. */
const TABLE = ['"items_game"', '{', '\t"items"', '\t{',
  item('6', "Juggernaut's Mask", 'default_item', 'head', 'models/heroes/juggernaut/jugg_mask.vmdl',
    modifier({ type: 'particle_create', modifier: 'particles/units/heroes/hero_juggernaut/mask_glow.vpcf' })),
  item('7', "Juggernaut's Weapon", 'default_item', 'weapon', 'models/heroes/juggernaut/jugg_sword.vmdl'),
  item('6058', 'Blade of the Wandering Demon', 'wearable', 'weapon', 'models/items/juggernaut/demon/demon.vmdl',
    styles('models/items/juggernaut/demon/demon.vmdl', 'models/items/juggernaut/demon/demon_style1.vmdl')),
  item('9000', 'Fire Sword', 'wearable', 'weapon', 'models/items/juggernaut/fire/fire.vmdl',
    modifier({ type: 'particle_create', modifier: 'particles/econ/items/juggernaut/fire/fire_ambient.vpcf' })),
  item('9001', 'Sword That Swaps the Hero', 'wearable', 'weapon', 'models/items/juggernaut/swap/swap.vmdl',
    modifier({ type: 'entity_model', asset: 'npc_dota_hero_juggernaut', modifier: 'models/heroes/juggernaut/juggernaut_arcana.vmdl' })),
  item('9002', 'Sword of Two Heroes', 'wearable', 'weapon', 'models/items/shared/two/two.vmdl', '', ['juggernaut', 'sven']),
  item('9003', 'Fire Mask', 'wearable', 'head', 'models/items/juggernaut/fire/fire_mask.vmdl'),
  // a stock item with no model, as Earthshaker's head is his body's, and a store item for it
  item('8', "Juggernaut's Neck", 'default_item', 'neck', ''),
  item('9006', 'Neck Charm', 'wearable', 'neck', 'models/items/juggernaut/charm/charm.vmdl',
    modifier({ type: 'particle_create', modifier: 'particles/econ/items/juggernaut/charm/charm_ambient.vpcf' })),
  item('9007', 'Something With No Stock Slot', 'wearable', 'misc', 'models/items/juggernaut/misc/misc.vmdl'),
  item('9004', 'Juggernaut Persona Blade', 'wearable', 'weapon_persona_1', 'models/items/juggernaut/persona/blade.vmdl'),
  item('99', "Sven's Sword", 'default_item', 'weapon', 'models/heroes/sven/sven_sword.vmdl', '', ['sven']),
  item('9005', 'Sven Sword', 'wearable', 'weapon', 'models/items/sven/sword/sword.vmdl', '', ['sven']),
  '\t}', '}', ''].join('\n');

const SWORD = 'models/heroes/juggernaut/jugg_sword.vmdl_c';
/** The user's sword pick: the pick's block under the stock id, and its model under the stock path. */
function swordPick(model = Buffer.from('the sword the user picked')): SchemaPatch {
  const block = item('7', "Juggernaut's Weapon", 'default_item', 'weapon', 'models/heroes/juggernaut/jugg_sword.vmdl',
    modifier({ type: 'particle_create', modifier: 'particles/econ/items/juggernaut/picked/picked_glow.vpcf' })).trim();
  return { id: '7', block, assets: [entryAt(SWORD, model)], source: 'Picked Sword' };
}
/** The game's pak, as much of it as these tests read: the stock models and Valve's invisible box. */
const GAME: Record<string, Buffer> = {
  'models/heroes/juggernaut/jugg_mask.vmdl_c': Buffer.from("the game's own mask"),
  'models/heroes/juggernaut/jugg_sword.vmdl_c': Buffer.from("the game's own sword"),
  'models/heroes/sven/sven_sword.vmdl_c': Buffer.from("Sven's own sword"),
  'models/heroes/monkey_king/transform_invisiblebox.vmdl_c': Buffer.from('nothing to see'),
};
const read = (p: string) => GAME[p] ?? null;
const wears = (list: SchemaPatch[], beneath: ReturnType<typeof entryAt>[] = [], heroes?: string[]) => everyoneWears(TABLE, list, beneath, read, heroes);
const of = (out: SchemaPatch[], id: string) => out.find((p) => p.id === id)!;
const paths = (patches: SchemaPatch[]) => Object.fromEntries(patches.map((p) => [p.id, (p.assets || []).map(entryPath).sort()]));

test("a hero the build dresses is worn by everybody as the user's is, slot by slot", () => {
  const pick = swordPick();
  const out = wears([pick]);
  assert.deepEqual(paths(out), {
    6058: ['models/items/juggernaut/demon/demon.vmdl_c', 'models/items/juggernaut/demon/demon_style1.vmdl_c'],
    9000: ['models/items/juggernaut/fire/fire.vmdl_c'],
    9003: ['models/items/juggernaut/fire/fire_mask.vmdl_c'],
    9006: ['models/items/juggernaut/charm/charm.vmdl_c'],
  }, "the styles' models too; not the hero-swapping sword, the shared one, the persona's, the one with no stock slot, or Sven's");
  for (const id of ['6058', '9000']) for (const en of of(out, id).assets!) assert.equal(en.data, pick.assets![0].data, 'the picked sword, one buffer the pak stores once');
  assert.equal(of(out, '9003').assets![0].data.toString(), "the game's own mask", 'a slot nothing is picked in: the stock item');
  assert.match(of(out, '9003').block, /mask_glow/, 'with its visuals');
  assert.equal(of(out, '9006').assets![0].data.toString(), 'nothing to see', 'a stock item with no model: the invisible box');
  assert.doesNotMatch(of(out, '9006').block, /charm_ambient/, 'and none of its own particles');
});

test("a dressed wearable keeps its own id, name, picture and model path, with the pick's visuals in place of its own", () => {
  const merged = mergeSchema(TABLE, [swordPick(), ...wears([swordPick()])]);
  assert.deepEqual(merged.conflicts, []);
  const fire = findItem(merged.text, '9000')!;
  const block = merged.text.slice(fire.start, fire.end);
  assert.match(block, /^"9000"/);
  assert.match(block, /"name"\s+"Fire Sword"/);
  assert.match(block, /"prefab"\s+"wearable"/, 'not a default item: the game would treat it as one every account owns');
  assert.match(block, /"image_inventory"\s+"econ\/items\/9000"/);
  assert.match(block, /"model_player"\s+"models\/items\/juggernaut\/fire\/fire.vmdl"/);
  assert.match(block, /picked_glow/, "the pick's particles");
  assert.doesNotMatch(block, /fire_ambient/, 'and not its own, which would hang off the picked sword');
});

test("an arcana base's part dresses its slot, and the slots it leaves are the stock items (Planetfall's belt)", () => {
  assert.deepEqual(wears([]), [], 'nothing built: nothing');
  const mask = entryAt('models/heroes/juggernaut/jugg_mask.vmdl_c', Buffer.from("the base's mask"));
  const out = wears([], [mask]);
  assert.deepEqual(Object.keys(paths(out)).sort(), ['6058', '9000', '9003', '9006']);
  assert.equal(of(out, '9003').assets![0].data, mask.data, "the base's part");
  assert.equal(of(out, '9000').assets![0].data.toString(), "the game's own sword", 'the slot the base leaves: the stock sword');
});

test("a block another mod lifted stays that mod's, and a hero not on the list is not touched", () => {
  const lifted: SchemaPatch = { id: '9000', block: item('9000', 'Fire Sword', 'wearable', 'weapon', 'models/items/juggernaut/fire/fire.vmdl').trim(), source: 'Some mod' };
  assert.ok(!('9000' in paths(wears([swordPick(), lifted]))));
  assert.deepEqual(wears([swordPick()], [], ['sven']), [], 'Sven only, and nothing of his is built');
});

test("every hero the build dresses is done in one go, each hero's wearables in his own", () => {
  const sven: SchemaPatch = { id: '99', block: item('99', "Sven's Sword", 'default_item', 'weapon', 'models/heroes/sven/sven_sword.vmdl', '', ['sven']).trim(),
    assets: [entryAt('models/heroes/sven/sven_sword.vmdl_c', Buffer.from("the user's sword for Sven"))], source: 'Sven pick' };
  const jugg = swordPick();
  const out = wears([jugg, sven]);
  assert.deepEqual(Object.keys(paths(out)).sort(), ['6058', '9000', '9003', '9005', '9006']);
  assert.equal(of(out, '9005').assets![0].data, sven.assets![0].data, "Sven's in Sven's pick");
  assert.equal(of(out, '9000').assets![0].data, jugg.assets![0].data, "Juggernaut's in his");
  assert.deepEqual(Object.keys(paths(wears([jugg, sven], [], ['sven']))), ['9005'], 'and a list of heroes keeps to it');
});

test("a file the build already puts at a wearable's path wins over the copy", () => {
  const own = entryAt('models/items/juggernaut/fire/fire.vmdl_c', Buffer.from('a mod of the fire sword'));
  const out = wears([swordPick(), { id: '1', block: '"1" {}', assets: [own], source: 'A mod' }]);
  assert.ok(!('9000' in paths(out)), 'nothing left to put there');
});

test('a pak with one model under many paths stores the bytes once, and reads back the same under each', () => {
  // big enough that a second copy cannot hide in the index's growth
  const model = Buffer.alloc(64 * 1024, 'sword');
  const pick = swordPick(model);
  const swords = wears([pick]).flatMap((p) => p.assets!).filter((e) => e.data === model);
  const one = buildVpk(pick.assets!);
  const many = buildVpk([...pick.assets!, ...swords]);
  assert.ok(many.length - one.length < 400, `only the index grows: ${many.length - one.length} bytes`);
  const back = readVpkEntries(many, 'pak01_dir.vpk');
  assert.equal(back.length, 4);
  for (const en of back) assert.ok(en.data.equals(model), entryPath(en));
});
