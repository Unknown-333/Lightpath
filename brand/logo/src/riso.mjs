// The riso-textured logo, for website art only. The clean logo stays the official one.
// Same shapes, printed as two inks on marshmallow paper:
//   - misregistration: the pink layer is shifted right and down by MIS units;
//   - overprint: where pink lands on indigo it prints the palette's "pink over indigo" colour
//     (drawn as the pink shape clipped to the indigo shape, so no blend mode is needed);
//   - ink voids: small paper-coloured squares from a fixed seeded hash, cut out of each ink.
// All of it is plain SVG geometry (clip paths and masks). No filters, blur, gradients or bitmaps.
import { PALETTE, PAPER } from '../../src/palette.mjs';
import { flatten, pathData, rect, transform } from './geom.mjs';
import { canvas, coverageMap, paintMap } from './raster.mjs';
import { TOKENS } from './tokens.mjs';

export const MIS = 0.18; // units of the 16-unit mark grid
const OVERPRINT = PALETTE.find((p) => p.name === 'pink over indigo').hex;
const VOID = 0.25; // void square size, units
const DENSITY = 0.05;

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Nonzero winding test: is (x, y) inside these closed polylines?
function inside(polys, x, y) {
  let wind = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      if (y0 <= y !== y1 <= y) {
        const xc = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
        if (xc > x) wind += y1 > y0 ? 1 : -1;
      }
    }
  }
  return wind !== 0;
}

/** Void squares (grid units) whose centre falls on the ink; ink is given in grid units too. */
function voids(b, seed, inkPolys) {
  const out = [];
  for (let gy = Math.floor(b.y0 / VOID); gy * VOID < b.y1; gy++) {
    for (let gx = Math.floor(b.x0 / VOID); gx * VOID < b.x1; gx++) {
      if (hash(gx, gy, seed) >= DENSITY) continue;
      if (inside(inkPolys, (gx + 0.5) * VOID, (gy + 0.5) * VOID))
        out.push(...rect(gx * VOID, gy * VOID, VOID, VOID));
    }
  }
  return out;
}

/**
 * art = { layers, w, h } in units where the mark grid unit is `unit`. Text layers print in indigo.
 * Returns the two ink shapes and their voids, all in art units, plus a margin for the shift.
 */
export function risoInks(art, unit) {
  const indigo = art.layers.filter((l) => l.role !== 'pink').flatMap((l) => l.segs);
  const pink = transform(
    art.layers.filter((l) => l.role === 'pink').flatMap((l) => l.segs),
    1,
    MIS * unit,
    MIS * unit,
  );
  const scale = (segs) => transform(segs, unit, 0, 0);
  const b = { x0: 0, y0: 0, x1: art.w / unit + 1, y1: art.h / unit + 1 };
  const grid = (segs) => flatten(segs, 1 / unit, 0.02);
  return {
    indigo,
    pink,
    indigoVoids: scale(voids(b, 1, grid(indigo))),
    pinkVoids: scale(voids(b, 2, grid(pink))),
    w: art.w + MIS * unit,
    h: art.h + MIS * unit,
  };
}

export function risoSVG(art, unit, { pad = 0, title = 'Lightpath' } = {}) {
  const k = risoInks(art, unit);
  const W = round(k.w + 2 * pad);
  const H = round(k.h + 2 * pad);
  const d = (segs) => pathData(transform(segs, 1, pad, pad));
  const mask = (id, voidSegs) =>
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><path fill="#000" d="${d(voidSegs)}"/></mask>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title>`,
    `<defs>${mask('lp-vi', k.indigoVoids)}${mask('lp-vp', k.pinkVoids)}<clipPath id="lp-ci"><path d="${d(k.indigo)}"/></clipPath></defs>`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
    `<path fill="${TOKENS['lp-indigo']}" mask="url(#lp-vi)" d="${d(k.indigo)}"/>`,
    `<path fill="${TOKENS['lp-pink']}" mask="url(#lp-vp)" d="${d(k.pink)}"/>`,
    `<g mask="url(#lp-vi)"><path fill="${OVERPRINT}" clip-path="url(#lp-ci)" mask="url(#lp-vp)" d="${d(k.pink)}"/></g>`,
    '</svg>\n',
  ].join('');
}

/** The same print as pixels, composited the way the SVG is. */
export function risoRaster(art, unit, px, pad = 0) {
  const k = risoInks(art, unit);
  const s = px / (k.w + 2 * pad);
  const w = Math.round((k.w + 2 * pad) * s);
  const h = Math.round((k.h + 2 * pad) * s);
  const o = { s, ox: pad * s, oy: pad * s };
  const ci = coverageMap(k.indigo, w, h, o);
  const cp = coverageMap(k.pink, w, h, o);
  const vi = coverageMap(k.indigoVoids, w, h, o);
  const vp = coverageMap(k.pinkVoids, w, h, o);
  const inkI = ci.map((v, i) => v * (1 - vi[i]));
  const inkP = cp.map((v, i) => v * (1 - vp[i]));
  const over = inkP.map((v, i) => v * ci[i] * (1 - vi[i]));
  const c = canvas(w, h, PAPER);
  paintMap(c, inkI, TOKENS['lp-indigo']);
  paintMap(c, inkP, TOKENS['lp-pink']);
  paintMap(c, over, OVERPRINT);
  return c;
}

const round = (v) => Math.round(v * 1000) / 1000;
