// The one fixed palette for every Lightpath brand image. Nothing may use another colour.
//
// Risograph model: marshmallow-white paper, two inks (deep indigo, bubblegum pink), each printed
// at full strength or as a lighter tint. Where inks overlap they overprint, and the overprint
// colour is the multiply of the two (checked in check.mjs). That gives 3 x 3 = 9 colours.
// Pink marks lit things only (code that ran, the click, the light).
export const PAPER = '#fcf5ec';
export const INDIGO = '#2b2684';
export const INDIGO_TINT = '#a19dd9';
export const PINK = '#ff4f9f';
export const PINK_TINT = '#ffb3d2';

// Index = indigo level * 3 + pink level, level 0 = none, 1 = tint, 2 = full ink.
export const PALETTE = [
  { name: 'paper', hex: PAPER },
  { name: 'pink tint', hex: PINK_TINT },
  { name: 'pink', hex: PINK },
  { name: 'indigo tint', hex: INDIGO_TINT },
  { name: 'pink tint over indigo tint', hex: '#a16eb3' },
  { name: 'pink over indigo tint', hex: '#a13187' },
  { name: 'indigo', hex: INDIGO },
  { name: 'pink tint over indigo', hex: '#2b1b6d' },
  { name: 'pink over indigo', hex: '#2b0c52' },
];

export const colourIndex = (indigo, pink) => indigo * 3 + pink;

const hexRGB = (hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

export const RGB = PALETTE.map(({ hex }) => hexRGB(hex));

/**
 * What each palette entry should be. An ink alone is its printed colour on this paper;
 * two inks overprint as the per-channel multiply of their printed colours.
 */
export function expectedOverprint(indigo, pink) {
  const ink = [hexRGB(PAPER), hexRGB(INDIGO_TINT), hexRGB(INDIGO)][indigo];
  const pk = [null, hexRGB(PINK_TINT), hexRGB(PINK)][pink];
  if (!pk) return ink;
  if (indigo === 0) return pk;
  return ink.map((v, ch) => Math.round((v * pk[ch]) / 255));
}

// Ink shorthands for drawing. i = indigo level, p = pink level; a missing key leaves that layer alone.
export const INK = {
  paper: { i: 0, p: 0 }, // knock both layers out
  indigo: { i: 2 },
  tint: { i: 1 },
  indigoOnly: { i: 2, p: 0 },
  pink: { i: 0, p: 2 }, // lit: pink on bare paper (indigo knocked out)
  pinkTint: { i: 0, p: 1 },
  pinkOver: { p: 2 }, // pink printed over whatever indigo is there
  plum: { i: 2, p: 2 }, // pink over full indigo
};
