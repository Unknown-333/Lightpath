// The one-page review sheet: the recommended logo, its tests, the other concepts and why.
import { NOTES, SEARCH_SUMMARY } from './notes.mjs';
import { blit, blurred, canvas, fillRect } from './raster.mjs';
import { paintArt, paintMark } from './render.mjs';
import { bare16, INK, label, MUTED, paragraph, RULE, tabs, tile } from './sheet.mjs';
import { COLOURWAYS } from './tokens.mjs';

const W = 1600;
const M = 48;

function heading(c, fonts, text, y) {
  fillRect(c, M, y - 30, W - 2 * M, 1, RULE);
  label(c, fonts.bold, text, 22, M, y);
  return y + 28;
}

export function onePage({ concept, concepts, fonts, art, icons, riso, why, date }) {
  const c = canvas(W, 4800, '#ffffff'); // cropped to the content at the end
  let y = 70;
  label(c, fonts.bold, 'Lightpath logo: review sheet', 40, M, y);
  y += 36;
  label(
    c,
    fonts.bold,
    `Draft for the owner's review, ${date}. Not published or used anywhere yet.`,
    17,
    M,
    y,
    MUTED,
  );
  y += 70;

  // Recommended, large.
  y = heading(c, fonts, `Recommended: concept ${concept.n}, ${concept.name}`, y);
  const panelH = 360;
  fillRect(c, M, y, 980, panelH, COLOURWAYS.colour.bg);
  const hs = 560 / art.horizontal.w;
  paintArt(c, art.horizontal, COLOURWAYS.colour, hs, M + 210, y + (panelH - art.horizontal.h * hs) / 2);
  fillRect(c, M + 1000, y, W - 2 * M - 1000, panelH, COLOURWAYS.colour.bg);
  const ss = 280 / art.stacked.h;
  paintArt(
    c,
    art.stacked,
    COLOURWAYS.colour,
    ss,
    M + 1000 + (W - 2 * M - 1000 - art.stacked.w * ss) / 2,
    y + 40,
  );
  y += panelH + 24;
  y += paragraph(c, fonts.bold, why, 17, M, y + 10, W - 2 * M, INK, 1.5) + 40;

  // Variants.
  y = heading(c, fonts, 'Variants: mark, horizontal lockup, wordmark', y + 30);
  const ways = ['colour', 'indigo', 'black', 'white', 'reversed'];
  const vw = (W - 2 * M - 4 * 16) / 5;
  ways.forEach((k, i) => {
    const way = COLOURWAYS[k];
    const x = M + i * (vw + 16);
    fillRect(c, x, y, vw, 300, way.bg);
    if (way.bg === '#ffffff') {
      fillRect(c, x, y, vw, 1, RULE);
      fillRect(c, x, y + 299, vw, 1, RULE);
      fillRect(c, x, y, 1, 300, RULE);
      fillRect(c, x + vw - 1, y, 1, 300, RULE);
    }
    paintMark(c, concept, 96, way, x + (vw - 96) / 2, y + 24);
    const s = (vw - 48) / art.horizontal.w;
    paintArt(c, art.horizontal, way, s, x + 24, y + 150);
    const ws = (vw - 90) / art.wordmark.w;
    paintArt(c, art.wordmark, way, ws, x + 45, y + 230);
    label(c, fonts.bold, way.label, 14, x, y + 324, MUTED);
  });
  y += 370;

  // Size and colour tests.
  y = heading(
    c,
    fonts,
    'Tests: 256, 64, 32 and 16 px, a x8 view of 16 px, and the squint test (blurred copy)',
    y + 30,
  );
  ['colour', 'indigo', 'black', 'white'].forEach((k, i) => {
    const way = COLOURWAYS[k];
    const ry = y + i * 150;
    label(c, fonts.bold, way.label, 15, M, ry + 70);
    let x = M + 200;
    fillRect(c, x, ry, W - 2 * M - 200, 140, way.bg);
    x += 20;
    const t128 = tile(concept, 128, way);
    blit(c, t128, x, ry + 6);
    x += 128 + 40;
    for (const s of [64, 32, 16]) {
      paintMark(c, concept, s, way, x, ry + (140 - s) / 2);
      x += s + 40;
    }
    blit(c, tile(concept, 16, way), x, ry + 6, 8);
    x += 128 + 40;
    blit(c, blurred(tile(concept, 128, way, 8), 4), x - 8, ry - 2);
    x += 128 + 40;
    if (i === 0) {
      paragraph(c, fonts.bold, `Squint: ${NOTES[concept.id].squint}`, 15, x, ry + 40, W - M - x - 20, MUTED);
    }
  });
  label(
    c,
    fonts.bold,
    '(The 256 px column is on the per-concept sheets; it is drawn here at 128 px to fit.)',
    13,
    M + 200,
    y + 620,
    MUTED,
  );
  y += 660;

  // Favicon, app icon, avatar.
  y = heading(c, fonts, 'Favicon, app icon and avatar', y + 30);
  label(c, fonts.bold, 'favicon.ico / PNG (on a marshmallow tile)', 15, M, y + 10);
  tabs(c, fonts.bold, { light: icons.fav16, dark: icons.fav16 }, M, y + 50);
  label(c, fonts.bold, 'favicon.svg (switches to white when the browser is dark)', 15, M, y + 130);
  tabs(
    c,
    fonts.bold,
    { light: bare16(concept, COLOURWAYS.colour), dark: bare16(concept, COLOURWAYS.reversed) },
    M,
    y + 170,
  );
  const ix = M + 840;
  blit(c, icons.app256, ix, y - 6);
  label(c, fonts.bold, 'App icon', 14, ix, y + 274, MUTED);
  const av = icons.avatar;
  const avc = canvas(av.w, av.h, '#ffffff');
  blit(avc, av, 0, 0);
  circleCrop(avc);
  const small = canvas(200, 200, '#ffffff');
  for (let yy = 0; yy < 200; yy++)
    for (let xx = 0; xx < 200; xx++) {
      const o = (yy * 200 + xx) * 4;
      for (let k = 0; k < 4; k++) {
        let sum = 0;
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ])
          sum += avc.px[((yy * 2 + dy) * avc.w + xx * 2 + dx) * 4 + k];
        small.px[o + k] = sum / 4;
      }
    }
  blit(c, small, ix + 300, y + 30);
  label(c, fonts.bold, 'Avatar, as GitHub crops it (circle)', 14, ix + 300, y + 274, MUTED);
  y += 320;

  // Clear space and minimum size.
  y = heading(c, fonts, 'Clear space and minimum size', y + 30);
  const cs = 240;
  fillRect(c, M, y, cs + 120, cs + 120, '#f3f1f7');
  fillRect(c, M + 60, y + 60, cs, cs, COLOURWAYS.colour.bg);
  paintMark(c, concept, cs, COLOURWAYS.colour, M + 60, y + 60);
  paragraph(
    c,
    fonts.bold,
    'Clear space: keep at least the width of the end square (a quarter of the mark box) empty on every side; the grey margin shows it. Minimum size: the mark at 16 px (use the favicon files, which are drawn for it); the horizontal lockup at 20 px tall (about 96 px wide); the stacked lockup at 64 px tall. Below those sizes use the mark alone. The mark box already has one grid unit of margin built in.',
    16,
    M + cs + 160,
    y + 30,
    W - 2 * M - cs - 160,
    INK,
    1.5,
  );
  const minH = canvas(Math.ceil(art.horizontal.w * (20 / art.horizontal.h)) + 4, 24, COLOURWAYS.colour.bg);
  paintArt(minH, art.horizontal, COLOURWAYS.colour, 20 / art.horizontal.h, 2, 2);
  blit(c, minH, M + cs + 160, y + 250);
  label(
    c,
    fonts.bold,
    'horizontal lockup at 20 px tall, real pixels',
    13,
    M + cs + 160 + minH.w + 16,
    y + 266,
    MUTED,
  );
  y += cs + 160;

  // The five concepts.
  y = heading(c, fonts, 'All five concepts (full sheets in review/)', y + 30);
  concepts.forEach((k, i) => {
    const ry = y + i * 120;
    fillRect(c, M, ry, 300, 104, COLOURWAYS.colour.bg);
    paintMark(c, k, 64, COLOURWAYS.colour, M + 20, ry + 20);
    paintMark(c, k, 32, COLOURWAYS.colour, M + 110, ry + 36);
    paintMark(c, k, 16, COLOURWAYS.colour, M + 170, ry + 44);
    paintMark(c, k, 32, COLOURWAYS.black, M + 220, ry + 36);
    label(c, fonts.bold, `${k.n}. ${k.name}`, 17, M + 330, ry + 30);
    paragraph(c, fonts.bold, NOTES[k.id].verdict, 14, M + 330, ry + 56, W - 2 * M - 330, MUTED, 1.45);
  });
  y += concepts.length * 120 + 20;

  // Memory and search.
  y = heading(c, fonts, 'Draw from memory, and similar logos', y + 30);
  y += paragraph(
    c,
    fonts.bold,
    `Draw from memory (our judgement, not a user test): "${concept.memory}" ${NOTES[concept.id].memory}`,
    16,
    M,
    y + 10,
    W - 2 * M,
    INK,
    1.5,
  );
  y += paragraph(c, fonts.bold, SEARCH_SUMMARY, 16, M, y + 20, W - 2 * M, INK, 1.5) + 30;

  // Riso version.
  y = heading(
    c,
    fonts,
    'Riso-textured version, for website art only (the clean logo stays the official one)',
    y + 30,
  );
  blit(c, riso.lockup, M, y);
  blit(c, riso.mark, M + riso.lockup.w + 40, y);
  y += Math.max(riso.lockup.h, riso.mark.h) + 30;

  return crop(c, y + 20);
}

function circleCrop(c) {
  const r = c.w / 2;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const a = Math.max(0, Math.min(1, r - d + 0.5));
      if (a >= 1) continue;
      const o = (y * c.w + x) * 4;
      for (let k = 0; k < 3; k++) c.px[o + k] = c.px[o + k] * a + 255 * (1 - a);
    }
}

function crop(c, h) {
  const out = canvas(c.w, Math.min(c.h, Math.ceil(h)));
  out.px.set(c.px.subarray(0, out.w * out.h * 4));
  return out;
}
