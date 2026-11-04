// Review sheets: one per concept (sizes x colourways, squint, pixel view, browser tabs) and a
// side-by-side overview of all five. The main one-page sheet is in onepage.mjs.

import { blit, blurred, canvas, fillRect, paint } from './raster.mjs';
import { paintMark } from './render.mjs';
import { outline, wrap } from './text.mjs';
import { COLOURWAYS } from './tokens.mjs';

export const INK = '#1d1b3a';
export const MUTED = '#5b5875';
export const RULE = '#e4e1ea';

export function label(c, font, str, size, x, y, colour = INK) {
  const { segs, width } = outline(font, str, size, x, y);
  if (segs.length) paint(c, segs, colour);
  return width;
}

export function paragraph(c, font, text, size, x, y, maxWidth, colour = INK, lead = 1.45) {
  const lines = wrap(font, text, size, maxWidth);
  lines.forEach((line, i) => {
    label(c, font, line, size, x, y + i * size * lead, colour);
  });
  return lines.length * size * lead;
}

/** A mark rendered alone on its colourway's background, size px plus a margin. */
export function tile(concept, size, way, pad = 0) {
  const t = canvas(size + 2 * pad, size + 2 * pad, way.bg);
  paintMark(t, concept, size, way, pad, pad);
  return t;
}

/** A 16 px mark on a transparent canvas. */
export function bare16(concept, way) {
  const fav = canvas(16, 16);
  paintMark(fav, concept, 16, way);
  return fav;
}

/**
 * Browser tab strips (Chrome's light and dark tab colours) with a 16 px icon, plus an x4 zoom.
 * icons = { light, dark } 16 x 16 canvases.
 */
export function tabs(c, font, icons, x, y) {
  const strips = [
    { bar: '#dee1e6', tab: '#ffffff', text: '#1f1f1f', icon: icons.light },
    { bar: '#202124', tab: '#35363a', text: '#e8eaed', icon: icons.dark },
  ];
  strips.forEach((st, i) => {
    const sx = x + i * 400;
    fillRect(c, sx, y, 280, 40, st.bar);
    fillRect(c, sx + 8, y + 6, 200, 34, st.tab);
    blit(c, st.icon, sx + 20, y + 15);
    label(c, font, 'Lightpath', 13, sx + 44, y + 28, st.text);
    const z = canvas(80, 80, st.tab);
    blit(z, st.icon, 8, 8, 4);
    blit(c, z, sx + 290, y - 20);
  });
}

const COLS = [
  { key: 256, w: 288, title: '256 px' },
  { key: 64, w: 96, title: '64' },
  { key: 32, w: 64, title: '32' },
  { key: 16, w: 48, title: '16' },
  { key: 'zoom', w: 160, title: '16 px, x8' },
  { key: 'squint', w: 288, title: 'squint (blurred)' },
];
const ROWS = ['colour', 'indigo', 'black', 'white', 'reversed'];

export function conceptSheet(concept, fonts, notes) {
  const W = 1200;
  const rowH = 296;
  const top = 168;
  const H = top + ROWS.length * rowH + 300;
  const c = canvas(W, H, '#ffffff');
  label(c, fonts.bold, `Concept ${concept.n}: ${concept.name}`, 30, 24, 52);
  paragraph(c, fonts.bold, concept.idea, 16, 24, 86, W - 48, MUTED);
  let x = 24 + 150;
  for (const col of COLS) {
    label(c, fonts.bold, col.title, 14, x, top - 10, MUTED);
    x += col.w + 8;
  }
  ROWS.forEach((rk, ri) => {
    const way = COLOURWAYS[rk];
    const y = top + ri * rowH;
    paragraph(c, fonts.bold, way.label, 15, 24, y + 30, 140);
    let cx = 24 + 150;
    for (const col of COLS) {
      fillRect(c, cx, y, col.w, rowH - 8, way.bg);
      if (way.bg === '#ffffff') {
        // A hairline frame so white panels show on the white sheet.
        for (const [fx, fy, fw, fh] of [
          [cx, y, col.w, 1],
          [cx, y + rowH - 9, col.w, 1],
          [cx, y, 1, rowH - 8],
          [cx + col.w - 1, y, 1, rowH - 8],
        ])
          fillRect(c, fx, fy, fw, fh, RULE);
      }
      const mid = (s) => [cx + Math.round((col.w - s) / 2), y + Math.round((rowH - 8 - s) / 2)];
      if (typeof col.key === 'number') {
        const [mx, my] = mid(col.key);
        paintMark(c, concept, col.key, way, mx, my);
      } else if (col.key === 'zoom') {
        const [mx, my] = mid(128);
        blit(c, tile(concept, 16, way), mx, my, 8);
      } else {
        const [mx, my] = mid(256);
        const t = tile(concept, 256, way, 16);
        blit(c, blurred(t, 8), mx - 16, my - 16);
      }
      cx += col.w + 8;
    }
  });
  let y = top + ROWS.length * rowH + 24;
  label(
    c,
    fonts.bold,
    'At 16 px in a browser tab: colour on light, reversed on dark (x4 zoom on the right)',
    15,
    24,
    y,
  );
  tabs(
    c,
    fonts.bold,
    { light: bare16(concept, COLOURWAYS.colour), dark: bare16(concept, COLOURWAYS.reversed) },
    24,
    y + 34,
  );
  y += 110;
  label(c, fonts.bold, 'Draw from memory (our judgement, not a user test)', 15, 24, y);
  y +=
    4 + paragraph(c, fonts.bold, `"${concept.memory}" ${notes?.memory ?? ''}`, 15, 24, y + 24, W - 48, MUTED);
  label(c, fonts.bold, 'Verdict', 15, 24, y + 36);
  paragraph(c, fonts.bold, notes?.verdict ?? '(to be written)', 15, 24, y + 60, W - 48, MUTED);
  return c;
}

/** All five side by side: rows of concepts, columns of sizes, in colour and in black. */
export function overviewSheet(concepts, fonts) {
  const W = 1200;
  const rowH = 150;
  const top = 110;
  const c = canvas(W, top + concepts.length * rowH + 30, '#ffffff');
  label(c, fonts.bold, 'All five concepts at 16, 32, 64 and 128 px', 30, 24, 52);
  label(
    c,
    fonts.bold,
    'Full colour on marshmallow, then black on white. Real pixels, no scaling.',
    15,
    24,
    82,
    MUTED,
  );
  concepts.forEach((k, i) => {
    const y = top + i * rowH;
    label(c, fonts.bold, `${k.n}. ${k.name}`, 18, 24, y + 70);
    let x = 260;
    for (const rk of ['colour', 'black']) {
      const way = COLOURWAYS[rk];
      fillRect(c, x, y, 440, rowH - 10, way.bg);
      let mx = x + 20;
      for (const s of [16, 32, 64, 128]) {
        paintMark(c, k, s, way, mx, y + Math.round((rowH - 10 - s) / 2));
        mx += s + 36;
      }
      x += 460;
    }
  });
  return c;
}
