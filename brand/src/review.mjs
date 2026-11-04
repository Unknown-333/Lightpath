// Review sheets: how an image looks when a page or a feed shows it smaller.
// Downscaling uses an area average (what browsers roughly do), so these previews are NOT
// palette-exact; they are for judging only and are not deliverables.
import { GLYPHS } from './font.mjs';

/** Indexed raster -> RGB bytes. */
export function toRGB(r, rgb) {
  const out = Buffer.alloc(r.w * r.h * 3);
  for (let i = 0; i < r.px.length; i++) {
    const c = rgb[r.px[i]];
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return { w: r.w, h: r.h, rgb: out };
}

function resample1D(n, m) {
  // Weights of source samples for each of m output samples covering n input samples.
  const out = [];
  const step = n / m;
  for (let j = 0; j < m; j++) {
    const a = j * step;
    const b = a + step;
    const ws = [];
    for (let i = Math.floor(a); i < Math.ceil(b); i++) {
      const w = Math.min(b, i + 1) - Math.max(a, i);
      if (w > 0) ws.push([i, w / step]);
    }
    out.push(ws);
  }
  return out;
}

/** Area-average downscale. */
export function downscale(img, nw, nh) {
  const wx = resample1D(img.w, nw);
  const wy = resample1D(img.h, nh);
  const tmp = new Float64Array(nw * img.h * 3);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < nw; x++)
      for (const [i, w] of wx[x])
        for (let c = 0; c < 3; c++) tmp[(y * nw + x) * 3 + c] += img.rgb[(y * img.w + i) * 3 + c] * w;
  const out = Buffer.alloc(nw * nh * 3);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++)
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (const [j, w] of wy[y]) v += tmp[(j * nw + x) * 3 + c] * w;
        out[(y * nw + x) * 3 + c] = Math.round(v);
      }
  return { w: nw, h: nh, rgb: out };
}

export class Sheet {
  constructor(w, h, bg) {
    this.w = w;
    this.h = h;
    this.rgb = Buffer.alloc(w * h * 3);
    this.fill(0, 0, w, h, bg);
  }

  fill(x, y, w, h, [r, g, b]) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) {
        const o = (j * this.w + i) * 3;
        this.rgb[o] = r;
        this.rgb[o + 1] = g;
        this.rgb[o + 2] = b;
      }
  }

  /** Paste an image; with `round`, mask the corners to `bg` like a rounded card. */
  paste(img, x, y, round = 0, bg = null) {
    for (let j = 0; j < img.h; j++)
      for (let i = 0; i < img.w; i++) {
        let src = img.rgb.subarray((j * img.w + i) * 3, (j * img.w + i) * 3 + 3);
        if (round) {
          const cx = Math.min(Math.max(i + 0.5, round), img.w - round);
          const cy = Math.min(Math.max(j + 0.5, round), img.h - round);
          if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > round * round) src = bg;
        }
        const o = ((y + j) * this.w + x + i) * 3;
        this.rgb[o] = src[0];
        this.rgb[o + 1] = src[1];
        this.rgb[o + 2] = src[2];
      }
  }

  label(str, x, y, s, colour) {
    let cx = x;
    for (const ch of str) {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      g.forEach((row, j) => {
        [...row].forEach((v, i) => {
          if (v === '#') this.fill(cx + i * s, y + j * s, s, s, colour);
        });
      });
      cx += (g[0].length + 1) * s;
    }
  }
}

/** Crop the centre 2:1 band (1200x600 of 1200x630). */
export function crop21(img) {
  const h = Math.round(img.w / 2);
  const y0 = Math.floor((img.h - h) / 2);
  return { w: img.w, h, rgb: Buffer.from(img.rgb.subarray(y0 * img.w * 3, (y0 + h) * img.w * 3)) };
}

const BACKGROUNDS = [
  { name: 'on white', bg: [255, 255, 255], ink: [90, 90, 90] },
  { name: 'on dark', bg: [13, 17, 23], ink: [170, 170, 170] },
];

/**
 * One sheet per concept: on white and on dark, at 1200, 500, the 2:1 crop with rounded corners
 * at 500, and 200 (with grain and without, to check that grain does not turn muddy).
 */
export function reviewSheet(title, full, fullNoGrain) {
  const pad = 40;
  const colW = 1240;
  const sheet = new Sheet(2 * (colW + 2 * pad), 40 + 630 + 300 + 220 + 3 * pad + 60, [255, 255, 255]);
  BACKGROUNDS.forEach(({ name, bg, ink }, col) => {
    const x0 = col * (colW + 2 * pad);
    sheet.fill(x0, 0, colW + 2 * pad, sheet.h, bg);
    sheet.label(`${title} ${name}`, x0 + pad, 14, 2, ink);
    let y = 40;
    sheet.paste(full, x0 + pad, y);
    sheet.label('1200 px', x0 + pad, y + 634, 2, ink);
    y += 630 + pad;
    const s500 = downscale(full, 500, 263);
    sheet.paste(s500, x0 + pad, y);
    sheet.label('500 px', x0 + pad, y + 266, 2, ink);
    const c = downscale(crop21(full), 500, 250);
    sheet.paste(c, x0 + pad + 520, y, 14, bg);
    sheet.label('500 px, 2:1 crop, round corners', x0 + pad + 520, y + 266, 2, ink);
    y += 300 + pad;
    sheet.paste(downscale(full, 200, 105), x0 + pad, y);
    sheet.label('200 px', x0 + pad, y + 110, 2, ink);
    sheet.paste(downscale(fullNoGrain, 200, 105), x0 + pad + 240, y);
    sheet.label('200 px, no grain', x0 + pad + 240, y + 110, 2, ink);
  });
  return sheet;
}
