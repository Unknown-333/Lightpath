// Checks run at the end of every build. The build fails if one fails.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PALETTE } from '../../src/palette.mjs';
import { TOKENS } from './tokens.mjs';

const OVERPRINT = PALETTE.find((p) => p.name === 'pink over indigo').hex;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const lum = (hex) => {
  const ch = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

export function runChecks(root, { fav16 }) {
  const fails = [];
  const files = {};
  const allowed = new Set([...Object.values(TOKENS), OVERPRINT, '#fff', '#000']);
  for (const p of walk(root)) {
    const rel = relative(root, p).replaceAll('\\', '/');
    if (rel.startsWith('fonts/') || rel.startsWith('src/') || rel.endsWith('.mjs')) continue;
    files[rel] = statSync(p).size;
    if (!rel.endsWith('.svg')) continue;
    const svg = readFileSync(p, 'utf8');
    for (const bad of ['<text', '<image', '<filter', 'Gradient', 'stroke', 'font-family', '<use', 'href=']) {
      if (svg.includes(bad)) fails.push(`${rel}: contains ${bad}`);
    }
    for (const m of svg.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) {
      if (!allowed.has(m[0].toLowerCase())) fails.push(`${rel}: colour ${m[0]} is not a token`);
    }
    if (!rel.startsWith('riso/') && svg.includes(OVERPRINT))
      fails.push(`${rel}: overprint colour outside riso/`);
    const colours = new Set([...svg.matchAll(/fill(?:="|:)(#[0-9a-f]{6})/g)].map((m) => m[1]));
    colours.delete(TOKENS['lp-marshmallow']);
    if (
      !rel.startsWith('riso/') &&
      !rel.includes('app-icon') &&
      !rel.includes('avatar') &&
      !rel.includes('favicon') &&
      colours.size > 2
    )
      fails.push(`${rel}: ${colours.size} colours, the limit is two`);
  }
  for (const [rel, size] of Object.entries(files)) {
    // Clean SVGs stay small; the riso ones carry ink voids and repeat the ink shapes for the overprint.
    const limit = rel.startsWith('review/')
      ? 2_000_000
      : rel.startsWith('riso/') && rel.endsWith('.svg')
        ? 60_000
        : rel.endsWith('.svg')
          ? 20_000
          : 200_000;
    if (size > limit) fails.push(`${rel}: ${size} bytes is over ${limit}`);
  }

  // Pixel fit at 16 px: how many pixels are partly covered (anti-aliased) in the favicon.
  let partial = 0;
  let inked = 0;
  let opaque = 0;
  for (let i = 0; i < fav16.w * fav16.h; i++) {
    const o = i * 4;
    if (fav16.px[o + 3] > 254) opaque++;
    const isTile = Math.abs(fav16.px[o] - 252) < 1 && Math.abs(fav16.px[o + 1] - 245) < 1;
    if (!isTile) inked++;
    const [r, g, b] = [fav16.px[o], fav16.px[o + 1], fav16.px[o + 2]];
    const exact = [TOKENS['lp-indigo'], TOKENS['lp-pink'], TOKENS['lp-marshmallow']].some((hex) => {
      const t = [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16));
      return Math.abs(t[0] - r) < 1 && Math.abs(t[1] - g) < 1 && Math.abs(t[2] - b) < 1;
    });
    if (!exact && fav16.px[o + 3] > 254) partial++;
  }

  const pairs = [
    ['lp-indigo', 'lp-marshmallow'],
    ['lp-indigo', 'lp-white'],
    ['lp-pink', 'lp-marshmallow'],
    ['lp-pink', 'lp-white'],
    ['lp-pink', 'lp-indigo'],
    ['lp-white', 'lp-indigo'],
  ].map(([a, b]) => ({ fg: a, bg: b, ratio: contrast(TOKENS[a], TOKENS[b]) }));
  pairs.push({
    fg: 'lp-indigo',
    bg: 'chrome dark tab #35363a',
    ratio: contrast(TOKENS['lp-indigo'], '#35363a'),
  });

  return {
    ok: fails.length === 0,
    fails,
    files,
    // mark_pixels: not plain tile colour. blended_opaque_pixels: opaque but not exactly a token colour.
    favicon16: {
      pixels: fav16.w * fav16.h,
      opaque_pixels: opaque,
      mark_pixels: inked,
      blended_opaque_pixels: partial,
    },
    contrast: pairs,
  };
}
