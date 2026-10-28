import type { LineHit, Trace, TraceSummary } from '@lightpath-dev/protocol';

/** Compresses sorted line numbers into ranges: [1,2,3,7,9,10] → "1-3, 7, 9-10". */
export function lineRanges(lines: readonly LineHit[]): string {
  const parts: string[] = [];
  let start: number | undefined;
  let prev: number | undefined;
  for (const { line } of lines) {
    if (start === undefined) start = line;
    else if (prev !== undefined && line !== prev + 1) {
      parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = line;
    }
    prev = line;
  }
  if (start !== undefined && prev !== undefined) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}

/** A compact, agent-readable description of one trace. */
export function describeTrace(trace: Trace): string {
  const out = [`Trace ${trace.id}: ${trace.label}`];
  for (const r of trace.requests) {
    out.push(
      `  request: ${r.method} ${r.path}${r.status ? ` → ${r.status}` : ''} (${r.collector}, ${Math.round(r.durationMs)} ms${r.overlapped ? ', overlapped with another request' : ''})`,
    );
  }
  if (trace.files.length === 0) out.push('  no workspace code ran');
  for (const f of trace.files) {
    const hottest = Math.max(...f.lines.map((l) => l.count));
    out.push(
      `  ${f.path} [${f.collector}] lines ${lineRanges(f.lines)}${hottest > 1 ? ` (max ${hottest} hits)` : ''}`,
    );
  }
  const dropped = trace.dropped.filter((d) => d.count > 0);
  if (dropped.length > 0) out.push(`  not shown: ${dropped.map((d) => `${d.count} ${d.reason}`).join(', ')}`);
  return out.join('\n');
}

export function describeSummaries(traces: readonly TraceSummary[]): string {
  if (traces.length === 0) return 'No traces yet. Click something in the app opened by `lightpath dev`.';
  return traces
    .map((t) => `${t.id}  ${new Date(t.startedAt).toISOString()}  ${t.label}  (${t.fileCount} files)`)
    .join('\n');
}

/** Lines that ran in only one of two traces, per file. */
export function diffTraces(a: Trace, b: Trace): string {
  const index = (t: Trace) => new Map(t.files.map((f) => [f.path, new Set(f.lines.map((l) => l.line))]));
  const ia = index(a);
  const ib = index(b);
  const out = [`Lines that ran in only one of ${a.id} (${a.label}) and ${b.id} (${b.label}):`];
  for (const path of [...new Set([...ia.keys(), ...ib.keys()])].sort()) {
    const la = ia.get(path) ?? new Set<number>();
    const lb = ib.get(path) ?? new Set<number>();
    const onlyA = [...la].filter((l) => !lb.has(l)).sort((x, y) => x - y);
    const onlyB = [...lb].filter((l) => !la.has(l)).sort((x, y) => x - y);
    const fmt = (ls: number[]) => lineRanges(ls.map((line) => ({ line, count: 1 })));
    if (onlyA.length) out.push(`  ${path}: only in A: ${fmt(onlyA)}`);
    if (onlyB.length) out.push(`  ${path}: only in B: ${fmt(onlyB)}`);
  }
  return out.length === 1 ? `${out[0]}\n  none, both traces ran the same lines` : out.join('\n');
}
