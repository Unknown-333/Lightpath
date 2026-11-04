// Review decisions, kept in code so the build reproduces them. See brand/README.md for why.
export const WINNER = 'a';

// Pink layer shift against indigo, in output pixels: the riso misregistration.
export const MISREGISTER = [2, 2];

// Dot grain per concept (null = none). Density is the share of pixels touched in grain areas.
export const GRAIN = {
  a: { seed: 11, density: 0.04 },
  b: { seed: 11, density: 0.04 },
  c: { seed: 11, density: 0.04 },
};
