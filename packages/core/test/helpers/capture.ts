import inspector from 'node:inspector';
import vm from 'node:vm';
import type { ScriptCoverage } from '@lightpath-dev/protocol';

/**
 * Runs `source` as a script named `url`, calls `act` on its exports, and returns the V8 coverage
 * delta for exactly that call: the same take-run-take pattern the agents use (ADR 0001).
 */
export function captureCoverage(
  source: string,
  url: string,
  act: (exports: Record<string, (...args: unknown[]) => unknown>) => void,
): ScriptCoverage {
  const session = new inspector.Session();
  session.connect();
  const post = <T>(method: string, params?: object): T => {
    let result: T | undefined;
    let error: Error | null = null;
    // In-process sessions call back synchronously (measured on Node 24).
    session.post(method, params, (err, res) => {
      error = err;
      result = res as T;
    });
    if (error) throw error;
    return result as T;
  };
  try {
    post('Profiler.enable');
    post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const exports: Record<string, (...args: unknown[]) => unknown> = {};
    new vm.Script(source, { filename: url }).runInNewContext({ exports });
    post('Profiler.takePreciseCoverage'); // discard: definition-time code
    act(exports);
    const { result } = post<{ result: ScriptCoverage[] }>('Profiler.takePreciseCoverage');
    const script = result.find((s) => s.url === url);
    if (!script) throw new Error(`no coverage for ${url}`);
    return script;
  } finally {
    post('Profiler.stopPreciseCoverage');
    session.disconnect();
  }
}
