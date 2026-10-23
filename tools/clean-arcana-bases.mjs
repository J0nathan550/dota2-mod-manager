/* Strips a compiled arcana base (game/dota_addons/<name>) down to what the base is for: the
   hero's models with their animations, and the materials and textures of those models.

   Everything else comes from the game when the app puts the arcana on, through items_game
   (src/arcana-base-store.ts takes nothing else): its particles, sounds, pictures and the swaps
   between them, which items_game names and the app reads out of pak01. The rest is the editor's own
   bookkeeping (tools_thumbnail_cache, tools_asset_info). Until 2026-10-23 a base kept its
   particles as well; J0nathan550 keeps the bases to the models, so they follow the game's updates.

   A material that belongs to a particle (materials/<anything>/particles/...) goes with the
   particles. Models are kept whoever they belong to: Rubick's arcana reshapes Lycan's wolf,
   Undying's golem and Pangolier's ball for when he steals them, and those are wanted.

   Usage: node tools/clean-arcana-bases.mjs [--root <game/dota_addons>] [--apply] [name...]
     With no names, every addon without an addoninfo.txt (Valve's own all have one).
     Without --apply it only lists what it would take out. With --apply the files are moved to
     <root>/../dota_addons_removed/<name>/, not deleted, so a mistake costs a move back and not a
     recompile. */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ROOT = 'D:/SteamLibrary/steamapps/common/dota 2 beta/game/dota_addons';

/** Why a file goes, or null when it stays. `rel` is lower case with forward slashes. */
function reasonToRemove(rel) {
  if (rel.startsWith('models/')) return null;
  if (rel.startsWith('materials/')) return /\/particles\//.test(rel) ? 'particle material' : null;
  return rel.split('/')[0];
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

/** Empty folders left behind, deepest first, the addon's own folder kept. */
function pruneEmpty(dir, top = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmpty(path.join(dir, e.name), top);
  }
  if (dir !== top && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let apply = false;
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--root') root = argv[++i];
    else names.push(argv[i]);
  }
  if (!fs.existsSync(root)) throw new Error(`no such folder: ${root}`);
  const addons = names.length ? names : fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !fs.existsSync(path.join(root, e.name, 'addoninfo.txt')))
    .map((e) => e.name);
  const trash = path.join(path.dirname(root), 'dota_addons_removed');

  let total = 0;
  for (const name of addons) {
    const dir = path.join(root, name);
    if (!fs.existsSync(dir)) { console.log(`${name}: not found, skipped`); continue; }
    const files = walk(dir);
    const gone = files.map((rel) => ({ rel, why: reasonToRemove(rel.toLowerCase()) })).filter((f) => f.why);
    const byWhy = new Map();
    for (const f of gone) byWhy.set(f.why, (byWhy.get(f.why) || 0) + 1);
    console.log(`${name}: ${files.length - gone.length} kept, ${gone.length} out`
      + (gone.length ? ` (${[...byWhy].map(([w, n]) => `${w} ${n}`).join(', ')})` : ''));
    if (apply) {
      for (const f of gone) {
        const to = path.join(trash, name, f.rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(dir, f.rel), to);
      }
      pruneEmpty(dir);
    }
    total += gone.length;
  }
  console.log(apply ? `\nmoved ${total} files to ${trash}` : `\n${total} files would go. Run again with --apply to move them.`);
}

main(process.argv.slice(2));
