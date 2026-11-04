// Logo colour tokens. The hex values come from the riso palette (brand/src/palette.mjs, PR #57),
// so the logo and the brand art can never drift apart. The logo uses ONE indigo and ONE pink.
// Marshmallow is the paper the logo sits on, not a logo colour.
import { INDIGO, PAPER, PINK } from '../../src/palette.mjs';

export const TOKENS = {
  'lp-indigo': INDIGO,
  'lp-pink': PINK,
  'lp-marshmallow': PAPER,
  'lp-black': '#000000',
  'lp-white': '#ffffff',
};

// How each variant colours the two ink roles. `bg` is only where the review sheet shows it.
export const COLOURWAYS = {
  colour: { label: 'Full colour', indigo: INDIGO, pink: PINK, bg: PAPER },
  indigo: { label: 'One colour, indigo', indigo: INDIGO, pink: INDIGO, bg: '#ffffff' },
  black: { label: 'Black', indigo: '#000000', pink: '#000000', bg: '#ffffff' },
  white: { label: 'White on indigo', indigo: '#ffffff', pink: '#ffffff', bg: INDIGO },
  reversed: { label: 'Reversed colour', indigo: '#ffffff', pink: PINK, bg: INDIGO },
};
