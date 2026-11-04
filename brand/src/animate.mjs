// The animated loop of the winning concept (A, pixel path): the click, the path lighting up
// tile by tile from the browser to the server, then the walker carries the light back and the
// loop ends where it began. 10 fps stepped, 100 frames = 10 s.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawA, SCENE_A } from './concepts.mjs';
import { encodeGIF } from './gif.mjs';
import { stampLogo } from './logo.mjs';
import { RGB } from './palette.mjs';
import { encodeIndexed } from './png.mjs';
import { printRaster } from './raster.mjs';
import { GRAIN, MISREGISTER } from './winner.mjs';

export const FPS = 10;
export const FRAMES = 100;
export const POSTER_FRAME = 72;
export const GIF_SCALE = 4; // 960x504
export const VIDEO_SCALE = 6; // 1440x756: every edge on an even pixel, so 4:2:0 chroma stays exact
export const VIDEO_DOT = 2;

const N = SCENE_A.path.length;
const START = { x: 52, y: 108 };
const CLICK = { x: 31, y: 92 };
const lerp = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
const walkerX = (p) => SCENE_A.path[0].x - 6 + p * 6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Scene state for frame f (0..FRAMES-1). Frame 0 follows frame 99 without a jump. */
export function stateAt(f) {
  const s = {
    lit: 0,
    pressed: false,
    buttonLit: false,
    cursor: CLICK,
    rays: false,
    walker: { x: walkerX(0), frame: 0, flip: false },
    leds: [false, false, false, false],
  };
  if (f < 8) s.cursor = lerp(START, CLICK, f / 8);
  if (f >= 10 && f < 92) s.buttonLit = true;
  if (f === 10 || f === 11) s.pressed = true;
  if (f >= 10 && f < 15) s.rays = true;
  if (f >= 12 && f < 80) {
    s.lit = clamp(Math.floor((f - 12) / 2) + 1, 0, N);
    const p = s.lit - 1;
    s.walker = { x: walkerX(p), frame: f < 64 ? f % 2 : 0, flip: false };
    s.leds = [0, 1, 2, 3].map((k) => f >= 63 + k);
  }
  if (f >= 80 && f < 93) {
    const p = clamp(N - 1 - 2 * (f - 79), 0, N - 1);
    s.lit = f < 92 ? p + 1 : 0;
    s.walker = { x: walkerX(p), frame: f % 2, flip: true };
  }
  if (f >= 92) s.cursor = lerp(CLICK, START, (f - 91) / 9);
  return s;
}

export function frameRaster(f, k, dot = 1) {
  const r = printRaster(drawA(stateAt(f)), k, { offset: MISREGISTER, grain: GRAIN.a, dot });
  return stampLogo(r, k, { offset: MISREGISTER, dot });
}

function encodeVideo(ffmpeg, args, k) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${err.slice(-2000)}`)),
    );
    (async () => {
      for (let f = 0; f < FRAMES; f++) {
        const r = frameRaster(f, k, VIDEO_DOT);
        const buf = Buffer.alloc(r.w * r.h * 3);
        for (let i = 0; i < r.px.length; i++) {
          const c = RGB[r.px[i]];
          buf[i * 3] = c[0];
          buf[i * 3 + 1] = c[1];
          buf[i * 3 + 2] = c[2];
        }
        if (!p.stdin.write(buf)) await new Promise((ok) => p.stdin.once('drain', ok));
      }
      p.stdin.end();
    })().catch(reject);
  });
}

// RGB -> BT.709 limited-range 4:2:0, tagged so players convert it back the same way.
// Nearest-neighbour chroma: every 2x2 block is one colour, so subsampling loses nothing there.
export const TO_YUV = 'scale=out_color_matrix=bt709:out_range=tv:flags=neighbor+accurate_rnd,format=yuv420p';
const TAGS = [
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv',
];

export async function buildAnimation(out, { video }) {
  const frames = Array.from({ length: FRAMES }, (_, f) => frameRaster(f, GIF_SCALE));
  writeFileSync(join(out, 'loop.gif'), encodeGIF(frames, RGB, 100 / FPS));
  writeFileSync(
    join(out, 'poster.png'),
    encodeIndexed(frameRaster(POSTER_FRAME, VIDEO_SCALE, VIDEO_DOT), RGB),
  );
  console.log(`loop.gif: ${frames.length} frames at ${FPS} fps; poster.png: frame ${POSTER_FRAME}`);
  if (!video) return;
  const ffmpeg = process.env.FFMPEG;
  if (!ffmpeg) throw new Error('set FFMPEG to the full path of ffmpeg, or pass --no-video');
  const { w, h } = { w: SCENE_A.W * VIDEO_SCALE, h: SCENE_A.H * VIDEO_SCALE };
  const input = ['-y', '-hide_banner', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`];
  input.push('-framerate', String(FPS), '-i', '-', '-vf', TO_YUV);
  await encodeVideo(
    ffmpeg,
    [
      ...input,
      ...['-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', '4', '-g', String(FRAMES)],
      ...[
        '-profile:v',
        'high',
        '-x264-params',
        'colorprim=bt709:transfer=bt709:colormatrix=bt709',
        ...TAGS,
        '-movflags',
        '+faststart',
        '-an',
        join(out, 'loop.mp4'),
      ],
    ],
    VIDEO_SCALE,
  );
  await encodeVideo(
    ffmpeg,
    [
      ...input,
      ...['-c:v', 'libvpx-vp9', '-lossless', '1', '-row-mt', '1', '-g', String(FRAMES)],
      ...[...TAGS, '-an', join(out, 'loop.webm')],
    ],
    VIDEO_SCALE,
  );
  console.log(`loop.mp4, loop.webm: ${w}x${h}, ${FPS} fps, ${FRAMES / FPS} s`);
}
