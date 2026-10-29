import type { ScriptCoverage } from '@lightpath-dev/protocol';

/**
 * How many background windows a function must run in before it counts as periodic. Two would
 * catch code that ran once at page load and once more by chance; three needs a pattern.
 */
export const PERIODIC_WINDOWS = 3;

/**
 * Remembers which functions run while nobody is doing anything: timers, polling, animation frames,
 * HMR pings (docs/ARCHITECTURE.md section 4.6, rule 2). Keyed by script hash and the function's
 * start offset, so a hot reload (new hash) starts fresh and two scripts never collide.
 *
 * One instance per collector process: a function's script hash is only meaningful there.
 */
export class PeriodicFunctions {
  readonly #windows = new Map<string, number>();
  readonly #limit: number;

  /** `limit` caps memory: once reached, the oldest entries are forgotten first. */
  constructor(limit = 50_000) {
    this.#limit = limit;
  }

  /** Records one background delta. `hashOf` gives a script's hash, or undefined if unknown. */
  observeBackground(
    coverage: readonly ScriptCoverage[],
    hashOf: (scriptId: string) => string | undefined,
  ): void {
    for (const script of coverage) {
      const hash = hashOf(script.scriptId);
      if (!hash) continue;
      for (const fn of script.functions) {
        const first = fn.ranges[0];
        if (!first || first.count === 0) continue;
        const key = `${hash}:${first.startOffset}`;
        const seen = this.#windows.get(key) ?? 0;
        this.#windows.delete(key); // re-insert so recently seen keys are the last to be evicted
        this.#windows.set(key, seen + 1);
      }
    }
    while (this.#windows.size > this.#limit) {
      const oldest = this.#windows.keys().next().value;
      if (oldest === undefined) break;
      this.#windows.delete(oldest);
    }
  }

  isPeriodic(hash: string, startOffset: number): boolean {
    return (this.#windows.get(`${hash}:${startOffset}`) ?? 0) >= PERIODIC_WINDOWS;
  }

  /**
   * Splits one script's action coverage into the functions that don't look periodic. Returns
   * `undefined` when none do, so the caller can skip the extra mapping work.
   */
  foreground(coverage: ScriptCoverage, hash: string): ScriptCoverage | undefined {
    const functions = coverage.functions.filter((fn) => {
      const first = fn.ranges[0];
      return !first || !this.isPeriodic(hash, first.startOffset);
    });
    if (functions.length === coverage.functions.length) return coverage;
    return { ...coverage, functions };
  }
}
