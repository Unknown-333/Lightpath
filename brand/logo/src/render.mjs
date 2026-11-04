// Draw a concept's mark into a canvas at a pixel size, in a colourway.
import { paint } from './raster.mjs';

/** The geometry used at a pixel size: the hinted drawing if the concept has one for it. */
export function geometryAt(concept, size) {
  const hinted = concept.hint?.(size);
  return (hinted ?? concept.draw)();
}

/** Paint the mark into canvas c with its 16-unit box at (x, y) and `size` px wide. */
export function paintMark(c, concept, size, way, x = 0, y = 0, geo = geometryAt(concept, size)) {
  const s = size / 16;
  // One paint per ink, so touching pieces of the same ink never show an anti-aliasing seam.
  // In one-colour variants both inks are the same colour and are merged into one paint.
  if (way.indigo === way.pink) {
    paint(c, [...geo.indigo, ...geo.pink].flat(), way.indigo, { s, ox: x, oy: y });
    return;
  }
  paint(c, geo.indigo.flat(), way.indigo, { s, ox: x, oy: y });
  paint(c, geo.pink.flat(), way.pink, { s, ox: x, oy: y });
}

/** Paint a lockup or wordmark ({ layers, w, h }) scaled by s with its top-left at (x, y). */
export function paintArt(c, art, way, s, x = 0, y = 0) {
  const groups = new Map();
  for (const l of art.layers) {
    const col = l.role === 'pink' ? way.pink : way.indigo;
    if (!groups.has(col)) groups.set(col, []);
    groups.get(col).push(...l.segs);
  }
  for (const [col, segs] of groups) if (segs.length) paint(c, segs, col, { s, ox: x, oy: y });
}
