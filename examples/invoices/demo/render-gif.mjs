// Turns one recorded run (record-run.mjs) into the README GIF (D-136). Left: frames of Lightpath's
// own browser from the run's screencast. Right: a terminal drawn from the run's stream-json
// transcript. Every tool call, argument, result line and message shown is cut from that transcript;
// nothing is typed in by hand. Time is shortened: each step gets a fixed share of the GIF, and the
// browser frame shown is the last one the screencast sent before that step's moment in the run.
//
// Usage: node examples/invoices/demo/render-gif.mjs --run <folder> [--gif docs/media/demo.gif]
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import gifenc from 'gifenc';
import pngjs from 'pngjs';

// Both are CommonJS packages; Node gives their exports as the default import.
const { applyPalette, GIFEncoder, quantize } = gifenc;
const { PNG } = pngjs;

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const { chromium } = createRequire(join(repo, 'packages', 'browser', 'package.json'))('playwright-core');

const { values } = parseArgs({
  options: { run: { type: 'string' }, gif: { type: 'string' }, frames: { type: 'string' } },
});
if (!values.run) throw new Error('--run <folder> is required');
const runDir = resolve(values.run);
const gifPath = resolve(values.gif ?? join(repo, 'docs', 'media', 'demo.gif'));
const W = 1100;
const H = 620;

// ---- The story, from the transcript -------------------------------------------------------------
const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
const times = JSON.parse(readFileSync(join(runDir, 'timing.json'), 'utf8'));
const frames = JSON.parse(readFileSync(join(runDir, 'frames.json'), 'utf8'));
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
    call = { type: 'tool', id: u.toolCallId, at: e.at, doneAt: e.at, title: '', input: null, output: '' };
    calls.set(u.toolCallId, call);
    steps.push(call);
  }
  call.title = u.title || call.title;
  call.kind = u.kind ?? call.kind;
  call.input = u.rawInput ?? call.input;
  const text = (u.content ?? []).map((c) => c?.content?.text ?? '').join('\n');
  if (text) call.output = text;
  if (u.status === 'completed' || u.status === 'failed') call.doneAt = e.at;
}
const shown = steps.filter((s) => s.type === 'message' || !/^Tool Load$/i.test(s.title));

// ---- Terminal lines ----------------------------------------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n = 62) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const rel = (p) =>
  String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^.*\/trial\//, '');

function toolLines(call) {
  const out = [];
  const args = call.input?.arguments ?? call.input ?? {};
  const isLightpath = String(call.input?.tool_id ?? call.title).includes('lightpath');
  if (isLightpath) {
    const name = String(call.input?.tool_id ?? call.title)
      .split(/::|\//)
      .pop();
    const arg = [args.target, args.within ? `within "${args.within}"` : ''].filter(Boolean).join(' ');
    out.push({ cls: 'call', text: `● lightpath ${name}`, sub: arg || JSON.stringify(args) });
    const lines = call.output.split('\n');
    const pick = [];
    for (const l of lines) {
      if (/^after the response/.test(l)) break;
      if (/^Trace t_/.test(l))
        pick.push({ cls: 'trace-head', text: cut(l.replace(/^Trace (t_\w+): /, ''), 58) });
      else if (/^ {2}request: /.test(l) || /^request: /.test(l))
        pick.push({ cls: 'req', text: cut(l.trim()) });
      else if (/^ {2}(src|server)\//.test(l)) pick.push({ cls: 'file', text: cut(l.trim()) });
      else if (/^ {4}\w/.test(l) && pick.at(-1)?.cls !== 'trace-head') {
        // Function lines for the server files only; the browser side is listed by file.
        const last = [...pick].reverse().find((p) => p.cls === 'file');
        if (last?.text.startsWith('server/')) pick.push({ cls: 'fn', text: cut(`  ${l.trim()}`) });
      } else if (/^(before|after|POST|GET) /.test(l)) pick.push({ cls: 'phase', text: cut(l.trim()) });
    }
    // At most 2 browser files by name, then a count, so the server lines fit on screen.
    const browserFiles = pick.filter((p) => p.cls === 'file' && p.text.startsWith('src/'));
    const extra = browserFiles.slice(2);
    const short = pick.filter((p) => !extra.includes(p));
    if (extra.length > 0) {
      const at = short.indexOf(browserFiles[1]) + 1;
      short.splice(at, 0, { cls: 'dim', text: `+ ${extra.length} more browser files` });
    }
    out.push(...short.slice(0, 16));
    if (short.length > 16) out.push({ cls: 'dim', text: `  … ${short.length - 16} more lines` });
    if (pick.length === 0) out.push({ cls: 'dim', text: cut(lines[0] ?? '') });
    return out;
  }
  if (call.kind === 'read') return [{ cls: 'call', text: '● read', sub: rel(args.path) }];
  if (call.kind === 'edit') {
    out.push({ cls: 'call', text: '● edit', sub: rel(args.path) });
    const oldL = String(args.oldStr ?? '').split('\n');
    const newL = String(args.newStr ?? args.content ?? '').split('\n');
    for (const l of oldL.filter((l) => !newL.includes(l)).slice(0, 4))
      out.push({ cls: 'del', text: cut(`- ${l}`) });
    for (const l of newL.filter((l) => !oldL.includes(l)).slice(0, 5))
      out.push({ cls: 'add', text: cut(`+ ${l}`) });
    return out;
  }
  const what = args.command ?? args.query ?? args.pattern ?? args.path ?? JSON.stringify(args);
  return [{ cls: 'call', text: `● ${call.kind ?? call.title}`, sub: cut(String(what), 50) }];
}

// The agent's words, wrapped. The final message keeps its "Cause", "Fix" and "Not verified"
// paragraphs (first sentence each), so the GIF says what the agent did and didn't check.
function messageLines(text, final) {
  const paras = text
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!final) return paras.slice(0, 1).map((l) => ({ cls: 'msg', text: cut(l, 120) }));
  const keep = paras.filter((p) => /^(Cause|Fix|Not verified):/.test(p));
  const chosen = keep.length > 0 ? keep : paras.slice(0, 2);
  return chosen.map((p) => {
    const sentences = p.split(/(?<=\.)\s+/);
    // "Cause" keeps two sentences: the second is where the agent reads the trace.
    const n = /^Cause:/.test(p) ? 2 : 1;
    return { cls: 'msg', text: cut(sentences.slice(0, n).join(' '), 260) };
  });
}

// ---- Scenes -------------------------------------------------------------------------------------
// Each scene: terminal lines so far, the run time to show the browser at, the step chip, and how
// long it stays. Fixed durations keep a 1-2 minute run inside about 18 s.
const scenes = [];
const term = [];
const chip = (s) => {
  if (s.type === 'message') return 4;
  if (String(s.input?.tool_id ?? s.title).includes('lightpath')) return s.seenEdit ? 4 : 2;
  if (s.kind === 'edit') return 4;
  return 3;
};
const startAt = run.startedAt;
scenes.push({ term: [], at: startAt, chip: 1, ms: 900 });
const prompt = run.prompt;
for (let i = 1; i <= 6; i++) {
  scenes.push({
    term: [{ cls: 'user', text: `> ${prompt.slice(0, Math.round((prompt.length * i) / 6))}` }],
    at: startAt,
    chip: 1,
    ms: i === 6 ? 1600 : 120,
  });
}
term.push({ cls: 'user', text: `> ${prompt}` });
let seenEdit = false;
for (const s of shown) {
  if (s.type === 'message') {
    const final = s === shown.at(-1);
    term.push(...messageLines(s.text, final));
    scenes.push({ term: [...term], at: s.at, chip: seenEdit ? 4 : 3, ms: final ? 4200 : 1200 });
    continue;
  }
  s.seenEdit = seenEdit;
  if (s.kind === 'edit') seenEdit = true;
  const lines = toolLines(s);
  const isAction = lines[0]?.text.includes('run_action');
  term.push(lines[0]);
  if (isAction) {
    // The call, then the click as the screencast saw it, then the trace it returned.
    scenes.push({ term: [...term], at: s.at, chip: chip(s), ms: 500 });
    const clickFrames = frames.filter((f) => f.at > s.at && f.at <= s.doneAt);
    const pickN = Math.min(6, clickFrames.length);
    for (let k = 0; k < pickN; k++) {
      const f = clickFrames[Math.floor((k * clickFrames.length) / pickN)];
      scenes.push({ term: [...term], at: f.at, chip: chip(s), ms: 110 });
    }
    term.push(...lines.slice(1));
    scenes.push({ term: [...term], at: s.doneAt + 400, chip: chip(s) === 2 ? 3 : 4, ms: 3400 });
  } else {
    term.push(...lines.slice(1));
    scenes.push({ term: [...term], at: s.doneAt, chip: chip(s), ms: s.kind === 'edit' ? 2400 : 650 });
  }
}
scenes.at(-1).ms += 1500;
const total = scenes.reduce((a, s) => a + s.ms, 0);
console.log(`${scenes.length} scenes, ${(total / 1000).toFixed(1)} s`);

const frameAt = (t) => {
  let pick = frames[0];
  for (const f of frames) if (f.at <= t) pick = f;
  return pick;
};

// ---- Render -------------------------------------------------------------------------------------
const CHIPS = ['Bug report', 'run_action', 'Trace', 'Fix'];
const html = `<!doctype html><html><head><style>
* { box-sizing: border-box; }
body { margin: 0; width: ${W}px; height: ${H}px; background: #0b1020; font-family: "Segoe UI", system-ui, sans-serif; color: #e2e8f0; overflow: hidden; }
.top { height: 52px; display: flex; align-items: center; gap: 14px; padding: 0 22px; }
.logo { font-weight: 700; font-size: 17px; letter-spacing: -.01em; color: #fff; }
.logo b { color: #a5b4fc; }
.chips { display: flex; gap: 6px; margin-left: auto; }
.chip { padding: 5px 11px; border-radius: 999px; font-size: 12.5px; color: #64748b; border: 1px solid #1e293b; }
.chip.done { color: #a5b4fc; border-color: #312e81; }
.chip.on { color: #fff; background: #4f46e5; border-color: #4f46e5; }
.stage { display: flex; gap: 16px; padding: 0 18px; }
.win { width: 600px; border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.4); align-self: flex-start; }
.bar { height: 28px; background: #e5e7eb; display: flex; align-items: center; gap: 6px; padding: 0 10px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #cbd5e1; }
.url { margin-left: 10px; font-size: 11px; color: #475569; background: #fff; border-radius: 6px; padding: 2px 10px; }
.win img { display: block; width: 600px; height: ${Math.round((600 * 760) / 1100)}px; }
.cap { width: 600px; margin-top: 10px; font-size: 12.5px; color: #94a3b8; }
.term { width: 466px; height: 556px; border-radius: 10px; background: #0f172a; box-shadow: 0 0 0 1px #1e293b; border-top: 12px solid #0f172a; padding: 0 14px 12px; font: 12.5px/1.5 "Cascadia Mono", Consolas, monospace; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; }
.term > div { flex: none; }
.term .head { color: #64748b; margin-bottom: auto; }
.l { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.user { color: #fde68a; white-space: pre-wrap; margin-bottom: 6px; }
.call { color: #a5b4fc; margin-top: 6px; } .call span { color: #e2e8f0; }
.trace-head { color: #f8fafc; font-weight: 600; }
.req { color: #34d399; } .file { color: #7dd3fc; } .fn { color: #cbd5e1; } .phase { color: #64748b; }
.nr { color: #fbbf24; } .del { color: #fca5a5; } .add { color: #86efac; } .dim { color: #64748b; } .msg { color: #e2e8f0; white-space: pre-wrap; margin-top: 6px; }
</style></head><body>
<div class="top"><div class="logo">Light<b>path</b></div><div class="chips" id="chips"></div></div>
<div class="stage">
  <div><div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">localhost:5174 · Lightpath's browser</span></div><img id="shot"></div>
  <div class="cap">Real run: kiro-cli ${esc(String(run.kiroCli).replace(/^kiro-cli\s*/, ''))}, ${esc(run.model)}. Bug planted for the demo. Time shortened.</div></div>
  <div class="term" id="term"></div>
</div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html);
const shots = [];
let lastImg = null;
for (const scene of scenes) {
  const f = frameAt(scene.at);
  const img = f
    ? `data:image/jpeg;base64,${readFileSync(join(runDir, 'frames', f.file)).toString('base64')}`
    : '';
  const termHtml =
    `<div class="head">kiro-cli · ${esc(run.model)} · lightpath MCP</div>` +
    scene.term
      .map((l) =>
        l.cls === 'call'
          ? `<div class="l call">${esc(l.text)} <span>${esc(l.sub ?? '')}</span></div>`
          : `<div class="${l.cls === 'user' || l.cls === 'msg' ? '' : 'l '}${l.cls}">${esc(l.text).replace(/(not run: [\d, -]+)/, '<span class="nr">$1</span>')}</div>`,
      )
      .join('');
  const chipsHtml = CHIPS.map(
    (c, i) =>
      `<span class="chip ${i + 1 === scene.chip ? 'on' : i + 1 < scene.chip ? 'done' : ''}">${i + 1} ${c}</span>`,
  ).join('');
  await page.evaluate(
    ([src, t, c, changeImg]) => {
      if (changeImg) document.getElementById('shot').src = src;
      document.getElementById('term').innerHTML = t;
      document.getElementById('chips').innerHTML = c;
    },
    [img, termHtml, chipsHtml, img !== lastImg],
  );
  if (img !== lastImg) await page.waitForFunction(() => document.getElementById('shot').complete);
  lastImg = img;
  shots.push({ png: await page.screenshot({ type: 'png' }), ms: scene.ms });
}
await browser.close();

// ---- Encode -------------------------------------------------------------------------------------
const rgba = shots.map((s) => PNG.sync.read(s.png).data);
// One palette for the whole GIF, from a sample of every frame; index 255 is "same as before".
const sampleStep = 7;
const sample = new Uint8Array(rgba.length * Math.ceil((W * H) / sampleStep) * 4);
let n = 0;
for (const data of rgba) {
  for (let p = 0; p < W * H; p += sampleStep) {
    sample.set(data.subarray(p * 4, p * 4 + 4), n);
    n += 4;
  }
}
const palette = quantize(sample.subarray(0, n), 255, { format: 'rgb565' });
while (palette.length < 256) palette.push([0, 0, 0]);
const gif = GIFEncoder();
let prev = null;
rgba.forEach((data, i) => {
  const index = applyPalette(data, palette.slice(0, 255), 'rgb565');
  const frame = new Uint8Array(index);
  if (prev) for (let p = 0; p < frame.length; p++) if (index[p] === prev[p]) frame[p] = 255;
  gif.writeFrame(frame, W, H, {
    palette: i === 0 ? palette : undefined,
    delay: shots[i].ms,
    transparent: i > 0,
    transparentIndex: 255,
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
  shots.forEach((s, i) => {
    writeFileSync(join(values.frames, `scene${String(i).padStart(3, '0')}.png`), s.png);
  });
}
console.log(
  `${gifPath}: ${shots.length} frames, ${(total / 1000).toFixed(1)} s, ${(statSync(gifPath).size / 1e6).toFixed(2)} MB`,
);
