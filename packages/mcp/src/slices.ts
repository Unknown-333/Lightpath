import type { FunctionHit, Trace } from '@lightpath-dev/protocol';
import { fitText, MAX_CHARS } from './budget.js';
import { redactSource } from './redact.js';
import { functionName, numberRanges, phaseTitle } from './summary.js';

export interface SourceFile {
  text: string;
  mtimeMs: number;
}
/** Reads a trace path from the workspace, or undefined (not inside a root, missing, unreadable). */
export type ReadSource = (path: string) => Promise<SourceFile | undefined>;

export interface SliceQuery {
  file?: string | undefined;
  function?: string | undefined;
  /** 1-based. */
  page?: number | undefined;
}

const MAX_LINE = 200;
/** Room kept for the page line at the end of each page. */
const PAGE_LINE_ROOM = 300;

interface Unit {
  path: string;
  startLine: number;
  endLine: number;
  /** Functions whose not-run lines and spans count inside this unit. */
  fns: FunctionHit[];
}

const fnKey = (f: Pick<FunctionHit, 'path' | 'name' | 'startLine'>) => `${f.path}|${f.name}|${f.startLine}`;

/**
 * `get_trace` with `file` or `function` (design section 6.3, D-117): the executed lines of each
 * outermost function that ran, with numbers, merged over every phase. A run of not-run lines folds
 * into one marker, an untaken block inside a line that ran is named after the line, lines with no
 * coverage (blank, comments, types) are left out. Paged under 16,000 characters.
 */
export async function sliceTrace(trace: Trace, query: SliceQuery, read: ReadSource): Promise<string> {
  const fns = trace.functions ?? [];
  let path: string | undefined;
  if (query.file !== undefined) {
    const found = pick(
      trace.files.map((f) => f.path),
      query.file,
    );
    if (typeof found !== 'string') return listMessage(trace, 'file', query.file, found);
    path = found;
  }
  let units: Unit[];
  let label: string;
  if (query.function !== undefined) {
    const name = query.function;
    const pool = fns.filter((f) => (path ? f.path === path : true));
    let named = pool.filter((f) => functionName(f) === name);
    if (named.length === 0) named = pool.filter((f) => functionName(f).toLowerCase() === name.toLowerCase());
    const groups = new Map<string, FunctionHit[]>();
    for (const f of named) groups.set(fnKey(f), [...(groups.get(fnKey(f)) ?? []), f]);
    if (groups.size !== 1) {
      const all = [...new Set(pool.map((f) => `${functionName(f)} (${f.path}:${f.startLine})`))];
      const near = all.filter((s) => s.toLowerCase().includes(name.toLowerCase()));
      return listMessage(
        trace,
        'function',
        name,
        groups.size === 0
          ? near.length
            ? near
            : all
          : [...groups.values()].map(
              (g) => `${functionName(g[0] as FunctionHit)} (${g[0]?.path}:${g[0]?.startLine})`,
            ),
        groups.size > 1,
      );
    }
    const group = [...groups.values()][0] as FunctionHit[];
    const first = group[0] as FunctionHit;
    path = first.path;
    const endLine = Math.max(...group.map((f) => f.endLine));
    units = [
      {
        path,
        startLine: first.startLine,
        endLine,
        fns: fns.filter((f) => f.path === path && f.startLine >= first.startLine && f.endLine <= endLine),
      },
    ];
    label = `function "${name}"`;
  } else if (path) {
    units = outermost(path, fns, trace);
    label = `file "${path}"`;
  } else {
    return 'Pass a file or a function to see its executed lines.';
  }

  const file = trace.files.find((f) => f.path === path);
  const lit = new Set((file?.lines ?? []).map((l) => l.line));
  const source = await read(path as string);
  if (!source) {
    return fitText(
      `${path}: can't read this file from the workspace, so only line numbers are shown.\nlines that ran: ${numberRanges([...lit])}`,
    );
  }
  // Hard-coded keys and tokens never come back (D-145); line numbers stay the same.
  const src = redactSource(source.text).split(/\r?\n/);
  const phaseNames = [
    ...new Set(
      fns
        .filter((f) => f.path === path)
        .map((f) => trace.phases?.[f.phase])
        .filter((p) => p !== undefined)
        .map((p) => phaseTitle(trace, p).replace(/ \[.*\]$/, '')),
    ),
  ];
  const head: string[] = [];
  if (source.mtimeMs > trace.startedAt) {
    head.push(
      `warning: ${path} changed after this trace; line numbers may not match. Rerun the action for a fresh trace.`,
    );
  }
  head.push(`${path} (trace ${trace.id}${phaseNames.length ? `, phase ${phaseNames.join(', ')}` : ''})`);

  // Each unit as its own block of lines.
  const blocks = units.map((u) => unitLines(u, src, lit));
  const pages = paginate(blocks, MAX_CHARS - PAGE_LINE_ROOM - head.join('\n').length - 1);
  const n = pages.length;
  const page = Math.min(Math.max(1, query.page ?? 1), Math.max(1, n));
  if ((query.page ?? 1) > n && n > 0)
    return `${path} has ${n} page${n === 1 ? '' : 's'}; there is no page ${query.page}.`;
  const body = pages[page - 1] ?? [];
  const out = [...head, ...body];
  if (n > 1) {
    out.push(
      page < n
        ? `page ${page} of ${n}. Call get_trace with traceId "${trace.id}", ${label}, page ${page + 1} for the next.`
        : `page ${page} of ${n}.`,
    );
  }
  return fitText(out.join('\n'), MAX_CHARS, trace.id);
}

/** A path from `paths` that `query` names: exactly, or as the only path containing it. */
function pick(paths: readonly string[], query: string): string | string[] {
  if (paths.includes(query)) return query;
  const q = query.replace(/\\/g, '/').toLowerCase();
  const hits = paths.filter((p) => p.toLowerCase().includes(q));
  return hits.length === 1 ? (hits[0] as string) : hits;
}

function listMessage(
  trace: Trace,
  what: 'file' | 'function',
  query: string,
  options: string[],
  ambiguous = options.length > 1,
): string {
  const shown = options.slice(0, 30);
  const more = options.length > shown.length ? `\n  +${options.length - shown.length} more` : '';
  const head = ambiguous
    ? `"${query}" matches ${options.length} ${what}s in trace ${trace.id}. Call get_trace again with one of them:`
    : `No ${what} "${query}" in trace ${trace.id}. Its ${what}s:`;
  return fitText(`${head}\n${shown.map((o) => `  ${o}`).join('\n')}${more}`);
}

/**
 * The executed lines of one file of the trace, as `get_trace` with `file` prints them (D-117),
 * from `text` (already redacted): one block of lines per outermost function, merged over phases.
 */
export function executedLines(trace: Trace, path: string, text: string): string[][] {
  const lit = new Set((trace.files.find((f) => f.path === path)?.lines ?? []).map((l) => l.line));
  const src = text.split(/\r?\n/);
  return outermost(path, trace.functions ?? [], trace)
    .map((u) => unitLines(u, src, lit))
    .filter((b) => b.length > 0);
}

/** The outermost functions of one file, merged over phases, or one unit for a file without any. */
function outermost(path: string, fns: readonly FunctionHit[], trace: Trace): Unit[] {
  const mine = fns.filter((f) => f.path === path);
  if (mine.length === 0) {
    const lines = trace.files.find((f) => f.path === path)?.lines.map((l) => l.line) ?? [];
    return lines.length
      ? [{ path, startLine: Math.min(...lines), endLine: Math.max(...lines), fns: [] }]
      : [];
  }
  const spans = [...new Map(mine.map((f) => [`${f.startLine}-${f.endLine}`, f])).values()].sort(
    (a, b) => a.startLine - b.startLine || b.endLine - a.endLine,
  );
  const units: Unit[] = [];
  for (const f of spans) {
    const last = units.at(-1);
    if (last && f.startLine >= last.startLine && f.endLine <= last.endLine) continue; // nested
    if (last && f.startLine <= last.endLine) last.endLine = Math.max(last.endLine, f.endLine);
    else units.push({ path, startLine: f.startLine, endLine: f.endLine, fns: [] });
  }
  for (const u of units) u.fns = mine.filter((f) => f.startLine >= u.startLine && f.endLine <= u.endLine);
  return units;
}

/** The printed lines of one unit. */
function unitLines(u: Unit, src: readonly string[], lit: ReadonlySet<number>): string[] {
  const notRun = new Set(u.fns.flatMap((f) => f.notRun ?? []));
  // Lines with no count: a call threw before them (D-150). A line another phase ran shows as run.
  const unknown = new Map<number, number>();
  for (const f of u.fns)
    for (const x of f.unknown ?? []) for (const l of x.lines) if (!lit.has(l)) unknown.set(l, x.threwAfter);
  let unknownRun: { from: number; to: number; at: number } | undefined;
  // A block is untaken only if every phase that ran its function left it untaken.
  const spansByFn = new Map<string, Map<string, NonNullable<FunctionHit['notRunSpans']>[number]>[]>();
  for (const f of u.fns) {
    const list = spansByFn.get(fnKey(f)) ?? [];
    list.push(new Map((f.notRunSpans ?? []).map((s) => [`${s.line}:${s.startColumn}`, s])));
    spansByFn.set(fnKey(f), list);
  }
  const spans = new Map<number, string[]>();
  for (const list of spansByFn.values()) {
    const [firstSet, ...others] = list;
    for (const [key, s] of firstSet ?? []) {
      if (!others.every((m) => m.has(key))) continue;
      const line = src[s.line - 1] ?? '';
      const tail = /^[\w$'"`.\])]+/.exec(line.slice(s.endColumn - 1))?.[0].length ?? 1;
      const text =
        line
          .slice(s.startColumn, s.endColumn - 1 + tail)
          .trim()
          .slice(0, 40) || redactSource(s.text);
      if (text) spans.set(s.line, [...(spans.get(s.line) ?? []), text]);
    }
  }
  const out: string[] = [];
  let gap: number[] = [];
  const flush = () => {
    if (gap.length) {
      out.push(`      // not run: ${gap.length === 1 ? `line ${gap[0]}` : `lines ${gap[0]}-${gap.at(-1)}`}`);
    }
    gap = [];
  };
  for (let l = u.startLine; l <= u.endLine; l++) {
    if (lit.has(l)) {
      flush();
      let text = src[l - 1] ?? '';
      if (text.length > MAX_LINE) text = `${text.slice(0, MAX_LINE - 1)}…`;
      const marks = spans.get(l);
      out.push(
        `${String(l).padStart(4)}  ${text}${marks?.length ? `  // not run: ${[...new Set(marks)].join(', ')}` : ''}`,
      );
    } else if (notRun.has(l)) gap.push(l);
    else if (unknown.has(l)) {
      flush();
      const at = unknown.get(l) as number;
      const last = out.at(-1);
      const run = last && unknownRun?.at === at && unknownRun.to === l - 1 ? unknownRun : undefined;
      if (run) {
        run.to = l;
        out[out.length - 1] = unknownMarker(run.from, l, at);
      } else {
        unknownRun = { from: l, to: l, at };
        out.push(unknownMarker(l, l, at));
      }
    }
  }
  flush();
  return out;
}

/** `// unknown: lines 55-56 (a call threw on or after line 54)` (D-150). */
const unknownMarker = (from: number, to: number, at: number) =>
  `      // unknown: ${from === to ? `line ${from}` : `lines ${from}-${to}`} (a call threw on or after line ${at})`;

/** Pages under `room` characters: break between units, and inside a unit only when it alone is too long. */
function paginate(blocks: readonly string[][], room: number): string[][] {
  const pages: string[][] = [];
  let page: string[] = [];
  let used = 0;
  const push = (line: string) => {
    if (used + line.length + 1 > room && page.length) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(line);
    used += line.length + 1;
  };
  for (const [i, block] of blocks.entries()) {
    const lines = i > 0 ? ['  ...', ...block] : block;
    const blockSize = lines.reduce((n, l) => n + l.length + 1, 0);
    if (page.length && used + blockSize > room && blockSize <= room) {
      pages.push(page);
      page = [];
      used = 0;
    }
    for (const l of lines) push(l);
  }
  if (page.length) pages.push(page);
  return pages;
}
