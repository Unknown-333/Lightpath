import type { IngestMessage, RequestInfo, ScriptCoverage } from '@lightpath-dev/protocol';
import type { AgentConfig } from './config.js';
import { normalizeRoot } from './config.js';
import type { InspectorSession } from './inspector.js';
import { readExternalSourceMap } from './sourcemap-file.js';

const TRACE_HEADER = 'x-lightpath-trace';
const TRACE_ID = /^t_[a-z0-9]{12}$/;

interface InFlight {
  traceId: string | undefined;
  startedAt: number;
  request: RequestInfo;
  overlapped: Set<string>;
}

/** Minimal shape of the objects published on the http.server.* diagnostics channels. */
export interface ServerRequestLike {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}
export interface ServerResponseLike {
  statusCode: number;
}

/**
 * Turns HTTP request boundaries into coverage deltas (docs/ARCHITECTURE.md section 5.2).
 * All methods are synchronous apart from the transport, and none of them may throw into the app.
 */
export class Agent {
  readonly #inFlight = new Map<ServerRequestLike, InFlight>();
  readonly #sentHashes = new Set<string>();
  readonly #session: InspectorSession;
  readonly #config: AgentConfig;
  readonly #send: (m: IngestMessage) => void;
  readonly #ownUrlPrefix: string;

  constructor(
    session: InspectorSession,
    config: AgentConfig,
    send: (m: IngestMessage) => void,
    ownUrl: string,
  ) {
    this.#session = session;
    this.#config = config;
    this.#send = send;
    // Everything under the agent's own dist directory is excluded from deltas.
    this.#ownUrlPrefix = ownUrl.slice(0, ownUrl.lastIndexOf('/') + 1);
  }

  onRequestStart(req: ServerRequestLike): void {
    if (this.#inFlight.size === 0) this.#emit('background', this.#session.take(), Date.now());
    const now = Date.now();
    const header = req.headers[TRACE_HEADER];
    const traceId = typeof header === 'string' && TRACE_ID.test(header) ? header : undefined;
    const entry: InFlight = {
      traceId,
      startedAt: now,
      request: { method: req.method ?? 'GET', path: (req.url ?? '/').split('?')[0] ?? '/' },
      overlapped: new Set(),
    };
    for (const other of this.#inFlight.values()) {
      if (other.traceId) entry.overlapped.add(other.traceId);
      if (traceId) other.overlapped.add(traceId);
    }
    this.#inFlight.set(req, entry);
  }

  onResponseFinish(req: ServerRequestLike, res: ServerResponseLike): void {
    const entry = this.#inFlight.get(req);
    if (!entry) return;
    this.#inFlight.delete(req);
    const coverage = this.#session.take();
    entry.request.status = res.statusCode;
    this.#emit('action', coverage, entry.startedAt, entry);
  }

  #emit(phase: 'background' | 'action', raw: ScriptCoverage[], startedAt: number, entry?: InFlight): void {
    const coverage = raw.filter((s) => this.#keep(s.url));
    if (coverage.length === 0 && phase === 'background') return;
    this.#pushSources(coverage);
    const overlapped = entry && entry.overlapped.size > 0 ? [...entry.overlapped] : undefined;
    this.#send({
      type: 'delta',
      phase,
      startedAt,
      endedAt: Date.now(),
      coverage,
      ...(entry?.traceId ? { traceId: entry.traceId } : {}),
      ...(entry ? { request: entry.request } : {}),
      ...(overlapped ? { overlapped } : {}),
    });
  }

  /** Drops Node internals, dependencies, and the agent itself before anything leaves the process. */
  #keep(url: string): boolean {
    if (!url || url.startsWith('node:') || url.startsWith(this.#ownUrlPrefix)) return false;
    return !/[\\/]node_modules[\\/]/.test(url);
  }

  /** Sends script info and source the first time a workspace script shows up (ADR 0006). */
  #pushSources(coverage: ScriptCoverage[]): void {
    for (const { scriptId } of coverage) {
      const script = this.#session.scripts.get(scriptId);
      if (!script || this.#sentHashes.has(script.hash) || !this.#inWorkspace(script.url)) continue;
      this.#sentHashes.add(script.hash);
      let source: string;
      try {
        source = this.#session.source(scriptId);
      } catch {
        continue;
      }
      const sourceMapURL = script.sourceMapURL.startsWith('data:')
        ? script.sourceMapURL
        : readExternalSourceMap(script.url, script.sourceMapURL, (u) => this.#inWorkspace(u));
      this.#send({
        type: 'scripts',
        scripts: [
          {
            scriptId,
            url: script.url,
            hash: script.hash,
            length: script.length,
            // Inline maps as V8 reported them; external .map files read once, as data: URLs.
            ...(sourceMapURL ? { sourceMapURL } : {}),
          },
        ],
      });
      this.#send({ type: 'source', scriptId, hash: script.hash, url: script.url, source });
    }
  }

  #inWorkspace(url: string): boolean {
    if (!url.startsWith('file://')) return false;
    let path = decodeURIComponent(url.slice('file://'.length));
    if (/^\/[a-zA-Z]:/.test(path)) path = path.slice(1);
    const p = normalizeRoot(path);
    return this.#config.roots.some((root) => p === root || p.startsWith(`${root}/`));
  }
}
