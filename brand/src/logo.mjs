// The official logo (brand/logo, approved 2026-11-04) printed into the riso art.
// The horizontal lockup is drawn from the same outlines as brand/logo/svg, then printed like
// the rest of the art: hard edges (each block is ink or no ink, never a blend), the pink layer
// shifted by the misregistration, and pink over indigo printing the overprint colour.
// Blocks are `dot` output pixels square, so at the video scale every edge stays on an even pixel.
import { CONCEPTS } from '../logo/src/concepts.mjs';
import { horizontal } from '../logo/src/lockup.mjs';
import { RECOMMENDED } from '../logo/src/notes.mjs';
import { coverageMap } from '../logo/src/raster.mjs';
import { loadFont } from '../logo/src/ttf.mjs';

const font = loadFont(new URL('../logo/fonts/IBMPlexSans-SemiBold.ttf', import.meta.url));
const art = horizontal(font, CONCEPTS.find((k) => k.id === RECOMMENDED).draw());
const ink = (pink) => art.layers.filter((l) => (l.role === 'pink') === pink).flatMap((l) => l.segs);

// Where the lockup sits, in cells of the scene grid: top-left corner and height.
export const LOGO_BOX = { x: 12, y: 8, h: 11 };

/** Width of the lockup in cells at LOGO_BOX.h. */
export const logoCells = () => (art.w / art.h) * LOGO_BOX.h;

/**
 * Stamp the lockup into an indexed print (palette index = indigo level * 3 + pink level).
 * k = output pixels per cell; offset = pink misregistration in output pixels.
 */
export function stampLogo(out, k, { offset = [2, 2], dot = 1 } = {}) {
  const s = (LOGO_BOX.h * k) / art.h / dot;
  const x0 = LOGO_BOX.x * k;
  const y0 = LOGO_BOX.y * k;
  const bw = Math.ceil((art.w * s) / 1) + 2;
  const bh = Math.ceil(art.h * s) + 2;
  const ci = coverageMap(ink(false), bw, bh, { s });
  const cp = coverageMap(ink(true), bw, bh, { s });
  const [dx, dy] = offset.map((v) => Math.round(v / dot));
  for (let by = 0; by < bh + dy; by++) {
    for (let bx = 0; bx < bw + dx; bx++) {
      const i = by < bh && bx < bw && ci[by * bw + bx] >= 0.5;
      const py = by - dy;
      const px = bx - dx;
      const p = py >= 0 && px >= 0 && py < bh && px < bw && cp[py * bw + px] >= 0.5;
      if (!i && !p) continue;
      for (let yy = 0; yy < dot; yy++) {
        for (let xx = 0; xx < dot; xx++) {
          const ox = x0 + bx * dot + xx;
          const oy = y0 + by * dot + yy;
          if (ox >= out.w || oy >= out.h) continue;
          const old = out.px[oy * out.w + ox];
          out.px[oy * out.w + ox] = (i ? 2 : Math.floor(old / 3)) * 3 + (p ? 2 : old % 3);
        }
      }
    }
  }
  return out;
}
