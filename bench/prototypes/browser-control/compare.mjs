// Compares every run in <out>/runs with the human-style press (pw-mouse-hold, headless): same label,
// same files, same lit lines, boundary at the press, the request, and the response handling
// (Cart.tsx line 26, "Order #… placed"). Writes <out>/summary.json and <out>/summary.md.
//
// Usage: node bench/prototypes/browser-control/compare.mjs [--out dir]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'browser-raw');
const runsDir = join(outDir, 'runs');
const read = (f) =>
  readFileSync(join(runsDir, f), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const pct = (values, p) => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1))];
};
const mode = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const lit = (files, path, line) => {
  const f = files?.find((x) => x.startsWith(`${path} `));
  if (!f) return false;
  const ranges = f.slice(f.lastIndexOf('] ') + 2).split(', ');
  return ranges.some((r) => {
    const [a, b = a] = r.split('-').map(Number);
    return line >= a && line <= b;
  });
};

const ref = read('pw-mouse-hold-headless.jsonl').filter((r) => r.kind === 'action');
const refFiles = {
  add: mode(ref.filter((r) => r.action === 'add').map((r) => JSON.stringify(r.files))),
  checkout: mode(ref.filter((r) => r.action === 'checkout').map((r) => JSON.stringify(r.files))),
};
const refLabel = { add: 'button: Add to cart', checkout: 'button: Checkout' };

const summary = [];
for (const f of readdirSync(runsDir).filter((x) => x.endsWith('.jsonl'))) {
  const rows = read(f);
  const start = rows.find((r) => r.kind === 'start');
  const end = rows.find((r) => r.kind === 'end');
  const effects = rows.filter((r) => r.kind === 'effect');
  for (const action of ['add', 'checkout']) {
    const acts = rows.filter((r) => r.kind === 'action' && r.action === action);
    const withTrace = acts.filter((r) => r.traceId && !r.noNode);
    const ready = withTrace.map((r) => r.readyMs).filter((v) => v !== null && v !== undefined);
    const sameFiles = withTrace.filter((r) => JSON.stringify(r.files) === refFiles[action]).length;
    const sameFileSet = withTrace.filter(
      (r) =>
        JSON.stringify(r.files.map((x) => x.split(' [')[0])) ===
        JSON.stringify(JSON.parse(refFiles[action]).map((x) => x.split(' [')[0])),
    ).length;
    summary.push({
      run: f.replace('.jsonl', ''),
      action,
      n: acts.length,
      errors: acts.filter((r) => r.error || r.isError).length,
      traces: withTrace.length,
      // A trace opened but never got what it needed in 10 s (for Checkout: no backend file).
      incomplete: acts.filter((r) => r.noNode || (!r.traceId && r.newTraces > 0)).length,
      extraTraces: acts.reduce((s, r) => s + Math.max(0, (r.newTraces ?? 0) - 1), 0),
      labelSame: withTrace.filter((r) => r.label === refLabel[action]).length,
      labelKey: withTrace.filter((r) => r.label?.startsWith(`${refLabel[action]} (`)).length,
      boundaryPress: withTrace.filter((r) => r.boundary === 'press').length,
      emptyTraces: withTrace.filter((r) => r.files.length === 0).length,
      sameFileSet,
      sameFilesAndLines: sameFiles,
      ...(action === 'checkout'
        ? {
            request201: withTrace.filter((r) => r.requests?.includes('POST /api/orders 201')).length,
            responseLine26: withTrace.filter((r) => lit(r.files, 'src/Cart.tsx', 26)).length,
            appPlaced: effects.filter((e) => e.placed).length,
          }
        : { appAdded: effects.filter((e) => e.added).length }),
      readyP50: pct(ready, 50),
      readyP95: pct(ready, 95),
      pauseP50: pct(withTrace.map((r) => r.pauseMs).filter(Boolean), 50),
      cpuStart: start?.cpuStart,
      cpuEnd: end?.cpuEnd,
      notices: end?.notices?.length ?? 0,
    });
  }
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ refFiles, summary }, null, 2));
const cols = [...new Set(summary.flatMap((s) => Object.keys(s)))].filter((c) => c !== 'cpuStart');
const md = [
  `| ${cols.join(' | ')} | cpuStart |`,
  `| ${cols.map(() => '---').join(' | ')} | --- |`,
  ...summary.map((s) => `| ${cols.map((c) => s[c] ?? '').join(' | ')} | ${JSON.stringify(s.cpuStart)} |`),
].join('\n');
writeFileSync(join(outDir, 'summary.md'), `${md}\n`);
console.log(md);
