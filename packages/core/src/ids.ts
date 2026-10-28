import type { TraceId } from '@lightpath/protocol';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Creates a trace ID like `t_k3x9q0m2a7bz`. Uses the global Web Crypto API (Node 22+, browsers). */
export function newTraceId(): TraceId {
  let id = 't_';
  while (id.length < 14) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      // 252 is the largest multiple of 36 below 256; skipping bytes above it avoids modulo bias.
      if (b < 252 && id.length < 14) id += ALPHABET[b % 36];
    }
  }
  return id;
}

/** Number of heat levels the editor renders, one decoration type each (ARCHITECTURE section 9.1). */
export const HEAT_BUCKETS = 8;

/**
 * Maps a hit count to a heat bucket from 0 (ran once) to HEAT_BUCKETS - 1 (ran 128+ times).
 * Logarithmic, so a hot loop doesn't wash out everything else.
 */
export function heatBucket(count: number): number {
  if (count <= 1) return 0;
  return Math.min(HEAT_BUCKETS - 1, Math.floor(Math.log2(count)));
}
