// The three social-image concepts, drawn as two-ink riso prints on a cell grid.
// Each returns { print, scale } where scale takes the grid to 1200x630.
import { measure } from './font.mjs';
import { stampLogo } from './logo.mjs';
import { INK } from './palette.mjs';
import { Print } from './raster.mjs';
import { CLICK_RAYS, CURSOR, WALKER } from './sprites.mjs';

export const HEADLINE = ['See the exact lines', 'one click ran.'];
export const WORDMARK = 'Lightpath';

/** Wordmark in indigo with a tint shadow; the dot of the i is lit pink. */
function wordmark(r, x, y, s, ink = INK.indigo, shadow = INK.tint) {
  r.text(WORDMARK, x, y, s, ink, shadow);
  // 'L' is 5 wide + 1 gap, so the i column starts at x + 6s; its dot is row 0.
  r.rect(x + 6 * s, y, s, s, INK.pink);
  r.rect(x + 7 * s, y + s, s, s, ink.i === 0 ? INK.indigo : INK.paper);
}

function tile(r, x, y, lit) {
  r.rect(x + 1, y + 1, 5, 5, { i: 2, g: 0 }); // hard shadow
  if (lit) {
    r.rect(x, y, 5, 5, { ...INK.pink, g: 0 });
    r.rect(x, y, 5, 1, INK.pinkTint);
    r.rect(x, y, 1, 5, INK.pinkTint);
    r.rect(x + 4, y + 1, 1, 4, INK.plum);
    r.rect(x + 1, y + 4, 4, 1, INK.plum);
  } else {
    r.rect(x, y, 5, 5, { i: 2, p: 0, g: 0 });
    r.rect(x + 1, y + 1, 3, 3, { i: 1 });
  }
}

function windowFrame(r, { x, y, w, h }, label) {
  r.rect(x + 1, y + 1, w, h, INK.indigo); // hard shadow
  r.rect(x, y, w, h, { i: 1, g: 1 });
  r.box(x, y, w, h, INK.indigo);
  r.rect(x, y, w, 10, { i: 2, g: 0 });
  for (let k = 0; k < 3; k++) r.rect(x + w - 6 - k * 4, y + 4, 2, 2, INK.tint);
  r.text(label, x + 4, y + 2, 1, INK.paper);
}

// ---- Concept A: pixel path ------------------------------------------------------------------

const A = {
  W: 240,
  H: 126,
  left: { x: 12, y: 66, w: 100, h: 50 },
  right: { x: 128, y: 66, w: 100, h: 50 },
  pathY: 91,
  button: { x: 17, y: 86, w: 22, h: 12 },
};
// The path: tiles from the button to the server, in the order the light reaches them.
A.path = Array.from({ length: 26 }, (_, i) => ({ x: 42 + i * 6, y: A.pathY }));
// Branches that did not run (stay dark), as columns of tiles off the path.
A.branches = [
  { x: 66, dir: 1, n: 3 },
  { x: 90, dir: -1, n: 2 },
  { x: 150, dir: 1, n: 3 },
  { x: 162, dir: -1, n: 2 },
].flatMap(({ x, dir, n }) => Array.from({ length: n }, (_, k) => ({ x, y: A.pathY + dir * 6 * (k + 1) })));
A.rack = { x: 200, y: 77, w: 22, h: 36 };

export const SCENE_A = A;

function rack(r, { x, y, w, h }, ledsLit) {
  r.rect(x + 1, y + 1, w, h, { i: 2, g: 0 });
  r.rect(x, y, w, h, { i: 2, p: 0, g: 0 });
  for (let k = 0; k < 4; k++) {
    const by = y + 3 + k * 8;
    r.rect(x + 3, by, w - 6, 6, INK.tint);
    r.rect(x + 5, by + 2, 9, 1, INK.indigo);
    r.rect(x + 5, by + 4, 6, 1, INK.indigo);
    if (ledsLit[k]) r.rect(x + w - 7, by + 2, 2, 2, INK.pink);
    else r.rect(x + w - 7, by + 2, 2, 2, INK.indigo);
  }
}

function button(r, { x, y, w, h }, pressed, lit) {
  r.rrect(x + 1, y + 2, w, h, 3, { i: 2, p: 0, g: 0 });
  const dy = pressed ? 1 : 0;
  if (lit) {
    r.rrect(x, y + 1, w, h, 3, INK.plum);
    r.rrect(x, y + dy, w, h - 1, 3, INK.pink);
    r.rect(x + 3, y + dy + 1, w - 6, 1, INK.pinkTint);
  } else {
    r.rrect(x, y + 1, w, h, 3, INK.indigoOnly);
    r.rrect(x, y + dy, w, h - 1, 3, INK.paper);
    r.rrect(x, y + dy, w, h - 1, 3, INK.paper);
  }
  r.rect(x + 6, y + dy + 5, w - 12, 2, lit ? INK.paper : INK.tint);
}

/**
 * Draw concept A. `state` lets the animation drive it:
 * lit: tiles lit so far (0..path.length); pressed; buttonLit; cursor {x,y} or null; rays;
 * walker {x, frame} or null; leds: lit flags for the four rack lights.
 */
export function drawA(state = {}) {
  const s = {
    lit: A.path.length,
    pressed: false,
    buttonLit: true,
    cursor: { x: 31, y: 92 },
    rays: true,
    walker: { x: A.path.at(-1).x - 10, frame: 0 },
    leds: [true, true, true, true],
    ...state,
  };
  const r = new Print(A.W, A.H);
  // The wordmark is no longer pixel text: printA() stamps the official logo (brand/logo) at
  // LOGO_BOX in src/logo.mjs, where the pixel "Lightpath" used to be.
  r.text(HEADLINE[0], 12, 23, 2, INK.indigo, INK.tint);
  r.text(HEADLINE[1], 12, 43, 2, INK.indigo, INK.tint);

  windowFrame(r, A.left, 'browser');
  windowFrame(r, A.right, 'server');
  for (const t of A.branches) tile(r, t.x, t.y, false);
  A.path.forEach((t, i) => {
    tile(r, t.x, t.y, i < s.lit);
  });
  button(r, A.button, s.pressed, s.buttonLit);
  rack(r, A.rack, s.leds);
  if (s.walker) r.sprite(WALKER[s.walker.frame], s.walker.x, A.pathY - 13, 1, s.walker.flip);
  if (s.cursor) {
    if (s.rays) for (const [dx, dy] of CLICK_RAYS) r.rect(s.cursor.x + dx, s.cursor.y + dy, 1, 1, INK.pink);
    r.sprite(CURSOR, s.cursor.x, s.cursor.y);
  }
  return r;
}

export function conceptA() {
  return { print: drawA(), scale: 5, stamp: stampLogo };
}

// ---- Concept B: typographic, one oversized lit line -----------------------------------------

export function conceptB() {
  const W = 240;
  const H = 126;
  const r = new Print(W, H);
  // Quiet unlit "lines" behind the type: plain tint bars, clearly not code.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let y = 4; y < 98; y += 6) {
    const indent = 4 + Math.floor(rnd() * 4) * 6;
    const len = 30 + Math.floor(rnd() * 120);
    r.rect(18 + indent, y, Math.min(len, W - 30 - indent), 2, INK.tint);
    r.rect(8, y, 4, 2, INK.tint);
  }
  // Clear the text area and set line one in big indigo type.
  r.rect(10, 10, measure('See the exact') * 3 + 6, 38, INK.paper);
  r.text('See the exact', 12, 16, 3, INK.indigo, INK.tint);
  // The lit line: a full-width pink band carrying the rest of the headline, printed in indigo
  // over the pink so the words come out in the overprint colour.
  const by = 50;
  r.rect(0, by + 1, W, 28, INK.indigoOnly);
  r.rect(0, by, W, 27, INK.pink);
  r.rect(0, by, W, 1, INK.pinkTint);
  r.rect(4, by + 3, 2, 21, INK.pinkTint);
  r.text('lines one click ran.', 16, by + 5, 2, INK.indigo);
  r.sprite(CURSOR, 16 + measure('lines one click ran.') * 2 + 8, by + 12, 1);
  // Footer: a flat indigo block (grain allowed) with the wordmark knocked out to paper.
  r.rect(0, 98, W, H - 98, { i: 2, p: 0, g: 1 });
  r.rect(0, 98, W, 1, INK.tint);
  wordmark(r, 14, 104, 2, INK.paper, INK.tint);
  return { print: r, scale: 5 };
}

// ---- Concept C: flat 2D cartoon -------------------------------------------------------------

export function conceptC() {
  const W = 600;
  const H = 315;
  const r = new Print(W, H);
  // Text on the same 10 px headline pixel as A (5 units of 2 px).
  wordmark(r, 30, 22, 3);
  r.text(HEADLINE[0], 30, 56, 5, INK.indigo, INK.tint);
  r.text(HEADLINE[1], 30, 106, 5, INK.indigo, INK.tint);

  // Ground: a flat tint strip, grain allowed.
  r.rect(0, 286, W, H - 286, { i: 1, g: 1 });
  r.rect(0, 286, W, 3, INK.indigo);

  // Big arcade button on the left, lit.
  r.disc(97, 244, 34, INK.plum);
  r.disc(95, 240, 34, INK.pink);
  r.disc(82, 226, 9, INK.pinkTint);
  r.rrect(46, 250, 110, 36, 8, INK.indigo);
  r.rrect(40, 246, 110, 36, 8, { i: 2, p: 0, g: 1 });
  r.rect(46, 252, 98, 3, INK.tint);
  r.sprite(CURSOR, 118, 214, 3);
  for (const [dx, dy] of CLICK_RAYS) r.rect(118 + dx * 3, 214 + dy * 3, 3, 3, INK.pink);
  r.text('browser', 54, 294, 2, INK.indigo);

  // Cartoon server with a face on the right.
  const sx = 452;
  const sy = 168;
  r.rrect(sx + 6, sy + 6, 110, 118, 10, INK.tint);
  r.rrect(sx, sy, 110, 118, 10, { i: 2, p: 0, g: 1 });
  r.disc(sx + 36, sy + 34, 11, { ...INK.paper, g: 0 });
  r.disc(sx + 74, sy + 34, 11, { ...INK.paper, g: 0 });
  r.disc(sx + 39, sy + 36, 5, INK.indigo);
  r.disc(sx + 77, sy + 36, 5, INK.indigo);
  r.rect(sx + 42, sy + 58, 26, 4, { ...INK.paper, g: 0 });
  r.rect(sx + 38, sy + 54, 4, 4, { ...INK.paper, g: 0 });
  r.rect(sx + 68, sy + 54, 4, 4, { ...INK.paper, g: 0 });
  for (let k = 0; k < 2; k++) {
    r.rect(sx + 14, sy + 76 + k * 18, 82, 10, { i: 1, g: 0 });
    r.rect(sx + 80, sy + 79 + k * 18, 8, 4, { ...INK.pink, g: 0 });
  }
  r.text('server', sx + 20, 294, 2, INK.indigo);

  // The light string from the button to the server.
  const wire = [];
  const x0 = 150;
  const x1 = sx;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = x0 + (x1 - x0) * t;
    const sag = Math.sin(t * Math.PI * 3) ** 2 * 26;
    wire.push([Math.round(x), Math.round(200 + sag)]);
  }
  // Drops that did not run: long cords with unlit tint bulbs.
  for (const k of [12, 28]) {
    const [jx, jy] = wire[k];
    r.line(
      [
        [jx, jy],
        [jx, 248],
      ],
      3,
      INK.tint,
    );
    r.rect(jx - 3, 248, 6, 5, INK.tint);
    r.disc(jx, 260, 9, INK.tint);
    r.disc(jx - 3, 256, 3, INK.paper);
  }
  r.line(wire, 3, INK.indigo);
  // Bulbs along the main string, all lit: this is the path that ran.
  for (let i = 2; i < 40; i += 4) {
    const [bx, by] = wire[i];
    r.rect(bx - 3, by + 1, 6, 5, INK.indigo);
    r.disc(bx + 1, by + 14, 9, INK.plum);
    r.disc(bx, by + 13, 9, INK.pink);
    r.disc(bx - 3, by + 10, 3, INK.pinkTint);
  }
  return { print: r, scale: 2 };
}
