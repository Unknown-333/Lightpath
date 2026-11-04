// A grid of small integers (ink levels, or palette indices once printed). Nothing can blend:
// no anti-aliasing, no gradients, no soft edges. Shapes are filled cell by cell.
import { GLYPHS } from './font.mjs';

export class Raster {
  constructor(w, h, fill = 0) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h).fill(fill);
  }

  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }

  get(x, y) {
    return this.px[y * this.w + x];
  }

  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  /** One-cell outline. */
  box(x, y, w, h, c) {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  /** Filled disc, cell centres tested against the radius: hard edge, no blending. */
  disc(cx, cy, r, c) {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.set(i, j, c);
      }
  }

  /** Rounded rectangle with a radius in cells. */
  rrect(x, y, w, h, r, c) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const cx = Math.min(Math.max(i + 0.5, x + r), x + w - r);
        const cy = Math.min(Math.max(j + 0.5, y + r), y + h - r);
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.set(i, j, c);
      }
  }

  /** Text in the pixel font; s = cells per font pixel. Returns the width drawn. */
  text(str, x, y, s, c) {
    let cx = x;
    for (const ch of str) {
      const g = GLYPHS[ch];
      if (!g) throw new Error(`font has no glyph for ${JSON.stringify(ch)}`);
      g.forEach((row, j) => {
        [...row].forEach((v, i) => {
          if (v === '#') this.rect(cx + i * s, y + j * s, s, s, c);
        });
      });
      cx += (g[0].length + 1) * s;
    }
    return cx - x - s;
  }

  /** Thick polyline, drawn as square stamps along each segment. */
  line(points, thick, c) {
    for (let k = 0; k + 1 < points.length; k++) {
      const [x0, y0] = points[k];
      const [x1, y1] = points[k + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
      for (let t = 0; t <= n; t++) {
        const x = Math.round(x0 + ((x1 - x0) * t) / n - thick / 2);
        const y = Math.round(y0 + ((y1 - y0) * t) / n - thick / 2);
        this.rect(x, y, thick, thick, c);
      }
    }
  }

  /** Nearest-neighbour integer upscale: each cell becomes a k x k block. */
  scale(k) {
    const out = new Raster(this.w * k, this.h * k, 0);
    for (let y = 0; y < out.h; y++) {
      const src = Math.floor(y / k) * this.w;
      const dst = y * out.w;
      for (let x = 0; x < out.w; x++) out.px[dst + x] = this.px[src + Math.floor(x / k)];
    }
    return out;
  }

  clone() {
    const r = new Raster(this.w, this.h, 0);
    r.px.set(this.px);
    return r;
  }
}

// ---- Two-layer riso print -------------------------------------------------------------------

/** Sprite keys -> inks. */
export const SPRITE_INKS = {
  K: { i: 2, p: 0 }, // indigo
  L: { i: 1, p: 0 }, // indigo tint
  W: { i: 0, p: 0 }, // bare paper
  P: { i: 0, p: 2 }, // pink
  p: { i: 0, p: 1 }, // pink tint
  q: { i: 2, p: 2 }, // pink over indigo
};

/**
 * A print on a cell grid: one Raster per ink holding levels 0/1/2, and a grain mask
 * (1 = this flat area may carry dot grain). Shapes take an ink {i, p}; a missing key
 * leaves that layer as it is, so pink can overprint indigo or knock it out.
 */
export class Print {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.i = new Raster(w, h, 0);
    this.p = new Raster(w, h, 0);
    this.g = new Raster(w, h, 0);
  }

  *layers(ink) {
    if (ink.i !== undefined) yield [this.i, ink.i];
    if (ink.p !== undefined) yield [this.p, ink.p];
    if (ink.g !== undefined) yield [this.g, ink.g];
  }

  rect(x, y, w, h, ink) {
    for (const [l, v] of this.layers(ink)) l.rect(x, y, w, h, v);
  }

  box(x, y, w, h, ink) {
    for (const [l, v] of this.layers(ink)) l.box(x, y, w, h, v);
  }

  disc(cx, cy, r, ink) {
    for (const [l, v] of this.layers(ink)) l.disc(cx, cy, r, v);
  }

  rrect(x, y, w, h, r, ink) {
    for (const [l, v] of this.layers(ink)) l.rrect(x, y, w, h, r, v);
  }

  line(points, thick, ink) {
    for (const [l, v] of this.layers(ink)) l.line(points, thick, v);
  }

  text(str, x, y, s, ink, shadowInk, shadowOffset = 1) {
    const o = shadowOffset;
    if (shadowInk) for (const [l, v] of this.layers(shadowInk)) l.text(str, x + o, y + o, s, v);
    let w = 0;
    for (const [l, v] of this.layers(ink)) w = l.text(str, x, y, s, v);
    return w;
  }

  sprite(rows, x, y, s = 1, flip = false) {
    rows.forEach((row, j) => {
      [...(flip ? [...row].reverse().join('') : row)].forEach((ch, k) => {
        if (ch === '.' || ch === ' ') return;
        const ink = SPRITE_INKS[ch];
        if (!ink) throw new Error(`sprite key ${ch} has no ink`);
        this.rect(x + k * s, y + j * s, s, s, ink);
      });
    });
  }
}

function grainHash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Print it: scale each cell to k x k output pixels (nearest neighbour), shift the pink layer by
 * a whole-pixel misregistration, and add hard single-pixel dot grain in flagged flat areas.
 * Returns an indexed Raster whose values are palette indices (indigo * 3 + pink).
 * grain: { seed, density } or null; dot: grain dot size in output pixels (2 keeps video chroma exact). Grain never touches pink ink, so the lit path stays clean.
 */
export function printRaster(pr, k, { offset = [2, 2], grain = { seed: 11, density: 0.05 }, dot = 1 } = {}) {
  const W = pr.w * k;
  const H = pr.h * k;
  const out = new Raster(W, H, 0);
  const [dx, dy] = offset;
  for (let y = 0; y < H; y++) {
    const cy = Math.floor(y / k);
    const py = Math.floor((y - dy) / k);
    for (let x = 0; x < W; x++) {
      const cx = Math.floor(x / k);
      const px = Math.floor((x - dx) / k);
      let ind = pr.i.px[cy * pr.w + cx];
      const pink = px >= 0 && py >= 0 && px < pr.w && py < pr.h ? pr.p.px[py * pr.w + px] : 0;
      if (grain && pink === 0 && pr.g.px[cy * pr.w + cx]) {
        const r = grainHash(Math.floor(x / dot), Math.floor(y / dot), grain.seed);
        // Ink voids in inked areas, ink specks on bare paper: one pixel, one palette step.
        if (ind === 2 && r < grain.density) ind = 1;
        else if (ind === 1 && r < grain.density) ind = r < grain.density / 2 ? 0 : 2;
        else if (ind === 0 && r < grain.density / 3) ind = 1;
      }
      out.px[y * W + x] = ind * 3 + pink;
    }
  }
  return out;
}
