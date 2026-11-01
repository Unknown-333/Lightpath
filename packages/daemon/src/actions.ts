import type {
  ActionRequest,
  ActionResult,
  ActionRunner,
  ActionWarning,
  Trace,
  TraceId,
} from '@lightpath-dev/protocol';
import type { Store } from './store.js';

/** Longest wait after `traceEnd` for the backend lines of the requests an action sent (D-114). */
export const BACKEND_WAIT_MS = 1500;

type Tagged = { method: string; path: string };

const withoutQuery = (path: string) => path.split('?')[0] ?? path;
const key = (r: Tagged) => `${r.method.toUpperCase()} ${withoutQuery(r.path)}`;

/** The tagged requests that have no backend delta in the trace yet, matched by method and path. */
export function missingBackend(trace: Trace | undefined, tagged: readonly Tagged[]): Tagged[] {
  const have = new Map<string, number>();
  for (const r of trace?.requests ?? []) {
    if (r.collector === 'browser') continue;
    have.set(key(r), (have.get(key(r)) ?? 0) + 1);
  }
  const missing: Tagged[] = [];
  for (const r of tagged) {
    const n = have.get(key(r)) ?? 0;
    if (n > 0) have.set(key(r), n - 1);
    else missing.push(r);
  }
  return missing;
}

/**
 * One wait for all of an action's requests: ends as soon as each tagged request has its backend
 * delta in the stored trace, or after `waitMs`. Returns the requests still missing.
 */
export function waitForBackend(
  store: Store,
  traceId: TraceId,
  tagged: readonly Tagged[],
  waitMs = BACKEND_WAIT_MS,
): Promise<Tagged[]> {
  const initial = missingBackend(store.get(traceId), tagged);
  if (initial.length === 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve(missingBackend(store.get(traceId), tagged));
    };
    const timer = setTimeout(finish, waitMs);
    const unsubscribe = store.subscribe((trace) => {
      if (trace.id === traceId && missingBackend(trace, tagged).length === 0) finish();
    });
  });
}

/** Runs one `/v1/action` request: the runner's action, then the backend wait (section 4.3). */
export async function runAction(
  runner: ActionRunner | undefined,
  store: Store,
  request: ActionRequest,
  waitMs = BACKEND_WAIT_MS,
): Promise<ActionResult> {
  if (!runner) {
    return {
      ok: false,
      error: {
        code: 'no_browser',
        message:
          'Lightpath has no browser open to act in. Start it with a browser (lightpath dev -- <your dev command>, ' +
          'without --no-browser) and wait until it prints "watching".',
      },
    };
  }
  const outcome = await runner(request);
  if (!outcome.ok) return outcome;
  const missing = await waitForBackend(store, outcome.traceId, outcome.tagged, waitMs);
  const trace = store.get(outcome.traceId);
  if (!trace) {
    return {
      ok: false,
      error: { code: 'no_trace', message: `Trace ${outcome.traceId} was evicted before it could be read.` },
    };
  }
  const warnings: ActionWarning[] = [...outcome.warnings];
  if (missing.length > 0) {
    warnings.push({
      code: 'backend_partial',
      message: `No backend lines arrived within ${waitMs} ms for ${missing.map(key).join(', ')}: a remote API, or a server not started by lightpath dev.`,
    });
  }
  return {
    ok: true,
    trace,
    boundary: outcome.boundary,
    settled: outcome.settled,
    backend: missing.length > 0 ? 'partial' : 'complete',
    pageUrl: outcome.pageUrl,
    warnings,
  };
}
