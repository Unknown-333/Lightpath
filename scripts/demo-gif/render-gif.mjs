// Turns one recorded tududi run (record-tududi.mjs) into the README GIF (D-138), drawn as a two-ink
// risograph print in the brand's palette. Five scenes, one idea each: the user's bug report
// over the real app, the agent's run_action click (frames of Lightpath's own browser from the run's
// screencast), the trace lines that matter, the agent's edit, and the list before and after.
//
// Every tool call, argument, trace line and agent sentence shown is cut from the run's stream-json
// transcript by the rules below; nothing is typed in by hand. Time is shortened: each scene has a
// fixed length, and every frame says so. The "after" picture is from `record-tududi.mjs --after`
// (server restarted, one scripted click), and the GIF says so.
//
// How it is drawn: everything around the app is set pixel by pixel on two ink layers (indigo and
// pink, levels 0-2) and printed with the 9-colour palette in riso-palette.mjs. Text uses the
// "Lightpath Pixel" bitmap font (pixel-font.mjs) at whole-number scales. There is no blur, gradient,
// glow, soft shadow or anti-aliasing in the frame; shadows are hard offsets. Grain is single-pixel
// dots from a fixed seed, only in large flat fills, never near text or the app.
//
// tududi's screenshots are scaled by Chrome and then recoloured, pixel by pixel, from their
// brightness to six indigo-on-paper steps (APP_RAMP below; the owner allowed this on 2026-11-04).
// Nothing in them is redrawn, added or removed, and no app pixel becomes pink: pink stays for what
// ran and for the click. The whole GIF uses 12 colours.
//
// Usage: node scripts/demo-gif/render-gif.mjs --run <folder> [--gif docs/media/tududi-demo.gif]
//        [--frames <folder>] (also saves each scene as a PNG, to check them)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GLYPHS, measure } from './pixel-font.mjs';
import { INDIGO_TINT, PAPER as PAPER_HEX, RGB } from './riso-palette.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
// The GIF encoder and PNG codec are the invoices demo's dev dependencies (D-136); playwright-core
// is the browser package's. Chrome only scales tududi's screenshots.
const fromInvoices = createRequire(join(repo, 'examples', 'invoices', 'package.json'));
const { GIFEncoder } = fromInvoices('gifenc');
const { PNG } = fromInvoices('pngjs');
const { chromium } = createRequire(join(repo, 'packages', 'browser', 'package.json'))('playwright-core');

const { values } = parseArgs({
  options: { run: { type: 'string' }, gif: { type: 'string' }, frames: { type: 'string' } },
});
if (!values.run) throw new Error('--run <folder> is required');
const runDir = resolve(values.run);
const gifPath = resolve(values.gif ?? join(repo, 'docs', 'media', 'tududi-demo.gif'));
const W = 1000;
const H = 640;

// ---- The story, from the transcript -------------------------------------------------------------
const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
const times = JSON.parse(readFileSync(join(runDir, 'timing.json'), 'utf8'));
const frames = JSON.parse(readFileSync(join(runDir, 'frames.json'), 'utf8'));
const afterShot = existsSync(join(runDir, 'after.jpg')) ? join(runDir, 'after.jpg') : null;
const afterInfo = afterShot ? JSON.parse(readFileSync(join(runDir, 'after.json'), 'utf8')) : null;
const events = readFileSync(join(runDir, 'transcript.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line, i) => ({ ...JSON.parse(line), at: times[i] }));

const calls = new Map();
const steps = [];
let message = null;
for (const e of events) {
  const u = e.data?.update;
  if (!u) continue;
  if (u.sessionUpdate === 'agent_message_chunk' && typeof u.content?.text === 'string') {
    if (!message) {
      message = { type: 'message', at: e.at, text: '' };
      steps.push(message);
    }
    message.text += u.content.text;
    continue;
  }
  if (u.sessionUpdate !== 'tool_call' && u.sessionUpdate !== 'tool_call_update') continue;
  message = null;
  let call = calls.get(u.toolCallId);
  if (!call) {
    call = { type: 'tool', at: e.at, doneAt: e.at, title: '', input: null, output: '', status: '' };
    calls.set(u.toolCallId, call);
    steps.push(call);
  }
  call.title = u.title || call.title;
  call.kind = u.kind ?? call.kind;
  call.input = u.rawInput ?? call.input;
  const text = (u.content ?? []).map((c) => c?.content?.text ?? '').join('\n');
  if (text) call.output = text;
  if (u.status === 'completed' || u.status === 'failed') {
    call.doneAt = e.at;
    call.status = u.status;
  }
}
const isLightpath = (s) => s.type === 'tool' && String(s.input?.tool_id ?? s.title).includes('lightpath');
const argsOf = (s) => s.input?.arguments ?? s.input ?? {};
// The click: the first run_action that returned a trace. The edit: the first file edit after it.
const action = steps.find((s) => isLightpath(s) && s.status === 'completed' && /^Trace t_/.test(s.output));
const edit = steps.find((s) => s.type === 'tool' && s.kind === 'edit' && s.at > action.at);
const finalMessage = steps.filter((s) => s.type === 'message').at(-1);
const afterAction = steps.find((s) => s.type === 'message' && s.at > action.doneAt && s.at < edit.at);
if (!action || !edit || !finalMessage) throw new Error('the run has no traced click, no edit or no answer');
const rel = (p) =>
  String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^.*\/demo-\d+\//, '');
const editPath = rel(argsOf(edit).path);

// Where the edit is: the line of its old text in the file as the agent read it.
const read = steps.find(
  (s) => s.type === 'tool' && s.kind === 'read' && rel(argsOf(s).path) === editPath && s.at < edit.at,
);
const oldText = String(argsOf(edit).oldStr ?? '');
const readBody = (read?.output ?? '').replace(/^[\s\S]*?<content>\n/, '').split('\n');
const editLine =
  readBody.findIndex((l) => oldText.split('\n')[0] && l.includes(oldText.split('\n')[0].trim())) + 1;

// ---- The trace lines that matter -----------------------------------------------------------------
// Rules: the request the click sent; for the edited file, its first two named functions and the
// named function whose lines hold the edit (highlighted); for the next server file, its widest
// named function; then how many other server files the answer listed. For the browser: the first
// two source files that ran after the response, then how many other browser files were listed.
// A function's "not run: ..." note (lines inside it that did not run) is shown as the trace gave it.
const trace = action.output.split('\n');
const actionLine = trace.find((l) => /^action: /.test(l)) ?? '';
const firstRequest = (trace.find((l) => /^request: /.test(l)) ?? '').replace(/^request: /, '');
const sections = [];
let section = null;
let file = null;
for (const l of trace) {
  const head = /^(GET|POST|PUT|PATCH|DELETE) (\S+) → (\d+) \[(\w+)/.exec(l);
  const phase = /^(before .*|after the response) \[browser\]/.exec(l);
  if (head || phase) {
    section = { side: head ? 'server' : 'browser', label: l, files: [] };
    sections.push(section);
    file = null;
    continue;
  }
  if (!section) continue;
  const f = /^ {2}(\S+)$/.exec(l);
  if (f) {
    file = { path: f[1], fns: [] };
    section.files.push(file);
    continue;
  }
  const fn = /^ {4}(\S+) (\d+)(?:-(\d+))? ×(\d+)(?: (not run: .+))?$/.exec(l);
  if (fn && file)
    file.fns.push({ name: fn[1], from: +fn[2], to: +(fn[3] ?? fn[2]), calls: +fn[4], notRun: fn[5] ?? '' });
}
const serverFiles = sections.filter((s) => s.side === 'server').flatMap((s) => s.files);
const browserFiles = sections.filter((s) => s.side === 'browser').flatMap((s) => s.files);
// First occurrence of each file (the click's own request comes first).
const uniq = (fs) => fs.filter((f, i) => fs.findIndex((g) => g.path === f.path) === i);
const named = (f) => f.fns.filter((x) => !x.name.startsWith('('));
const fnLine = (x, cls) => {
  const range = x.from === x.to ? `${x.from}` : `${x.from}-${x.to}`;
  return { cls, text: `${x.name}  ${range}  ×${x.calls}`, ...(x.notRun ? { notRun: x.notRun } : {}) };
};
const edited = serverFiles.find((f) => f.path === editPath);
const traceLines = [];
traceLines.push({ cls: 'req', text: firstRequest.replace(/\(node, (\d+ ms)\)/, '· node · $1') });
const shownServer = [];
if (edited) {
  shownServer.push(edited.path);
  traceLines.push({ cls: 'file', text: edited.path });
  const holder = named(edited)
    .filter((x) => x.from <= editLine && editLine <= x.to)
    .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
  const pick = named(edited)
    .filter((x) => x !== holder)
    .slice(0, 2);
  for (const x of [...pick, holder].filter(Boolean).sort((a, b) => a.from - b.from)) {
    traceLines.push(fnLine(x, x === holder ? 'fn hit' : 'fn'));
  }
}
const nextServer = uniq(serverFiles).find((f) => !shownServer.includes(f.path) && named(f).length);
if (nextServer) {
  shownServer.push(nextServer.path);
  traceLines.push({ cls: 'file', text: nextServer.path });
  const wide = [...named(nextServer)].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  traceLines.push(fnLine(wide, 'fn'));
}
const moreServer = uniq(serverFiles).length - shownServer.length;
if (moreServer > 0) traceLines.push({ cls: 'dim', text: `+ ${moreServer} more server files` });
const afterPhase = sections.find((s) => s.side === 'browser' && /^after the response/.test(s.label));
const shownBrowser = (afterPhase?.files ?? browserFiles)
  .filter((f) => /\.(t|j)sx?$/.test(f.path) && f.path.includes('/'))
  .slice(0, 2);
traceLines.push({ cls: 'side', text: 'browser' });
for (const f of shownBrowser) traceLines.push({ cls: 'file', text: f.path });
const moreBrowser = uniq(browserFiles).length - shownBrowser.length;
if (moreBrowser > 0) traceLines.push({ cls: 'dim', text: `+ ${moreBrowser} more browser files` });
traceLines.splice(1, 0, { cls: 'side', text: 'server' });

// ---- The agent's words ---------------------------------------------------------------------------
const clean = (t) => t.replace(/\*\*/g, '').replace(/`/g, '');
const sentences = (t) =>
  clean(t)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(/(?<=\.)\s+/));
const finalParas = sentences(finalMessage.text);
// The first sentence of the answer (what the agent did and didn't check) and the first sentence
// of the paragraph that names the edited function (the cause).
const fnName = traceLines.find((l) => l.cls === 'fn hit')?.text.split(' ')[0] ?? '';
const causePara = finalParas.find((p) => fnName && p.join(' ').includes(fnName)) ?? finalParas[1] ?? [];
const answer = { status: finalParas[0]?.[0] ?? '', cause: causePara[0] ?? '' };
const readNote = afterAction ? sentences(afterAction.text)[0]?.[0] : null;

// ---- Scenes ---------------------------------------------------------------------------------------
const frameAt = (t) => {
  let pick = frames[0];
  for (const f of frames) if (f.at <= t) pick = f;
  return pick;
};
const clickFrames = frames.filter((f) => f.at > action.at && f.at <= action.doneAt);
const target = argsOf(action).target ?? '';
const prompt = run.prompt;
const scenes = [];
// 1. The bug report over the real app.
const first = frameAt(action.at - 1);
for (let i = 1; i <= 8; i++) {
  scenes.push({
    kind: 'app',
    chip: 1,
    frame: first,
    zoom: 0,
    prompt: prompt.slice(0, Math.round((prompt.length * i) / 8)),
    ms: i === 8 ? 2900 : 80,
  });
}
// 2. The click, zooming in on the page, then the page the click opened.
for (const z of [0.33, 0.66, 1]) scenes.push({ kind: 'app', chip: 2, frame: first, zoom: z, ms: 70 });
scenes.push({ kind: 'app', chip: 2, frame: first, zoom: 1, pill: 'call', ms: 900 });
const pickN = Math.min(5, clickFrames.length);
for (let k = 0; k < pickN; k++) {
  const f = clickFrames[Math.floor((k * clickFrames.length) / pickN)];
  scenes.push({ kind: 'app', chip: 2, frame: f, zoom: 1, pill: 'call', ms: 120 });
}
const landed = frameAt(action.doneAt);
scenes.push({ kind: 'app', chip: 2, frame: landed, zoom: 1, pill: 'done', ms: 1500 });
// 3. The trace, in three steps.
const parts = [2, traceLines.findIndex((l) => l.cls === 'side' && l.text === 'browser'), traceLines.length];
for (const [i, n] of parts.entries()) {
  scenes.push({ kind: 'trace', chip: 3, lines: traceLines.slice(0, n), ms: i === 2 ? 2900 : 400 });
}
if (readNote) scenes.push({ kind: 'trace', chip: 3, lines: traceLines, note: readNote, ms: 1300 });
// 4. The edit and what the agent said.
scenes.push({ kind: 'fix', chip: 4, step: 1, ms: 900 });
scenes.push({ kind: 'fix', chip: 4, step: 2, ms: 3300 });
// 5. Before and after, then the pitch.
if (afterShot) scenes.push({ kind: 'compare', chip: 4, ms: 2300 });
scenes.push({ kind: 'end', chip: 0, ms: 1500 });
const total = scenes.reduce((a, s) => a + s.ms, 0);
console.log(`${scenes.length} scenes, ${(total / 1000).toFixed(1)} s`);

const kiro = String(run.kiroCli ?? '').replace(/^kiro-cli\s*/, '');
const credits = typeof run.credits === 'number' ? run.credits.toFixed(2) : '?';
const caption = `Real kiro-cli ${kiro} run · ${run.model} · ${run.steps} steps · ${credits} credits · ${Math.round(run.wallMs / 1000)} s`;
const stamp = 'bug planted · time shortened';

// ---- The press: two ink layers, printed with the 9-colour palette ---------------------------------
// Ink levels per pixel: i = indigo, p = pink (0 none, 1 tint, 2 full). Palette index = i * 3 + p.
const PAPER = { i: 0, p: 0 };
const INDIGO = { i: 2, p: 0 };
const TINT = { i: 1, p: 0 };
const LIT = { i: 0, p: 2 }; // pink on bare paper: indigo knocked out under it
const LIT_TINT = { i: 0, p: 1 };
const S = 3; // body text scale: capitals 21 px
const LH = 11 * S; // line height: 9 glyph rows + 2
const GRAIN_SEED = 0x11d7;
const GRAIN_DENSITY = 0.02;

const hash = (x, y) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(GRAIN_SEED, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
// tududi's pixels: brightness (Rec. 601 luma, 0-255) to one of six steps from paper to indigo.
// Steps 1, 2 and 4 are extra tints of the indigo ink (palette indices 9-11), so small grey text and
// the white cards on the light grey page stay apart. Thresholds: luma >= the step's floor.
const hexRGB = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, ch) => Math.round(v + (b[ch] - v) * t));
const EXTRA = [
  mix(hexRGB(PAPER_HEX), hexRGB(INDIGO_TINT), 0.22),
  mix(hexRGB(PAPER_HEX), hexRGB(INDIGO_TINT), 0.5),
  mix(hexRGB(INDIGO_TINT), RGB[6], 0.5),
];
const APP_RAMP = [
  { floor: 247, index: 0 }, // paper
  { floor: 225, index: 9 }, // 22% of the way to indigo tint
  { floor: 190, index: 10 }, // 50% of the way to indigo tint
  { floor: 150, index: 3 }, // indigo tint
  { floor: 95, index: 11 }, // halfway from indigo tint to indigo
  { floor: 0, index: 6 }, // indigo
];
const appIndex = (r, g, b) => {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return APP_RAMP.find((s) => luma >= s.floor).index;
};
const GRAIN = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) GRAIN[y * W + x] = hash(x, y) < GRAIN_DENSITY ? 1 : 0;

class Sheet {
  constructor() {
    this.ink = new Uint8Array(W * H);
    this.pk = new Uint8Array(W * H);
    this.flat = new Uint8Array(W * H); // a large flat fill: grain may fall here
    this.keep = new Uint8Array(W * H); // text, the app and their margins: no grain
    this.isApp = new Uint8Array(W * H);
    this.app = new Uint8Array(W * H); // palette index of each recoloured app pixel
  }
  each(x, y, w, h, fn) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(W, x + w);
    const y1 = Math.min(H, y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) fn(yy * W + xx);
  }
  fill(x, y, w, h, ink, flat = false) {
    this.each(x, y, w, h, (k) => {
      if (ink.i !== undefined) this.ink[k] = ink.i;
      if (ink.p !== undefined) this.pk[k] = ink.p;
      this.flat[k] = flat ? 1 : 0;
      this.isApp[k] = 0;
    });
  }
  keepOut(x, y, w, h, pad = 6) {
    this.each(x - pad, y - pad, w + 2 * pad, h + 2 * pad, (k) => {
      this.keep[k] = 1;
    });
  }
  // A box with a border and a hard shadow (offset, one ink, no blur).
  box(x, y, w, h, { fill = PAPER, border = INDIGO, bw = 3, shadow = INDIGO, sh = 6 } = {}) {
    if (shadow) this.fill(x + sh, y + sh, w, h, shadow);
    if (border) this.fill(x, y, w, h, border);
    this.fill(x + bw, y + bw, w - 2 * bw, h - 2 * bw, fill, w * h > 40000);
  }
  // A pink block printed 2 px off its indigo knockout: the riso misregistration.
  misreg(x, y, w, h, d = 2) {
    this.fill(x, y, w, h, { i: 0 });
    this.fill(x + d, y + d, w, h, { p: 2 });
  }
  text(str, x, y, s, ink) {
    let cx = x;
    for (const ch of str) {
      const g = GLYPHS[ch];
      if (!g) throw new Error(`font has no glyph for ${JSON.stringify(ch)}`);
      g.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++)
          if (row[rx] === '#') this.fill(cx + rx * s, y + ry * s, s, s, ink);
      });
      cx += (g[0].length + 1) * s;
    }
    const w = width(str, s);
    this.keepOut(x, y, w, 9 * s);
    return w;
  }
  paste(img, x, y) {
    for (let yy = 0; yy < img.height; yy++) {
      for (let xx = 0; xx < img.width; xx++) {
        const X = x + xx;
        const Y = y + yy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const k = Y * W + X;
        const s = (yy * img.width + xx) * 4;
        this.app[k] = appIndex(img.data[s], img.data[s + 1], img.data[s + 2]);
        this.isApp[k] = 1;
        this.flat[k] = 0;
      }
    }
    this.keepOut(x, y, img.width, img.height, 8);
  }
  // Grain: one ink step at seeded dots in flat fills away from text, the app and pink ink.
  grain() {
    for (let k = 0; k < W * H; k++) {
      if (!GRAIN[k] || !this.flat[k] || this.keep[k] || this.isApp[k] || this.pk[k]) continue;
      this.ink[k] = this.ink[k] === 1 ? 0 : 1;
    }
  }
}
const width = (str, s) => measure(str) * s;
const wrap = (str, s, maxW) => {
  const lines = [];
  let cur = '';
  for (const word of str.split(' ')) {
    const t = cur ? `${cur} ${word}` : word;
    if (cur && width(t, s) > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
};
const fits = (str, maxW, scales = [3, 2]) => scales.find((s) => width(str, s) <= maxW) ?? scales.at(-1);

// ---- Layout ---------------------------------------------------------------------------------------
const M = 30; // outer margin
const TOP = 66; // content starts under the top bar
const BOTTOM = H - 46; // and ends above the caption band
const CW = W - 2 * M - 6; // content width, leaving room for a 6 px shadow
const WIN = { x: M, y: TOP, w: CW, h: BOTTOM - TOP };
const BAR = 30;
const VIEW = { x: WIN.x + 3, y: WIN.y + 3 + BAR, w: WIN.w - 6, h: WIN.h - 6 - BAR };
const CHIPS = ['Bug report', 'Agent clicks', 'Trace', 'Fix'];

function wordmark(sh, x, y, s) {
  sh.text('Lightpath', x, y, s, INDIGO);
  // The dot of the "i" is lit: "L" is 5 wide plus 1 space, and the dot is the i's top row.
  sh.fill(x + 6 * s, y, s, s, LIT);
}
function frameChrome(sh, scene) {
  sh.fill(0, 0, W, H, PAPER, true);
  if (scene.kind !== 'end') wordmark(sh, M, 18, 3);
  if (scene.chip) {
    let x = W - M;
    const boxes = CHIPS.map((c, i) => `${i + 1} ${c}`).map((t) => ({ t, w: width(t, 2) + 22 }));
    for (let i = boxes.length - 1; i >= 0; i--) {
      x -= boxes[i].w;
      boxes[i].x = x;
      x -= 10;
    }
    boxes.forEach((b, i) => {
      const n = i + 1;
      const on = n === scene.chip;
      const done = n < scene.chip;
      if (on) sh.box(b.x, 14, b.w, 30, { fill: INDIGO, border: INDIGO, shadow: TINT, sh: 3 });
      else sh.box(b.x, 14, b.w, 30, { fill: PAPER, border: done ? INDIGO : TINT, bw: 2, shadow: null });
      sh.text(b.t, b.x + 11, 22, 2, on ? PAPER : done ? INDIGO : TINT);
    });
  }
  if (scene.kind !== 'end') {
    const y = H - 30;
    sh.text(caption, M, y, 2, INDIGO);
    const sw = width(stamp, 2) + 20;
    sh.box(W - M - sw, y - 8, sw, 30, { fill: INDIGO, border: INDIGO, shadow: null });
    sh.text(stamp, W - M - sw + 10, y, 2, PAPER);
    if (width(caption, 2) + sw + 20 > W - 2 * M) throw new Error('caption and stamp do not fit');
  }
}

// ---- tududi's own pixels, scaled by Chrome ---------------------------------------------------------
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: VIEW.w, height: VIEW.h } });
const cache = new Map();
const jpeg = (path) => `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`;
async function view(path, w, h, transform) {
  const key = `${path}|${w}|${h}|${transform}`;
  if (cache.has(key)) return cache.get(key);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;overflow:hidden;background:#fff"><img src="${jpeg(path)}" style="position:absolute;left:0;top:0;width:1280px;height:800px;transform-origin:0 0;transform:${transform}"></body></html>`,
  );
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const img = PNG.sync.read(await page.screenshot({ type: 'png' }));
  cache.set(key, img);
  return img;
}
const frameFile = (f) => join(runDir, 'frames', f.file);
// Zoom 0: the whole page width. Zoom 1: the middle of the page at 96%, where Today's card and the
// plan list are.
const zoomTransform = (z) => {
  const s0 = VIEW.w / 1280;
  const s = s0 + (0.96 - s0) * z;
  return `translate(${-300 * z * s}px, ${-75 * z * s}px) scale(${s})`;
};
const CROP = { w: 420, h: 334, t: `translate(${-352 * 1.03}px, ${-128 * 1.03}px) scale(1.03)` };

const litBoxes = [];
function litButton(sh) {
  const seen = new Uint8Array(W * H);
  let best = null;
  for (let y = VIEW.y; y < VIEW.y + VIEW.h; y++) {
    for (let x = VIEW.x; x < VIEW.x + VIEW.w; x++) {
      const k0 = y * W + x;
      if (seen[k0] || !sh.isApp[k0] || sh.app[k0] !== 6) continue;
      const stack = [k0];
      const px = [];
      seen[k0] = 1;
      while (stack.length) {
        const k = stack.pop();
        px.push(k);
        for (const n of [k - 1, k + 1, k - W, k + W]) {
          if (n < 0 || n >= W * H || seen[n] || !sh.isApp[n] || sh.app[n] !== 6) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      const xs = px.map((k) => k % W);
      const ys = px.map((k) => Math.floor(k / W));
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: 0, h: 0, n: px.length };
      box.w = Math.max(...xs) - box.x + 1;
      box.h = Math.max(...ys) - box.y + 1;
      const buttonish =
        box.w >= 60 && box.w <= 300 && box.h >= 20 && box.h <= 70 && px.length > 0.6 * box.w * box.h;
      if (buttonish && (!best || px.length > best.px.length)) best = { px, box };
    }
  }
  // Once the page has moved on, the button is gone and nothing is lit.
  if (!best) return;
  // The label inside the button (pixels enclosed by it on all four sides) goes indigo, so it reads
  // as indigo over pink.
  const inButton = new Uint8Array(W * H);
  for (const k of best.px) inButton[k] = 1;
  const { x: bx, y: by, w: bw, h: bh } = best.box;
  const enclosed = (x, y) => {
    const hit = (dx, dy) => {
      for (
        let xx = x + dx, yy = y + dy;
        xx >= bx && xx < bx + bw && yy >= by && yy < by + bh;
        xx += dx, yy += dy
      )
        if (inButton[yy * W + xx]) return true;
      return false;
    };
    return hit(-1, 0) && hit(1, 0) && hit(0, -1) && hit(0, 1);
  };
  const label = [];
  for (let y = by; y < by + bh; y++)
    for (let x = bx; x < bx + bw; x++) if (!inButton[y * W + x] && enclosed(x, y)) label.push(y * W + x);
  for (const k of best.px) sh.app[k] = 2;
  for (const k of label) sh.app[k] = 6;
  litBoxes.push(best.box);
}

// ---- Scenes, drawn ---------------------------------------------------------------------------------
async function draw(scene) {
  const sh = new Sheet();
  frameChrome(sh, scene);
  if (scene.kind === 'app') {
    sh.box(WIN.x, WIN.y, WIN.w, WIN.h, { fill: INDIGO });
    for (let d = 0; d < 3; d++) sh.fill(WIN.x + 14 + d * 20, WIN.y + 12, 10, 10, d === 0 ? PAPER : TINT);
    sh.text("tududi · localhost:8412 · Lightpath's browser", WIN.x + 90, WIN.y + 11, 2, PAPER);
    sh.paste(await view(frameFile(scene.frame), VIEW.w, VIEW.h, zoomTransform(scene.zoom)), VIEW.x, VIEW.y);
    if (scene.prompt !== undefined) {
      const bx = WIN.x + 30;
      const bw = WIN.w - 60;
      const lines = wrap(prompt, S, bw - 48);
      const bh = 24 + 28 + 10 + lines.length * LH + 10;
      const by = WIN.y + WIN.h - 26 - bh;
      sh.box(bx, by, bw, bh);
      sh.fill(bx + 3, by + 3, width('THE USER REPORTS', 2) + 24, 30, INDIGO);
      sh.text('THE USER REPORTS', bx + 15, by + 11, 2, PAPER);
      // Type the prompt out: the same wrapped lines, cut at this scene's length.
      let left = scene.prompt.length;
      lines.forEach((l, i) => {
        const part = l.slice(0, Math.max(0, left));
        left -= l.length + 1;
        if (part) sh.text(part, bx + 24, by + 24 + 28 + 10 + i * LH, S, INDIGO);
      });
    }
    // The clicked element is lit: while the click runs on the page it was clicked on, the button's
    // own pixels (the largest solid indigo shape that is button-sized) are printed pink instead.
    if (scene.pill === 'call') litButton(sh);
    if (scene.pill) {
      const call = scene.pill === 'call';
      const mark = call ? '●' : '✓';
      const rest = call
        ? `  lightpath run_action  ${target}`
        : `  trace  ${firstRequest.replace(/ \(node.*$/, '')}`;
      const pw = width(mark + rest, S) + 40;
      const px = WIN.x + WIN.w - 40 - pw;
      const py = WIN.y + 120;
      sh.fill(px + 6, py + 6, pw, 52, LIT); // the click is lit: its shadow is pink
      sh.fill(px, py, pw, 52, INDIGO);
      sh.text(mark, px + 20, py + 13, S, LIT);
      sh.text(rest, px + 20 + width(mark, S), py + 13, S, PAPER);
    }
  }
  if (scene.kind === 'trace') {
    sh.box(WIN.x, WIN.y, WIN.w, WIN.h, { fill: INDIGO, border: INDIGO, shadow: TINT });
    let y = WIN.y + 14;
    const x = WIN.x + 26;
    const dot = sh.text('●', x, y, S, LIT);
    sh.text(` run_action  ${target}`, x + dot, y, S, PAPER);
    y += LH;
    for (const l of scene.lines) {
      if (l.cls === 'side') {
        y += 6;
        sh.text(l.text.toUpperCase(), x, y, 2, TINT);
        y += 26;
        continue;
      }
      const ink = { req: LIT, file: LIT, fn: LIT, 'fn hit': INDIGO, dim: LIT_TINT }[l.cls];
      const ix = l.cls.startsWith('fn') ? x + 30 : x;
      if (l.cls === 'fn hit') sh.misreg(ix - 10, y - 6, width(l.text, S) + 20, LH - 2);
      const w = sh.text(l.text, ix, y, S, ink);
      if (l.notRun) sh.text(l.notRun, ix + w + 24, y, S, TINT);
      y += LH;
    }
    if (scene.note) {
      y += 10;
      const lead = sh.text('Agent: ', x, y, S, TINT);
      for (const [i, l] of wrap(scene.note, S, WIN.w - 52 - lead).entries())
        sh.text(l, x + lead, y + i * LH, S, PAPER);
      y += LH;
    }
    if (y > WIN.y + WIN.h - 8) throw new Error(`trace panel overflows by ${y - (WIN.y + WIN.h - 8)} px`);
  }
  if (scene.kind === 'fix') {
    const a = argsOf(edit);
    const oldL = String(a.oldStr ?? '').split('\n');
    const newL = String(a.newStr ?? '').split('\n');
    const del = oldL.filter((l) => !newL.includes(l)).map((l) => `- ${l.trim()}`);
    const add = newL.filter((l) => !oldL.includes(l)).map((l) => `+ ${l.trim()}`);
    const where = [editLine > 0 ? `line ${editLine}` : '', fnName ? `in ${fnName}` : '']
      .filter(Boolean)
      .join(', ');
    const inner = WIN.w - 52;
    const cs = Math.min(...[...del, ...add].map((l) => fits(l, inner)));
    const ph = 20 + LH + 30 + (del.length + add.length) * (11 * cs + 4) + 14;
    sh.box(WIN.x, WIN.y, WIN.w, ph, { fill: INDIGO, border: INDIGO, shadow: TINT });
    let y = WIN.y + 20;
    const x = WIN.x + 26;
    sh.text(`edit  ${editPath}`, x, y, S, PAPER);
    y += LH;
    sh.text(where, x, y, 2, TINT);
    y += 30;
    for (const l of del) {
      sh.text(l, x, y, cs, TINT);
      y += 11 * cs + 4;
    }
    for (const l of add) {
      sh.text(l, x, y, cs, LIT);
      y += 11 * cs + 4;
    }
    if (scene.step === 2) {
      const bx = WIN.x;
      const by = WIN.y + ph + 26;
      const paras = [answer.cause, answer.status].map((p) => wrap(p, S, WIN.w - 48));
      const bh = 24 + 28 + 10 + paras.flat().length * LH + (paras.length - 1) * 12 + 10;
      sh.box(bx, by, WIN.w, bh);
      sh.fill(bx + 3, by + 3, width('THE AGENT SAYS', 2) + 24, 30, INDIGO);
      sh.text('THE AGENT SAYS', bx + 15, by + 11, 2, PAPER);
      let ty = by + 24 + 28 + 10;
      for (const p of paras) {
        for (const l of p) {
          sh.text(l, bx + 24, ty, S, INDIGO);
          ty += LH;
        }
        ty += 12;
      }
      if (by + bh > BOTTOM) throw new Error('the agent box overflows');
    }
  }
  if (scene.kind === 'compare') {
    const gap = 40;
    const x0 = Math.round((W - (2 * CROP.w + gap)) / 2);
    const y0 = TOP + 44;
    const shots = [
      ['BEFORE', frameFile(landed), false],
      ['AFTER THE FIX', afterShot, true],
    ];
    for (const [i, [label, path, lit]] of shots.entries()) {
      const x = x0 + i * (CROP.w + gap);
      const lw = width(label, 2) + 24;
      if (lit) sh.misreg(x, y0 - 40, lw, 30);
      else sh.fill(x, y0 - 40, lw, 30, INDIGO);
      sh.text(label, x + 12, y0 - 32, 2, lit ? INDIGO : PAPER);
      sh.box(x - 3, y0 - 3, CROP.w + 6, CROP.h + 6, { fill: INDIGO });
      sh.paste(await view(path, CROP.w, CROP.h, CROP.t), x, y0);
    }
    const note =
      'After: server restarted and "Plan your day" clicked again by the recording script, not by the agent.';
    const lines = wrap(note, 2, W - 2 * M);
    lines.forEach((l, i) => {
      sh.text(l, Math.round((W - width(l, 2)) / 2), y0 + CROP.h + 28 + i * 24, 2, INDIGO);
    });
  }
  if (scene.kind === 'end') {
    const big = 10;
    const ww = width('Lightpath', big);
    const wx = Math.round((W - ww) / 2);
    const wy = 150;
    sh.text('Lightpath', wx + 6, wy + 6, big, TINT); // hard shadow
    wordmark(sh, wx, wy, big);
    const tag = 'See the exact lines one click ran, browser and server, for your agent.';
    const lines = wrap(tag, S, 760);
    lines.forEach((l, i) => {
      sh.text(l, Math.round((W - width(l, S)) / 2), wy + 120 + i * LH, S, INDIGO);
    });
    const cmd = 'npx @lightpath-dev/cli init --agent kiro';
    const cw = width(cmd, S) + 48;
    const cx = Math.round((W - cw) / 2);
    const cy = wy + 120 + lines.length * LH + 40;
    sh.box(cx, cy, cw, 60, { fill: INDIGO, border: INDIGO, shadow: TINT });
    sh.text(cmd, cx + 24, cy + 18, S, PAPER);
  }
  sh.grain();
  return sh;
}

const sheets = [];
for (const scene of scenes) sheets.push({ sheet: await draw(scene), ms: scene.ms });
await browser.close();
if (!litBoxes.length) throw new Error('no button-shaped indigo element in the clicked frames');

// ---- Encode ---------------------------------------------------------------------------------------
// One 16-entry table: the 9 riso colours (0-8), the 3 extra indigo tints for tududi's screens
// (9-11), unused 12-14, and 15 for "same as the frame before".
const SAME = 15;
const palette = [...RGB, ...EXTRA, [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const indexed = sheets.map(({ sheet }) => {
  const index = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) index[k] = sheet.isApp[k] ? sheet.app[k] : sheet.ink[k] * 3 + sheet.pk[k];
  return index;
});
const used = new Set();
for (const index of indexed) for (const v of index) used.add(v);
if ([...used].some((v) => v > 11)) throw new Error('a pixel is outside the 12 colours');
const gif = GIFEncoder();
let prev = null;
indexed.forEach((index, i) => {
  const frame = new Uint8Array(index);
  if (prev) for (let p = 0; p < frame.length; p++) if (index[p] === prev[p]) frame[p] = SAME;
  gif.writeFrame(frame, W, H, {
    palette: i === 0 ? palette : undefined,
    delay: sheets[i].ms,
    transparent: i > 0,
    transparentIndex: SAME,
    dispose: 1,
    repeat: 0,
  });
  prev = index;
});
gif.finish();
mkdirSync(dirname(gifPath), { recursive: true });
writeFileSync(gifPath, gif.bytes());
if (values.frames) {
  mkdirSync(values.frames, { recursive: true });
  indexed.forEach((index, i) => {
    const png = new PNG({ width: W, height: H });
    for (let k = 0; k < W * H; k++) {
      png.data.set(palette[index[k]], k * 4);
      png.data[k * 4 + 3] = 255;
    }
    writeFileSync(join(values.frames, `scene${String(i).padStart(3, '0')}.png`), PNG.sync.write(png));
  });
}
const shown = {
  action: actionLine,
  editLine,
  fnName,
  traceLines,
  answer,
  readNote,
  caption,
  stamp,
  litButton: litBoxes,
  after: afterInfo,
};
writeFileSync(join(runDir, 'gif-text.json'), `${JSON.stringify(shown, null, 2)}\n`);
console.log(
  `${gifPath}: ${sheets.length} frames, ${W}x${H}, ${(total / 1000).toFixed(1)} s, ${used.size} colours, ${(statSync(gifPath).size / 1e6).toFixed(2)} MB`,
);
