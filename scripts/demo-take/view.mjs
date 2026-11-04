// The terminal half of a demo take (scripts/demo-take/take.mjs starts it in Windows Terminal).
//
// It shows a 3-2-1 countdown, the user's bug report, then runs kiro-cli and prints its
// stream-json output as it arrives, in a readable form: the agent's words, each tool call, and
// the text Lightpath's tools returned. Nothing here is typed in or made up; every line comes from
// kiro-cli's output, and the raw output is saved line by line next to the take.
//
// What the view changes in how that output looks (RECORDING.md lists the same):
//   - colour: lines that ran are pink, "not run" ranges are grey, and each function line gets a
//     small bar drawn from its own numbers (pink = ran, grey = not run);
//   - folding: in a trace, one server file of the first request is shown in full (of the files
//     whose path has a word of the request's URL path, the one with the most functions listed),
//     and browser phases and the other files become
//     one "folded" line with their counts, so the trace fits the screen. The full text is in
//     transcript.jsonl;
//   - Read File results aren't printed (the file's text), only their line count.
//
// It talks to take.mjs through files in the take folder: it waits for `go`, writes `agent.done`
// when kiro-cli exits, waits for `reset.done`, redraws the first screen, writes `view.done`, and
// exits when `close` appears.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// `node view.mjs --print <file>` prints one saved run_action answer the way a take shows it.
const printOnly = process.argv[2] === '--print' ? process.argv[3] : null;
const out = printOnly ? null : process.argv[2];
if (!out && !printOnly) throw new Error('usage: node view.mjs <take folder> | --print <trace text file>');
const session = out ? JSON.parse(readFileSync(join(out, 'session.json'), 'utf8')) : { cols: 62 };

const rgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
};
// The brand palette: deep indigo background (the terminal profile), marshmallow white text, and
// bubblegum pink only for lit things (code that ran).
const C = {
  white: rgb('#FFF7F2'),
  soft: rgb('#C9C5EC'),
  dim: rgb('#8A85BD'),
  faint: rgb('#5D5895'),
  pink: rgb('#FF7AC6'),
  bold: '\x1b[1m',
  strike: '\x1b[9m',
  reset: '\x1b[0m',
};
const write = (s) => process.stdout.write(s);
const line = (s = '') => write(`${s}${C.reset}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (name) => {
  while (!existsSync(join(out, name))) await sleep(100);
};
// A fixed width (from take.mjs), so every take wraps the same way.
const cols = () => session.cols || 62;
const clear = () => write('\x1b[2J\x1b[3J\x1b[H');
const hideCursor = () => write('\x1b[?25l');

/** Word-wraps plain text to the terminal width, with an indent on every line. */
function wrap(text, indent = '', color = C.white) {
  const width = Math.max(20, cols() - indent.length - 1);
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/(\s+)/)) {
      if ((cur + word).length > width && cur.trim()) {
        line(`${indent}${color}${cur.trimEnd()}`);
        cur = word.trimStart();
      } else cur += word;
    }
    line(`${indent}${color}${cur.trimEnd()}`);
  }
}

/** The first screen, which is also the last one, so the loop point matches. */
function firstScreen() {
  clear();
  line();
  line(`  ${C.dim}kiro-cli · ${session.model} · Lightpath ${session.lightpathVersion}`);
  line(`  ${C.dim}app: tududi, github.com/chrisvel/tududi (MIT)`);
  line(`  ${C.dim}one bug planted in a local copy for this demo`);
  if (session.dry) line(`  ${C.pink}${C.bold}DRY RUN: no agent. The script does the steps.`);
  line();
  line(`  ${C.soft}${C.bold}Bug report`);
  wrap(session.headline, '  ', `${C.white}${C.bold}`);
  line();
  wrap(session.details, '  ', C.soft);
  wrap(session.footer, '  ', C.dim);
  line();
}

const BIG = {
  3: ['█████', '    █', ' ████', '    █', '█████'],
  2: ['█████', '    █', '█████', '█    ', '█████'],
  1: ['  █  ', ' ██  ', '  █  ', '  █  ', '█████'],
};
async function countdown() {
  for (const n of [3, 2, 1]) {
    clear();
    const top = Math.max(0, Math.floor(((process.stdout.rows || 30) - 5) / 2));
    const left = ' '.repeat(Math.max(0, Math.floor((cols() - 10) / 2)));
    write('\n'.repeat(top));
    for (const row of BIG[n]) line(`${left}${C.soft}${row.replace(/█/g, '██').replace(/ /g, '  ')}`);
    await sleep(1000);
  }
}

// ---- Trace text -------------------------------------------------------------------------------

const RANGE = /^(\d+)(?:-(\d+))?$/;
function expand(list) {
  const set = new Set();
  for (const part of list.split(',').map((s) => s.trim())) {
    const m = RANGE.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

/** `name 33-42 ×40 not run: 39-40` → coloured, with a bar of its lines (one cell per line, max 20). */
const FN = /^(\s+)(.+?) (\d+)(?:-(\d+))? (×\d+|resumed)(?: not run: (.+))?$/;
function functionLine(text) {
  const m = FN.exec(text);
  if (!m) return null;
  const [, indent, name, a, b, count, notRun] = m;
  const start = Number(a);
  const end = Number(b ?? a);
  const skip = notRun ? expand(notRun) : new Set();
  const n = end - start + 1;
  const cells = Math.min(n, 20);
  let bar = '';
  for (let c = 0; c < cells; c++) {
    // A cell covers one line, or a share of them when the function is longer than 20 lines; it is
    // grey when most of its lines didn't run.
    const from = start + Math.floor((c * n) / cells);
    const to = start + Math.floor(((c + 1) * n) / cells) - 1;
    let off = 0;
    for (let l = from; l <= to; l++) if (skip.has(l)) off++;
    bar += off * 2 > to - from + 1 ? `${C.faint}□` : `${C.pink}■`;
  }
  const range = `${start}${end !== start ? `-${end}` : ''}`;
  let s = `${indent}${C.white}${name} ${C.pink}${range} ${C.dim}${count}`;
  // A long "not run" list is cut to fit the line (the transcript has all of it).
  const shown = notRun && notRun.length > 16 ? `${notRun.slice(0, 15)}…` : notRun;
  if (notRun) s += ` ${C.faint}not run: ${C.dim}${shown}`;
  return { s, bar, plainLen: `${indent}${name} ${range} ${count}`.length + (notRun ? 10 + shown.length : 0) };
}

function printFunction(text) {
  const f = functionLine(text);
  if (!f) return line(`${C.soft}${text}`);
  // Bars start at one column, so they line up; a long line gets its bar after one space.
  const pad = Math.max(1, 41 - f.plainLen);
  line(`${f.s}${' '.repeat(pad)}${f.bar}`);
}

/** Prints run_action's answer: header in full, the first server file of the first request in full, the rest folded. */
function printTrace(text) {
  const rows = text.split('\n');
  let i = 0;
  // Header: up to the first blank line. Two request lines at most; the rest become a count.
  let requests = 0;
  const extraRequests =
    rows
      .slice(
        0,
        rows.findIndex((r) => !r.trim()),
      )
      .filter((r) => /^request:/.test(r)).length - 2;
  for (; i < rows.length && rows[i].trim(); i++) {
    const r = rows[i];
    if (/^request:/.test(r) && ++requests > 2) {
      if (requests === 3) line(`  ${C.faint}+ ${extraRequests} more requests (folded)`);
      continue;
    }
    if (/^Trace /.test(r)) wrap(r, '  ', `${C.white}${C.bold}`);
    else if (/^warning/.test(r)) wrap(r, '  ', C.dim);
    else if (/^page:/.test(r)) continue;
    else wrap(r, '  ', C.soft);
  }
  // Blocks: a heading line (no indent), files (2 spaces), functions (4 spaces).
  const blocks = [];
  for (; i < rows.length; i++) {
    const r = rows[i];
    if (!r.trim()) continue;
    if (!r.startsWith(' ')) blocks.push({ head: r, files: [] });
    else if (/^ {2}\S/.test(r)) blocks.at(-1)?.files.push({ path: r.trim(), fns: [] });
    else blocks.at(-1)?.files.at(-1)?.fns.push(r);
  }
  let expanded = false;
  for (const b of blocks) {
    if (/^not shown:/.test(b.head)) {
      wrap(b.head.replace(/ Call get_trace.*$/, ''), '  ', C.dim);
      continue;
    }
    const browser = /\[browser\]/.test(b.head);
    wrap(b.head, '  ', `${browser ? C.dim : C.white}${C.bold}`);
    const fnCount = (files) => files.reduce((n, f) => n + f.fns.length, 0);
    if (!browser && !expanded && b.files.length) {
      expanded = true;
      // The file shown in full: of the files whose path has a word of the request's URL path
      // ("daily-plan" for GET /api/daily-plan/candidates), the one with the most functions listed;
      // else the first file. A rule from the trace alone, so the view never picks a file because
      // the agent later edits it.
      const words = (/^\S+ (\/\S*)/.exec(b.head)?.[1] ?? '')
        .split(/[/?#]/)
        .filter((w) => w.length >= 4 && w !== 'api');
      const matching = b.files.filter((f) => words.some((w) => f.path.includes(w)));
      const first = matching.reduce(
        (best, f) => (f.fns.length > best.fns.length ? f : best),
        matching[0] ?? b.files[0],
      );
      const rest = b.files.filter((f) => f !== first);
      line(`    ${C.white}${first.path}`);
      for (const fn of first.fns) printFunction(`  ${fn}`);
      if (rest.length)
        line(`    ${C.faint}+ ${rest.length} more server files, ${fnCount(rest)} functions (folded)`);
    } else if (b.files.length) {
      line(`    ${C.faint}${b.files.length} files, ${fnCount(b.files)} functions (folded)`);
    }
  }
}

/** diff_traces' answer: server lines in full, browser lines folded into a count. */
function printDiff(text) {
  const rows = text.split('\n');
  line(`  ${C.white}${C.bold}${rows[0]}`);
  let folded = 0;
  for (const r of rows.slice(1)) {
    if (/^\s+(frontend|src|main\.|node_modules)/.test(r) || /\.(tsx|jsx)\b/.test(r)) {
      folded++;
      continue;
    }
    const m = /^(\s+)(.+?): only in ([AB]): (.+)$/.exec(r);
    if (m) line(`${m[1]}${C.white}${m[2]}  ${m[3] === 'B' ? C.pink : C.dim}only in ${m[3]}: ${m[4]}`);
    else line(`  ${C.soft}${r.trim()}`);
  }
  if (folded) line(`  ${C.faint}+ ${folded} browser lines (folded)`);
}

// ---- kiro-cli's stream-json -------------------------------------------------------------------

const shortPath = (p) => {
  const s = String(p ?? '').replace(/\\/g, '/');
  const root = String(session.trial ?? '').replace(/\\/g, '/');
  if (root && s.toLowerCase().startsWith(root.toLowerCase())) return s.slice(root.length + 1);
  return s.replace(/^.*\/demo-take-\d+\//, '');
};

const calls = new Map();
let speaking = false;
let said = '';
const endSpeech = () => {
  if (!speaking) return;
  wrap(said.trim(), '  ', C.white);
  line();
  speaking = false;
  said = '';
};

function onToolCall(u) {
  endSpeech();
  const title = String(u.title ?? '');
  const input = u.rawInput ?? {};
  const args = input.arguments ?? input;
  calls.set(u.toolCallId, { title, input });
  let what = '';
  if (/run_action/.test(title)) {
    what = `${args.action === 'press' ? `press ${args.key ?? 'Enter'} on` : 'click'} ${args.target}${args.within ? ` within "${args.within}"` : ''}`;
  } else if (/diff_traces/.test(title))
    what = `${args.a ?? args.before ?? ''} → ${args.b ?? args.after ?? ''}`;
  else if (/get_trace|find_code|list_traces|run_request/.test(title))
    what = JSON.stringify(args).slice(0, 60);
  else if (input.path) what = shortPath(input.path);
  else if (input.command) what = String(input.command).slice(0, 60);
  else if (/Tool Load/.test(title))
    what = (input.tool_ids ?? []).map((t) => String(t).replace(/^.*::/, '')).join(', ');
  const name = title.replace(/^@lightpath\//, '');
  const lp = /^@lightpath\//.test(title);
  line(`${lp ? C.pink : C.soft}● ${C.bold}${name}${C.reset}${C.soft}  ${what}`);
  if (/Replace in File|Edit/i.test(title) && input.oldStr !== undefined) {
    for (const l of String(input.oldStr).split('\n')) wrap(`- ${l.trim()}`, '  ', `${C.faint}${C.strike}`);
    for (const l of String(input.newStr ?? '').split('\n'))
      wrap(`+ ${l.trim()}`, '  ', `${C.white}${C.bold}`);
    line();
  }
}

function onToolDone(u) {
  const call = calls.get(u.toolCallId);
  if (!call || call.done) return;
  call.done = true;
  const text = (u.content ?? []).map((c) => c?.content?.text ?? '').join('\n');
  if (/run_action/.test(call.title)) {
    if (/^Trace /.test(text)) printTrace(text);
    else wrap(text.split('\n').slice(0, 4).join('\n'), '  ', C.dim);
    line();
  } else if (/diff_traces/.test(call.title)) {
    printDiff(text);
    line();
  } else if (/@lightpath\//.test(call.title)) {
    wrap(text.split('\n').slice(0, 6).join('\n'), '  ', C.dim);
    line();
  } else if (/Read File/.test(call.title)) {
    const n = (text.match(/\n/g) ?? []).length;
    line(`  ${C.faint}read ${n} lines`);
  }
}

function onEvent(e) {
  const u = e?.data?.update;
  if (!u) return;
  if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
    speaking = true;
    said += u.content.text;
    // Print whole lines as they complete, so wrapping stays right.
    const nl = said.lastIndexOf('\n');
    if (nl >= 0) {
      wrap(said.slice(0, nl).trimEnd(), '  ', C.white);
      said = said.slice(nl + 1);
    }
  } else if (u.sessionUpdate === 'tool_call') onToolCall(u);
  else if (u.sessionUpdate === 'tool_call_update') {
    if (u.title && !calls.has(u.toolCallId)) onToolCall(u);
    if (u.status === 'completed' || u.status === 'failed') onToolDone(u);
  }
}

async function runAgent() {
  const lines = [];
  const kiro = spawn(session.kiro, [...session.args, session.prompt], {
    cwd: session.trial,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buf = '';
  let err = '';
  kiro.stdout.on('data', (c) => {
    buf += c;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const l = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (l) {
        lines.push({ at: Date.now(), line: l });
        try {
          onEvent(JSON.parse(l));
        } catch {}
      }
      nl = buf.indexOf('\n');
    }
  });
  kiro.stderr.on('data', (c) => {
    err += c;
  });
  const exitCode = await new Promise((res) => {
    const timer = setTimeout(() => kiro.kill(), 10 * 60_000);
    kiro.on('exit', (code) => {
      clearTimeout(timer);
      res(code);
    });
  });
  if (buf.trim()) lines.push({ at: Date.now(), line: buf.trim() });
  endSpeech();
  writeFileSync(join(out, 'transcript.jsonl'), lines.map((l) => `${l.line}\n`).join(''));
  writeFileSync(join(out, 'timing.json'), `${JSON.stringify(lines.map((l) => l.at))}\n`);
  writeFileSync(join(out, 'kiro-cli.stderr.log'), err);
  return exitCode;
}

/**
 * --dry: the agent's loop done by take.mjs with no model: click, undo the planted bug, click
 * again. For each step it writes dry-<n>.go and waits for take.mjs's dry-<n>.txt.
 */
async function runDry() {
  for (const [n, step] of session.dry.entries()) {
    if (step.fix)
      line(`${C.soft}● ${C.bold}fix${C.reset}${C.soft}  bug.patch undone  ${C.dim}(by the script)`);
    else
      line(
        `${C.pink}● ${C.bold}run_action${C.reset}${C.soft}  click ${step.target}  ${C.dim}(by the script)`,
      );
    writeFileSync(join(out, `dry-${n}.go`), '');
    await waitFor(`dry-${n}.txt`);
    const text = readFileSync(join(out, `dry-${n}.txt`), 'utf8');
    if (/^Trace /.test(text)) printTrace(text);
    else wrap(text, '  ', C.dim);
    line();
  }
  wrap('Dry run: no model was called. This screen is never recorded.', '  ', C.dim);
  await sleep(3000);
  return 0;
}

if (printOnly) {
  printTrace(readFileSync(printOnly, 'utf8'));
  process.exit(0);
}
hideCursor();
writeFileSync(join(out, 'view.ready'), String(process.pid));
await waitFor('go');
await countdown();
firstScreen();
await sleep(session.holdMs);
const startedAt = Date.now();
const exitCode = session.dry ? await runDry() : await runAgent();
writeFileSync(join(out, 'agent.done'), JSON.stringify({ exitCode, startedAt, endedAt: Date.now() }));
await waitFor('reset.done');
firstScreen();
writeFileSync(join(out, 'view.done'), String(Date.now()));
await waitFor('close');
process.exit(0);
