/**
 * An arcana base (src/arcana-bases.ts) in a colour of the user's: Terrorblade's, for the arcana
 * window (src/arcana-service.ts), which offers his arcana in any RGB (issue #118).
 *
 * Valve's arcana takes its colour from its gem at run time, and src/recolor.ts rewrites what the
 * files do with the gem's colour. The base has no gem to read: it was compiled with the gem's
 * colour, Reflection's Shade, written in. So here it is that colour that moves:
 * - a particle's written colours move as far as the gem's colour moves to the chosen one (shade
 *   with `from`), so the base in red is the base as it was made;
 * - a particle that puts the gem's colour on control point 15 itself has the chosen colour put
 *   there too: what reads that point is then in it (particleInColor). The base held 120 particles,
 *   94 of them so, until 2026-10-23; it is models and materials now, and the arcana's particles
 *   are the game's, baked in a colour (createColoredBases);
 * - a material that read `$GemColor` has the colour as a constant expression in its place, the
 *   numbers as somebody typed them in the tools (0.235 for 60/255): one near the gem's colour
 *   becomes the chosen one, any other constant stays.
 * A file that cannot be read goes in as it is, in the base's own colour, and is counted.
 *
 * The item builder puts the same base on when Terrorblade's arcana is picked, from its own folder
 * (src/schema-build.ts). It took the base as the repository has it, so a colour chosen in the
 * window went back to Reflection's Shade wherever the builder's copy was the one the game read.
 * While the window's record is on, the builder's copy is in its colour too; switched off or
 * removed, the builder puts on the base as it was made, which is how the user picks between them.
 */
import crypto from 'node:crypto';
import { RECOLOR_SETS, recolorResource, shade, shadeColors, type Rgb } from './recolor.ts';
import { numberOf, readKv3, writeCell, type Kv3Block, type Kv3Node } from './kv3.ts';
import { dataBlock } from './resource.ts';
import { TERRORBLADE_BASE, readyBase, type ReadyBase } from './arcana-bases.ts';
import { constantExpression, constantOf, rewriteExpressions } from './material.ts';
import { entryAt, entryPath, sharedVpkIndex, type VpkEntry } from './vpk.ts';

/** how far a typed-in channel may be from the gem's and still be the gem's: 0.235 against 0.2353 */
const NEAR = 0.01;

const isGem = (value: number[] | null, gem: Rgb) => !!value && gem.every((c, i) => Math.abs(value[i] - c / 255) <= NEAR);

/** A base's material with the gem's colour, written in, made the chosen one. */
export function materialInColor(file: Buffer, target: Rgb, gem: Rgb): { file: Buffer; changed: number } {
  return rewriteExpressions(file, (e) => {
    const value = constantOf(e.code);
    if (!isGem(value, gem)) return null;
    return constantExpression([...target.map((n) => n / 255), ...value!.slice(3)]);
  });
}

type Num = Extract<Kv3Node, { kind: 'number' }>;

/**
 * Where a particle puts a gem's colour on control point 15 itself. The base was compiled with
 * Reflection's Shade set there by C_OP_SetSingleControlPointPosition (and the tint switched on
 * through 16) in 94 of its 120 particles, so what reads that point read red from the file, not the
 * game: with only the written colours moved, the base in purple was red with a little purple.
 */
function gemPoints(kv: Kv3Block): Num[][] {
  const out: Num[][] = [];
  const visit = (node: Kv3Node) => {
    if (node.kind === 'array') { node.items.forEach(visit); return; }
    if (node.kind !== 'object') return;
    const m = node.members;
    const cls = m.get('_class');
    const cp = m.get('m_nCP1');
    const pos = m.get('m_vecCP1Pos');
    if (cls?.kind === 'string' && cls.value === 'C_OP_SetSingleControlPointPosition' && cp?.kind === 'number' && numberOf(kv, cp) === 15
      && pos?.kind === 'array' && pos.items.length === 3 && pos.items.every((x) => x.kind === 'number')) out.push(pos.items as Num[]);
    m.forEach(visit);
  };
  visit(kv.root);
  return out;
}

/**
 * A base's particle in the chosen colour. One that sets the gem's point has the colour put there
 * and its written colours moved, and is not baked: its tints read the point as for a gem of that
 * colour. Any other is moved as src/recolor.ts does for a hero with no gem.
 */
export function particleInColor(file: Buffer, target: Rgb, gem: Rgb): { file: Buffer; changed: number } {
  const block = dataBlock(file);
  const kv = readKv3(block.data);
  const points = gemPoints(kv);
  if (!points.length) return recolorResource(file, target, { bake: true, from: gem });
  let changed = 0;
  for (const pos of points) {
    if (pos.some((x) => !x.cell)) continue; // a zero written as "zero" has no bytes to change
    shade(pos.map((x) => Math.round(numberOf(kv, x))) as Rgb, target, gem).forEach((n, c) => writeCell(kv, pos[c].cell!, n));
    changed++;
  }
  changed += shadeColors(kv, target, undefined, gem).changed;
  return { file: changed ? block.replace(kv.encode()) : file, changed };
}

/** A base's files in the chosen colour: its particles and materials moved, every other file as it is. */
export function baseInColor(entries: VpkEntry[], target: Rgb, gem: Rgb): { entries: VpkEntry[]; changed: number; failed: string[] } {
  // its own colour is the base as it was made, not the base rounded through HSV and back
  if (target.every((c, i) => c === gem[i])) return { entries, changed: 0, failed: [] };
  let changed = 0;
  const failed: string[] = [];
  const out = entries.map((e) => {
    const p = entryPath(e);
    const particle = p.endsWith('.vpcf_c');
    if (!particle && !p.endsWith('.vmat_c')) return e;
    try {
      const r = particle ? particleInColor(e.data, target, gem) : materialInColor(e.data, target, gem);
      if (!r.changed) return e;
      changed++;
      return entryAt(p, r.file);
    } catch {
      failed.push(p);
      return e;
    }
  });
  return { entries: out, changed, failed };
}

/** The set the arcana window builds (src/arcana-service.ts), as its records carry it. */
export const WINDOW_SET = 'terrorblade-arcana';

/** Whether a record is the arcana window's. */
export const isWindowRecord = (rec: object) => ((rec as { generated?: { set?: string } }).generated)?.set === WINDOW_SET;

/** The colour the arcana window has Terrorblade in, while its record is on; null otherwise. */
export function windowColor(records: { enabled?: boolean; generated?: unknown }[]): Rgb | null {
  const rec = records.find((r) => isWindowRecord(r) && r.enabled !== false);
  const color = (rec?.generated as { color?: unknown } | undefined)?.color;
  return Array.isArray(color) && color.length === 3 && color.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? color as Rgb : null;
}

const sha = (entries: VpkEntry[]) => {
  const hash = crypto.createHash('sha1');
  for (const e of entries) hash.update(entryPath(e)).update(e.data);
  return hash.digest('hex');
};

/** Particles of the game's in a colour, baked: the builder's hero has no gem to tint them (src/recolor.ts). */
function particlesInColor(entries: VpkEntry[], target: Rgb, failed: string[]): VpkEntry[] {
  const { gem } = RECOLOR_SETS[WINDOW_SET];
  return entries.map((e) => {
    const p = entryPath(e);
    if (!p.endsWith('.vpcf_c')) return e;
    try {
      return entryAt(p, recolorResource(e.data, target, { gem, own: true, bake: true }).file);
    } catch {
      failed.push(p);
      return e;
    }
  });
}

/** The arcana's own particles, its folder of them, out of the game's pak01. */
function ownParticles(pak01: string): VpkEntry[] {
  const index = sharedVpkIndex(pak01);
  const own = RECOLOR_SETS[WINDOW_SET].own;
  return [...index.paths()].filter((p) => p.endsWith('.vpcf_c') && own.some((o) => p.startsWith(o)))
    .flatMap((p) => { const data = index.read(p); return data ? [entryAt(p, data)] : []; });
}

/**
 * Terrorblade's arcana as the builder puts it on, in a colour: the arcana window's while its
 * record is on, and the gem's own, Reflection's Shade, while it is not. The last one made of each
 * is kept: the recolour parses every particle, and the table is built again on every pick.
 *
 * The bases hold models and their materials alone (J0nathan550, 2026-10-23), so the arcana's
 * particles are the game's, which take their colour from the gem at run time; the builder's hero
 * has no gem, and they are baked in a colour here as the window bakes its own (src/arcana.ts):
 * - the base: its materials moved to the colour (baseInColor), and the arcana's folder of
 *   particles, out of pak01, in it as well, under their own paths;
 * - a pick of the arcana's set (`pick`): the arcana's particles it copies under the plain hero's
 *   paths, from items_game's swaps.
 * Without pak01 and without a colour the base is as it was made.
 */
export function createColoredBases(log: (msg: string) => void = () => {}) {
  let kept: { key: string; entries: VpkEntry[] } | null = null;
  let keptPick: { key: string; entries: VpkEntry[] } | null = null;
  const said = (what: string, failed: string[]) => {
    if (failed.length) log(`schema: ${failed.length} files of ${what} kept their own colour, first ${failed[0]}`);
  };
  return {
    bases: (ready: ReadyBase[], color: Rgb | null, pak01: string | null = null): ReadyBase[] => ready.map((r) => {
      if (r.base.id !== TERRORBLADE_BASE || (!color && !pak01)) return r;
      const target = color || RECOLOR_SETS[WINDOW_SET].gem;
      const key = `${sha(r.entries)}|${target.join(',')}|${pak01}`;
      if (kept?.key !== key) {
        const failed: string[] = [];
        const colored = color ? baseInColor(r.entries, color, RECOLOR_SETS[WINDOW_SET].gem) : { entries: r.entries, failed: [] };
        failed.push(...colored.failed);
        const have = new Set(colored.entries.map(entryPath));
        const own = pak01 ? particlesInColor(ownParticles(pak01).filter((e) => !have.has(entryPath(e))), target, failed) : [];
        said(r.base.id, failed);
        kept = { key, entries: [...colored.entries, ...own] };
      }
      return kept.entries === r.entries ? r : readyBase(r.base, kept.entries);
    }),
    pick: (entries: VpkEntry[], color: Rgb | null): VpkEntry[] => {
      const target = color || RECOLOR_SETS[WINDOW_SET].gem;
      const key = `${sha(entries)}|${target.join(',')}`;
      if (keptPick?.key !== key) {
        const failed: string[] = [];
        keptPick = { key, entries: particlesInColor(entries, target, failed) };
        said("Terrorblade's arcana", failed);
      }
      return keptPick.entries;
    },
  };
}
