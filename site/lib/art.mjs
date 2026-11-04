// Turns brand prints (brand/src) into inline SVG for the site: two ink layers, the pink layer
// overprinting (multiply) and shifted for misregistration, tints as halftone dot patterns, and
// grain from an feTurbulence filter on the large flat areas only. Text never gets any of this.
import { drawA, SCENE_A } from '../../brand/src/concepts.mjs';
import { GLYPHS, measure } from '../../brand/src/font.mjs';
import { INDIGO, INDIGO_TINT, PAPER, PINK, PINK_TINT } from '../../brand/src/palette.mjs';
import { Print } from '../../brand/src/raster.mjs';
import { CLICK_RAYS, CURSOR, WALKER } from '../../brand/src/sprites.mjs';

/** Row runs of cells where pick(x, y) is true, as one SVG path (cell units). */
function runs(w, h, pick, x0 = 0, y0 = 0) {
  let d = '';
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!pick(x, y)) {
        x++;
        continue;
      }
      const s = x;
      while (x < w && pick(x, y)) x++;
      d += `M${s + x0} ${y + y0}h${x - s}v1h${s - x}z`;
    }
  }
  return d;
}

const path = (d, cls) => (d ? `<path class="${cls}" d="${d}"/>` : '');

/**
 * One print as SVG groups. `crop` = {x, y, w, h} in cells. `where(x, y)` limits the cells drawn
 * (for animation overlays); `knockout` paints paper where the indigo layer is empty.
 */
export function layers(pr, { crop, where = () => true, knockout = false, grain = true } = {}) {
  const c = crop ?? { x: 0, y: 0, w: pr.w, h: pr.h };
  const at = (layer, x, y) => layer.px[(y + c.y) * pr.w + x + c.x];
  const ok = (x, y) => where(x + c.x, y + c.y);
  const ink = (lvl) => (x, y) => ok(x, y) && at(pr.i, x, y) === lvl;
  const pk = (lvl) => (x, y) => ok(x, y) && at(pr.p, x, y) === lvl;
  let out = '<g class="ink-i">';
  if (knockout) out += path(runs(c.w, c.h, ink(0)), 'paper');
  out += path(runs(c.w, c.h, ink(1)), 'tint-i');
  out += path(runs(c.w, c.h, ink(2)), 'full-i');
  if (grain)
    out += path(
      runs(c.w, c.h, (x, y) => ok(x, y) && at(pr.g, x, y) === 1),
      'grain',
    );
  out += '</g><g class="ink-p">';
  out += path(runs(c.w, c.h, pk(1)), 'tint-p');
  out += path(runs(c.w, c.h, pk(2)), 'full-p');
  return `${out}</g>`;
}

/** Shared <defs>: halftone screens for the two tints and the grain filter. Used once per page. */
export function defs() {
  return `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
<pattern id="ht-i" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1" height="1" fill="${PAPER}"/><circle cx=".5" cy=".5" r=".34" fill="${INDIGO}"/></pattern>
<pattern id="ht-p" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(15)"><circle cx=".5" cy=".5" r=".4" fill="${PINK}"/></pattern>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="1" seed="11" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.988 0 0 0 0 0.961 0 0 0 0 0.925 0 0 0 9 -5.6" result="dots"/>
<feComposite in="dots" in2="SourceAlpha" operator="in"/>
</filter>
</defs></svg>`;
}

/** CSS custom properties the SVG classes read; the stylesheet swaps tints for halftone. */
export const INKS = { PAPER, INDIGO, INDIGO_TINT, PINK, PINK_TINT };

// ---- Hero: concept A's scene, animated in stepped CSS ---------------------------------------

const SCENE = { x: 4, y: 63, w: 232, h: 60 };
const N = SCENE_A.path.length;
const CLICK = { x: 31, y: 92 };
const START = { x: 52, y: 108 };

function spriteSvg(rows, cls, x, y) {
  const pr = new Print(rows[0].length, rows.length);
  pr.sprite(rows, 0, 0);
  // Paper-white sprite cells must cover what is behind them; '.' cells stay see-through.
  const where = (cx, cy) => rows[cy][cx] !== '.' && rows[cy][cx] !== ' ';
  return `<g class="${cls}" transform="translate(${x} ${y})">${layers(pr, { grain: false, knockout: true, where })}</g>`;
}

export function heroSvg() {
  const still = { cursor: null, rays: false, walker: null, pressed: false };
  const dark = drawA({ ...still, lit: 0, buttonLit: false, leds: [false, false, false, false] });
  const lit = drawA({ ...still, lit: N, buttonLit: true, leds: [true, true, true, true] });
  const differs = (x, y) => {
    const k = y * lit.w + x;
    return dark.i.px[k] !== lit.i.px[k] || dark.p.px[k] !== lit.p.px[k];
  };
  const crop = SCENE;
  const region = (x0, x1) => (x, y) => x >= x0 && x < x1 && differs(x, y);
  const base = layers(dark, { crop });
  const button = layers(lit, { crop, where: region(0, 41), knockout: true, grain: false });
  const tiles = layers(lit, { crop, where: region(41, 198), knockout: true, grain: false });
  const leds = layers(lit, { crop, where: region(198, 240), knockout: true, grain: false });
  const sx = (x) => x - crop.x;
  const sy = (y) => y - crop.y;
  const walkerY = sy(SCENE_A.pathY - 13);
  const walkerX0 = sx(SCENE_A.path[0].x - 6);
  const rays = new Print(11, 11);
  for (const [dx, dy] of CLICK_RAYS) rays.rect(dx + 5, dy + 5, 1, 1, { p: 2 });
  // The lit tiles appear under a clip that widens one tile (6 cells) per step.
  const clipX = sx(SCENE_A.path[0].x - 1);
  return `<svg class="hero-art" viewBox="0 0 ${crop.w} ${crop.h}" role="img" aria-labelledby="hero-art-title" shape-rendering="crispEdges">
<title id="hero-art-title">A pointer clicks a button in a browser window. A row of tiles lights up pink, one by one, across to a server window, where four server lights come on. Side branches that did not run stay dark.</title>
<clipPath id="hero-clip"><rect class="hero-clip" x="${clipX}" y="0" width="${N * 6}" height="${crop.h}"/></clipPath>
<g class="art">${base}
<g class="hero-button">${button}</g>
<g clip-path="url(#hero-clip)"><g class="hero-tiles">${tiles}</g></g>
<g class="hero-leds">${leds}</g>
<g class="hero-walker">${spriteSvg(WALKER[0], 'w0', walkerX0, walkerY)}</g>
<g class="hero-cursor" style="--cx:${sx(START.x) - sx(CLICK.x)}px;--cy:${sy(START.y) - sy(CLICK.y)}px">${spriteSvg(CURSOR, 'cur', sx(CLICK.x), sy(CLICK.y))}<g class="hero-rays"><g transform="translate(${sx(CLICK.x) - 5} ${sy(CLICK.y) - 5})">${layers(rays, { grain: false })}</g></g></g>
</g></svg>`;
}

// ---- Pixel font text (display only: the h1 and the wordmark) --------------------------------

/** One word as an SVG of solid squares in the brand pixel font. Decorative: the real text sits beside it. */
export function pixelWord(word, cls = 'px-word') {
  const w = measure(word);
  let d = '';
  let cx = 0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    g.forEach((row, j) => {
      let i = 0;
      while (i < row.length) {
        if (row[i] !== '#') {
          i++;
          continue;
        }
        const s = i;
        while (i < row.length && row[i] === '#') i++;
        d += `M${cx + s} ${j}h${i - s}v1h${s - i}z`;
      }
    });
    cx += g[0].length + 1;
  }
  return `<svg class="${cls}" viewBox="0 0 ${w} 9" style="--w:${w}" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path d="${d}"/></svg>`;
}

/** The wordmark: indigo pixel letters, the dot of the i lit pink (as in the brand art). */
export function wordmarkSvg() {
  const word = 'Lightpath';
  const w = measure(word);
  let d = '';
  let cx = 0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    g.forEach((row, j) => {
      [...row].forEach((v, i) => {
        // The i's dot (column 6, row 0) is drawn separately in pink.
        if (v === '#' && !(cx === 6 && j === 0)) d += `M${cx + i} ${j}h1v1h-1z`;
      });
    });
    cx += g[0].length + 1;
  }
  return `<svg class="wordmark" viewBox="0 0 ${w} 9" style="--w:${w}" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path class="wm-ink" d="${d}"/><rect class="wm-dot" x="6" y="0" width="1" height="1"/></svg>`;
}

// ---- Spot illustrations for "How it works" ---------------------------------------------------

const I = { i: 2 };
const T = { i: 1 };
const P0 = { i: 0, p: 0 };
const PK = { i: 0, p: 2 };
const PT = { p: 1 };

function frame(r, x, y, w, h) {
  r.rect(x + 1, y + 1, w, h, I);
  r.rect(x, y, w, h, { i: 1, g: 1 });
  r.box(x, y, w, h, I);
  r.rect(x, y, w, 6, { i: 2, g: 0 });
  for (let k = 0; k < 3; k++) r.rect(x + w - 4 - k * 3, y + 2, 2, 2, T);
}

/** 1: a pointer clicks a button in a browser window. */
function spotClick() {
  const r = new Print(64, 44);
  frame(r, 4, 4, 54, 34);
  r.rect(9, 14, 30, 2, P0);
  r.rect(9, 18, 22, 2, P0);
  r.rrect(15, 25, 24, 9, 2, I);
  r.rrect(14, 24, 24, 8, 2, PK);
  r.rect(18, 27, 16, 2, P0);
  for (const [dx, dy] of CLICK_RAYS) r.rect(34 + dx, 30 + dy, 1, 1, { p: 2 });
  r.sprite(CURSOR, 34, 30);
  return r;
}

/** 2: two windows, browser and Node, each with coverage bars: lit where code ran. */
function spotCoverage() {
  const r = new Print(64, 44);
  frame(r, 3, 4, 27, 34);
  frame(r, 34, 4, 27, 34);
  const bars = [
    [1, 16, true],
    [3, 12, true],
    [3, 9, false],
    [1, 14, true],
    [3, 8, false],
    [1, 18, true],
  ];
  for (const ox of [3, 34]) {
    bars.forEach(([indent, len, ran], k) => {
      const y = 13 + k * 4;
      r.rect(ox + 3 + indent, y, len, 2, ran ? PK : I);
    });
  }
  return r;
}

/** 3: the trace arriving in the agent's chat: a speech bubble holding lit lines. */
function spotAgent() {
  const r = new Print(64, 44);
  r.rrect(5, 5, 54, 28, 3, I);
  r.rrect(4, 4, 54, 28, 3, { i: 1, g: 1 });
  r.rect(6, 6, 50, 24, P0);
  const lines = [
    [8, 22, true],
    [11, 30, true],
    [11, 18, false],
    [11, 26, true],
  ];
  lines.forEach(([x, len, ran], k) => {
    r.rect(x, 9 + k * 5, len, 2, ran ? PK : T);
  });
  r.rect(46, 9, 6, 2, PT);
  r.rect(12, 32, 6, 2, { i: 1 });
  r.rect(12, 34, 4, 2, { i: 1 });
  r.rect(12, 36, 2, 2, { i: 1 });
  r.rrect(30, 34, 28, 8, 2, I);
  r.rect(33, 37, 22, 2, P0);
  return r;
}

export function spotSvgs() {
  return [spotClick(), spotCoverage(), spotAgent()].map(
    (pr) =>
      `<svg class="spot" viewBox="0 0 ${pr.w} ${pr.h}" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><g class="art">${layers(pr)}</g></svg>`,
  );
}
