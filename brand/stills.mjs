// Concept stills and review sheets only (fast loop while designing): node brand/stills.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conceptA, conceptB, conceptC } from './src/concepts.mjs';
import { RGB } from './src/palette.mjs';
import { encodeIndexed, encodeRGB } from './src/png.mjs';
import { printRaster } from './src/raster.mjs';
import { downscale, reviewSheet, toRGB } from './src/review.mjs';
import { GRAIN, MISREGISTER, WINNER } from './src/winner.mjs';

const root = dirname(fileURLToPath(import.meta.url));

export function buildStills() {
  const out = join(root, 'out');
  const review = join(root, 'review');
  mkdirSync(out, { recursive: true });
  mkdirSync(review, { recursive: true });
  const concepts = { a: conceptA, b: conceptB, c: conceptC };
  const titles = { a: 'A pixel path', b: 'B typographic', c: 'C flat cartoon' };
  const grain = {};
  for (const [id, make] of Object.entries(concepts)) {
    const { print, scale } = make();
    const img = printRaster(print, scale, { offset: MISREGISTER, grain: GRAIN[id] });
    if (img.w !== 1200 || img.h !== 630) throw new Error(`concept ${id} is ${img.w}x${img.h}, not 1200x630`);
    writeFileSync(join(review, `concept-${id}.png`), encodeIndexed(img, RGB));
    const plain = printRaster(print, scale, { offset: MISREGISTER, grain: null });
    const withGrain = toRGB(img, RGB);
    const noGrain = toRGB(plain, RGB);
    const sheet = reviewSheet(titles[id], withGrain, noGrain);
    grain[id] = grainAt200(withGrain, noGrain, GRAIN[id]);
    writeFileSync(join(review, `review-${id}.png`), encodeRGB(sheet.w, sheet.h, sheet.rgb));
    if (id === WINNER) writeFileSync(join(out, 'og.png'), encodeIndexed(img, RGB));
    console.log(`concept ${id}: ${img.w}x${img.h}`);
  }
  writeFileSync(join(review, 'grain-200.json'), `${JSON.stringify(grain, null, 2)}\n`);
}

/**
 * The muddy-grain check: shrink the image to 200 px wide with and without grain and measure how
 * far apart they are. A large shift means the grain turns into a grey haze at thumbnail size.
 */
function grainAt200(withGrain, noGrain, setting) {
  const a = downscale(withGrain, 200, 105);
  const b = downscale(noGrain, 200, 105);
  let sum = 0;
  let max = 0;
  let over8 = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.rgb[i * 3 + c] - b.rgb[i * 3 + c]));
    sum += d;
    if (d > max) max = d;
    if (d > 8) over8++;
  }
  return {
    grain: setting,
    at200px: {
      meanShift: Number((sum / (a.w * a.h)).toFixed(2)),
      maxShift: max,
      pixelsShiftedOver8: over8,
      pixels: a.w * a.h,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) buildStills();
