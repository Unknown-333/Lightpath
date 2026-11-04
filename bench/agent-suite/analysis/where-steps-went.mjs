#!/usr/bin/env node
// Where the extra steps went: a read-only audit of the 2026-11-03 full benchmark transcripts.
//
//   node bench/agent-suite/analysis/where-steps-went.mjs [outDir]
//
// Reads the result lines in bench/agent-suite/results (the four 2026-11-03 `with` files and the
// `without` runs of the same bugs: the two 2026-11-01 baselines and the two 2026-11-03 held-out
// `without` files), opens each valid run's transcript (the `transcript` path in its line) and
// writes, to outDir (default: ./stepsaudit-raw):
//   summary.txt  every table the write-up quotes, one labelled line per number
//   runs.json    per run: each step with its kind, the Lightpath outcome and the trace files
//   misses.txt   every run_action / find_code_for_action call that did not return a trace
//   h01.txt      the tududi held-out h01 `with` runs step by step, with check result and diff
//
// It runs no agent, no browser and no app, and changes no file outside outDir. Valid = `void`
// is false in the result line (SCORING.md). Steps = tool calls, as in lib/agent.mjs
// parseTranscript. Tokens = characters / 4 as in lib/agent.mjs estimateTokens (D-111).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(here, '..', 'results');
const outDir = resolve(process.argv[2] ?? 'stepsaudit-raw');
mkdirSync(outDir, { recursive: true });

const WITH_FILES = [
  '2026-11-03-shop-with.jsonl',
  '2026-11-03-shop-heldout-with.jsonl',
  '2026-11-03-realapp-with.jsonl',
  '2026-11-03-realapp-heldout-with.jsonl',
];
const WITHOUT_FILES = [
  '2026-11-01-baseline-without.jsonl',
  '2026-11-03-shop-heldout-without.jsonl',
  '2026-11-01-realapp-baseline-without.jsonl',
  '2026-11-03-realapp-heldout-without.jsonl',
];

// ---------- reading ----------

function readLines(file) {
  return readFileSync(join(resultsDir, file), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function suiteOf(rec, file) {
  const s = rec.suite === 'realapp' || file.includes('realapp') ? 'tududi' : 'shop';
  return { suite: s, set: `${s} ${rec.heldout ? 'held-out' : 'visible'}` };
}

/** Same merge as lib/agent.mjs parseTranscript, but keeps the full output text. */
function readCalls(transcriptPath) {
  const calls = new Map();
  const events = [];
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  const chunks = { message: 0, thought: 0 };
  for (const event of events) {
    const u = event.data?.update;
    if (!u) continue;
    if (u.sessionUpdate === 'agent_message_chunk' && typeof u.content?.text === 'string')
      chunks.message += u.content.text.length;
    if (u.sessionUpdate === 'agent_thought_chunk' && typeof u.content?.text === 'string')
      chunks.thought += u.content.text.length;
    if (u.sessionUpdate !== 'tool_call' && u.sessionUpdate !== 'tool_call_update') continue;
    const prev = calls.get(u.toolCallId) ?? { id: u.toolCallId };
    const text = (u.content ?? []).map((c) => c?.content?.text ?? '').join('\n');
    calls.set(u.toolCallId, {
      ...prev,
      kind: u.kind ?? prev.kind,
      title: u.title ?? prev.title,
      input: u.rawInput !== undefined ? u.rawInput : prev.input,
      status: u.status ?? prev.status,
      output: text ? text : (prev.output ?? ''),
    });
  }
  return { calls: [...calls.values()], chunks, events };
}

// ---------- classifying ----------

const SRC = /\.(?:[cm]?[jt]sx?)$/i;

function norm(p, trialDir) {
  if (!p || typeof p !== 'string') return null;
  let s = p.replace(/\\/g, '/').trim();
  const t = trialDir.replace(/\\/g, '/').toLowerCase();
  if (s.toLowerCase().startsWith('/' + t)) s = s.slice(t.length + 1);
  else if (s.toLowerCase().startsWith(t)) s = s.slice(t.length);
  s = s.replace(/^\/+/, '').replace(/^\.\//, '');
  return s.toLowerCase();
}

function shellSub(cmd) {
  const c = String(cmd ?? '');
  if (/Set-Content|Out-File|WriteAllText|Add-Content|\.Replace\(|-replace[\s\S]*Set-Content/i.test(c))
    return 'edit';
  if (/\b(npx|npm|pnpm|yarn|tsc|jest|vitest|eslint)\b|\bnode\s/i.test(c)) return 'test/build';
  if (/curl|Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b/i.test(c)) return 'http';
  if (/Select-String|findstr|\brg\b|\bgrep\b|Get-ChildItem|\bgci\b|\bdir\b|\bls\b/i.test(c)) return 'search';
  if (/Get-Content|\bcat\b|\btype\b|\bgc\b/i.test(c)) return 'read';
  if (/Get-Process|netstat|Get-NetTCPConnection|Test-NetConnection/i.test(c)) return 'process/port';
  return 'other';
}

function classify(call) {
  const title = call.title ?? '';
  if (title === 'Tool Load') {
    const ids = call.input?.tool_ids ?? [];
    return ids.length && ids.every((id) => String(id).startsWith('lightpath::'))
      ? { cat: 'lp_load', sub: 'tool_load' }
      : { cat: 'other', sub: 'tool_load (non-Lightpath)' };
  }
  if (title.startsWith('@lightpath/')) return { cat: 'lightpath', sub: title.slice('@lightpath/'.length) };
  if (call.kind === 'search' || ['Grep Search', 'File Search', 'List Directory'].includes(title))
    return { cat: 'search', sub: title || 'search' };
  if (call.kind === 'read' || title === 'Read File') return { cat: 'read', sub: 'Read File' };
  if (call.kind === 'edit' || /Replace in File|Write File|Create File|Append/i.test(title))
    return { cat: 'edit', sub: title };
  if (call.kind === 'execute' || title === 'Run Command' || title === 'run_in_background')
    return { cat: 'shell', sub: shellSub(call.input?.command) };
  return { cat: 'other', sub: title || '(no title)' };
}

function lpOutcome(out) {
  const o = String(out ?? '').trim();
  if (/^Trace t_/.test(o)) return 'ok';
  if (/not_found/.test(o)) return 'not_found';
  if (/^No recorded action matches/.test(o)) return 'no_recorded_action';
  return 'error: ' + o.slice(0, 120).replace(/\s+/g, ' ');
}

function traceFiles(out) {
  const files = new Set();
  for (const line of String(out ?? '').split('\n')) {
    const m = line.match(/^\s+([\w@.\-/[\]]+\.(?:[cm]?[jt]sx?|vue|svelte))\s*$/);
    if (m) files.add(m[1].toLowerCase());
  }
  return files;
}

function closestTargets(out) {
  const o = String(out ?? '');
  const i = o.indexOf('Closest targets on the page:');
  if (i < 0) return [];
  return o
    .slice(i)
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
}

function pathsInText(text, trialDir) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/[\w:./\\@\-[\]]+\.(?:[cm]?[jt]sx?)\b/gi)) {
    const n = norm(m[0], trialDir);
    if (n && !n.includes('node_modules')) out.add(n);
  }
  return out;
}

function fixFiles(rec) {
  const files = new Set();
  for (const raw of String(rec.diff ?? '').split('\n')) {
    let l = raw.trim();
    if (!l || /files? changed/.test(l)) continue;
    if (l.includes('|')) l = l.split('|')[0].trim();
    l = l
      .replace(/\s*\(new\)$/, '')
      .replace(/\\/g, '/')
      .toLowerCase();
    if (/^backend\/(db|uploads)\//.test(l) || !SRC.test(l)) continue;
    files.add(l);
  }
  return files;
}

// ---------- per run ----------

function analyseRun(rec, file) {
  const { suite, set } = suiteOf(rec, file);
  const { calls, chunks } = readCalls(rec.transcript);
  const promptPath = join(dirname(rec.transcript), 'prompt.txt');
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';
  const fix = fixFiles(rec);
  const steps = calls.map((c, i) => {
    const { cat, sub } = classify(c);
    const step = {
      n: i + 1,
      cat,
      sub,
      title: c.title,
      status: c.status,
      input: c.input,
      outChars: String(c.output ?? '').length,
      inChars: c.input === undefined ? 0 : JSON.stringify(c.input).length,
    };
    if (cat === 'lightpath') {
      step.outcome = lpOutcome(c.output);
      step.args = c.input?.arguments ?? c.input;
      step.traceFiles = [...traceFiles(c.output)];
      step.closest = closestTargets(c.output);
      step.outHead = String(c.output ?? '')
        .split('\n')
        .slice(0, 3)
        .join(' / ')
        .slice(0, 300);
    }
    if (cat === 'read' || cat === 'edit') step.path = norm(c.input?.path, rec.trialDir);
    if (cat === 'search') {
      step.query = c.input?.query ?? null;
      step.include = c.input?.includePattern ?? null;
      step.dir = c.title === 'List Directory' ? norm(c.input?.path, rec.trialDir) : null;
      step.hits = [...pathsInText(c.output, rec.trialDir)];
    }
    if (cat === 'shell') {
      step.command = String(c.input?.command ?? '').slice(0, 300);
      step.hits = [...pathsInText(c.output, rec.trialDir)];
      step.cmdPaths = [...pathsInText(c.input?.command, rec.trialDir)];
    }
    return step;
  });

  // tokens, the D-111 way, split into Lightpath and the rest
  const tok = {
    lpOut: 0,
    lpIn: 0,
    lpLoadOut: 0,
    lpLoadIn: 0,
    restIn: prompt.length,
    restOut: chunks.message + chunks.thought,
  };
  calls.forEach((c, i) => {
    const s = steps[i];
    const o = String(c.output ?? '').length;
    const inp = c.input === undefined ? 0 : JSON.stringify(c.input).length;
    if (s.cat === 'lightpath') {
      tok.lpOut += o;
      tok.lpIn += inp;
    } else if (s.cat === 'lp_load') {
      tok.lpLoadOut += o;
      tok.lpLoadIn += inp;
    } else {
      tok.restIn += o;
      tok.restOut += inp;
    }
  });
  const totalChars = tok.lpOut + tok.lpIn + tok.lpLoadOut + tok.lpLoadIn + tok.restIn + tok.restOut;

  return {
    trial: rec.trial,
    bug: rec.bug,
    condition: rec.condition,
    suite,
    set,
    correct: rec.correct === true,
    steps: steps.length,
    recordSteps: rec.steps,
    credits: rec.credits,
    tokensEst: rec.tokensEst,
    tokensCalc:
      Math.round((tok.restIn + tok.lpOut + tok.lpLoadOut) / 4) +
      Math.round((tok.restOut + tok.lpIn + tok.lpLoadIn) / 4),
    tokChars: tok,
    totalChars,
    fix: [...fix],
    checkDetail: rec.check?.detail ?? null,
    diff: rec.diff,
    trialDir: rec.trialDir,
    transcript: rec.transcript,
    prompt,
    stepsList: steps,
  };
}

// ---------- helpers for tables ----------

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '-');
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const lines = [];
const out = (s = '') => lines.push(s);
const table = (head, rows) => {
  out('| ' + head.join(' | ') + ' |');
  out('|' + head.map(() => ' --- ').join('|') + '|');
  for (const r of rows) out('| ' + r.join(' | ') + ' |');
  out();
};

// ---------- load ----------

const runs = [];
for (const f of WITH_FILES) for (const r of readLines(f)) if (!r.void) runs.push(analyseRun(r, f));
for (const f of WITHOUT_FILES) for (const r of readLines(f)) if (!r.void) runs.push(analyseRun(r, f));

const W = runs.filter((r) => r.condition === 'with');
const WO = runs.filter((r) => r.condition === 'without');
const SETS = ['shop visible', 'shop held-out', 'tududi visible', 'tududi held-out'];
const key = (r) => `${r.suite}:${r.bug}`; // bug ids repeat across suites (h01, h02)
const bugsOf = (set) => [...new Set(runs.filter((r) => r.set === set).map((r) => r.bug))].sort();
const calledLp = (r) => r.stepsList.some((s) => s.cat === 'lightpath');

out('# where-steps-went: raw summary');
out(`generated ${new Date().toISOString()} from ${resultsDir}`);
out(`valid runs: with ${W.length}, without ${WO.length}`);
const stepMismatch = runs.filter((r) => r.steps !== r.recordSteps);
out(
  `step count check (transcript tool calls vs result line 'steps'): ${stepMismatch.length} mismatches ${stepMismatch.map((r) => r.trial + ':' + r.steps + '/' + r.recordSteps).join(' ')}`,
);
const tokMismatch = runs.filter((r) => Math.abs(r.tokensCalc - r.tokensEst) > 1);
out(
  `token check (re-computed D-111 estimate vs result line 'tokensEst', |diff|>1): ${tokMismatch.length} mismatches ${tokMismatch.map((r) => r.trial + ':' + r.tokensCalc + '/' + r.tokensEst).join(' ')}`,
);
out();

// ---------- Q1 steps by kind ----------

const CATS = ['lp_load', 'lightpath', 'search', 'read', 'edit', 'shell', 'other'];
const catCount = (r, c) => r.stepsList.filter((s) => s.cat === c).length;
out('## Q1 steps by kind (mean per valid run)');
out(
  'lp_load = the tool_load call that loads the Lightpath tools; lightpath = run_action/find_code_for_action/other Lightpath calls',
);
out();
const q1Rows = [];
for (const set of SETS) {
  for (const cond of ['without', 'with']) {
    const rs = runs.filter((r) => r.set === set && r.condition === cond);
    q1Rows.push([
      set,
      cond,
      String(rs.length),
      f2(mean(rs.map((r) => r.steps))),
      ...CATS.map((c) => f2(mean(rs.map((r) => catCount(r, c))))),
    ]);
  }
  const a = runs.filter((r) => r.set === set && r.condition === 'without');
  const b = runs.filter((r) => r.set === set && r.condition === 'with');
  q1Rows.push([
    set,
    'delta',
    '',
    f2(mean(b.map((r) => r.steps)) - mean(a.map((r) => r.steps))),
    ...CATS.map((c) => f2(mean(b.map((r) => catCount(r, c))) - mean(a.map((r) => catCount(r, c))))),
  ]);
}
table(['set', 'cond', 'runs', 'steps', ...CATS], q1Rows);

out('### Q1 all 53 with vs 55 without, totals');
{
  const rows = [];
  for (const [label, rs] of [
    ['without', WO],
    ['with', W],
  ])
    rows.push([
      label,
      String(rs.length),
      String(rs.reduce((a, r) => a + r.steps, 0)),
      ...CATS.map((c) => String(rs.reduce((a, r) => a + catCount(r, c), 0))),
    ]);
  table(['cond', 'runs', 'steps total', ...CATS], rows);
}

out('### Q1 per bug (mean per valid run)');
const q1b = [];
for (const set of SETS) {
  for (const bug of bugsOf(set)) {
    for (const cond of ['without', 'with']) {
      const rs = runs.filter((r) => r.set === set && r.bug === bug && r.condition === cond);
      q1b.push([
        set,
        bug,
        cond,
        String(rs.length),
        f2(mean(rs.map((r) => r.steps))),
        ...CATS.map((c) => f2(mean(rs.map((r) => catCount(r, c))))),
      ]);
    }
  }
}
table(['set', 'bug', 'cond', 'runs', 'steps', ...CATS], q1b);

out('### Q1 Lightpath calls by tool (with runs, totals)');
{
  const rows = [];
  for (const set of SETS) {
    const rs = W.filter((r) => r.set === set);
    const by = {};
    for (const r of rs)
      for (const s of r.stepsList) if (s.cat === 'lightpath') by[s.sub] = (by[s.sub] ?? 0) + 1;
    rows.push([
      set,
      String(rs.length),
      String(rs.filter(calledLp).length),
      String(rs.reduce((a, r) => a + catCount(r, 'lp_load'), 0)),
      JSON.stringify(by),
    ]);
  }
  table(['set', 'runs', 'runs calling Lightpath', 'tool_load calls', 'calls by tool'], rows);
}

out('### Q1 shell steps by sub-kind (totals)');
{
  const subs = ['search', 'read', 'edit', 'test/build', 'http', 'process/port', 'other'];
  const rows = [];
  for (const set of SETS)
    for (const cond of ['without', 'with']) {
      const rs = runs.filter((r) => r.set === set && r.condition === cond);
      rows.push([
        set,
        cond,
        ...subs.map((u) =>
          String(
            rs.reduce((a, r) => a + r.stepsList.filter((s) => s.cat === 'shell' && s.sub === u).length, 0),
          ),
        ),
      ]);
    }
  table(['set', 'cond', ...subs], rows);
}

out('### Q1 search steps by tool (totals)');
{
  const subs = ['Grep Search', 'File Search', 'List Directory'];
  const rows = [];
  for (const set of SETS)
    for (const cond of ['without', 'with']) {
      const rs = runs.filter((r) => r.set === set && r.condition === cond);
      rows.push([
        set,
        cond,
        ...subs.map((u) =>
          String(
            rs.reduce((a, r) => a + r.stepsList.filter((s) => s.cat === 'search' && s.sub === u).length, 0),
          ),
        ),
      ]);
    }
  table(['set', 'cond', ...subs], rows);
}

out("### Q1 Lightpath calls before and after the run's first edit (with runs, totals)");
{
  const rows = [];
  for (const set of SETS) {
    const rs = W.filter((r) => r.set === set);
    let before = 0,
      after = 0,
      diffs = 0,
      runsVerify = 0;
    for (const r of rs) {
      const fe = r.stepsList.findIndex((s) => s.cat === 'edit' || (s.cat === 'shell' && s.sub === 'edit'));
      let a = 0;
      r.stepsList.forEach((s, i) => {
        if (s.cat !== 'lightpath') return;
        if (s.sub === 'diff_traces') diffs++;
        if (fe >= 0 && i > fe) a++;
        else before++;
      });
      after += a;
      if (a) runsVerify++;
    }
    rows.push([set, String(rs.length), String(before), String(after), String(runsVerify), String(diffs)]);
  }
  table(
    [
      'set',
      'runs',
      'Lightpath calls before first edit',
      'after first edit',
      'runs with a call after first edit',
      'diff_traces calls',
    ],
    rows,
  );
}

out('### Q1 credits per step (mean of credits/steps per run)');
{
  const rows = [];
  for (const set of SETS)
    for (const cond of ['without', 'with']) {
      const rs = runs.filter((r) => r.set === set && r.condition === cond);
      rows.push([
        set,
        cond,
        f3(mean(rs.map((r) => r.credits / r.steps))),
        f3(mean(rs.map((r) => r.credits))),
        f2(mean(rs.map((r) => r.steps))),
      ]);
    }
  table(['set', 'cond', 'credits per step', 'credits per run', 'steps per run'], rows);
}

out('### Q1 tool_load: tools loaded per run and its text size');
{
  const by = {};
  for (const r of W) {
    for (const s of r.stepsList.filter((s) => s.cat === 'lp_load')) {
      const n = (s.input?.tool_ids ?? []).length;
      by[n] ??= { loads: 0, chars: 0 };
      by[n].loads++;
      by[n].chars += s.outChars + s.inChars;
    }
  }
  table(
    ['tools loaded', 'tool_load calls', 'mean tokens est. of its text'],
    Object.entries(by).map(([n, v]) => [n, String(v.loads), f2(v.chars / v.loads / 4)]),
  );
  const ids = {};
  for (const r of W)
    for (const s of r.stepsList.filter((s) => s.cat === 'lp_load'))
      for (const id of s.input?.tool_ids ?? []) ids[id] = (ids[id] ?? 0) + 1;
  out('tool ids loaded (count of runs): ' + JSON.stringify(ids));
  out();
}

// ---------- Q2 after the first useful trace ----------

out('## Q2 after the first trace');
out(
  'ok trace = a Lightpath result that starts "Trace t_". useful trace = an ok trace that names a file this run changed (its diff).',
);
out(
  're-find search = a search or shell search after that trace whose include pattern / listed folder is a trace-named file or its folder, or whose result lists a trace-named file.',
);
out(
  'first read of a trace-named file is counted apart: the trace gives line numbers, not code text, so one read is needed before an edit.',
);
out();
const q2 = [];
for (const r of W) {
  const okIdx = r.stepsList.findIndex((s) => s.cat === 'lightpath' && s.outcome === 'ok');
  const usefulIdx = r.stepsList.findIndex(
    (s) => s.cat === 'lightpath' && s.outcome === 'ok' && s.traceFiles.some((f) => r.fix.includes(f)),
  );
  const anyOk = okIdx >= 0;
  const row = {
    trial: r.trial,
    set: r.set,
    bug: r.bug,
    correct: r.correct,
    steps: r.steps,
    called: calledLp(r),
    anyOk,
    firstOk: okIdx + 1,
    firstUseful: usefulIdx + 1,
  };
  if (anyOk) {
    const s0 = r.stepsList[okIdx];
    row.firstOkLabel = s0.outHead.split(' / ')[0];
    row.okNamesFix = usefulIdx >= 0;
  }
  if (usefulIdx >= 0) {
    const named = new Set();
    for (let i = 0; i <= usefulIdx; i++) for (const f of r.stepsList[i].traceFiles ?? []) named.add(f);
    const dirs = new Set([...named].map((f) => f.split('/').slice(0, -1).join('/')));
    let searches = 0,
      refind = 0,
      readsNamedFirst = 0,
      readsNamedRepeat = 0,
      readsOther = 0,
      edits = 0,
      lpAfter = 0,
      shellOther = 0;
    const readSeen = new Set();
    const refindSteps = [];
    for (let i = usefulIdx + 1; i < r.stepsList.length; i++) {
      const s = r.stepsList[i];
      // later ok traces add to what is named
      if (s.cat === 'lightpath') {
        lpAfter++;
        for (const f of s.traceFiles ?? []) named.add(f);
        continue;
      }
      const isSearch = s.cat === 'search' || (s.cat === 'shell' && s.sub === 'search');
      if (isSearch) {
        searches++;
        const inc = s.include ? String(s.include).toLowerCase().replace(/\\/g, '/') : null;
        const targets =
          (inc && (named.has(inc) || dirs.has(inc.replace(/\/\*\*.*$/, '').replace(/\/\*.*$/, '')))) ||
          (s.dir !== null && s.dir !== undefined && (dirs.has(s.dir) || named.has(s.dir))) ||
          (s.cmdPaths ?? []).some((p) => named.has(p));
        const hits = (s.hits ?? []).some((h) => named.has(h));
        if (targets || hits) {
          refind++;
          refindSteps.push(
            `#${s.n} ${s.sub}${s.query ? ' q=' + JSON.stringify(s.query).slice(0, 60) : ''}${s.include ? ' in=' + s.include : ''}${s.dir ? ' dir=' + s.dir : ''}${s.command ? ' cmd=' + JSON.stringify(s.command.slice(0, 60)) : ''}`,
          );
        }
      } else if (s.cat === 'read' || (s.cat === 'shell' && s.sub === 'read')) {
        const p = s.path ?? (s.cmdPaths ?? [])[0];
        if (p && named.has(p)) {
          if (readSeen.has(p)) readsNamedRepeat++;
          else readsNamedFirst++;
          readSeen.add(p);
        } else readsOther++;
      } else if (s.cat === 'edit' || (s.cat === 'shell' && s.sub === 'edit')) edits++;
      else shellOther++;
    }
    Object.assign(row, {
      after: r.steps - usefulIdx - 1,
      searches,
      refind,
      readsNamedFirst,
      readsNamedRepeat,
      readsOther,
      edits,
      lpAfter,
      shellOther,
      refindSteps,
      named: [...named],
    });
  }
  q2.push(row);
}
{
  const rows = [];
  for (const set of SETS) {
    const rs = q2.filter((x) => x.set === set);
    const u = rs.filter((x) => x.firstUseful > 0);
    rows.push([
      set,
      String(rs.length),
      String(rs.filter((x) => x.called).length),
      String(rs.filter((x) => x.anyOk).length),
      String(u.length),
      String(u.reduce((a, x) => a + x.after, 0)),
      String(u.reduce((a, x) => a + x.searches, 0)),
      String(u.reduce((a, x) => a + x.refind, 0)),
      String(u.reduce((a, x) => a + x.readsNamedFirst, 0)),
      String(u.reduce((a, x) => a + x.readsNamedRepeat, 0)),
      String(u.reduce((a, x) => a + x.readsOther, 0)),
      String(u.reduce((a, x) => a + x.lpAfter, 0)),
    ]);
  }
  table(
    [
      'set',
      'with runs',
      'called Lightpath',
      'got an ok trace',
      'got a useful trace',
      'steps after useful trace',
      'searches after',
      're-find searches',
      'first reads of trace files',
      're-reads of trace files',
      'reads of other files',
      'Lightpath calls after',
    ],
    rows,
  );
}
out('### Q2 ok traces that did not name a changed file');
for (const x of q2.filter((x) => x.anyOk && !x.okNamesFix))
  out(`${x.trial} (${x.set}) first ok trace at step ${x.firstOk}: ${x.firstOkLabel}`);
out();
out('### Q2 per run with a useful trace');
table(
  [
    'trial',
    'steps',
    'useful trace at',
    'after',
    'searches',
    're-find',
    'first reads named',
    're-reads named',
    'reads other',
    'edits',
    'Lightpath after',
    're-find steps',
  ],
  q2
    .filter((x) => x.firstUseful > 0)
    .map((x) => [
      x.trial,
      String(x.steps),
      String(x.firstUseful),
      String(x.after),
      String(x.searches),
      String(x.refind),
      String(x.readsNamedFirst),
      String(x.readsNamedRepeat),
      String(x.readsOther),
      String(x.edits),
      String(x.lpAfter),
      x.refindSteps.join('; '),
    ]),
);

// Steps before the first edit, by kind, for runs with a useful trace vs the without runs of the same bug
out('### Q2 steps before the first edit (mean), useful-trace runs vs without runs of the same bugs');
{
  const firstEdit = (r) => {
    const i = r.stepsList.findIndex((s) => s.cat === 'edit' || (s.cat === 'shell' && s.sub === 'edit'));
    return i < 0 ? r.steps : i;
  };
  const u = W.filter((r) => q2.find((x) => x.trial === r.trial && x.set === r.set)?.firstUseful > 0);
  const bugKeys = [...new Set(u.map(key))];
  const wo = WO.filter((r) => bugKeys.includes(key(r)));
  const rows = [];
  for (const [label, rs] of [
    ['with, useful trace', u],
    ['without, same bugs', wo],
  ])
    rows.push([
      label,
      String(rs.length),
      f2(mean(rs.map(firstEdit))),
      ...['lp_load', 'lightpath', 'search', 'read', 'shell'].map((c) =>
        f2(mean(rs.map((r) => r.stepsList.slice(0, firstEdit(r)).filter((s) => s.cat === c).length))),
      ),
    ]);
  table(['rows', 'runs', 'steps before first edit', 'lp_load', 'lightpath', 'search', 'read', 'shell'], rows);
  out('bugs: ' + bugKeys.join(', '));
  out();
}

// ---------- Q3 run_action outcomes ----------

out('## Q3 Lightpath call outcomes');
const lpCalls = [];
for (const r of W)
  r.stepsList.forEach((s, i) => {
    if (s.cat === 'lightpath') lpCalls.push({ r, s, i });
  });
{
  const rows = [];
  for (const set of SETS) {
    for (const tool of ['run_action', 'find_code_for_action']) {
      const cs = lpCalls.filter((c) => c.r.set === set && c.s.sub === tool);
      const by = {};
      for (const c of cs) by[c.s.outcome] = (by[c.s.outcome] ?? 0) + 1;
      rows.push([
        set,
        tool,
        String(cs.length),
        String(by.ok ?? 0),
        String(by.not_found ?? 0),
        String(by.no_recorded_action ?? 0),
        String(cs.length - (by.ok ?? 0) - (by.not_found ?? 0) - (by.no_recorded_action ?? 0)),
      ]);
    }
  }
  const all = lpCalls.filter((c) => c.s.sub === 'run_action');
  rows.push([
    'all',
    'run_action',
    String(all.length),
    String(all.filter((c) => c.s.outcome === 'ok').length),
    String(all.filter((c) => c.s.outcome === 'not_found').length),
    '0',
    String(all.filter((c) => !['ok', 'not_found'].includes(c.s.outcome)).length),
  ]);
  table(['set', 'tool', 'calls', 'ok', 'not_found', 'no recorded action', 'other errors'], rows);
}

// retries and what came after each miss
function missCause(c) {
  const a = c.s.args ?? {};
  const target = String(a.target ?? a.action ?? '');
  const closest = c.s.closest;
  if (c.s.sub === 'find_code_for_action')
    return 'nothing recorded yet (find_code_for_action before any run_action)';
  const onLogin = closest.includes('button "Login"') && closest.includes('textbox "Email"');
  if (onLogin && /sign in/i.test(target))
    return 'text mismatch: report says "sign in", page button is "Login"';
  if (onLogin) return 'page not ready: still on the Login page (not signed in)';
  const m = target.match(/^(\w+)\s+"(.*)"$/);
  if (m) {
    const sameName = closest.filter((x) => x.endsWith(`"${m[2]}"`));
    if (sameName.length && a.within) return 'within mismatch: name exists, not inside the given row';
    if (sameName.length) return 'wrong role: name exists with another role';
  }
  return 'text mismatch: no element with that name on the page';
}
const misses = [];
for (const r of W) {
  const lp = r.stepsList.filter((s) => s.cat === 'lightpath');
  lp.forEach((s, k) => {
    if (s.outcome === 'ok') return;
    const c = { r, s };
    const later = lp.slice(k + 1);
    const nextLp = later[0];
    const nextStep = r.stepsList[s.n]; // s.n is 1-based, so this is the step after
    misses.push({
      trial: r.trial,
      set: r.set,
      step: s.n,
      tool: s.sub,
      args: s.args,
      outcome: s.outcome,
      closest: s.closest,
      cause: missCause(c),
      retried: !!nextLp,
      retryOk: nextLp ? nextLp.outcome === 'ok' : null,
      retryArgs: nextLp?.args ?? null,
      stepsToRetry: nextLp ? nextLp.n - s.n : null,
      laterOkTrace: later.some((x) => x.outcome === 'ok'),
      nextStep: nextStep ? `${nextStep.cat}/${nextStep.sub}` : '(end)',
    });
  });
}
{
  const by = {};
  for (const m of misses) {
    const k = `${m.tool} | ${m.cause}`;
    by[k] ??= { n: 0, retried: 0, retryOk: 0, abandoned: 0, trials: [] };
    by[k].n++;
    if (m.retried) by[k].retried++;
    if (m.retryOk) by[k].retryOk++;
    if (!m.laterOkTrace) by[k].abandoned++;
    by[k].trials.push(m.trial);
  }
  out('### Q3 misses by cause');
  table(
    ['tool | cause', 'misses', 'retried', 'retry ok', 'no ok trace later in run', 'runs'],
    Object.entries(by)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => [
        k,
        String(v.n),
        String(v.retried),
        String(v.retryOk),
        String(v.abandoned),
        v.trials.join(' '),
      ]),
  );
  out(
    `misses total ${misses.length}; retried ${misses.filter((m) => m.retried).length}; retry ok ${misses.filter((m) => m.retryOk).length}; runs with a miss ${new Set(misses.map((m) => m.set + m.trial)).size}; runs whose every Lightpath call missed ${W.filter((r) => calledLp(r) && r.stepsList.filter((s) => s.cat === 'lightpath').every((s) => s.outcome !== 'ok')).length}`,
  );
  const nextAfterMiss = {};
  for (const m of misses) nextAfterMiss[m.nextStep] = (nextAfterMiss[m.nextStep] ?? 0) + 1;
  out(`step right after a miss: ${JSON.stringify(nextAfterMiss)}`);
  out();
}
{
  // repeat calls with the same arguments after an ok trace
  let same = 0;
  const per = {};
  for (const r of W) {
    const lp = r.stepsList.filter((s) => s.sub === 'run_action');
    for (let k = 1; k < lp.length; k++) {
      if (JSON.stringify(lp[k].args) === JSON.stringify(lp[k - 1].args) && lp[k - 1].outcome === 'ok') {
        same++;
        per[r.trial] = (per[r.trial] ?? 0) + 1;
      }
    }
  }
  out(
    `### Q3 run_action repeated with the same arguments right after an ok trace: ${same} calls ${JSON.stringify(per)}`,
  );
  out(
    '(some bugs need repeats: b04 is "press Add to cart twice"; b05/b02 need several adds before Checkout)',
  );
  out();
}
{
  // run_action calls per run with Lightpath, and what the agent clicked
  out('### Q3 run_action targets (with runs, all calls)');
  const t = {};
  for (const c of lpCalls.filter((c) => c.s.sub === 'run_action')) {
    const a = c.s.args ?? {};
    const k = `${c.r.set} | ${a.target}${a.within ? ' within ' + JSON.stringify(a.within) : ''}${a.fill ? ' fill ' + a.fill.map((x) => x.target).join(',') : ''}${a.key ? ' key ' + a.key : ''} -> ${c.s.outcome}`;
    t[k] = (t[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(t).sort()) out(`${v}\t${k}`);
  out();
}
{
  // tududi: did any run trace the action the bug is about?
  out('### Q3 tududi: ok traces by first line');
  const tud = lpCalls.filter((c) => c.r.suite === 'tududi' && c.s.outcome === 'ok');
  for (const c of tud) {
    const later = c.r.stepsList.slice(c.i + 1).filter((s) => s.sub === 'run_action').length;
    out(`${c.r.trial} step ${c.s.n}: ${c.s.outHead.split(' / ')[0]}; run_action calls after it: ${later}`);
  }
  const tw = W.filter((r) => r.suite === 'tududi');
  out(
    `tududi with runs ${tw.length}; called Lightpath ${tw.filter(calledLp).length}; ok traces ${tud.length}, all of them the Login click: ${tud.every((c) => /login-submit/.test(c.s.outHead))}; runs with a trace of any action after sign-in: ${tw.filter((r) => r.stepsList.some((s) => s.outcome === 'ok' && !/login-submit/.test(s.outHead))).length}`,
  );
  out();
  out('### Q3 tududi Login traces: what fills them');
  // full outputs are needed here, so re-read them
  for (const c of tud) {
    const { calls } = readCalls(c.r.transcript);
    const o = String(calls[c.i].output ?? '');
    const ls = o.split('\n');
    const reqs = ls.filter((l) => /^request: /.test(l.trim())).length;
    const groups = ls.filter((l) => /^\S.*\[(node|browser)/.test(l)).length;
    const files = ls.filter((l) => /^\s{2}\S+\.(?:[cm]?[jt]sx?)\s*$/.test(l));
    const uniq = new Set(files.map((l) => l.trim()));
    const notShown = ls.filter((l) => /not shown/i.test(l)).map((l) => l.trim().slice(0, 160));
    out(
      `${c.r.trial}: ${o.length} chars, ${ls.length} lines, ${reqs} request lines, ${groups} request/phase groups, ${files.length} file lines (${uniq.size} distinct files: ${[...uniq].slice(0, 12).join(', ')}${uniq.size > 12 ? ', ...' : ''}); not-shown lines: ${notShown.join(' || ') || 'none'}`,
    );
  }
  out();
}

// ---------- Q4 calls that were not needed ----------

out('## Q4 runs that called Lightpath on a bug that search finds in 1-2 steps');
out(
  'steps-to-fix-file = 1-based index of the first step that reads, edits or lists in its result a file the run changed. Lightpath steps (tool_load and calls) are left out of the index for with runs, so both conditions count search steps the same way.',
);
function stepsToFix(r, skipLp) {
  let n = 0;
  for (const s of r.stepsList) {
    if (skipLp && (s.cat === 'lp_load' || s.cat === 'lightpath')) continue;
    n++;
    const touches =
      ((s.cat === 'read' || s.cat === 'edit') && r.fix.includes(s.path)) ||
      (s.hits ?? []).some((h) => r.fix.includes(h)) ||
      (s.cmdPaths ?? []).some((h) => r.fix.includes(h));
    if (touches) return n;
  }
  return null;
}
{
  const rows = [];
  const easy = [];
  for (const set of SETS)
    for (const bug of bugsOf(set)) {
      const wo = WO.filter((r) => r.set === set && r.bug === bug);
      const wi = W.filter((r) => r.set === set && r.bug === bug);
      const s = wo.map((r) => stepsToFix(r, false)).filter((x) => x !== null);
      const sw = wi
        .filter((r) => !calledLp(r))
        .map((r) => stepsToFix(r, true))
        .filter((x) => x !== null);
      const med = median(s);
      const isEasy = med <= 2;
      if (isEasy) easy.push(`${set}:${bug}`);
      rows.push([
        set,
        bug,
        JSON.stringify(wo.map((r) => stepsToFix(r, false))),
        f2(med),
        isEasy ? 'yes' : 'no',
        JSON.stringify(wi.map((r) => (calledLp(r) ? 'LP:' : '') + stepsToFix(r, true))),
      ]);
      void sw;
    }
  table(
    [
      'set',
      'bug',
      'without steps-to-fix-file per run',
      'median',
      'search-easy (median <= 2)',
      'with runs (LP: = called Lightpath), steps-to-fix-file without Lightpath steps',
    ],
    rows,
  );

  const sel = W.filter((r) => easy.includes(`${r.set}:${r.bug}`) && calledLp(r));
  const rows2 = [];
  for (const r of sel) {
    const wo = WO.filter((x) => x.set === r.set && x.bug === r.bug);
    const lpSteps = r.stepsList.filter((s) => s.cat === 'lightpath' || s.cat === 'lp_load').length;
    const lpTok = Math.round(
      (r.tokChars.lpOut + r.tokChars.lpIn + r.tokChars.lpLoadOut + r.tokChars.lpLoadIn) / 4,
    );
    rows2.push([
      r.trial,
      r.set,
      String(r.steps),
      String(lpSteps),
      String(lpTok),
      f3(r.credits),
      f3(mean(wo.map((x) => x.credits))),
      f3(r.credits - mean(wo.map((x) => x.credits))),
      f2(r.steps - mean(wo.map((x) => x.steps))),
    ]);
  }
  out(`search-easy bugs: ${easy.join(', ')}`);
  out();
  out('### Q4 with runs on search-easy bugs that called Lightpath');
  table(
    [
      'trial',
      'set',
      'steps',
      'Lightpath steps (load + calls)',
      'Lightpath tokens est.',
      'credits',
      'without mean credits',
      'extra credits vs without mean',
      'extra steps vs without mean',
    ],
    rows2,
  );
  const tot = (i) => rows2.reduce((a, x) => a + Number(x[i]), 0);
  out(
    `Q4 totals: runs ${rows2.length}; Lightpath steps ${tot(3)}; Lightpath tokens est. ${tot(4)}; extra credits vs without mean ${tot(7).toFixed(3)}; extra steps vs without mean ${tot(8).toFixed(2)}`,
  );
  const easyRunsAll = W.filter((r) => easy.includes(`${r.set}:${r.bug}`));
  out(`Q4 with runs on search-easy bugs: ${easyRunsAll.length}, of which called Lightpath ${sel.length}`);
  // stricter bar: search found the file in its first step in the without runs (median 1)
  const strict = rows.filter((x) => Number(x[3]) <= 1).map((x) => `${x[0]}:${x[1]}`);
  const sel1 = rows2.filter((x) =>
    strict.includes(`${x[1]}:${W.find((r) => r.trial === x[0] && r.set === x[1]).bug}`),
  );
  const t1 = (i) => sel1.reduce((a, x) => a + Number(x[i]), 0);
  out(
    `Q4 strict bar (without median steps-to-fix-file = 1): bugs ${strict.join(', ')}; runs that called Lightpath ${sel1.length} (${sel1.map((x) => x[0]).join(' ')}); Lightpath steps ${t1(3)}; Lightpath tokens est. ${t1(4)}; extra credits vs without mean ${t1(7).toFixed(3)}; extra steps vs without mean ${t1(8).toFixed(2)}`,
  );
  // within with: same bug, called vs not called
  out();
  out('### Q4 same bug, with runs that called Lightpath vs with runs that did not (bugs with both)');
  const rows3 = [];
  for (const set of SETS)
    for (const bug of bugsOf(set)) {
      const wi = W.filter((r) => r.set === set && r.bug === bug);
      const a = wi.filter(calledLp);
      const b = wi.filter((r) => !calledLp(r));
      if (!a.length || !b.length) continue;
      rows3.push([
        set,
        bug,
        String(a.length),
        f2(mean(a.map((r) => r.steps))),
        f3(mean(a.map((r) => r.credits))),
        String(b.length),
        f2(mean(b.map((r) => r.steps))),
        f3(mean(b.map((r) => r.credits))),
      ]);
    }
  table(['set', 'bug', 'called: runs', 'steps', 'credits', 'not called: runs', 'steps', 'credits'], rows3);
}

// ---------- Q5 tokens ----------

out('## Q5 tokens est. (D-111 chars/4): Lightpath text vs the rest, with runs');
out(
  'Lightpath text = Lightpath call results + call inputs; tool_load text = the tool_load result (tool descriptions and schemas) + its input. rest = prompt, other tool results and inputs, agent messages and thoughts.',
);
{
  const rows = [];
  for (const set of SETS) {
    const rs = W.filter((r) => r.set === set);
    const lp = rs.reduce((a, r) => a + r.tokChars.lpOut + r.tokChars.lpIn, 0) / 4;
    const ld = rs.reduce((a, r) => a + r.tokChars.lpLoadOut + r.tokChars.lpLoadIn, 0) / 4;
    const all = rs.reduce((a, r) => a + r.totalChars, 0) / 4;
    const wo = WO.filter((r) => r.set === set);
    rows.push([
      set,
      String(rs.length),
      f2(lp / rs.length),
      f2(ld / rs.length),
      f2((all - lp - ld) / rs.length),
      f2(all / rs.length),
      pct(lp, all),
      pct(ld, all),
      f2(mean(wo.map((r) => r.totalChars / 4))),
    ]);
  }
  const lp = W.reduce((a, r) => a + r.tokChars.lpOut + r.tokChars.lpIn, 0) / 4;
  const ld = W.reduce((a, r) => a + r.tokChars.lpLoadOut + r.tokChars.lpLoadIn, 0) / 4;
  const all = W.reduce((a, r) => a + r.totalChars, 0) / 4;
  rows.push([
    'all with',
    String(W.length),
    f2(lp / W.length),
    f2(ld / W.length),
    f2((all - lp - ld) / W.length),
    f2(all / W.length),
    pct(lp, all),
    pct(ld, all),
    f2(mean(WO.map((r) => r.totalChars / 4))),
  ]);
  table(
    [
      'set',
      'runs',
      'Lightpath calls tok/run',
      'tool_load tok/run',
      'rest tok/run',
      'total tok/run',
      'Lightpath share',
      'tool_load share',
      'without total tok/run',
    ],
    rows,
  );
}
out('### Q5 per with run');
table(
  [
    'trial',
    'set',
    'called',
    'tokensEst (line)',
    'Lightpath calls tok',
    'tool_load tok',
    'rest tok',
    'Lightpath+load share',
  ],
  W.map((r) => {
    const lp = (r.tokChars.lpOut + r.tokChars.lpIn) / 4;
    const ld = (r.tokChars.lpLoadOut + r.tokChars.lpLoadIn) / 4;
    return [
      r.trial,
      r.set,
      calledLp(r) ? 'yes' : 'no',
      String(r.tokensEst),
      f2(lp),
      f2(ld),
      f2(r.totalChars / 4 - lp - ld),
      pct(lp + ld, r.totalChars / 4),
    ];
  }),
);
{
  // largest single Lightpath results
  const big = lpCalls
    .map((c) => ({ trial: c.r.trial, n: c.s.n, chars: c.s.outChars, head: c.s.outHead.slice(0, 80) }))
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 10);
  out('### Q5 ten largest Lightpath results (chars)');
  for (const b of big) out(`${b.chars}\t${b.trial} step ${b.n}: ${b.head}`);
  out();
}

// ---------- Q6 runs that never called Lightpath ----------

out('## Q6 with runs that never called Lightpath vs without runs of the same bug');
{
  const nc = W.filter((r) => !calledLp(r));
  out(
    `with runs that never called Lightpath: ${nc.length}; of them with a tool_load step: ${nc.filter((r) => catCount(r, 'lp_load') > 0).length}`,
  );
  const rows = [];
  for (const set of SETS)
    for (const bug of bugsOf(set)) {
      const a = nc.filter((r) => r.set === set && r.bug === bug);
      if (!a.length) continue;
      const b = WO.filter((r) => r.set === set && r.bug === bug);
      rows.push([
        set,
        bug,
        String(a.length),
        `${a.filter((r) => r.correct).length}/${a.length}`,
        f2(mean(a.map((r) => r.steps))),
        f2(mean(a.map((r) => r.steps - catCount(r, 'lp_load')))),
        f2(mean(a.map((r) => r.tokensEst))),
        f3(mean(a.map((r) => r.credits))),
        String(b.length),
        `${b.filter((r) => r.correct).length}/${b.length}`,
        f2(mean(b.map((r) => r.steps))),
        f2(mean(b.map((r) => r.tokensEst))),
        f3(mean(b.map((r) => r.credits))),
      ]);
    }
  table(
    [
      'set',
      'bug',
      'no-call runs',
      'correct',
      'steps',
      'steps less tool_load',
      'tokens est.',
      'credits',
      'without runs',
      'correct',
      'steps',
      'tokens est.',
      'credits',
    ],
    rows,
  );
  // pooled, weighting each no-call run against its own bug's without mean
  const d = (f) =>
    mean(nc.map((r) => f(r) - mean(WO.filter((x) => x.set === r.set && x.bug === r.bug).map(f))));
  out(
    `Q6 pooled (each no-call run minus the without mean of its bug): steps ${f2(d((r) => r.steps))}; steps less tool_load ${f2(d((r) => r.steps - catCount(r, 'lp_load')))}; tokens est. ${f2(d((r) => r.tokensEst))}; credits ${f3(d((r) => r.credits))}; correct ${nc.filter((r) => r.correct).length}/${nc.length}`,
  );
  const ldTok = mean(nc.map((r) => (r.tokChars.lpLoadOut + r.tokChars.lpLoadIn) / 4));
  out(`Q6 tool_load text in no-call runs, mean tokens est.: ${f2(ldTok)}`);
  // credits per step, as a rough scale only
  out(
    `Q6 credits per step (mean of credits/steps): with no-call ${f3(mean(nc.map((r) => r.credits / r.steps)))}; without (same bugs) ${f3(mean(WO.filter((x) => nc.some((r) => r.set === x.set && r.bug === x.bug)).map((r) => r.credits / r.steps)))}`,
  );
  out();
}

// ---------- Q7 tududi h01 ----------

const h = [];
h.push('# tududi held-out h01: with and without runs, step by step');
for (const r of runs.filter((r) => r.set === 'tududi held-out' && r.bug === 'h01')) {
  h.push('');
  h.push(
    `=== ${r.trial} correct=${r.correct} steps=${r.steps} credits=${f3(r.credits)} check: ${r.checkDetail}`,
  );
  h.push(`changed: ${r.fix.join(', ')}`);
  for (const s of r.stepsList) {
    let d = '';
    if (s.cat === 'lightpath')
      d = `${JSON.stringify(s.args).slice(0, 200)} -> ${s.outcome}; ${s.outHead.slice(0, 160)}`;
    else if (s.cat === 'search') d = `${JSON.stringify(s.query ?? s.dir)} in ${s.include ?? ''}`;
    else if (s.cat === 'read' || s.cat === 'edit')
      d = `${s.path} ${s.cat === 'read' ? `offset=${s.input?.offset} limit=${s.input?.limit}` : ''}`;
    else if (s.cat === 'shell') d = s.command.slice(0, 160).replace(/\s+/g, ' ');
    h.push(`#${s.n} ${s.cat}/${s.sub} ${d}`);
    if (s.cat === 'edit') {
      h.push(`   old: ${JSON.stringify(String(s.input?.oldStr ?? '').slice(0, 600))}`);
      h.push(`   new: ${JSON.stringify(String(s.input?.newStr ?? '').slice(0, 600))}`);
    }
  }
}
out('## Q7 tududi held-out h01: see h01.txt');
{
  const rs = runs.filter((r) => r.set === 'tududi held-out' && r.bug === 'h01');
  // where the edits went: the line `setInputText(remaining.join('\n'))` (after a save) or elsewhere
  const editedRemaining = (r) =>
    r.stepsList.some((s) => s.cat === 'edit' && /remaining\.join/.test(String(s.input?.oldStr ?? '')));
  const furthestRead = (r) =>
    Math.max(
      0,
      ...r.stepsList
        .filter((s) => s.cat === 'read' && /quickcaptureinput/.test(s.path ?? ''))
        .map((s) => Number(s.input?.offset ?? 0)),
    );
  table(
    [
      'trial',
      'cond',
      'correct',
      'steps',
      'Lightpath calls',
      'ok traces',
      'edits',
      'edited the remaining.join line',
      'furthest read offset in QuickCaptureInput.tsx',
      'check',
    ],
    rs.map((r) => [
      r.trial,
      r.condition,
      String(r.correct),
      String(r.steps),
      String(catCount(r, 'lightpath')),
      String(r.stepsList.filter((s) => s.outcome === 'ok').length),
      String(r.stepsList.filter((s) => s.cat === 'edit' || (s.cat === 'shell' && s.sub === 'edit')).length),
      editedRemaining(r) ? 'yes' : 'no',
      String(furthestRead(r)),
      String(r.checkDetail),
    ]),
  );
  out(
    `h01: runs that edited the remaining.join line: ${rs.filter(editedRemaining).length}, all correct: ${rs.filter(editedRemaining).every((r) => r.correct)}; runs that did not: ${rs.filter((r) => !editedRemaining(r)).length}, correct: ${rs.filter((r) => !editedRemaining(r) && r.correct).length}`,
  );
}

// ---------- write ----------

writeFileSync(join(outDir, 'summary.txt'), lines.join('\n') + '\n');
writeFileSync(join(outDir, 'h01.txt'), h.join('\n') + '\n');
writeFileSync(
  join(outDir, 'misses.txt'),
  misses
    .map(
      (m) =>
        `${m.trial} (${m.set}) step ${m.step} ${m.tool} ${JSON.stringify(m.args)} -> ${m.outcome}\n  cause: ${m.cause}\n  page showed: ${m.closest.join(' | ') || '(no list)'}\n  retried: ${m.retried}${m.retried ? ` after ${m.stepsToRetry} steps, ok=${m.retryOk}, args ${JSON.stringify(m.retryArgs)}` : ''}; next step ${m.nextStep}`,
    )
    .join('\n\n') + '\n',
);
writeFileSync(
  join(outDir, 'runs.json'),
  JSON.stringify(
    runs.map((r) => ({
      ...r,
      prompt: undefined,
      stepsList: r.stepsList.map((s) => ({ ...s, input: undefined })),
    })),
    null,
    1,
  ),
);
console.log(
  `wrote ${outDir}: summary.txt, runs.json, misses.txt, h01.txt (${W.length} with, ${WO.length} without)`,
);
