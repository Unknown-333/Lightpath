import { lineRanges } from '@lightpath/mcp';
import type { Trace } from '@lightpath/protocol';
import pc from 'picocolors';

const COLLECTOR_COLOR = { browser: pc.cyan, node: pc.green, python: pc.yellow } as const;

/** Prints one trace as a tree of files and line ranges, for `lightpath dev` (ARCHITECTURE 9.2). */
export function formatTrace(trace: Trace, color = true): string {
  const c = color ? pc : pc.createColors(false);
  const duration = trace.endedAt ? ` ${c.dim(`${Math.max(0, trace.endedAt - trace.startedAt)} ms`)}` : '';
  const lines = [`${c.bold('◆')} ${c.bold(trace.label)}${duration} ${c.dim(trace.id)}`];
  for (const r of trace.requests) {
    const status =
      r.status === undefined ? '' : r.status >= 400 ? c.red(` ${r.status}`) : c.dim(` ${r.status}`);
    lines.push(
      `  ${c.dim('→')} ${r.method} ${r.path}${status}${r.overlapped ? c.yellow(' (overlapped)') : ''}`,
    );
  }
  trace.files.forEach((f, i) => {
    const branch = i === trace.files.length - 1 ? '└─' : '├─';
    const paint = color ? COLLECTOR_COLOR[f.collector] : (s: string) => s;
    const hottest = Math.max(...f.lines.map((l) => l.count));
    const hot = hottest > 1 ? c.dim(` ×${hottest}`) : '';
    lines.push(`  ${c.dim(branch)} ${paint(f.path)} ${c.dim(`:${lineRanges(f.lines)}`)}${hot}`);
  });
  if (trace.files.length === 0) lines.push(`  ${c.dim('no workspace code ran')}`);
  const hidden = trace.dropped.reduce((n, d) => n + d.count, 0);
  if (hidden > 0)
    lines.push(`  ${c.dim(`${hidden} scripts hidden (${trace.dropped.map((d) => d.reason).join(', ')})`)}`);
  return lines.join('\n');
}
