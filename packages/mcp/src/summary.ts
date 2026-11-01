import type { FileHits, FunctionHit, Trace, TracePhase, TraceRequest } from '@lightpath-dev/protocol';
import { type FileBlock, fit, type SummaryParts } from './budget.js';

const MAX_REQUEST_LINES = 20;

/** Sorted line numbers as ranges: [1,2,3,7] → "1-3, 7". */
export function numberRanges(lines: readonly number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | undefined;
  let prev: number | undefined;
  for (const l of sorted) {
    if (start === undefined) start = l;
    else if (prev !== undefined && l !== prev + 1) {
      parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = l;
    }
    prev = l;
  }
  if (start !== undefined && prev !== undefined) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}

export const requestLine = (r: TraceRequest) =>
  `${r.method} ${r.path}${r.status ? ` → ${r.status}` : ''} (${r.collector}, ${Math.round(r.durationMs)} ms${r.overlapped ? ', overlapped with another request' : ''})`;

/** The title of one phase: `before POST /api/orders [browser]`, `POST /api/orders [node, 3 ms]`. */
export function phaseTitle(trace: Trace, phase: TracePhase): string {
  const r = phase.request !== undefined ? trace.requests[phase.request] : undefined;
  switch (phase.kind) {
    case 'before-request':
      return r ? `before ${r.method} ${r.path} [browser]` : 'before a request [browser]';
    case 'backend':
      return r
        ? `${r.method} ${r.path}${r.status ? ` → ${r.status}` : ''} [${r.collector}, ${Math.round(r.durationMs)} ms]`
        : 'a request [backend]';
    case 'after-response':
      return 'after the response [browser]';
    case 'browser':
      return 'in the browser [browser]';
  }
}

export const functionName = (f: Pick<FunctionHit, 'name'>) => f.name || '(anonymous)';

/** `checkout 21-33 ×1 not run: 29`. */
export function functionLine(f: FunctionHit): string {
  const range = f.startLine === f.endLine ? `${f.startLine}` : `${f.startLine}-${f.endLine}`;
  const calls = f.count > 0 ? `×${f.count}` : 'resumed';
  const notRun = f.notRun?.length ? ` not run: ${numberRanges(f.notRun)}` : '';
  return `${functionName(f)} ${range} ${calls}${notRun}`;
}

const litRanges = (f: FileHits) => numberRanges(f.lines.map((l) => l.line));

/**
 * The default trace text (design section 6.1, D-116): header lines, then one block per phase with
 * its files and their functions in line order, cut to 16,000 characters by `fit()`.
 * `extraHeader` goes after the first line (run_action's action, page and warning lines).
 */
export function summarizeTrace(trace: Trace, extraHeader: readonly string[] = []): string {
  const header = [`Trace ${trace.id}: ${trace.label}`, ...extraHeader];
  for (const r of trace.requests.slice(0, MAX_REQUEST_LINES)) header.push(`request: ${requestLine(r)}`);
  if (trace.requests.length > MAX_REQUEST_LINES)
    header.push(`+${trace.requests.length - MAX_REQUEST_LINES} more requests`);
  if (trace.files.length === 0) header.push('no workspace code ran');
  header.push('');

  const fileOf = new Map(trace.files.map((f) => [f.path, f]));
  const phases = trace.phases ?? [];
  const sections: SummaryParts['sections'] = phases.map((p) => ({ title: phaseTitle(trace, p), files: [] }));
  const byPhase = new Map<number, Map<string, FunctionHit[]>>();
  for (const fn of trace.functions ?? []) {
    let files = byPhase.get(fn.phase);
    if (!files) byPhase.set(fn.phase, (files = new Map()));
    files.set(fn.path, [...(files.get(fn.path) ?? []), fn]);
  }
  const placed = new Set<string>();
  const order = (paths: Iterable<string>) =>
    [...paths].sort((a, b) => {
      const fa = fileOf.get(a);
      const fb = fileOf.get(b);
      const bg = Number(Boolean(fa?.background)) - Number(Boolean(fb?.background));
      return bg || (fa?.firstSeenAt ?? 0) - (fb?.firstSeenAt ?? 0) || a.localeCompare(b);
    });
  for (const [i, files] of byPhase) {
    const section = sections[i];
    if (!section) continue;
    for (const path of order(files.keys())) {
      const fns = (files.get(path) ?? []).sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
      const bg = fileOf.get(path)?.background ? ' (background)' : '';
      section.files.push({
        path,
        lines: [`  ${path}${bg}`, ...fns.map((f) => `    ${functionLine(f)}`)],
        functions: fns.length,
      });
      placed.add(path);
    }
  }

  // Files with no function list (Python lines, or code outside any function): by line range, in
  // the phase their collector belongs to, else in a last section.
  const rest = order(trace.files.filter((f) => !placed.has(f.path)).map((f) => f.path));
  let other: { title: string; files: FileBlock[] } | undefined;
  for (const path of rest) {
    const f = fileOf.get(path) as FileHits;
    const i = phases.findIndex((p) =>
      f.collector === 'browser'
        ? p.kind === 'browser' || p.kind === 'after-response'
        : p.kind === 'backend' &&
          p.request !== undefined &&
          trace.requests[p.request]?.collector === f.collector,
    );
    const block: FileBlock = {
      path,
      lines: [`  ${path} [${f.collector}] lines ${litRanges(f)}${f.background ? ' (background)' : ''}`],
      functions: 0,
    };
    const section = i >= 0 ? sections[i] : undefined;
    if (section) section.files.push(block);
    else {
      if (!other) sections.push((other = { title: phases.length ? 'other files' : 'files', files: [] }));
      other.files.push(block);
    }
  }

  const hidden = trace.dropped.filter((d) => d.count > 0);
  const footer = hidden.length ? [`hidden: ${hidden.map((d) => `${d.count} ${d.reason}`).join(', ')}`] : [];
  return fit({
    traceId: trace.id,
    header,
    sections,
    footer,
    rank: (path) => {
      const f = fileOf.get(path);
      return { background: Boolean(f?.background), hits: f ? f.lines.reduce((n, l) => n + l.count, 0) : 0 };
    },
  });
}
