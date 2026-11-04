import type { FileHits, FunctionHit, Trace, TracePhase } from '@lightpath-dev/protocol';

/**
 * Several traces of the same action as one (run_action `times`, D-142): requests matched by method
 * and path in order, phases by kind and request, functions by phase, file, name and lines. Calls
 * and line hits add up; a line counts as not run only when no run ran it. The id, label and
 * request details (status, time) are the last run's, so get_trace on the id shows that run.
 */
export function mergeTraces(traces: readonly Trace[]): Trace {
  const [first, ...rest] = traces;
  if (!first) throw new Error('mergeTraces needs at least one trace');
  const last = traces.at(-1) ?? first;
  const out: Trace = {
    ...first,
    id: last.id,
    label: last.label,
    ...(last.endedAt !== undefined ? { endedAt: last.endedAt } : {}),
    files: first.files.map((f) => ({ ...f, lines: f.lines.map((l) => ({ ...l })) })),
    requests: first.requests.map((r) => ({ ...r })),
    dropped: first.dropped.map((d) => ({ ...d })),
    phases: (first.phases ?? []).map((p) => ({ ...p })),
    functions: (first.functions ?? []).map((f) => copyFn(f)),
    problems: [...(first.problems ?? [])],
    problemsDropped: first.problemsDropped ?? 0,
  };
  const phases = out.phases as TracePhase[];
  const functions = out.functions as FunctionHit[];
  const fnIndex = new Map(functions.map((f, i) => [fnKey(f), i]));

  for (const t of rest) {
    // Requests: the n-th `GET /api/x` of this run is the n-th of the merged trace.
    const reqMap = new Map<number, number>();
    const usedReq = new Set<number>();
    for (const [r, req] of t.requests.entries()) {
      const j = out.requests.findIndex(
        (o, k) => !usedReq.has(k) && o.method === req.method && o.path === req.path,
      );
      if (j >= 0) {
        out.requests[j] = { ...req };
        usedReq.add(j);
        reqMap.set(r, j);
      } else {
        out.requests.push({ ...req });
        usedReq.add(out.requests.length - 1);
        reqMap.set(r, out.requests.length - 1);
      }
    }
    // Phases: same kind and the same merged request.
    const phaseMap = new Map<number, number>();
    const usedPhase = new Set<number>();
    for (const [i, p] of (t.phases ?? []).entries()) {
      const request = p.request !== undefined ? reqMap.get(p.request) : undefined;
      let j = phases.findIndex((q, k) => !usedPhase.has(k) && q.kind === p.kind && q.request === request);
      if (j < 0) {
        phases.push({ kind: p.kind, ...(request !== undefined ? { request } : {}) });
        j = phases.length - 1;
      }
      usedPhase.add(j);
      phaseMap.set(i, j);
    }
    for (const f of t.functions ?? []) {
      const moved = { ...copyFn(f), phase: phaseMap.get(f.phase) ?? f.phase };
      const at = fnIndex.get(fnKey(moved));
      const m = at !== undefined ? functions[at] : undefined;
      if (!m) {
        fnIndex.set(fnKey(moved), functions.length);
        functions.push(moved);
        continue;
      }
      m.count += f.count;
      const notRun = new Set(f.notRun ?? []);
      m.notRun = (m.notRun ?? []).filter((l) => notRun.has(l));
      const spans = new Set((f.notRunSpans ?? []).map((s) => `${s.line}:${s.startColumn}`));
      if (m.notRunSpans) m.notRunSpans = m.notRunSpans.filter((s) => spans.has(`${s.line}:${s.startColumn}`));
    }
    for (const f of t.files) {
      const m = out.files.find((o) => o.path === f.path);
      if (!m) {
        out.files.push({ ...f, lines: f.lines.map((l) => ({ ...l })) });
        continue;
      }
      mergeLines(m, f);
    }
    for (const d of t.dropped) {
      const m = out.dropped.find((o) => o.reason === d.reason);
      if (m) m.count += d.count;
      else out.dropped.push({ ...d });
    }
    out.problems?.push(...(t.problems ?? []));
    out.problemsDropped = (out.problemsDropped ?? 0) + (t.problemsDropped ?? 0);
  }
  if (!first.phases) delete out.phases;
  if (!first.functions && functions.length === 0) delete out.functions;
  return out;
}

const fnKey = (f: FunctionHit) => `${f.phase}|${f.path}|${f.name}|${f.startLine}|${f.endLine}`;

function copyFn(f: FunctionHit): FunctionHit {
  return {
    ...f,
    ...(f.notRun ? { notRun: [...f.notRun] } : {}),
    ...(f.notRunSpans ? { notRunSpans: f.notRunSpans.map((s) => ({ ...s })) } : {}),
    ...(f.unknown
      ? { unknown: f.unknown.map((u) => ({ lines: [...u.lines], threwAfter: u.threwAfter })) }
      : {}),
  };
}

function mergeLines(into: FileHits, from: FileHits): void {
  const byLine = new Map(into.lines.map((l) => [l.line, l]));
  for (const l of from.lines) {
    const m = byLine.get(l.line);
    if (m) m.count += l.count;
    else {
      const copy = { ...l };
      into.lines.push(copy);
      byLine.set(l.line, copy);
    }
  }
  into.lines.sort((a, b) => a.line - b.line);
  // Background only when every run saw it as background.
  if (!(into.background && from.background)) delete into.background;
  into.firstSeenAt = Math.min(into.firstSeenAt, from.firstSeenAt);
}
