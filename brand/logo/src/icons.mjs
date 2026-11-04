// Favicons, the app icon and the avatar, as SVG and as pixels, from the recommended mark.
import { pathData, rect, roundRect } from './geom.mjs';
import { markLayers } from './lockup.mjs';
import { canvas, paint } from './raster.mjs';
import { paintMark } from './render.mjs';
import { COLOURWAYS, TOKENS } from './tokens.mjs';

// PNG and ICO favicons carry no colour-scheme switch, so they sit on a marshmallow tile:
// on a light tab the tile is almost invisible, on a dark tab it keeps the indigo readable.
export const TILE_RADIUS = 3; // units of the 16-unit grid

/** 16 / 32 / 48 px favicon: the hinted mark on a marshmallow tile. */
export function faviconPixels(concept, size) {
  const c = canvas(size, size);
  paint(c, roundRect(0, 0, 16, 16, TILE_RADIUS), TOKENS['lp-marshmallow'], { s: size / 16 });
  paintMark(c, concept, size, COLOURWAYS.colour);
  return c;
}

/** favicon.svg: transparent, indigo and pink; white and pink when the browser is in dark mode. */
export function faviconSVG(geo) {
  const [ind, pk] = markLayers(geo);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" role="img" aria-label="Lightpath"><title>Lightpath</title>',
    `<style>.i{fill:${TOKENS['lp-indigo']}}.p{fill:${TOKENS['lp-pink']}}@media (prefers-color-scheme:dark){.i{fill:${TOKENS['lp-white']}}}</style>`,
    `<path class="i" d="${pathData(ind.segs)}"/><path class="p" d="${pathData(pk.segs)}"/>`,
    '</svg>\n',
  ].join('');
}

// App icon, apple-touch-icon and avatar: full-bleed indigo, the mark reversed (white and pink),
// its 16-unit box at 62.5% of the side. That keeps the whole mark inside a circle crop.
export const ICON_BOX = 0.625;

export function iconPixels(concept, size) {
  const c = canvas(size, size, TOKENS['lp-indigo']);
  const box = size * ICON_BOX;
  const off = (size - box) / 2;
  paintMark(c, concept, box, COLOURWAYS.reversed, off, off);
  return c;
}

export function iconSVG(geo) {
  const off = (16 / ICON_BOX - 16) / 2;
  const side = 16 / ICON_BOX;
  const [ind, pk] = markLayers(geo, 1, off, off);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" role="img" aria-label="Lightpath"><title>Lightpath</title>`,
    `<path fill="${TOKENS['lp-indigo']}" d="${pathData(rect(0, 0, side, side))}"/>`,
    `<path fill="${TOKENS['lp-white']}" d="${pathData(ind.segs)}"/><path fill="${TOKENS['lp-pink']}" d="${pathData(pk.segs)}"/>`,
    '</svg>\n',
  ].join('');
}
