// SVG writer: one <path> per colour, outlines only (no strokes, no fonts, no filters).
import { pathData } from './geom.mjs';

const colourOf = (role, way) => (role === 'pink' ? way.pink : way.indigo);

/** art = { layers, w, h }. Options: title, background colour, scale of the viewBox. */
export function toSVG(art, way, { title = 'Lightpath', bg = null, width, height } = {}) {
  const groups = new Map();
  for (const l of art.layers) {
    if (!l.segs.length) continue;
    const col = colourOf(l.role, way);
    // Indigo-role shapes go first so pink sits on top; same colours merge into one path.
    if (!groups.has(col)) groups.set(col, []);
    groups.get(col).push(...l.segs);
  }
  const w = round(art.w);
  const h = round(art.h);
  const size = width ? ` width="${width}" height="${height ?? width}"` : '';
  const body = [];
  if (bg) body.push(`<rect width="${w}" height="${h}" fill="${bg}"/>`);
  for (const [col, segs] of groups) body.push(`<path fill="${col}" d="${pathData(segs)}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${size} role="img" aria-label="${title}"><title>${title}</title>${body.join('')}</svg>\n`;
}

const round = (v) => Math.round(v * 1000) / 1000;
