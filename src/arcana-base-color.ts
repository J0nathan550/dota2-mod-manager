/**
 * An arcana base (src/arcana-bases.ts) in a colour of the user's: Terrorblade's, for the arcana
 * window (src/arcana-service.ts), which offers his arcana in any RGB (issue #118).
 *
 * Valve's arcana takes its colour from its gem at run time, and src/recolor.ts rewrites what the
 * files do with the gem's colour. The base has no gem to read: it was compiled with the gem's
 * colour, Reflection's Shade, written in. So here it is that colour that moves:
 * - a particle's written colours move as far as the gem's colour moves to the chosen one (shade
 *   with `from`), so the base in red is the base as it was made;
 * - a material that read `$GemColor` has the colour as a constant expression in its place, the
 *   numbers as somebody typed them in the tools (0.235 for 60/255): one near the gem's colour
 *   becomes the chosen one, any other constant stays.
 * A file that cannot be read goes in as it is, in the base's own colour, and is counted.
 */
import { recolorResource, type Rgb } from './recolor.ts';
import { constantExpression, constantOf, rewriteExpressions } from './material.ts';
import { entryAt, entryPath, type VpkEntry } from './vpk.ts';

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
      const r = particle ? recolorResource(e.data, target, { bake: true, from: gem }) : materialInColor(e.data, target, gem);
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
