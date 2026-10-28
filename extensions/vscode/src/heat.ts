import { HEAT_BUCKETS, heatBucket } from '@lightpath/core';
import type { FileHits, LineHit, Trace } from '@lightpath/protocol';

export { HEAT_BUCKETS };

/**
 * Groups a file's lines by heat bucket, so the editor makes one `setDecorations` call per bucket
 * instead of one decoration type per line (ARCHITECTURE section 9.1).
 * Returns HEAT_BUCKETS arrays; index 0 is the coolest.
 */
export function bucketize(lines: readonly LineHit[]): LineHit[][] {
  const buckets: LineHit[][] = Array.from({ length: HEAT_BUCKETS }, () => []);
  for (const hit of lines) buckets[heatBucket(hit.count)]?.push(hit);
  return buckets;
}

/** Text shown after a line: nothing for a single hit, `× 12` for repeated hits. */
export function countLabel(count: number): string {
  return count > 1 ? `  × ${count}` : '';
}

/** Order in which replay walks through a trace's files: as the collectors saw them. */
export function replayOrder(trace: Trace): FileHits[] {
  return [...trace.files].sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.path.localeCompare(b.path));
}

/** Short relative time for the trace list, e.g. "12s ago". */
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Key for matching a trace file to an open editor. Windows paths compare case-insensitively. */
export function pathKey(fsPath: string, platform: string = process.platform): string {
  const slashed = fsPath.replace(/\\/g, '/');
  return platform === 'win32' ? slashed.toLowerCase() : slashed;
}
