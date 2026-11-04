// Text as outlines: lays out a string in a font and returns path segments (y down).
// Used for the wordmark and for the review sheet labels. Kerning comes from a table we pass in,
// not from the font (the reader skips GPOS).
import { contourToSegments } from './ttf.mjs';

/**
 * Outline `str` with its baseline at (x, y), `size` = font size in output units.
 * tracking and kerning are in 1/1000 em. Returns { segs, width, glyphs }.
 */
export function outline(font, str, size, x = 0, y = 0, { tracking = 0, kern = {} } = {}) {
  const s = size / font.metrics.unitsPerEm;
  const segs = [];
  const glyphs = [];
  let pen = 0;
  const chars = [...str];
  chars.forEach((ch, i) => {
    const gid = font.glyphId(ch);
    const gx = x + pen * s;
    const own = [];
    for (const contour of font.contours(gid)) {
      for (const g of contourToSegments(contour)) {
        if (g.c === 'Z') own.push(g);
        else if (g.c === 'Q')
          own.push({ c: 'Q', cx: gx + g.cx * s, cy: y - g.cy * s, x: gx + g.x * s, y: y - g.y * s });
        else own.push({ c: g.c, x: gx + g.x * s, y: y - g.y * s });
      }
    }
    glyphs.push({ ch, segs: own, x: gx });
    segs.push(...own);
    pen += font.advance(gid);
    if (i < chars.length - 1) {
      const pair = ch + chars[i + 1];
      pen += ((tracking + (kern[pair] ?? 0)) * font.metrics.unitsPerEm) / 1000;
    }
  });
  return { segs, width: pen * s, glyphs };
}

export function measure(font, str, size, opts) {
  let w = 0;
  const s = size / font.metrics.unitsPerEm;
  const chars = [...str];
  chars.forEach((ch, i) => {
    w += font.advance(font.glyphId(ch)) * s;
    if (i < chars.length - 1)
      w += (((opts?.tracking ?? 0) + (opts?.kern?.[ch + chars[i + 1]] ?? 0)) * size) / 1000;
  });
  return w;
}

/** Greedy word wrap to a width. */
export function wrap(font, text, size, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(font, next, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
