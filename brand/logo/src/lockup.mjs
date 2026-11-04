// Wordmark and lockups as layers of outline segments, ready for SVG or raster.
// A layer is { role: 'indigo' | 'pink' | 'text', segs }. A colourway maps roles to colours:
// the wordmark takes the indigo role's colour.
import { bend, bounds, rect, transform } from './geom.mjs';
import { outline } from './text.mjs';

export const WORD = 'lightpath';
// Wordmark type settings (1/1000 em). Plex Sans SemiBold spaced a little tighter for a logo.
export const WORD_SETTINGS = { tracking: -12, kern: {} };
// The redrawn "l" foot, in stem widths: bend radii and where the foot ends (from the stem's left).
// A longer foot (2.4 stems) read as a capital L, so it stays short.
const L_FOOT = { outer: 1.15, inner: 0.25, length: 1.75 };

/**
 * The wordmark at font size `size` with its baseline at y = 0.
 * One change to the font: the "l" is redrawn as the path in the mark. Its stem keeps Plex's width
 * and height and turns right at the foot (same bend proportions as the mark: outer radius 1.5
 * stems, inner 0.5). That stops "lightpath" reading as "Iightpath" or "1ightpath" at small sizes.
 */
export function wordmark(font, size = 100, settings = WORD_SETTINGS, { tailedL = true } = {}) {
  const { glyphs } = outline(font, WORD, size, 0, 0, settings);
  const l = bounds([glyphs[0].segs]);
  if (!tailedL) {
    const segs = glyphs.flatMap((g) => g.segs);
    return { segs, b: bounds([segs]), lTop: l.y0 };
  }
  const stem = l.w;
  const R = stem * L_FOOT.outer;
  const r = stem * L_FOOT.inner;
  const t = R - r; // foot thickness
  const footEnd = l.x0 + stem * L_FOOT.length;
  const extra = footEnd - l.x1;
  const lSegs = [
    ...rect(l.x0, l.y0, stem, -l.y0 - R),
    ...bend(l.x0 + R, -R, R, r, 90, 180),
    ...rect(l.x0 + R - 0.01, -t, footEnd - (l.x0 + R) + 0.01, t),
  ];
  const segs = [...lSegs, ...glyphs.slice(1).flatMap((g) => transform(g.segs, 1, extra, 0))];
  return { segs, b: bounds([segs]), lTop: l.y0 };
}

/** Mark geometry (16-unit grid) as layers, scaled by s and moved by (dx, dy). */
export function markLayers(geo, s = 1, dx = 0, dy = 0) {
  return [
    { role: 'indigo', segs: geo.indigo.flatMap((g) => transform(g, s, dx, dy)) },
    { role: 'pink', segs: geo.pink.flatMap((g) => transform(g, s, dx, dy)) },
  ];
}

/**
 * Horizontal lockup: the mark's box is as tall as the "l" (ascender to baseline) times 1.25,
 * centred on the middle of the "l"; the gap to the wordmark is 30% of the mark box.
 * Returns { layers, w, h } with a clear-space margin `pad` (in units of the mark box) around it.
 */
export function horizontal(font, geo, markBox) {
  const wm = wordmark(font, 100);
  const lH = -wm.lTop;
  const box = lH * 1.25;
  const s = box / 16;
  const live = bounds([[...geo.indigo, ...geo.pink].flat()]);
  const gap = box * 0.3;
  const markX = -live.x0 * s;
  const midY = -lH / 2;
  const markY = midY - ((live.y0 + live.y1) / 2) * s;
  const textX = live.w * s + gap - wm.b.x0;
  const layers = [
    ...markLayers(geo, s, markX, markY),
    { role: 'text', segs: transform(wm.segs, 1, textX, 0) },
  ];
  return { ...frame(layers, markBox ? box * markBox : 0), unit: s };
}

/** Stacked lockup: mark above, centred; the mark box is 2.4 x the "l" height. */
export function stacked(font, geo, markBox) {
  const wm = wordmark(font, 100);
  const lH = -wm.lTop;
  const box = lH * 2.4;
  const s = box / 16;
  const live = bounds([[...geo.indigo, ...geo.pink].flat()]);
  const gap = box * 0.22;
  const markX = wm.b.x0 + wm.b.w / 2 - ((live.x0 + live.x1) / 2) * s;
  const markY = wm.lTop - gap - live.y1 * s;
  const layers = [...markLayers(geo, s, markX, markY), { role: 'text', segs: wm.segs }];
  return { ...frame(layers, markBox ? box * markBox : 0), unit: s };
}

export function wordOnly(font, pad = 0) {
  const wm = wordmark(font, 100);
  return frame([{ role: 'text', segs: wm.segs }], pad);
}

/** Mark alone in its 16-unit box. */
export function markOnly(geo) {
  return { layers: markLayers(geo), x: 0, y: 0, w: 16, h: 16 };
}

/** Move layers so their bounds start at pad, and report the size. */
function frame(layers, pad) {
  const b = bounds(layers.map((l) => l.segs));
  const moved = layers.map((l) => ({ role: l.role, segs: transform(l.segs, 1, pad - b.x0, pad - b.y0) }));
  return { layers: moved, x: 0, y: 0, w: b.w + 2 * pad, h: b.h + 2 * pad };
}
