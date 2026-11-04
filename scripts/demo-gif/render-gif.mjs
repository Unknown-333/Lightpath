// Turns one recorded tududi run (record-tududi.mjs) into the README GIF (D-138). Five scenes, one
// idea each, in text big enough to read at README width: the user's bug report over the real app,
// the agent's run_action click (frames of Lightpath's own browser from the run's screencast), the
// trace lines that matter, the agent's edit, and the list before and after.
//
// Every tool call, argument, trace line and agent sentence shown is cut from the run's stream-json
// transcript by the rules below; nothing is typed in by hand. Time is shortened: each scene has a
// fixed length. The "after" picture is from `record-tududi.mjs --after` (server restarted, one
// scripted click), and the GIF says so.
//
// Usage: node scripts/demo-gif/render-gif.mjs --run <folder> [--gif docs/media/tududi-demo.gif]
//        [--frames <folder>] (also saves each scene as a PNG, to check them)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
// The GIF encoder and PNG reader are the invoices demo's dev dependencies (D-136); playwright-core
// is the browser package's.
const fromInvoices = createRequire(join(repo, 'examples', 'invoices', 'package.json'));
const { applyPalette, GIFEncoder, quantize } = fromInvoices('gifenc');
const { PNG } = fromInvoices('pngjs');
const { chromium } = createRequire(join(repo, 'packages', 'browser', 'package.json'))('playwright-core');

const { values } = parseArgs({
  options: { run: { type: 'string' }, gif: { type: 'string' }, frames: { type: 'string' } },
});
if (!values.run) throw new Error('--run <folder> is required');
const runDir = resolve(values.run);
const gifPath = resolve(values.gif ?? join(repo, 'docs', 'media', 'tududi-demo.gif'));
const W = 1000;
const H = 600;

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
  const fn = /^ {4}(\S+) (\d+)(?:-(\d+))? ×(\d+)/.exec(l);
  if (fn && file) file.fns.push({ name: fn[1], from: +fn[2], to: +(fn[3] ?? fn[2]), calls: +fn[4] });
}
const serverFiles = sections.filter((s) => s.side === 'server').flatMap((s) => s.files);
const browserFiles = sections.filter((s) => s.side === 'browser').flatMap((s) => s.files);
// First occurrence of each file (the click's own request comes first).
const uniq = (fs) => fs.filter((f, i) => fs.findIndex((g) => g.path === f.path) === i);
const named = (f) => f.fns.filter((x) => !x.name.startsWith('('));
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
    const range = x.from === x.to ? `${x.from}` : `${x.from}-${x.to}`;
    traceLines.push({ cls: x === holder ? 'fn hit' : 'fn', text: `${x.name}  ${range}  ×${x.calls}` });
  }
}
const nextServer = uniq(serverFiles).find((f) => !shownServer.includes(f.path) && named(f).length);
if (nextServer) {
  shownServer.push(nextServer.path);
  traceLines.push({ cls: 'file', text: nextServer.path });
  const wide = [...named(nextServer)].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  traceLines.push({ cls: 'fn', text: `${wide.name}  ${wide.from}-${wide.to}  ×${wide.calls}` });
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

// ---- Render ---------------------------------------------------------------------------------------
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const img = (path) => `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`;
const frameSrc = (f) => img(join(runDir, 'frames', f.file));
const lastBefore = frameSrc(landed);
const afterSrc = afterShot ? img(afterShot) : '';
const kiro = String(run.kiroCli ?? '').replace(/^kiro-cli\s*/, '');
const credits = typeof run.credits === 'number' ? run.credits.toFixed(2) : '?';
const caption = `Real kiro-cli ${kiro} run, ${run.model} · ${run.steps} tool calls, ${credits} credits, ${Math.round(run.wallMs / 1000)} s · bug planted for the demo · time shortened`;

// The browser window shows the 1280×800 page. Zoom 0: the whole page width. Zoom 1: the middle
// of the page at 95%, where Today's card and the plan list are.
const WIN = { x: 30, y: 58, w: 940, h: 490 };
const VIEW_H = WIN.h - 30;
const zoomTransform = (z) => {
  const s0 = WIN.w / 1280;
  const s1 = 0.96;
  const s = s0 + (s1 - s0) * z;
  const x = -300 * z * s;
  const y = -75 * z * s;
  return `translate(${x}px, ${y}px) scale(${s})`;
};
const CHIPS = ['Bug report', 'Agent clicks', 'Trace', 'Fix'];
const css = `
* { box-sizing: border-box; margin: 0; }
body { width: ${W}px; height: ${H}px; overflow: hidden; color: #e2e8f0;
  font-family: "Segoe UI", system-ui, sans-serif;
  background: radial-gradient(1200px 600px at 20% 0%, #1e1b4b 0%, #0b1020 55%, #070a14 100%); }
.top { height: 56px; display: flex; align-items: center; padding: 0 30px; }
.logo { font-weight: 700; font-size: 22px; letter-spacing: -.02em; color: #fff; display: flex; align-items: center; gap: 10px; }
.logo i { width: 22px; height: 22px; border-radius: 7px; background: linear-gradient(135deg, #818cf8, #4f46e5); display: inline-block; box-shadow: 0 0 18px rgba(129,140,248,.6); }
.logo b { color: #a5b4fc; font-weight: 700; }
.chips { display: flex; gap: 8px; margin-left: auto; }
.chip { padding: 6px 13px; border-radius: 999px; font-size: 14px; color: #64748b; border: 1px solid #1e293b; }
.chip.done { color: #a5b4fc; border-color: #3730a3; }
.chip.on { color: #fff; background: #4f46e5; border-color: #4f46e5; }
.cap { position: absolute; left: 30px; right: 30px; bottom: 12px; font-size: 13px; color: #7c8aa5; text-align: center; }
.win { position: absolute; left: ${WIN.x}px; top: ${WIN.y}px; width: ${WIN.w}px; height: ${WIN.h}px; border-radius: 12px; overflow: hidden;
  background: #fff; box-shadow: 0 20px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06); }
.bar { height: 30px; background: #eef0f4; display: flex; align-items: center; gap: 7px; padding: 0 12px; border-bottom: 1px solid #dfe3ea; }
.dot { width: 11px; height: 11px; border-radius: 50%; background: #d4d8e0; }
.url { margin-left: 12px; font-size: 12.5px; color: #475569; background: #fff; border-radius: 7px; padding: 3px 12px; }
.view { position: relative; height: ${VIEW_H}px; overflow: hidden; background: #f2f3f5; }
.view img { position: absolute; left: 0; top: 0; width: 1280px; height: 800px; transform-origin: 0 0; }
.prompt { position: absolute; left: 56px; right: 56px; bottom: 76px; background: rgba(15,23,42,.94); border: 1px solid #334155;
  border-radius: 14px; padding: 18px 22px; font-size: 19px; line-height: 1.45; color: #f8fafc; box-shadow: 0 16px 40px rgba(0,0,0,.45); }
.who { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #fbbf24; margin-bottom: 6px; font-weight: 600; }
.pill { position: absolute; right: 60px; top: 150px; background: rgba(15,23,42,.95); color: #e2e8f0;
  border: 1px solid #4338ca; border-radius: 12px; padding: 12px 20px; font: 17px/1.3 "Cascadia Mono", Consolas, monospace; white-space: nowrap;
  box-shadow: 0 12px 30px rgba(0,0,0,.4); }
.pill .k { color: #a5b4fc; } .pill .ok { color: #34d399; } .pill .s { color: #cbd5e1; }
.panel { position: absolute; top: 66px; bottom: 44px; border-radius: 14px; background: #0f172a; border: 1px solid #1e293b; padding: 20px 24px;
  font: 17px/1.62 "Cascadia Mono", Consolas, monospace; box-shadow: 0 20px 50px rgba(0,0,0,.4); overflow: hidden; }
.panel .l { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.call { color: #a5b4fc; } .call span { color: #e2e8f0; }
.req { color: #34d399; font-weight: 600; }
.side { color: #64748b; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; margin-top: 8px; }
.file { color: #7dd3fc; }
.fn { color: #cbd5e1; padding-left: 2ch; }
.fn.hit { color: #fff; background: rgba(250,204,21,.16); border-left: 3px solid #facc15; margin-left: -3px; border-radius: 3px; }
.dim { color: #64748b; }
.note { margin-top: 14px; color: #f8fafc; font-family: "Segoe UI", system-ui, sans-serif; font-size: 18px; white-space: normal; }
.note b { color: #a5b4fc; font-weight: 600; }
.thumb { position: absolute; top: 66px; right: 30px; width: 330px; }
.thumb .t { font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: #fca5a5; margin-bottom: 8px; font-weight: 600; }
.thumb .t.good { color: #86efac; }
.crop { position: relative; width: 330px; height: 262px; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 14px 34px rgba(0,0,0,.45); }
.crop img { position: absolute; width: 1280px; height: 800px; transform-origin: 0 0; transform: translate(${-352 * 0.81}px, ${-128 * 0.81}px) scale(0.81); }
.del { color: #fca5a5; background: rgba(239,68,68,.12); } .add { color: #86efac; background: rgba(34,197,94,.12); }
.where { color: #94a3b8; font-size: 15px; margin: 2px 0 10px; }
.say { margin-top: 18px; font: 19px/1.5 "Segoe UI", system-ui, sans-serif; color: #f1f5f9; white-space: normal; }
.say + .say { margin-top: 10px; }
.say b { color: #a5b4fc; font-weight: 600; }
.cmp { position: absolute; top: 74px; left: 0; right: 0; display: flex; justify-content: center; gap: 36px; }
.cmp .crop { width: 420px; height: 334px; }
.cmp .crop img { transform: translate(${-352 * 1.03}px, ${-128 * 1.03}px) scale(1.03); }
.cmp .t { font-size: 15px; }
.cmpcap { position: absolute; top: 470px; left: 60px; right: 60px; text-align: center; font-size: 15px; color: #94a3b8; }
.end { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; }
.end .big { font-size: 46px; font-weight: 700; letter-spacing: -.03em; color: #fff; }
.end .big b { color: #a5b4fc; }
.end .tag { font-size: 24px; color: #e2e8f0; max-width: 760px; line-height: 1.35; }
.end code { font: 18px "Cascadia Mono", Consolas, monospace; color: #c7d2fe; background: #111a33; border: 1px solid #312e81; padding: 10px 18px; border-radius: 10px; }
`;

function chips(on) {
  if (!on) return '';
  return CHIPS.map(
    (c, i) => `<span class="chip ${i + 1 === on ? 'on' : i + 1 < on ? 'done' : ''}">${i + 1} ${c}</span>`,
  ).join('');
}
function body(scene) {
  const top = `<div class="top"><div class="logo"><i></i><span>Light<b>path</b></span></div><div class="chips">${chips(scene.chip)}</div></div>`;
  const cap = scene.kind === 'end' ? '' : `<div class="cap">${esc(caption)}</div>`;
  if (scene.kind === 'app') {
    let over = '';
    if (scene.prompt !== undefined)
      over = `<div class="prompt"><div class="who">The user reports</div>${esc(scene.prompt)}</div>`;
    if (scene.pill === 'call')
      over = `<div class="pill"><span class="k">● lightpath run_action</span>  <span class="s">${esc(target)}</span></div>`;
    if (scene.pill === 'done')
      over = `<div class="pill"><span class="ok">✓ trace</span>  <span class="s">${esc(firstRequest.replace(/ \(node.*$/, ''))}</span></div>`;
    return `${top}<div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">tududi · localhost:8412 · Lightpath's browser</span></div><div class="view"><img src="${frameSrc(scene.frame)}" style="transform:${zoomTransform(scene.zoom)}"></div></div>${over}${cap}`;
  }
  if (scene.kind === 'trace') {
    const lines = scene.lines.map((l) => `<div class="l ${l.cls}">${esc(l.text)}</div>`).join('');
    const note = scene.note ? `<div class="note"><b>Agent:</b> ${esc(scene.note)}</div>` : '';
    return `${top}<div class="panel" style="left:30px;width:590px"><div class="l call">● run_action <span>${esc(target)}</span></div>${lines}${note}</div>
      <div class="thumb"><div class="t">What the user sees</div><div class="crop"><img src="${lastBefore}"></div></div>${cap}`;
  }
  if (scene.kind === 'fix') {
    const a = argsOf(edit);
    const oldL = String(a.oldStr ?? '').split('\n');
    const newL = String(a.newStr ?? '').split('\n');
    const del = oldL
      .filter((l) => !newL.includes(l))
      .map((l) => `<div class="l del">- ${esc(l.trim())}</div>`);
    const add = newL
      .filter((l) => !oldL.includes(l))
      .map((l) => `<div class="l add">+ ${esc(l.trim())}</div>`);
    const where = [editLine > 0 ? `line ${editLine}` : '', fnName ? `in ${fnName}` : '']
      .filter(Boolean)
      .join(', ');
    const say =
      scene.step === 2
        ? `<div class="say"><b>Agent:</b> ${esc(answer.cause)}</div><div class="say"><b>Agent:</b> ${esc(answer.status)}</div>`
        : '';
    return `${top}<div class="panel" style="left:30px;right:30px;top:140px;bottom:auto;padding:26px 30px"><div class="l call">● edit <span>${esc(editPath)}</span></div><div class="where">${esc(where)}</div>${del.join('')}${add.join('')}${say}</div>${cap}`;
  }
  if (scene.kind === 'compare') {
    return `${top}<div class="cmp"><div><div class="t" style="color:#fca5a5;letter-spacing:.1em;text-transform:uppercase;font-weight:600;margin-bottom:8px">Before</div><div class="crop"><img src="${lastBefore}"></div></div>
      <div><div class="t" style="color:#86efac;letter-spacing:.1em;text-transform:uppercase;font-weight:600;margin-bottom:8px">After the fix</div><div class="crop"><img src="${afterSrc}"></div></div></div>
      <div class="cmpcap">After: server restarted and "Plan your day" clicked again by the recording script, not by the agent.</div>${cap}`;
  }
  return `<div class="end"><div class="big">Light<b>path</b></div><div class="tag">See the exact lines one click ran, browser and server, for your agent.</div><code>npx @lightpath-dev/cli init --agent kiro</code></div>`;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body></body></html>`);
const shots = [];
for (const scene of scenes) {
  await page.evaluate((h) => {
    document.body.innerHTML = h;
  }, body(scene));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  shots.push({ png: await page.screenshot({ type: 'png' }), ms: scene.ms });
}
await browser.close();

// ---- Encode ---------------------------------------------------------------------------------------
const rgba = shots.map((s) => PNG.sync.read(s.png).data);
// One palette for the whole GIF, from a sample of every frame; index 255 is "same as before".
const sampleStep = 5;
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
const shown = { action: actionLine, editLine, fnName, traceLines, answer, readNote, after: afterInfo };
writeFileSync(join(runDir, 'gif-text.json'), `${JSON.stringify(shown, null, 2)}\n`);
console.log(
  `${gifPath}: ${shots.length} frames, ${(total / 1000).toFixed(1)} s, ${(statSync(gifPath).size / 1e6).toFixed(2)} MB`,
);
