// Sprite data: rows of palette keys (see palette.mjs), '.' is transparent. All original drawings.

// The lamplighter: a small marshmallow-white walker that carries the light along the path.
// Two walking frames; the lantern is the only pink part.
export const WALKER = [
  [
    '...........pp.',
    '..........pPPq',
    '..........PPPq',
    '..........qPPq',
    '...........qq.',
    '...KKKK.....K.',
    '..KWWWWK....K.',
    '.KWWWWWWK...K.',
    '.KWWWKWKWK.KK.',
    '.KWWWKWKWWKK..',
    '.KLWWWWWWK....',
    '..KLLLLLK.....',
    '...KK.KK......',
  ],
  [
    '...........pp.',
    '..........pPPq',
    '..........PPPq',
    '..........qPPq',
    '...........qq.',
    '...KKKK.....K.',
    '..KWWWWK....K.',
    '.KWWWWWWK...K.',
    '.KWWWKWKWK.KK.',
    '.KWWWKWKWWKK..',
    '.KLWWWWWWK....',
    '..KLLLLLK.....',
    '..KK...KK.....',
  ],
];

// Mouse pointer.
export const CURSOR = [
  'K.........',
  'KK........',
  'KWK.......',
  'KWWK......',
  'KWWWK.....',
  'KWWWWK....',
  'KWWWWWK...',
  'KWWWWWWK..',
  'KWWWWWWWK.',
  'KWWWWKKKKK',
  'KWWKWWK...',
  'KWK.KWWK..',
  'KK..KWWK..',
  'K....KWWK.',
  '.....KKK..',
];

// Hard pixel "click" burst drawn around the pointer tip, offsets from the tip.
export const CLICK_RAYS = [
  [-3, -3],
  [-4, -4],
  [0, -4],
  [0, -5],
  [-4, 0],
  [-5, 0],
  [3, -3],
  [4, -4],
];
