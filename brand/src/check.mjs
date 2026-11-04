// Checks every output against the fixed palette and the size limits, and writes the numbers
// to brand/out/check.json. PNGs are decoded and every pixel's colour counted; the GIF's colour
// table is read; MP4/WebM frames are decoded with ffmpeg and compared with the source frame.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FPS, FRAMES, frameRaster, POSTER_FRAME, VIDEO_DOT, VIDEO_SCALE } from './animate.mjs';
import { gifColours } from './gif.mjs';
import { expectedOverprint, PALETTE, RGB } from './palette.mjs';
import { decodePNG, encodeRGB } from './png.mjs';

const MB = 1024 * 1024;
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const PALETTE_SET = new Set(PALETTE.map((c) => c.hex));

function pngColours(path) {
  const { w, h, rgb } = decodePNG(readFileSync(path));
  const seen = new Map();
  for (let i = 0; i < w * h; i++) {
    const k = hex([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const outside = [...seen.keys()].filter((k) => !PALETTE_SET.has(k));
  return { w, h, uniqueColours: seen.size, outsidePalette: outside.length };
}

function decodeFrame(ffmpeg, file, n, w, h) {
  const vf = `select=eq(n\\,${n}),scale=in_color_matrix=bt709:in_range=tv:flags=neighbor+accurate_rnd,format=rgb24`;
  const args = ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', vf, '-frames:v', '1'];
  const r = spawnSync(ffmpeg, [...args, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * MB });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr}`);
  if (r.stdout.length !== w * h * 3) throw new Error(`decoded ${r.stdout.length} bytes, want ${w * h * 3}`);
  return r.stdout;
}

function nearest(r, g, b) {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  RGB.forEach(([R, G, B], i) => {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function compareVideo(ffmpeg, file, review) {
  const src = frameRaster(POSTER_FRAME, VIDEO_SCALE, VIDEO_DOT);
  const got = decodeFrame(ffmpeg, file, POSTER_FRAME, src.w, src.h);
  let maxErr = 0;
  let sumErr = 0;
  let wrongColour = 0;
  for (let i = 0; i < src.px.length; i++) {
    const want = RGB[src.px[i]];
    const g = [got[i * 3], got[i * 3 + 1], got[i * 3 + 2]];
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(g[c] - want[c]);
      sumErr += e;
      if (e > maxErr) maxErr = e;
    }
    if (nearest(...g) !== src.px[i]) wrongColour++;
  }
  // A 2x nearest-neighbour crop of the decoded frame, to look at edge sharpness.
  const cw = 360;
  const ch = 180;
  const x0 = 1080 - 500;
  const y0 = 500;
  const out = Buffer.alloc(cw * 2 * ch * 2 * 3);
  for (let y = 0; y < ch * 2; y++)
    for (let x = 0; x < cw * 2; x++) {
      const s = ((y0 + (y >> 1)) * src.w + x0 + (x >> 1)) * 3;
      got.copy(out, (y * cw * 2 + x) * 3, s, s + 3);
    }
  const name = `video-2x-${file.endsWith('.mp4') ? 'mp4' : 'webm'}.png`;
  return {
    frame: POSTER_FRAME,
    maxChannelError: maxErr,
    meanChannelError: Number((sumErr / (src.px.length * 3)).toFixed(3)),
    pixelsNearestToAnotherPaletteColour: wrongColour,
    crop2x: { name, png: encodeRGB(cw * 2, ch * 2, out), path: join(review, name) },
  };
}

export async function runChecks(root, { video }) {
  const out = join(root, 'out');
  const review = join(root, 'review');
  const fails = [];
  const palette = PALETTE.map((c, i) => {
    const want = hex(expectedOverprint(Math.floor(i / 3), i % 3));
    if (want !== c.hex) fails.push(`palette ${c.name} is ${c.hex}, multiply gives ${want}`);
    return { ...c, multiplyCheck: want === c.hex };
  });
  if (PALETTE.length < 8 || PALETTE.length > 12) fails.push(`palette has ${PALETTE.length} colours`);

  const files = {};
  const pngs = [
    ['out/og.png', 1200, 630],
    ['out/poster.png', 1440, 756],
    ['review/concept-a.png', 1200, 630],
    ['review/concept-b.png', 1200, 630],
    ['review/concept-c.png', 1200, 630],
  ];
  for (const [rel, w, h] of pngs) {
    const p = join(root, rel);
    const c = pngColours(p);
    const bytes = statSync(p).size;
    files[rel] = { bytes, ...c };
    if (c.w !== w || c.h !== h) fails.push(`${rel} is ${c.w}x${c.h}, want ${w}x${h}`);
    if (c.outsidePalette) fails.push(`${rel} has ${c.outsidePalette} colours outside the palette`);
    if (bytes >= MB) fails.push(`${rel} is ${bytes} bytes`);
  }

  const gifPath = join(out, 'loop.gif');
  const gifBuf = readFileSync(gifPath);
  const g = gifColours(gifBuf);
  const tableOutside = g.table.map(hex).filter((k) => !PALETTE_SET.has(k));
  files['out/loop.gif'] = {
    bytes: gifBuf.length,
    w: gifBuf.readUInt16LE(6),
    h: gifBuf.readUInt16LE(8),
    frames: g.frames,
    seconds: g.frames / FPS,
    tableEntriesOutsidePalette: tableOutside.length,
    distinctTableColours: new Set(g.table.map(hex)).size,
    localColourTables: g.localTables,
  };
  if (tableOutside.length || g.localTables) fails.push('loop.gif can show colours outside the palette');
  if (g.frames !== FRAMES) fails.push(`loop.gif has ${g.frames} frames`);
  if (gifBuf.length >= 8 * MB) fails.push(`loop.gif is ${gifBuf.length} bytes`);

  if (video) {
    const { writeFileSync } = await import('node:fs');
    for (const name of ['loop.mp4', 'loop.webm']) {
      const p = join(out, name);
      const v = compareVideo(process.env.FFMPEG, p, review);
      writeFileSync(v.crop2x.path, v.crop2x.png);
      files[`out/${name}`] = { bytes: statSync(p).size, ...v, crop2x: `review/${v.crop2x.name}` };
      if (v.pixelsNearestToAnotherPaletteColour > 0)
        fails.push(`${name}: colours drift to another palette entry`);
    }
  }
  const summary = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [
      k,
      `${v.bytes} bytes${v.uniqueColours !== undefined ? `, ${v.uniqueColours} colours, ${v.outsidePalette} outside` : ''}${v.distinctTableColours !== undefined ? `, table ${v.distinctTableColours} colours, ${v.tableEntriesOutsidePalette} outside` : ''}${v.maxChannelError !== undefined ? `, max err ${v.maxChannelError}, mean ${v.meanChannelError}, off-palette px ${v.pixelsNearestToAnotherPaletteColour}` : ''}`,
    ]),
  );
  return { ok: fails.length === 0, fails, palette, files, summary };
}
