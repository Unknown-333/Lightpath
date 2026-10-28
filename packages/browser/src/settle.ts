export type SettleReason = 'quiet' | 'timeout';

export interface SettleOptions {
  /** Quiet time with no requests in flight before a click counts as finished. */
  settleMs: number;
  /** Hard cap on a click's window. */
  maxSettleMs: number;
}

/**
 * Decides when a click is over (ARCHITECTURE section 5.1): no requests in flight for `settleMs`,
 * or `maxSettleMs` since the click, whichever comes first.
 */
export class SettleTracker {
  #inFlight = 0;
  #quietTimer: ReturnType<typeof setTimeout> | undefined;
  #maxTimer: ReturnType<typeof setTimeout> | undefined;
  #resolve: ((reason: SettleReason) => void) | undefined;
  readonly #opts: SettleOptions;

  constructor(opts: SettleOptions) {
    this.#opts = opts;
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  /** Starts a window. Requests already in flight count toward it. */
  begin(): Promise<SettleReason> {
    this.#finish('quiet');
    return new Promise((resolve) => {
      this.#resolve = resolve;
      this.#maxTimer = setTimeout(() => this.#finish('timeout'), this.#opts.maxSettleMs);
      if (this.#inFlight === 0) this.#armQuiet();
    });
  }

  requestStarted(): void {
    this.#inFlight++;
    this.#clearQuiet();
  }

  requestEnded(): void {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    if (this.#inFlight === 0 && this.#resolve) this.#armQuiet();
  }

  /** Ends the current window early, for example when the next click starts. */
  cancel(): void {
    this.#finish('quiet');
  }

  #armQuiet(): void {
    this.#clearQuiet();
    this.#quietTimer = setTimeout(() => this.#finish('quiet'), this.#opts.settleMs);
  }

  #clearQuiet(): void {
    if (this.#quietTimer) clearTimeout(this.#quietTimer);
    this.#quietTimer = undefined;
  }

  #finish(reason: SettleReason): void {
    this.#clearQuiet();
    if (this.#maxTimer) clearTimeout(this.#maxTimer);
    this.#maxTimer = undefined;
    const resolve = this.#resolve;
    this.#resolve = undefined;
    resolve?.(reason);
  }
}
