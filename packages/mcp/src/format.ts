import type { ActionRequest, ActionResult, LineHit, Trace, TraceSummary } from '@lightpath-dev/protocol';
import { fitText, MAX_CHARS } from './budget.js';
import { redactFillValues } from './redact.js';
import { summarizeTrace } from './summary.js';

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
    const bg = f.background ? ' (background: only code that also runs while idle, likely unrelated)' : '';
    out.push(
      `  ${f.path} [${f.collector}] lines ${lineRanges(f.lines)}${hottest > 1 ? ` (max ${hottest} hits)` : ''}${bg}`,
    );
  }
  const dropped = trace.dropped.filter((d) => d.count > 0);
  if (dropped.length > 0) out.push(`  not shown: ${dropped.map((d) => `${d.count} ${d.reason}`).join(', ')}`);
  return out.join('\n');
}

/**
 * find_code_for_action's answer when no recorded action matches (D-143): the run_action call that
 * records one, with the words as its target, instead of only "do it with run_action".
 */
export function noRecordedAction(action: string): string {
  return [
    `No recorded action matches "${action}" yet, so there is no trace to read. Record it now with:`,
    `  run_action ${JSON.stringify({ target: action.trim() })}`,
    'If it needs sign-in or setup steps first, do each with its own run_action call. Or ask the user to click it in the app opened by `lightpath dev`.',
  ].join('\n');
}

export function describeSummaries(traces: readonly TraceSummary[]): string {
  if (traces.length === 0) return 'No traces yet. Click something in the app opened by `lightpath dev`.';
  return traces
    .map(
      (t) =>
        `${t.id}  ${new Date(t.startedAt).toISOString()}  ${t.label}  (${t.fileCount} files${t.problemCount ? `, ${t.problemCount} problem${t.problemCount === 1 ? '' : 's'}` : ''})`,
    )
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

type ActionInput = Pick<ActionRequest, 'target' | 'within' | 'action' | 'key' | 'fill'>;

/** `click button "Checkout"`, `press Enter on textbox "Search" within "Header"`. */
export function describeAction(input: ActionInput): string {
  const where = `${input.target}${input.within ? ` within "${input.within}"` : ''}`;
  const verb = input.action === 'press' ? `press ${input.key ?? 'Enter'} on ${where}` : `click ${where}`;
  const n = input.fill?.length ?? 0;
  return n > 0 ? `${verb}, after filling ${n} field${n === 1 ? '' : 's'}` : verb;
}

/**
 * run_action's answer (design section 4.5): the trace's first line, the action and page lines,
 * warnings, then the summary by phase (section 6.1). On failure, the outcome and the candidates.
 * Every fill value in the text is redacted (rule 6). itText runs again after redaction, which can lengthen
 * the text.
 */
export function describeActionResult(
  input: ActionInput,
  result: ActionResult,
  /** Lines after the page line, before warnings: `times` and `compareTo` notes (D-142, D-144). */
  notes: readonly string[] = [],
): string {
  const values = (input.fill ?? []).map((f) => f.value);
  if (!result.ok) {
    const { error } = result;
    const out = [`run_action did not record a trace: ${error.code}. ${error.message}`];
    if (error.candidates?.length) {
      out.push(error.code === 'ambiguous' ? 'Matches:' : 'Closest targets on the page:');
      for (const c of error.candidates) out.push(`  ${c}`);
    }
    return redactFillValues(out.join('\n'), values);
  }
  const text = summarizeTrace(result.trace, [
    `action: ${describeAction(input)} (boundary ${result.boundary}, settled ${result.settled})`,
    `page: ${result.pageUrl}`,
    ...notes,
    ...result.warnings.map((w) => `warning (${w.code}): ${w.message}`),
  ]);
  return fitText(redactFillValues(text, values), MAX_CHARS, result.trace.id);
}

/**
 * run_request's answer (design section 4A): one `sent:` line with the method, the path (never the
 * query), status, response size and time, then the backend trace summary. The request body, its
 * headers and the response's body and headers never appear.
 */
export function describeRequestResult(
  method: string,
  path: string,
  sent: { status: number; bytes: number; durationMs: number; redirect?: string | undefined },
  trace: Trace,
): string {
  const lines = [
    `sent: ${method} ${path} → ${sent.status} (${sent.bytes.toLocaleString('en-US')} bytes, ${Math.round(sent.durationMs)} ms)`,
  ];
  const note = redirectNote(sent.status, sent.redirect);
  if (note) lines.push(note);
  return fitText(summarizeTrace(trace, lines), MAX_CHARS, trace.id);
}

/** For a 3xx: that it wasn't followed, and where it points when that is loopback. */
export function redirectNote(status: number, loopbackTarget: string | undefined): string | undefined {
  if (status < 300 || status >= 400) return undefined;
  return `redirect not followed${loopbackTarget ? `: it points to ${loopbackTarget}` : ' (it points off loopback, or nowhere)'}`;
}
