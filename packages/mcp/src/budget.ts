/**
 * Every tool result is at most 16,000 characters: the 4,000-token budget N at 4 characters a token
 * (D-109). Every tool's text goes through `fit()` or `fitText()` (design section 6.2).
 */
export const MAX_CHARS = 16_000;

/** One file's lines inside one phase of a summary. */
export interface FileBlock {
  path: string;
  lines: string[];
  functions: number;
}

export interface SummaryParts {
  traceId: string;
  /** Always printed: trace, action, page, requests. */
  header: string[];
  sections: { title: string; files: FileBlock[] }[];
  /** Printed after the sections (the "hidden:" line). */
  footer: string[];
  /** Rank of a file, across all its phases: higher stays longer. */
  rank: (path: string) => { background: boolean; hits: number };
}

const size = (lines: readonly string[]) => lines.reduce((n, l) => n + l.length + 1, 0);

function render(parts: SummaryParts, keep: (path: string) => boolean): string {
  const out = [...parts.header];
  for (const s of parts.sections) {
    out.push(s.title);
    for (const f of s.files) if (keep(f.path)) out.push(...f.lines);
  }
  out.push(...parts.footer);
  return out.join('\n');
}

/**
 * The summary as text, within MAX_CHARS. When the whole text doesn't fit, drops whole files,
 * lowest rank first (background before foreground, then fewest hits), from every phase at once,
 * and ends with one line saying what was cut and how to see it.
 */
export function fit(parts: SummaryParts, max = MAX_CHARS): string {
  const full = render(parts, () => true);
  if (full.length <= max) return full;

  const bytes = new Map<string, number>();
  const fns = new Map<string, number>();
  for (const s of parts.sections) {
    for (const f of s.files) {
      bytes.set(f.path, (bytes.get(f.path) ?? 0) + size(f.lines));
      fns.set(f.path, (fns.get(f.path) ?? 0) + f.functions);
    }
  }
  // Lowest rank first.
  const order = [...bytes.keys()].sort((a, b) => {
    const ra = parts.rank(a);
    const rb = parts.rank(b);
    if (ra.background !== rb.background) return ra.background ? -1 : 1;
    return ra.hits - rb.hits || b.localeCompare(a);
  });
  const dropped = new Set<string>();
  let length = full.length;
  let droppedChars = 0;
  const cut = () => {
    const top = [...dropped].at(-1) ?? '';
    const n = dropped.size;
    const m = [...dropped].reduce((sum, p) => sum + (fns.get(p) ?? 0), 0);
    return (
      `not shown: ${n} file${n === 1 ? '' : 's'}, ${m} function${m === 1 ? '' : 's'} ` +
      `(${droppedChars.toLocaleString('en-US')} chars). Call get_trace with traceId "${parts.traceId}" and file "${top}" to see one.`
    );
  };
  for (const path of order) {
    if (length + 1 + cut().length <= max) break;
    dropped.add(path);
    const b = bytes.get(path) ?? 0;
    length -= b;
    droppedChars += b;
  }
  return fitText(`${render(parts, (p) => !dropped.has(p))}\n${cut()}`, max, parts.traceId);
}

/**
 * The last guard for any tool's text: cuts at a line boundary under `max` and says so. The cut
 * line names the call that shows the rest when there is one.
 */
export function fitText(text: string, max = MAX_CHARS, traceId?: string): string {
  if (text.length <= max) return text;
  const tail = traceId
    ? `not shown: the rest (${(text.length).toLocaleString('en-US')} chars in all). Call get_trace with traceId "${traceId}" and a file or function to see one part.`
    : `not shown: the rest (${(text.length).toLocaleString('en-US')} chars in all).`;
  const room = max - tail.length - 1;
  const at = text.lastIndexOf('\n', room);
  return `${text.slice(0, at > 0 ? at : room)}\n${tail}`;
}
