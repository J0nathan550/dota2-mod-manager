/* The item builder's look on everybody playing the hero (src/item-builder-everyone.ts): which of
 * the hero's wearables are dressed as the user's pick, with which files and block, and which are
 * left alone; and the pak holding one model under many paths once.
 *
 * The promise to the user: another player's Juggernaut wears what the user built, not his own items
 * on the user's body, and nothing outside that hero and those slots changes. */
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

/** Juggernaut as the game has him, cut down: two stock items, and a wearable for each case. */
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
  item('9004', 'Juggernaut Persona Blade', 'wearable', 'weapon_persona_1', 'models/items/juggernaut/persona/blade.vmdl'),
  item('9005', 'Sven Sword', 'wearable', 'weapon', 'models/items/sven/sword/sword.vmdl', '', ['sven']),
  '\t}', '}', ''].join('\n');

const SWORD = 'models/heroes/juggernaut/jugg_sword.vmdl_c';
/** The user's sword pick: the pick's block under the stock id, and its model under the stock path. */
function swordPick(model = Buffer.from('the sword the user picked')): SchemaPatch {
  const block = item('7', "Juggernaut's Weapon", 'default_item', 'weapon', 'models/heroes/juggernaut/jugg_sword.vmdl',
    modifier({ type: 'particle_create', modifier: 'particles/econ/items/juggernaut/picked/picked_glow.vpcf' })).trim();
  return { id: '7', block, assets: [entryAt(SWORD, model)], source: 'Picked Sword' };
}
const paths = (patches: SchemaPatch[]) => Object.fromEntries(patches.map((p) => [p.id, (p.assets || []).map(entryPath).sort()]));

test("every other wearable of a picked slot wears the pick's model, under each path its block names", () => {
  const pick = swordPick();
  const out = everyoneWears(TABLE, [pick], []);
  assert.deepEqual(paths(out), {
    6058: ['models/items/juggernaut/demon/demon.vmdl_c', 'models/items/juggernaut/demon/demon_style1.vmdl_c'],
    9000: ['models/items/juggernaut/fire/fire.vmdl_c'],
  }, 'the styles\' models too; not the hero-swapping sword, the shared one, the persona\'s, Sven\'s or the head');
  for (const en of out.flatMap((p) => p.assets!)) assert.equal(en.data, pick.assets![0].data, 'the same buffer, which the pak stores once');
});

test("a dressed wearable keeps its own id, name, picture and model path, with the pick's visuals in place of its own", () => {
  const merged = mergeSchema(TABLE, [swordPick(), ...everyoneWears(TABLE, [swordPick()], [])]);
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

test('a slot nothing of ours fills is left alone; one an arcana base fills wears the base, with the stock visuals', () => {
  assert.deepEqual(everyoneWears(TABLE, [], []), [], 'no pick, no base: nothing');
  const mask = entryAt('models/heroes/juggernaut/jugg_mask.vmdl_c', Buffer.from("the base's mask"));
  const out = everyoneWears(TABLE, [], [mask]);
  assert.deepEqual(paths(out), { 9003: ['models/items/juggernaut/fire/fire_mask.vmdl_c'] });
  assert.equal(out[0].assets![0].data, mask.data);
  assert.match(out[0].block, /mask_glow/, "the stock mask's own visuals");
  assert.match(out[0].block, /"name"\s+"Fire Mask"/);
});

test("a block another mod lifted stays that mod's, and a hero not on the list is not touched", () => {
  const lifted: SchemaPatch = { id: '9000', block: item('9000', 'Fire Sword', 'wearable', 'weapon', 'models/items/juggernaut/fire/fire.vmdl').trim(), source: 'Some mod' };
  assert.deepEqual(Object.keys(paths(everyoneWears(TABLE, [swordPick(), lifted], []))), ['6058']);
  assert.deepEqual(everyoneWears(TABLE, [swordPick()], [], ['sven']), [], 'Sven has no stock item our build fills');
});

test('a file the build already puts at a wearable\'s path wins over the copy', () => {
  const own = entryAt('models/items/juggernaut/fire/fire.vmdl_c', Buffer.from('a mod of the fire sword'));
  const out = everyoneWears(TABLE, [swordPick(), { id: '1', block: '"1" {}', assets: [own], source: 'A mod' }], []);
  assert.deepEqual(paths(out)[9000], undefined, 'nothing left to put there');
});

test('a pak with one model under many paths stores the bytes once, and reads back the same under each', () => {
  // big enough that a second copy cannot hide in the index's growth
  const model = Buffer.alloc(64 * 1024, 'sword');
  const pick = swordPick(model);
  const entries = [...pick.assets!, ...everyoneWears(TABLE, [pick], []).flatMap((p) => p.assets!)];
  const one = buildVpk(pick.assets!);
  const many = buildVpk(entries);
  assert.ok(many.length - one.length < 400, `only the index grows: ${many.length - one.length} bytes`);
  const read = readVpkEntries(many, 'pak01_dir.vpk');
  assert.equal(read.length, 4);
  for (const en of read) assert.ok(en.data.equals(model), entryPath(en));
});
