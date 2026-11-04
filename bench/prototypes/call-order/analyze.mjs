// Turns harness runs into the call-order study's numbers (docs/research/call-order.md).
// Usage: node bench/prototypes/call-order/analyze.mjs --raw <dir> [--conditions P,G0,A,B,C,E]
//
// For each condition it prints one line per number, and writes the sample outputs of the first
// timed run (function summary, describeTrace, slices) next to the raw runs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = (pkg) => new URL(`../../../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { LineIndex, mapScript, decodeDataUrlSourceMap, resolveFile } = await import(dist('core'));
const { describeTrace, lineRanges } = await import(dist('mcp'));
const require = createRequire(new URL('../../../packages/core/package.json', import.meta.url));
const { TraceMap, originalPositionFor, LEAST_UPPER_BOUND } = require('@jridgewell/trace-mapping');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const raw = arg('--raw');
const conditions = arg('--conditions', 'P,G0,A,B,C,E').split(',');
const BUDGET_CHARS = 16_000;

// ---------------------------------------------------------------------------------------------
// stats
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const q = (xs, p) => {
  const s = sorted(xs);
  if (s.length === 0) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const stat = (xs) =>
  `n=${xs.length} p50=${f2(q(xs, 0.5))} p95=${f2(q(xs, 0.95))} mean=${f2(mean(xs))} sd=${f2(sd(xs))} min=${f2(Math.min(...xs))} max=${f2(Math.max(...xs))}`;

const push = (o, k, ...vs) => {
  if (!o[k]) o[k] = [];
  o[k].push(...vs);
};

// ---------------------------------------------------------------------------------------------
// mapping generated positions to workspace file:line
function loadScripts(cond) {
  const s = JSON.parse(readFileSync(join(raw, `scripts-${cond}.json`), 'utf8'));
  const ctx = { workspaceRoots: [s.appRoot], devServers: [{ origin: s.origin, root: s.appRoot }] };
  const byId = new Map();
  const byUrl = new Map();
  for (const sc of s.scripts) {
    const entry = { ...sc, index: new LineIndex(sc.source ?? '') };
    if (sc.sourceMapURL) {
      entry.map = decodeDataUrlSourceMap(sc.sourceMapURL);
      entry.tracer = new TraceMap(entry.map, sc.url);
    }
    const r = resolveFile(sc.url, ctx);
    entry.path = r.kind === 'workspace' ? r.path : undefined;
    byId.set(`${sc.agent}|${sc.scriptId}`, entry);
    byUrl.set(sc.url, entry);
  }
  return { ...s, ctx, byId, byUrl };
}

/** Workspace file and 1-based line for a 0-based generated line and column. */
function origLC(S, script, line0, col, upper = false) {
  if (!script) return undefined;
  if (!script.tracer) return script.path ? { path: script.path, line: line0 + 1, col } : undefined;
  let p = originalPositionFor(script.tracer, {
    line: line0 + 1,
    column: col,
    ...(upper ? { bias: LEAST_UPPER_BOUND } : {}),
  });
  if (p.source == null)
    p = originalPositionFor(script.tracer, { line: line0 + 1, column: col, bias: LEAST_UPPER_BOUND });
  if (p.source == null) return undefined;
  const r = resolveFile(p.source, S.ctx);
  return r.kind === 'workspace' ? { path: r.path, line: p.line, col: p.column } : undefined;
}
function origOffset(S, script, offset, upper = false) {
  const line0 = script.index.lineOf(offset);
  return origLC(S, script, line0, offset - script.index.lineStart(line0), upper);
}
const isLog = (path) => !path || path.endsWith('lp-log.ts');

// ---------------------------------------------------------------------------------------------
// function table and line counts of one run's coverage
function analyzeCoverage(S, deltas) {
  /** key -> { name, path, start, end, calls, side } */
  const fns = new Map();
  /** path -> Map(line -> count) (max over deltas; 0 = known not run) */
  const lines = new Map();
  const zeroBlocks = [];
  for (const d of deltas) {
    for (const cov of d.coverage) {
      const script = S.byId.get(`${d.agentId}|${cov.scriptId}`);
      if (!script) continue;
      const full = mapScript(
        { coverage: cov, source: script.source, ...(script.map ? { sourceMap: script.map } : {}) },
        S.ctx,
      );
      for (const [path, lc] of full.files) {
        if (isLog(path)) continue;
        const m = lines.get(path) ?? new Map();
        for (const [l, c] of lc) m.set(l, Math.max(m.get(l) ?? 0, c));
        lines.set(path, m);
      }
      for (const fn of cov.functions) {
        const top = fn.ranges[0];
        if (top.count === 0 || top.startOffset === 0) continue; // not run, or the module itself
        const at = origOffset(S, script, top.startOffset);
        if (!at || isLog(at.path)) continue;
        const one = mapScript(
          {
            coverage: { ...cov, functions: [fn] },
            source: script.source,
            ...(script.map ? { sourceMap: script.map } : {}),
          },
          S.ctx,
        );
        const own = one.files.get(at.path);
        const end = own?.size ? Math.max(...own.keys()) : at.line;
        const key = `${at.path}:${at.line}`;
        for (const b of fn.ranges.slice(1)) {
          if (b.count !== 0) continue;
          // Upper bound: a block starts after the token before it, e.g. the else arm after ":".
          const s = origOffset(S, script, b.startOffset, true);
          const e = origOffset(S, script, Math.max(b.startOffset, b.endOffset - 1));
          if (s && e && s.path === at.path)
            zeroBlocks.push({ path: at.path, start: s.line, end: e.line, sc: s.col, ec: e.col });
        }
        const prev = fns.get(key);
        if (prev) prev.calls += top.count;
        else
          fns.set(key, {
            key,
            name: fn.functionName || '(anonymous)',
            path: at.path,
            start: at.line,
            end,
            calls: top.count,
            side: d.agentId,
          });
      }
    }
  }
  return { fns, lines, zeroBlocks };
}

/** Lines in [start, end] known not to have run, as "a-b, c". */
function notRun(lineCounts, start, end) {
  const zero = [];
  for (let l = start; l <= end; l++) if (lineCounts?.get(l) === 0) zero.push({ line: l, count: 1 });
  return zero.length ? lineRanges(zero) : '';
}

// ---------------------------------------------------------------------------------------------
// output formats measured against the budget
function functionSummary(trace, cov) {
  const out = [`Trace ${trace.id}: ${trace.label}`];
  for (const r of trace.requests)
    out.push(
      `  request: ${r.method} ${r.path}${r.status ? ` → ${r.status}` : ''} (${r.collector}, ${Math.round(r.durationMs)} ms)`,
    );
  const byFile = new Map();
  for (const f of cov.fns.values()) byFile.set(f.path, [...(byFile.get(f.path) ?? []), f]);
  for (const [path, list] of byFile) {
    out.push(`  ${path} [${list[0].side === 'browser' ? 'browser' : 'node'}]`);
    for (const f of list.sort((a, b) => a.start - b.start)) {
      const nr = notRun(cov.lines.get(path), f.start, f.end);
      out.push(`    ${f.name} ${f.start}-${f.end} ×${f.calls}${nr ? ` not run: ${nr}` : ''}`);
    }
  }
  return out.join('\n');
}

function slices(cov, sourceOf, withinLine = false) {
  const out = [];
  const byFile = new Map();
  for (const f of cov.fns.values()) byFile.set(f.path, [...(byFile.get(f.path) ?? []), f]);
  for (const [path, list] of byFile) {
    const text = sourceOf(path);
    if (!text) continue;
    const src = text.split(/\r?\n/);
    const counts = cov.lines.get(path) ?? new Map();
    // Outermost functions only; nested ones are inside their range.
    const tops = list
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .filter((f, i, all) => !all.slice(0, i).some((o) => o.start <= f.start && o.end >= f.end && o !== f));
    out.push(`${path}`);
    for (const f of tops) {
      let gap = [];
      const flush = () => {
        if (gap.length)
          out.push(
            `      // not run: ${gap.length === 1 ? `line ${gap[0]}` : `lines ${gap[0]}-${gap.at(-1)}`}`,
          );
        gap = [];
      };
      for (let l = f.start; l <= f.end; l++) {
        const c = counts.get(l);
        if (c === 0) {
          gap.push(l);
          continue;
        }
        if (c === undefined) continue; // blank or comment: no coverage information
        flush();
        // An untaken block inside a line that ran (`?? []`, a ternary arm): name its text.
        const inLine = withinLine
          ? cov.zeroBlocks.filter(
              (b) => b.path === path && b.start === l && b.end === l && b.sc !== undefined,
            )
          : [];
        const marks = inLine.map((b) => {
          const tail = src[l - 1].slice(b.ec).match(/^[\w$'"`.\])]+/)?.[0].length ?? 1;
          return src[l - 1]
            .slice(b.sc, b.ec + tail)
            .trim()
            .slice(0, 40);
        });
        out.push(
          `${String(l).padStart(4)}  ${src[l - 1]}${marks.length ? `  // not run: ${marks.join(', ')}` : ''}`,
        );
      }
      flush();
      out.push('  ...');
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// call order: ground truth and scoring
function groundTruth(run) {
  const all = [
    ...run.groundTruth.browser.map(([k, t]) => ({ k, t, side: 'browser' })),
    ...run.groundTruth.node.map(([k, t]) => ({ k, t, side: 'node' })),
  ].sort((a, b) => a.t - b.t);
  const first = new Map();
  for (const e of all) if (!first.has(e.k)) first.set(e.k, e);
  const nodeTs = run.groundTruth.node.map(([, t]) => t);
  return {
    order: [...first.keys()],
    first,
    calls: all,
    nodeStart: Math.min(...nodeTs),
    nodeEnd: Math.max(...nodeTs),
  };
}

/** rank: key -> number (equal numbers = not ordered). keys: ground-truth keys in first-call order. */
function score(rank, keys) {
  const placed = keys.filter((k) => rank.has(k));
  const missed = keys.filter((k) => !rank.has(k));
  let pairs = 0;
  let resolved = 0;
  let correct = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      pairs++;
      const a = rank.get(keys[i]);
      const b = rank.get(keys[j]);
      if (a === undefined || b === undefined || a === b) continue;
      resolved++;
      if (a < b) correct++;
    }
  }
  return { n: keys.length, placed: placed.length, pairs, resolved, correct, missed };
}

/** The function in the table that contains file:line most tightly. */
function containing(fns, path, line) {
  let best;
  for (const f of fns.values()) {
    if (f.path !== path || f.start > line || f.end < line) continue;
    if (!best || f.end - f.start < best.end - best.start) best = f;
  }
  return best?.key;
}

function rankFromProfile(S, profile, fns, side) {
  if (!profile) return new Map();
  const parent = new Map();
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const keyOf = new Map();
  const nodeKey = (n) => {
    if (keyOf.has(n.id)) return keyOf.get(n.id);
    const cf = n.callFrame;
    let key;
    let script = S.byUrl.get(cf.url);
    if (!script && side === 'browser')
      script = [...S.byUrl.values()].find(
        (s) => s.agent === 'browser' && s.url.split('?')[0] === cf.url.split('?')[0],
      );
    if (script && cf.lineNumber >= 0) {
      const at = origLC(S, script, cf.lineNumber, cf.columnNumber);
      if (at && !isLog(at.path))
        key = fns.has(`${at.path}:${at.line}`) ? `${at.path}:${at.line}` : containing(fns, at.path, at.line);
    }
    keyOf.set(n.id, key);
    return key;
  };
  const rank = new Map();
  let _t = 0;
  profile.samples.forEach((id, i) => {
    _t += profile.timeDeltas[i] ?? 0;
    const stack = [];
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) stack.unshift(nodes.get(cur));
    stack.forEach((n, depth) => {
      const k = nodeKey(n);
      if (k && !rank.has(k)) rank.set(k, i * 1000 + depth);
    });
  });
  return rank;
}

// ---------------------------------------------------------------------------------------------
const say = (s) => {
  console.log(s);
  lines.push(s);
};
const lines = [];
const g0 = {};
for (const cond of conditions) {
  const file = join(raw, `runs-${cond}.jsonl`);
  if (!existsSync(file)) {
    say(`[${cond}] no runs file`);
    continue;
  }
  const S = loadScripts(cond);
  const runs = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .filter((r) => !r.warmup);
  const sourceOf = (path) => {
    // Slices print the original shop's text (the ground-truth copy has the same line numbers).
    const p = fileURLToPath(new URL(`../../../examples/shop/${path}`, import.meta.url));
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  };
  say(
    `[${cond}] runs=${runs.length} boundary=${[...new Set(runs.map((r) => r.boundary))].join('/')} busyDuringRun ${stat(runs.map((r) => r.busyPctDuringRun))}`,
  );
  say(`[${cond}] pausedMs ${stat(runs.map((r) => r.pausedMs))}`);
  say(`[${cond}] visibleMs ${stat(runs.map((r) => r.visibleMs))}`);
  say(
    `[${cond}] requestMs(daemon, whole ms) ${stat(runs.map((r) => r.trace.requests[0]?.durationMs ?? NaN))}`,
  );

  const sizes = { describe: [], summary: [], slices: [] };
  const sc = {};
  const add = (name, s) => {
    sc[name] ??= {
      n: 0,
      placed: 0,
      pairs: 0,
      resolved: 0,
      correct: 0,
      runs: 0,
      placedShares: [],
      correctShares: [],
    };
    const o = sc[name];
    for (const k of ['n', 'placed', 'pairs', 'resolved', 'correct']) o[k] += s[k];
    if (o.runs === 0) o.missed = s.missed;
    o.runs++;
    o.placedShares.push(s.placed / Math.max(1, s.n));
    o.correctShares.push(s.resolved ? s.correct / s.resolved : NaN);
  };
  const gtSpans = { browser: [], node: [], calls: [], fns: [] };
  const readMs = {};
  let firstMissing;
  runs.forEach((run, idx) => {
    const finalDeltas = run.deltas;
    const cov = analyzeCoverage(S, finalDeltas);
    const d = describeTrace(run.trace);
    const s = functionSummary(run.trace, cov);
    const sl = slices(cov, sourceOf);
    sizes.describe.push(d.length);
    sizes.summary.push(s.length);
    sizes.slices.push(sl.length);
    const sl2 = slices(cov, sourceOf, true);
    push(sizes, 'slicesWithinLine', sl2.length);
    const marked = cov.zeroBlocks.filter((b) => {
      for (let l = b.start; l <= b.end; l++) if (cov.lines.get(b.path)?.get(l) === 0) return true;
      return false;
    });
    push(sizes, 'zeroBlocks', cov.zeroBlocks.length);
    push(sizes, 'zeroBlocksMarked', marked.length);
    if (idx === 0)
      say(
        `[${cond}] untaken blocks run 1, not marked by line slices: [${cov.zeroBlocks
          .filter((b) => !marked.includes(b))
          .map((b) => `${b.path}:${b.start}-${b.end}`)
          .join(', ')}]`,
      );
    if (idx === 0) {
      writeFileSync(join(raw, `sample-${cond}-describeTrace.txt`), `${d}\n`);
      writeFileSync(join(raw, `sample-${cond}-summary.txt`), `${s}\n`);
      writeFileSync(join(raw, `sample-${cond}-slices.txt`), `${sl}\n`);
      writeFileSync(join(raw, `sample-${cond}-slices-within-line.txt`), `${sl2}\n`);
    }
    if (cond === 'P') return;

    const gt = groundTruth(run);
    gtSpans.browser.push(
      Math.max(...run.groundTruth.browser.map((e) => e[1])) -
        Math.min(...run.groundTruth.browser.map((e) => e[1])),
    );
    gtSpans.node.push(gt.nodeEnd - gt.nodeStart);
    gtSpans.calls.push(gt.calls.length);
    gtSpans.fns.push(gt.order.length);
    for (const s of run.handlerStacks ?? []) {
      push(readMs, 'handlerStackMs', s.ms);
      push(readMs, 'handlerStackAppFrames', s.appFrames.length);
      if (idx === 0)
        say(
          `[${cond}] (d) stack at createOrder, run 1: ${s.frames} frames, app frames [${s.appFrames.join(' | ')}]`,
        );
    }
    const sideKeys = (side) => gt.order.filter((k) => gt.first.get(k).side === side);
    // Do the coverage function keys match the ground-truth keys? (they must, for scoring to mean anything)
    const missing = gt.order.filter((k) => !cov.fns.has(k));
    if (idx === 0) firstMissing = { missing, extra: [...cov.fns.keys()].filter((k) => !gt.first.has(k)) };

    // existing pipeline: one browser delta + one Node delta; sides only, no order inside a side.
    const existing = new Map([...cov.fns.values()].map((f) => [f.key, 0]));
    add('existing: two deltas, no order', score(existing, gt.order));

    // (a) phases from more coverage reads (condition A): request-sent | node | response-arrived | rest
    if (cond === 'A') {
      const phase = new Map();
      const phases = [
        [run.reads.find((r) => r.name === 'request-sent'), 'browser'],
        [null, 'node'],
        [run.reads.find((r) => r.name === 'response-arrived'), 'browser'],
        ['final', 'browser'],
      ];
      phases.forEach(([read, side], p) => {
        let ds;
        if (side === 'node') ds = run.deltas.filter((x) => x.agentId === 'node');
        else if (read === 'final') ds = run.deltas.filter((x) => x.agentId === 'browser');
        else ds = read ? [{ agentId: 'browser', coverage: read.coverage }] : [];
        for (const k of analyzeCoverage(S, ds).fns.keys()) if (!phase.has(k)) phase.set(k, p);
      });
      add('(a) phases from 2 more reads', score(phase, gt.order));
      for (const r of run.reads) {
        push(readMs, r.name, r.ms);
        push(
          readMs,
          `appFnsIn-${r.name}`,
          analyzeCoverage(S, [{ agentId: 'browser', coverage: r.coverage }]).fns.size,
        );
      }
      // The press read happens before any app code, so the 'request-sent' phase is all of the
      // frontend before the request: how many ground-truth browser functions ran before it?
      const before = sideKeys('browser').filter((k) => gt.first.get(k).t < gt.nodeStart).length;
      push(readMs, 'gtBrowserFnsBeforeRequest', before);
    }
    // (b) initiator stack of the fetch (condition B)
    if (cond === 'B') {
      const rank = new Map();
      const frames = [];
      for (let st = run.initiators[0]?.initiator?.stack; st; st = st.parent) frames.push(...st.callFrames);
      frames.reverse().forEach((cf, i) => {
        const script =
          S.byUrl.get(cf.url) ??
          [...S.byUrl.values()].find((x) => x.url.split('?')[0] === cf.url.split('?')[0]);
        const at = script ? origLC(S, script, cf.lineNumber, cf.columnNumber) : undefined;
        const k = at && !isLog(at.path) ? containing(cov.fns, at.path, at.line) : undefined;
        if (k && !rank.has(k)) rank.set(k, i);
      });
      add('(b) initiator stack, browser', score(rank, sideKeys('browser')));
      push(readMs, 'initiatorFrames', frames.length);
      push(readMs, 'initiatorAppFns', rank.size);
      if (idx === 0)
        writeFileSync(join(raw, 'sample-B-initiator.json'), JSON.stringify(run.initiators, null, 1));
    }
    // (c) sampling profiler (condition C)
    if (cond === 'C') {
      const br = rankFromProfile(S, run.profile, cov.fns, 'browser');
      add('(c) sampling 100us, browser', score(br, sideKeys('browser')));
      const nodeRank = new Map();
      let offset = 0;
      for (const p of run.nodeProfiles ?? []) {
        for (const [k, v] of rankFromProfile(S, p.profile, cov.fns, 'node'))
          if (!nodeRank.has(k)) nodeRank.set(k, offset + v);
        offset += 1e9;
      }
      add('(c) sampling 100us, node', score(nodeRank, sideKeys('node')));
      push(readMs, 'browserSamples', run.profile.samples.length);
      push(
        readMs,
        'nodeSamples',
        (run.nodeProfiles ?? []).reduce((a, p) => a + p.profile.samples.length, 0),
      );
      push(readMs, 'nodeProfileStopMs', ...(run.nodeProfiles ?? []).map((p) => p.stopMs));
    }
    // (e) a breakpoint at every app function in the page (condition E)
    if (cond === 'E') {
      const bp = new Map(S.bpKeys);
      const rank = new Map();
      run.hits.forEach((h, i) => {
        for (const id of h.ids) {
          const b = bp.get(id);
          const script = b && S.byId.get(`browser|${b.scriptId}`);
          const at = script ? origOffset(S, script, b.offset) : undefined;
          const k = at ? `${at.path}:${at.line}` : undefined;
          if (k && !rank.has(k)) rank.set(k, i);
        }
      });
      add('(e) breakpoint per function, browser', score(rank, sideKeys('browser')));
      if (idx === 0) {
        const set = [...bp.values()].map((b) => {
          const sc = S.byId.get(`browser|${b.scriptId}`);
          const at = sc && origOffset(S, sc, b.offset);
          return at ? `${at.path}:${at.line}` : '?';
        });
        say(`[E] breakpoints set: ${set.length}, on [${[...new Set(set)].sort().join(', ')}]`);
      }
      push(readMs, 'breakpointHits', run.hits.length);
    }
    // within-side scores of the existing data, for comparison
    add(
      'existing, browser only',
      score(new Map(sideKeys('browser').map((k) => [k, 0])), sideKeys('browser')),
    );
  });
  say(
    `[${cond}] chars describeTrace ${stat(sizes.describe)} (chars/4 p50=${q(sizes.describe, 0.5) / 4}) fits ${BUDGET_CHARS}: ${Math.max(...sizes.describe) <= BUDGET_CHARS}`,
  );
  say(
    `[${cond}] chars functionSummary ${stat(sizes.summary)} (chars/4 p50=${q(sizes.summary, 0.5) / 4}) fits ${BUDGET_CHARS}: ${Math.max(...sizes.summary) <= BUDGET_CHARS}`,
  );
  say(
    `[${cond}] chars slices with within-line marks ${stat(sizes.slicesWithinLine)} (chars/4 p50=${q(sizes.slicesWithinLine, 0.5) / 4}) fits ${BUDGET_CHARS}: ${Math.max(...sizes.slicesWithinLine) <= BUDGET_CHARS}`,
  );
  say(
    `[${cond}] chars slices ${stat(sizes.slices)} (chars/4 p50=${q(sizes.slices, 0.5) / 4}) fits ${BUDGET_CHARS}: ${Math.max(...sizes.slices) <= BUDGET_CHARS}`,
  );
  say(
    `[${cond}] untaken blocks in executed functions ` +
      stat(sizes.zeroBlocks) +
      `; marked by a not-run line ` +
      stat(sizes.zeroBlocksMarked),
  );
  if (cond === 'P') continue;
  say(`[${cond}] groundTruth calls/click ${stat(gtSpans.calls)}; distinct functions ${stat(gtSpans.fns)}`);
  say(`[${cond}] groundTruth browser span ms ${stat(gtSpans.browser)}; node span ms ${stat(gtSpans.node)}`);
  if (firstMissing)
    say(
      `[${cond}] key check run 1: in ground truth but not in coverage: [${firstMissing.missing.join(', ')}]; in coverage but not logged: [${firstMissing.extra.join(', ')}]`,
    );
  for (const [name, o] of Object.entries(sc)) {
    say(
      `[${cond}] order ${name}: placed ${o.placed}/${o.n} (${f2((100 * o.placed) / o.n)}%, per-run min ${f2(100 * Math.min(...o.placedShares))}%), ` +
        `pairs ordered ${o.resolved}/${o.pairs} (${f2((100 * o.resolved) / o.pairs)}%), correct ${o.correct}/${o.resolved} (${f2((100 * o.correct) / Math.max(1, o.resolved))}%) over ${o.runs} runs; not placed in run 1: [${o.missed.join(', ')}]`,
    );
  }
  for (const [k, v] of Object.entries(readMs)) say(`[${cond}] ${k} ${stat(v)}`);
  if (cond === 'G0')
    Object.assign(g0, {
      visible: q(
        runs.map((r) => r.visibleMs),
        0.5,
      ),
    });
}
writeFileSync(join(raw, `analysis-${conditions.join('-')}.txt`), `${lines.join('\n')}\n`);
