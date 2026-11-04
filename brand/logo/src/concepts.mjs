// The five logo concepts, drawn on a 16-unit grid (1 unit = 1 px at 16 px).
// Every edge sits on a whole unit, so at 16, 32 and 48 px the straight edges land on whole pixels
// without a separate small-size drawing. The one exception is the pixel path (see `hint`).
// Each concept has two ink roles: `indigo` (the path, unlit) and `pink` (the lit part). Pink is
// painted on top. Where the two meet, the indigo piece runs 0.1 unit under the pink one so
// anti-aliasing never shows a pale seam between them.
import { bend, circle, rect } from './geom.mjs';

const OV = 0.1;

// 1. Path mark: the click (a dot), a line with one bend, an end node (a square).
//    Stroke 3 units. A first draft ran right and then down; at 64 px and up it read as a water tap,
//    so the line now runs down from the click and turns right.
function pathMark() {
  return {
    pink: [circle(3, 3, 2), rect(2, 3, 2, 5)],
    indigo: [rect(2, 8 - OV, 2, 3 + OV), bend(5, 11, 3, 1, 90, 180), rect(5, 12, 6.1, 2), rect(11, 11, 4, 4)],
  };
}

// 2. Lettermark: an "L" drawn as one path. The vertical is indigo, the tail is pink.
function lettermark() {
  return {
    indigo: [rect(3, 2, 3, 8), bend(7, 10, 4, 1, 180, 90), rect(7, 11, OV, 3)],
    pink: [rect(7, 11, 6, 3)],
  };
}

// 3. Pixel path: a 5 x 5 grid. Cells the path ran through are solid; the rest are small dots.
const PATH_CELLS = [
  [1, 0],
  [1, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [3, 3],
  [3, 4],
];
function pixelPath(offset = 0.5) {
  const lit = new Set(PATH_CELLS.map(([r, c]) => `${r},${c}`));
  const indigo = [];
  const pink = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = offset + c * 3;
      const y = offset + r * 3;
      if (lit.has(`${r},${c}`)) pink.push(rect(x, y, 3, 3));
      else indigo.push(rect(x + 1, y + 1, 1, 1));
    }
  }
  return { indigo, pink };
}

// 4. Lit lines: four bars like lines of code. Lit bars are thick and pink; unlit bars are thin.
function litLines() {
  return {
    indigo: [rect(2, 2, 7, 1), rect(2, 13, 5, 1)],
    pink: [rect(4, 5, 10, 2), rect(4, 9, 7, 2)],
  };
}

// 5. Branch (our own): the click runs into an if. The branch that ran is lit and long;
//    the branch that did not run stays indigo and stops short.
function branch() {
  return {
    pink: [
      circle(3, 8, 2),
      rect(3, 7, 5, 2),
      rect(7, 6, 2, 3),
      bend(10, 6, 3, 1, 180, 270),
      rect(10, 3, 5, 2),
    ],
    indigo: [rect(7, 8 - OV, 2, 2 + OV), bend(10, 10, 3, 1, 180, 90), rect(10, 11, 2, 2)],
  };
}

export const CONCEPTS = [
  {
    id: 'path',
    n: 1,
    name: 'Path mark',
    draw: pathMark,
    idea: 'A dot (the click) runs along a line that bends once and ends in a square node. The part from the click to the bend is lit.',
    memory: 'A dot on top, a line down, a turn to the right, a square at the end.',
  },
  {
    id: 'letter',
    n: 2,
    name: 'Lettermark L',
    draw: lettermark,
    idea: 'A capital L drawn as one path. The vertical is unlit; the tail is lit.',
    memory: 'A thick L whose foot is pink.',
  },
  {
    id: 'pixel',
    n: 3,
    name: 'Pixel path',
    draw: pixelPath,
    // At 16 and 48 px the half-unit centring offset would fall between pixels, so the grid is
    // moved to start on a whole pixel (one pixel more margin on the right and bottom).
    hint: (size) => ({ 16: () => pixelPath(0), 48: () => pixelPath(1 / 3) })[size] ?? null,
    idea: 'A 5 x 5 grid of pixels. The cells one click ran through are lit and join into a path; the rest stay as dots.',
    memory: 'A dotted 5 by 5 grid with a thick stepped line across it.',
  },
  {
    id: 'lines',
    n: 4,
    name: 'Lit lines',
    draw: litLines,
    idea: 'Four lines of code. The two indented lines that ran are thick and lit; the two that did not are thin.',
    memory: 'Four bars, the middle two thick and indented.',
  },
  {
    id: 'branch',
    n: 5,
    name: 'Branch (own)',
    draw: branch,
    idea: 'The click runs into a fork, like an if. The branch that ran is lit and long; the one that did not stays dark and short.',
    memory: 'A dot on a stem that splits in two, the top arm longer.',
  },
];
