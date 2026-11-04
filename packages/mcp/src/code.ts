import type { Trace } from '@lightpath-dev/protocol';
import { MAX_CHARS } from './budget.js';
import { redactFillValues, redactSource } from './redact.js';
import { executedLines, type ReadSource } from './slices.js';

/** The first line of the code section: what the fold marker means (D-145). */
export const CODE_LEGEND =
  'code that ran, most-used files first ("// not run: lines A-B" marks lines in it that did not run):';

/** Room kept for the last line, which says what was left out. */
const TAIL_ROOM = 320;
/** The first file is cut at a line, rather than left out, when at least this much room is left. */
const MIN_PARTIAL = 600;

interface Block {
  path: string;
  /** The file's path, then its executed lines. */
  lines: string[];
  size: number;
}

const sizeOf = (lines: readonly string[]) => lines.reduce((n, l) => n + l.length + 1, 0);

/** Trace files most-used first: foreground before background, then by hits (D-116's rank). */
function ranked(trace: Trace): string[] {
  const hits = (f: Trace['files'][number]) => f.lines.reduce((n, l) => n + l.count, 0);
  return [...trace.files]
    .sort(
      (a, b) =>
        Number(Boolean(a.background)) - Number(Boolean(b.background)) ||
        hits(b) - hits(a) ||
        a.path.localeCompare(b.path),
    )
    .map((f) => f.path);
}

/**
 * Each readable file's executed lines, redacted (D-145), most-used first. Files that can't be read
 * from the workspace are left out; files changed after the trace started are listed apart.
 */
async function codeBlocks(
  trace: Trace,
  read: ReadSource,
  fill: readonly string[],
): Promise<{ blocks: Block[]; changed: string[] }> {
  const blocks: Block[] = [];
  const changed: string[] = [];
  for (const path of ranked(trace)) {
    const source = await read(path);
    if (!source) continue;
    if (source.mtimeMs > trace.startedAt) {
      changed.push(path);
      continue;
    }
    const units = executedLines(trace, path, redactSource(source.text));
    if (units.length === 0) continue;
    const lines = [path, ...units.flatMap((u, i) => (i > 0 ? ['  ...', ...u] : u))].map((l) =>
      redactFillValues(l, fill),
    );
    blocks.push({ path, lines, size: sizeOf(lines) });
  }
  return { blocks, changed };
}

/** The code section within `room` characters, with a last line naming what was left out. */
function renderCode(blocks: readonly Block[], changed: readonly string[], room: number, traceId: string) {
  const changedLine = changed.length
    ? `code not shown for ${changed[0]}${changed.length > 1 ? ` and ${changed.length - 1} more` : ''}: changed after this trace. Rerun the action for a fresh trace.`
    : undefined;
  const all = [CODE_LEGEND, ...blocks.flatMap((b) => b.lines), ...(changedLine ? [changedLine] : [])];
  if (sizeOf(all) - 1 <= room) return all.join('\n');

  const out = [CODE_LEGEND];
  let used = CODE_LEGEND.length + 1;
  const limit = room - TAIL_ROOM;
  const skipped: Block[] = [];
  for (const b of blocks) {
    if (used + b.size <= limit) {
      out.push(...b.lines);
      used += b.size;
      continue;
    }
    if (out.length === 1 && limit - used >= MIN_PARTIAL) {
      // The most-used file alone is too long: as much of it as fits, then where the rest is.
      const more = `  ... cut here: get_trace with traceId "${traceId}" and file "${b.path}" shows all of it`;
      const keep: string[] = [];
      let n = used + more.length + 1;
      for (const l of b.lines) {
        if (n + l.length + 1 > limit) break;
        keep.push(l);
        n += l.length + 1;
      }
      out.push(...keep, more);
      used = n;
      continue;
    }
    skipped.push(b);
  }
  if (skipped.length) {
    const chars = skipped.reduce((s, b) => s + b.size, 0);
    const n = skipped.length;
    out.push(
      `code not shown: ${n} file${n === 1 ? '' : 's'} (${chars.toLocaleString('en-US')} chars). Call get_trace with traceId "${traceId}" and file "${(skipped[0] as Block).path}" to see one.`,
    );
  }
  if (changedLine) out.push(changedLine);
  if (out.length === 1) return '';
  return out.join('\n');
}

/**
 * A trace answer with the code of the lines that ran after it (D-145), at most `max` characters.
 * `summary(m)` renders the trace text (already redacted) within `m` characters. When summary and
 * code don't both fit, the summary keeps at least half of `max` and the code gets the rest.
 * Without a reader, or with no readable file, the answer is the summary alone.
 */
export async function withCode(
  trace: Trace,
  read: ReadSource | undefined,
  summary: (max: number) => string,
  max = MAX_CHARS,
  fill: readonly string[] = [],
): Promise<string> {
  if (!read) return summary(max);
  const { blocks, changed } = await codeBlocks(trace, read, fill);
  if (blocks.length === 0 && changed.length === 0) return summary(max);
  const code = sizeOf([CODE_LEGEND, ...blocks.flatMap((b) => b.lines)]) + TAIL_ROOM;
  let text = summary(max);
  if (text.length + 2 + code > max) {
    const share = Math.max(Math.floor(max / 2), max - code - 2);
    if (text.length > share) text = summary(share);
  }
  const section = renderCode(blocks, changed, max - text.length - 2, trace.id);
  return section ? `${text}\n\n${section}` : text;
}
