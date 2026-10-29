import inspector from 'node:inspector';
import type { ScriptCoverage } from '@lightpath-dev/protocol';

export interface ParsedScript {
  scriptId: string;
  url: string;
  hash: string;
  length: number;
  sourceMapURL: string;
}

/** Called after each coverage read with its duration and how many functions it returned. */
export type TakeObserver = (ms: number, functions: number) => void;

/**
 * Wraps an in-process inspector session. `post` callbacks run synchronously when the session
 * is connected to the same thread (measured on Node 24.13), so every call here returns directly.
 */
export class InspectorSession {
  readonly #session = new inspector.Session();
  readonly #onTake: TakeObserver | undefined;
  readonly scripts = new Map<string, ParsedScript>();

  constructor(onTake?: TakeObserver) {
    this.#onTake = onTake;
    this.#session.connect();
    this.#session.on('Debugger.scriptParsed', ({ params }) => {
      this.scripts.set(params.scriptId, {
        scriptId: params.scriptId,
        url: params.url,
        hash: params.hash,
        length: params.length ?? 0,
        sourceMapURL: params.sourceMapURL ?? '',
      });
    });
  }

  post<T>(method: string, params?: object): T {
    let result: unknown;
    let error: Error | null = null;
    let called = false;
    this.#session.post(method, params, (err, res) => {
      called = true;
      error = err;
      result = res;
    });
    if (!called) throw new Error(`inspector call ${method} did not complete synchronously`);
    if (error) throw error;
    return result as T;
  }

  /** Starts script tracking and precise block coverage. Replays already-parsed scripts. */
  start(): void {
    this.post('Debugger.enable');
    // Never let `debugger;` statements or exceptions pause the user's process.
    this.post('Debugger.setSkipAllPauses', { skip: true });
    this.post('Profiler.enable');
    this.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  }

  /** Returns everything that ran since the previous take and resets V8's counters. */
  take(): ScriptCoverage[] {
    if (!this.#onTake) return this.post<{ result: ScriptCoverage[] }>('Profiler.takePreciseCoverage').result;
    const started = performance.now();
    const { result } = this.post<{ result: ScriptCoverage[] }>('Profiler.takePreciseCoverage');
    let functions = 0;
    for (const script of result) functions += script.functions.length;
    this.#onTake(performance.now() - started, functions);
    return result;
  }

  source(scriptId: string): string {
    return this.post<{ scriptSource: string }>('Debugger.getScriptSource', { scriptId }).scriptSource;
  }

  stop(): void {
    try {
      this.post('Profiler.stopPreciseCoverage');
      this.post('Debugger.disable');
    } finally {
      this.#session.disconnect();
    }
  }
}
