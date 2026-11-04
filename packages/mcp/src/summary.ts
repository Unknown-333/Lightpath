import type {
  FileHits,
  FunctionHit,
  Trace,
  TracePhase,
  TraceProblem,
  TraceRequest,
} from '@lightpath-dev/protocol';
import { droppedFiles, type FileBlock, fit, MAX_CHARS, type SummaryParts } from './budget.js';

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

const ERROR_KINDS = new Set(['exception', 'console-error', 'uncaught']);

/** A problem message as one line of at most `max` characters, with where it happened. */
export function problemText(p: TraceProblem, max = 200): string {
  const first = p.message.split('\n')[0]?.trim() ?? '';
  const where = p.path ? ` at ${p.path}${p.line ? `:${p.line}` : ''}` : '';
  const text = `${first}${where}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Errors (thrown, console.error, uncaught) in the order they happened, dropped ones counted. */
export function errorsOf(trace: Trace): { list: TraceProblem[]; total: number } {
  const list = (trace.problems ?? []).filter((p) => ERROR_KINDS.has(p.kind)).sort((a, b) => a.at - b.at);
  return { list, total: list.length + (trace.problemsDropped ?? 0) };
}

/**
 * Failed requests (D-121): status 400 and up from the browser or the backend, and network
 * errors, once each by method, path and status (or failure).
 */
export function failedRequestsOf(trace: Trace): string[] {
  const seen = new Map<string, string>();
  for (const p of [...(trace.problems ?? [])].sort((a, b) => a.at - b.at)) {
    if (p.kind !== 'request-failed' || !p.request) continue;
    const r = p.request;
    const key = `${r.method} ${r.path} ${r.status ?? r.failure ?? ''}`;
    if (!seen.has(key))
      seen.set(
        key,
        r.status ? `${r.method} ${r.path} → ${r.status}` : `${r.method} ${r.path} (${r.failure ?? 'failed'})`,
      );
  }
  for (const r of trace.requests) {
    if (r.status === undefined || r.status < 400) continue;
    const key = `${r.method} ${r.path} ${r.status}`;
    if (!seen.has(key)) seen.set(key, `${r.method} ${r.path} → ${r.status}`);
  }
  return [...seen.values()];
}

/** The summary's problem lines (design section 8): counts and the first message, when any. */
export function problemLines(trace: Trace): string[] {
  const out: string[] = [];
  const errors = errorsOf(trace);
  const first = errors.list[0];
  if (errors.total > 0) out.push(`errors: ${errors.total}${first ? ` (first: ${problemText(first)})` : ''}`);
  const failed = failedRequestsOf(trace);
  if (failed.length > 0) out.push(`failed requests: ${failed.length} (first: ${failed[0]})`);
  return out;
}

/** `checkout 21-33 ×1 not run: 29`. */
export function functionLine(f: FunctionHit): string {
  const range = f.startLine === f.endLine ? `${f.startLine}` : `${f.startLine}-${f.endLine}`;
  const calls = f.count > 0 ? `×${f.count}` : 'resumed';
  const notRun = f.notRun?.length ? ` not run: ${numberRanges(f.notRun)}` : '';
  return `${functionName(f)} ${range} ${calls}${notRun}`;
}

const litRanges = (f: FileHits) => numberRanges(f.lines.map((l) => l.line));

/** A backend file shows once when it ran in this many requests of one trace, or more (D-141). */
export const FOLD_MIN_REQUESTS = 3;
const SHARED_NAME = `in ${FOLD_MIN_REQUESTS} or more requests`;
const SHARED_TITLE = `${SHARED_NAME} [backend, shown once]`;

/**
 * The "in 3 or more requests" section (D-141): each shared backend file once, with how many
 * requests ran it, and its functions with calls added up over those requests. A function that ran
 * in fewer of them says in how many; a line is "not run" only when no request ran it.
 */
function foldShared(
  shared: ReadonlyMap<string, readonly number[]>,
  byPhase: ReadonlyMap<number, ReadonlyMap<string, FunctionHit[]>>,
  requests: number,
  order: (paths: Iterable<string>) => string[],
  fileOf: (path: string) => FileHits | undefined,
): { section: { title: string; files: FileBlock[] }; saved: Map<string, number> } | undefined {
  if (shared.size === 0) return undefined;
  const size = (lines: readonly string[]) => lines.reduce((n, l) => n + l.length + 1, 0);
  const files: FileBlock[] = [];
  /** Per file: characters under each request before folding, less its folded block. */
  const saved = new Map<string, number>();
  for (const path of order(shared.keys())) {
    const phases = shared.get(path) ?? [];
    const merged = new Map<string, { fn: FunctionHit; in: number; notRun: Set<number> }>();
    let before = 0;
    for (const i of phases) {
      const fns = byPhase.get(i)?.get(path) ?? [];
      before += size([`  ${path}`, ...fns.map((f) => `    ${functionLine(f)}`)]);
      for (const f of fns) {
        const key = `${f.name}|${f.startLine}|${f.endLine}`;
        const m = merged.get(key);
        if (!m) {
          merged.set(key, { fn: { ...f }, in: 1, notRun: new Set(f.notRun ?? []) });
          continue;
        }
        m.fn.count += f.count;
        m.in += 1;
        const mine = new Set(f.notRun ?? []);
        for (const l of m.notRun) if (!mine.has(l)) m.notRun.delete(l);
      }
    }
    const fns = [...merged.values()].sort(
      (a, b) => a.fn.startLine - b.fn.startLine || b.fn.endLine - a.fn.endLine,
    );
    const bg = fileOf(path)?.background ? ', background' : '';
    const lines = [
      `  ${path} (in ${phases.length} of ${requests} requests${bg})`,
      ...fns.map((m) => {
        const line = functionLine({ ...m.fn, notRun: [...m.notRun] });
        return `    ${line}${m.in < phases.length ? ` (in ${m.in})` : ''}`;
      }),
    ];
    files.push({ path, lines, functions: fns.length });
    saved.set(path, before - size(lines));
  }
  return { section: { title: SHARED_TITLE, files }, saved };
}

/**
 * The default trace text (design section 6.1, D-116): header lines, then one block per phase with
 * its files and their functions in line order, cut to 16,000 characters by `fit()`.
 * `extraHeader` goes after the first line (run_action's action, page and warning lines).
 */
export function summarizeTrace(
  trace: Trace,
  extraHeader: readonly string[] = [],
  /** The cap: 16,000, or less when run_action adds a `compareTo` diff after it (D-144). */
  max = MAX_CHARS,
): string {
  const header = [`Trace ${trace.id}: ${trace.label}`, ...extraHeader];
  for (const r of trace.requests.slice(0, MAX_REQUEST_LINES)) header.push(`request: ${requestLine(r)}`);
  if (trace.requests.length > MAX_REQUEST_LINES)
    header.push(`+${trace.requests.length - MAX_REQUEST_LINES} more requests`);
  header.push(...problemLines(trace));
  if (trace.files.length === 0) header.push('no workspace code ran');
  header.push('');

  const fileOf = new Map(trace.files.map((f) => [f.path, f]));
  const phases = trace.phases ?? [];
  const byPhase = new Map<number, Map<string, FunctionHit[]>>();
  for (const fn of trace.functions ?? []) {
    let files = byPhase.get(fn.phase);
    if (!files) {
      files = new Map();
      byPhase.set(fn.phase, files);
    }
    files.set(fn.path, [...(files.get(fn.path) ?? []), fn]);
  }
  // D-141: a backend file that ran in FOLD_MIN_REQUESTS or more requests is shown once, not under each.
  const backend = phases.flatMap((p, i) => (p.kind === 'backend' ? [i] : []));
  const shared = new Map<string, number[]>();
  if (backend.length >= FOLD_MIN_REQUESTS) {
    const where = new Map<string, number[]>();
    for (const i of backend)
      for (const path of byPhase.get(i)?.keys() ?? []) where.set(path, [...(where.get(path) ?? []), i]);
    for (const [path, list] of where) if (list.length >= FOLD_MIN_REQUESTS) shared.set(path, list);
  }
  const order = (paths: Iterable<string>) =>
    [...paths].sort((a, b) => {
      const fa = fileOf.get(a);
      const fb = fileOf.get(b);
      const bg = Number(Boolean(fa?.background)) - Number(Boolean(fb?.background));
      return bg || (fa?.firstSeenAt ?? 0) - (fb?.firstSeenAt ?? 0) || a.localeCompare(b);
    });

  /** The phase sections, with shared backend files folded into one section when `fold` is set. */
  const build = (fold: ReadonlyMap<string, readonly number[]>) => {
    const sections: SummaryParts['sections'] = phases.map((p) => ({
      title: phaseTitle(trace, p),
      files: [],
    }));
    const placed = new Set<string>();
    for (const [i, files] of byPhase) {
      const section = sections[i];
      if (!section) continue;
      for (const path of order(files.keys())) {
        placed.add(path);
        if (fold.get(path)?.includes(i)) continue;
        const fns = (files.get(path) ?? []).sort(
          (a, b) => a.startLine - b.startLine || b.endLine - a.endLine,
        );
        const bg = fileOf.get(path)?.background ? ' (background)' : '';
        section.files.push({
          path,
          lines: [`  ${path}${bg}`, ...fns.map((f) => `    ${functionLine(f)}`)],
          functions: fns.length,
        });
      }
    }
    const folded = foldShared(fold, byPhase, backend.length, order, (p) => fileOf.get(p));
    if (folded) sections.push(folded.section);

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
        if (!other) {
          other = { title: phases.length ? 'other files' : 'files', files: [] };
          sections.push(other);
        }
        other.files.push(block);
      }
    }
    return { sections, folded };
  };

  const hidden = trace.dropped.filter((d) => d.count > 0);
  const footer = hidden.length ? [`hidden: ${hidden.map((d) => `${d.count} ${d.reason}`).join(', ')}`] : [];
  const rank = (path: string) => {
    const f = fileOf.get(path);
    return { background: Boolean(f?.background), hits: f ? f.lines.reduce((n, l) => n + l.count, 0) : 0 };
  };
  const { sections, folded } = build(shared);
  if (!folded) return fit({ traceId: trace.id, header, sections, footer, rank }, max);
  // The files shown are the ones the unfolded text would show (D-141): folding never adds files,
  // and the fold line counts only the shared files that stay in view.
  const unfolded = { traceId: trace.id, header, sections: build(new Map()).sections, footer, rank };
  const dropped = droppedFiles(unfolded, max);
  const kept = folded.section.files.filter((f) => !dropped.has(f.path)).map((f) => f.path);
  if (kept.length === 0) return fit({ traceId: trace.id, header, sections, footer, rank }, max, unfolded);
  const n = kept.length;
  const saved = kept.reduce((sum, p) => sum + (folded.saved.get(p) ?? 0), 0) - (SHARED_TITLE.length + 1);
  const foldLine =
    `folded: ${n} backend file${n === 1 ? '' : 's'} that ran in ${FOLD_MIN_REQUESTS} or more of the ${backend.length} requests ` +
    `${n === 1 ? 'is' : 'are'} shown once under "${SHARED_NAME}", not under each request ` +
    `(${Math.max(0, saved).toLocaleString('en-US')} chars saved). Call get_trace with traceId "${trace.id}" and file "${kept[0]}" to see one file's lines.`;
  return fit({ traceId: trace.id, header, sections, footer: [...footer, foldLine], rank }, max, unfolded);
}
