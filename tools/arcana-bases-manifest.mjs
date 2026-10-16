/* Writes manifest.json into a checkout of the arcana bases' repository (src/arcana-base-store.ts):
   each base under src/<id>/ with git's hash of each of its files, the VPK of them left out.

   The app reads the same list from the repository's git tree on api.github.com, and needs this
   file only where that host cannot be reached and the mirrors can: so it has to be what the tree
   says, which is why it is written from the files and not by hand. Run it before each push.

   Usage: node tools/arcana-bases-manifest.mjs <checkout of d2pfx-arcana-fixes> */
import fs from 'node:fs';
import path from 'node:path';
import { blobSha } from '../src/arcana-base-store.ts';

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'src'))) {
  console.error('usage: node tools/arcana-bases-manifest.mjs <checkout with a src/ folder of bases>');
  process.exit(1);
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const bases = {};
for (const id of fs.readdirSync(path.join(root, 'src')).sort()) {
  const dir = path.join(root, 'src', id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = {};
  for (const rel of walk(dir).sort()) {
    if (!rel.includes('/') && rel.toLowerCase().endsWith('.vpk')) continue;
    files[rel] = blobSha(fs.readFileSync(path.join(dir, rel)));
  }
  bases[id] = files;
  console.log(`${id}: ${Object.keys(files).length} files`);
}
fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify({ bases }, null, 1)}\n`);
console.log(`\nwrote ${path.join(root, 'manifest.json')}`);
