import type { Trace } from '@lightpath-dev/protocol';
import { fitText } from './budget.js';
import { functionName, numberRanges } from './summary.js';

interface Merged {
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  count: number;
  /** Not-run lines as offsets from startLine, so a shifted function still compares. */
  notRun: Set<number>;
}

/**
 * Functions of one trace merged over phases and keyed by file, name and order among functions
 * of that name in the file. Line numbers aren't in the key: a fix moves them (D-118).
 */
function functionsOf(trace: Trace): Map<string, Merged> {
  const byFn = new Map<string, Merged>();
  for (const f of trace.functions ?? []) {
    const id = `${f.path}|${f.name}|${f.startLine}`;
    const m = byFn.get(id);
    if (m) {
      m.count += f.count;
      // Not run in every phase that ran it.
      const mine = new Set((f.notRun ?? []).map((l) => l - f.startLine));
      for (const o of m.notRun) if (!mine.has(o)) m.notRun.delete(o);
    } else {
      byFn.set(id, {
        path: f.path,
        name: f.name,
        startLine: f.startLine,
        endLine: f.endLine,
        count: f.count,
        notRun: new Set((f.notRun ?? []).map((l) => l - f.startLine)),
      });
    }
  }
  const out = new Map<string, Merged>();
  const seen = new Map<string, number>();
  for (const m of [...byFn.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine,
  )) {
    const base = `${m.path}|${m.name}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(`${base}#${n}`, m);
  }
  return out;
}

const where = (m: Merged) => `${m.path} ${functionName(m)} (line ${m.startLine})`;
const lines = (m: Merged, offsets: Iterable<number>) =>
  numberRanges([...offsets].map((o) => o + m.startLine));

/** True when both traces carry function lists, so the function-level diff applies. */
export function hasFunctions(t: Trace): boolean {
  return t.functions !== undefined;
}

/**
 * `diff_traces` at function level (design section 6.4, D-118), in this order: requests whose
 * status changed, functions that ran in only one trace, functions whose not-run lines changed
 * (each side in its own line numbers), and functions whose call count changed. Problems join in
 * build 4, when traces carry them.
 */
export function diffFunctions(a: Trace, b: Trace): string {
  const out = [`Trace ${a.id} (${a.label}) → ${b.id} (${b.label}):`];

  // Requests matched by method and path, in order.
  const statuses: string[] = [];
  const used = new Set<number>();
  for (const ra of a.requests) {
    const j = b.requests.findIndex((rb, k) => !used.has(k) && rb.method === ra.method && rb.path === ra.path);
    if (j < 0) {
      statuses.push(`  ${ra.method} ${ra.path} ${ra.status ?? '?'} → not sent`);
      continue;
    }
    used.add(j);
    const rb = b.requests[j];
    if (rb && rb.status !== ra.status)
      statuses.push(`  ${ra.method} ${ra.path} ${ra.status ?? '?'} → ${rb.status ?? '?'}`);
  }
  for (const [k, rb] of b.requests.entries())
    if (!used.has(k)) statuses.push(`  ${rb.method} ${rb.path} newly sent → ${rb.status ?? '?'}`);
  if (statuses.length) out.push('requests:', ...statuses);

  const fa = functionsOf(a);
  const fb = functionsOf(b);
  const onlyA = [...fa].filter(([k]) => !fb.has(k)).map(([, m]) => `  ${where(m)} ×${m.count}`);
  const onlyB = [...fb].filter(([k]) => !fa.has(k)).map(([, m]) => `  ${where(m)} ×${m.count}`);
  if (onlyA.length) out.push(`ran only in ${a.id}:`, ...onlyA);
  if (onlyB.length) out.push(`ran only in ${b.id}:`, ...onlyB);

  const branches: string[] = [];
  const counts: string[] = [];
  for (const [k, ma] of fa) {
    const mb = fb.get(k);
    if (!mb) continue;
    const nowRuns = [...ma.notRun].filter((o) => !mb.notRun.has(o));
    const noLonger = [...mb.notRun].filter((o) => !ma.notRun.has(o));
    if (nowRuns.length || noLonger.length) {
      const parts = [
        ...(nowRuns.length ? [`now runs ${lines(ma, nowRuns)}`] : []),
        ...(noLonger.length ? [`no longer runs ${lines(mb, noLonger)}`] : []),
      ];
      const shift = mb.startLine !== ma.startLine ? ` (line ${ma.startLine} → ${mb.startLine})` : '';
      branches.push(`  ${ma.path} ${functionName(ma)}${shift}: ${parts.join('; ')}`);
    }
    if (ma.count !== mb.count) counts.push(`  ${where(ma)}: ×${ma.count} → ×${mb.count}`);
  }
  if (branches.length) out.push('branches changed (each side in its own line numbers):', ...branches);
  if (counts.length) out.push('call counts changed:', ...counts);

  if (out.length === 1) out.push('none: both traces ran the same functions and branches');
  return fitText(out.join('\n'));
}
