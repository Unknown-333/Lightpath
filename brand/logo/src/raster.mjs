// A small anti-aliased rasterizer for the logo's PNG files and review sheets.
// Fill rule is nonzero (as in SVG). Coverage is exact across each sub-scanline and uses 16
// sub-scanlines per pixel row. Colours are sRGB 0-255, composited as browsers do (in sRGB).
// The blur and nearest-neighbour zoom exist only for the review sheets (squint test, pixel view).
import { flatten } from './geom.mjs';

const SUB = 16;

export function canvas(w, h, bg = null) {
  const c = { w, h, px: new Float32Array(w * h * 4) };
  if (bg) fillRect(c, 0, 0, w, h, bg);
  return c;
}

export const hexRGB = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/** Coverage of a set of closed polylines (pixels), clipped to the canvas. */
function coverage(polys, w, h) {
  const edges = [];
  let minY = h;
  let maxY = 0;
  let minX = w;
  let maxX = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      minX = Math.min(minX, x0);
      maxX = Math.max(maxX, x0);
      if (y0 === y1) continue;
      const dir = y1 > y0 ? 1 : -1;
      const ya = Math.min(y0, y1);
      const yb = Math.max(y0, y1);
      edges.push({ ya, yb, x0, y0, k: (x1 - x0) / (y1 - y0), dir });
      minY = Math.min(minY, ya);
      maxY = Math.max(maxY, yb);
    }
  }
  const r0 = Math.max(0, Math.floor(minY));
  const r1 = Math.min(h, Math.ceil(maxY));
  const bx0 = Math.max(0, Math.floor(minX));
  const bx1 = Math.min(w, Math.ceil(maxX) + 1);
  if (r1 <= r0 || bx1 <= bx0) return null;
  const bw = bx1 - bx0;
  const cov = new Float32Array(bw * (r1 - r0));
  const buckets = Array.from({ length: r1 - r0 }, () => []);
  for (const e of edges) {
    const a = Math.max(r0, Math.floor(e.ya));
    const b = Math.min(r1, Math.ceil(e.yb));
    for (let r = a; r < b; r++) buckets[r - r0].push(e);
  }
  const wt = 1 / SUB;
  const xs = [];
  for (let row = r0; row < r1; row++) {
    const list = buckets[row - r0];
    if (!list.length) continue;
    const base = (row - r0) * bw;
    for (let s = 0; s < SUB; s++) {
      const sy = row + (s + 0.5) / SUB;
      xs.length = 0;
      for (const e of list) if (sy >= e.ya && sy < e.yb) xs.push([e.x0 + (sy - e.y0) * e.k, e.dir]);
      if (xs.length < 2) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      let xa = 0;
      for (const [x, d] of xs) {
        const before = wind;
        wind += d;
        if (before === 0 && wind !== 0) xa = x;
        else if (before !== 0 && wind === 0) span(cov, base, bx0, bw, xa, x, wt);
      }
    }
  }
  return { cov, r0, r1, bx0, bw };
}

function span(cov, base, bx0, bw, xa, xb, wt) {
  let a = xa - bx0;
  let b = xb - bx0;
  if (a < 0) a = 0;
  if (b > bw) b = bw;
  if (b <= a) return;
  const ia = Math.floor(a);
  const ib = Math.floor(b);
  if (ia === ib) {
    cov[base + ia] += (b - a) * wt;
    return;
  }
  cov[base + ia] += (ia + 1 - a) * wt;
  for (let i = ia + 1; i < ib; i++) cov[base + i] += wt;
  if (ib < bw) cov[base + ib] += (b - ib) * wt;
}

/**
 * Paint segments (design units) at scale s and offset (ox, oy) in a colour.
 * mode 'multiply' darkens what is under it (ink overprint, used by the riso version only).
 */
export function paint(c, segs, colour, { s = 1, ox = 0, oy = 0, mode = 'over', alpha = 1 } = {}) {
  const polys = flatten(segs, s, 0.03, ox, oy);
  paintPolys(c, polys, colour, mode, alpha);
}

/** Full-canvas coverage (0-1) of segments, for compositing ink layers in the riso version. */
export function coverageMap(segs, w, h, { s = 1, ox = 0, oy = 0 } = {}) {
  const map = new Float32Array(w * h);
  const res = coverage(flatten(segs, s, 0.03, ox, oy), w, h);
  if (!res) return map;
  for (let y = res.r0; y < res.r1; y++) {
    for (let i = 0; i < res.bw; i++)
      map[y * w + res.bx0 + i] = Math.min(1, res.cov[(y - res.r0) * res.bw + i]);
  }
  return map;
}

/** Paint a colour through a coverage map. */
export function paintMap(c, map, colour) {
  const [r, g, b] = hexRGB(colour);
  for (let i = 0; i < c.w * c.h; i++) {
    const a = map[i];
    if (a <= 0) continue;
    const o = i * 4;
    c.px[o] = r * a + c.px[o] * (1 - a);
    c.px[o + 1] = g * a + c.px[o + 1] * (1 - a);
    c.px[o + 2] = b * a + c.px[o + 2] * (1 - a);
    c.px[o + 3] = 255 * a + c.px[o + 3] * (1 - a);
  }
}

export function paintPolys(c, polys, colour, mode = 'over', alpha = 1) {
  const res = coverage(polys, c.w, c.h);
  if (!res) return;
  const [r, g, b] = typeof colour === 'string' ? hexRGB(colour) : colour;
  const { cov, r0, r1, bx0, bw } = res;
  for (let y = r0; y < r1; y++) {
    for (let i = 0; i < bw; i++) {
      let a = cov[(y - r0) * bw + i];
      if (a <= 0) continue;
      a = Math.min(1, a) * alpha;
      const o = (y * c.w + bx0 + i) * 4;
      const px = c.px;
      if (mode === 'multiply') {
        // Overprint on opaque paper: result = under * ink.
        px[o] += (px[o] * (r / 255) - px[o]) * a;
        px[o + 1] += (px[o + 1] * (g / 255) - px[o + 1]) * a;
        px[o + 2] += (px[o + 2] * (b / 255) - px[o + 2]) * a;
        continue;
      }
      // Premultiplied "over".
      px[o] = r * a + px[o] * (1 - a);
      px[o + 1] = g * a + px[o + 1] * (1 - a);
      px[o + 2] = b * a + px[o + 2] * (1 - a);
      px[o + 3] = 255 * a + px[o + 3] * (1 - a);
    }
  }
}

export function fillRect(c, x, y, w, h, colour) {
  paintPolys(
    c,
    [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
    ],
    colour,
  );
}

/** Copy src onto dst at (x, y) with "over", optionally zoomed by a whole number (nearest neighbour). */
export function blit(dst, src, x0, y0, zoom = 1) {
  const x = Math.round(x0);
  const y = Math.round(y0);
  for (let sy = 0; sy < src.h * zoom; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.h) continue;
    for (let sx = 0; sx < src.w * zoom; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.w) continue;
      const so = (Math.floor(sy / zoom) * src.w + Math.floor(sx / zoom)) * 4;
      const a = src.px[so + 3] / 255;
      if (a <= 0) continue;
      const o = (dy * dst.w + dx) * 4;
      for (let k = 0; k < 3; k++) dst.px[o + k] = src.px[so + k] + dst.px[o + k] * (1 - a);
      dst.px[o + 3] = src.px[so + 3] + dst.px[o + 3] * (1 - a);
    }
  }
}

/** Box blur, three passes (close to a Gaussian). Only for the squint test. */
export function blurred(src, radius) {
  let cur = src.px.slice();
  const { w, h } = src;
  const pass = (data, horizontal) => {
    const out = new Float32Array(data.length);
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      for (let k = 0; k < 4; k++) {
        let sum = 0;
        const at = (i) => {
          const j = Math.min(len - 1, Math.max(0, i));
          return horizontal ? (l * w + j) * 4 + k : (j * w + l) * 4 + k;
        };
        for (let i = -radius; i <= radius; i++) sum += data[at(i)];
        for (let i = 0; i < len; i++) {
          out[at(i)] = sum / (2 * radius + 1);
          sum += data[at(i + radius + 1)] - data[at(i - radius)];
        }
      }
    }
    return out;
  };
  for (let p = 0; p < 3; p++) cur = pass(pass(cur, true), false);
  return { w, h, px: cur };
}

/** Unpremultiplied 8-bit RGBA bytes. */
export function toRGBA(c) {
  const out = Buffer.alloc(c.w * c.h * 4);
  for (let i = 0; i < c.w * c.h; i++) {
    const a = c.px[i * 4 + 3];
    out[i * 4 + 3] = Math.round(Math.min(255, a));
    if (a > 0)
      for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(Math.min(255, (c.px[i * 4 + k] * 255) / a));
  }
  return out;
}
