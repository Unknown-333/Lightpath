// The brand's risograph palette, copied from brand/src/palette.mjs (PR #57, commit d4d8167) so the
// demo GIF does not depend on that PR. Paper plus two inks (indigo, pink), each at full strength or
// as a tint; where they overlap they overprint (per-channel multiply). 3 x 3 = 9 colours.
// Pink marks lit things only: code that ran, the click, the light.
export const PAPER = '#fcf5ec';
export const INDIGO = '#2b2684';
export const INDIGO_TINT = '#a19dd9';
export const PINK = '#ff4f9f';
export const PINK_TINT = '#ffb3d2';

// Index = indigo level * 3 + pink level; level 0 = none, 1 = tint, 2 = full ink.
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

const hexRGB = (hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

export const RGB = PALETTE.map(({ hex }) => hexRGB(hex));
