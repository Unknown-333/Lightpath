import {
  decodeDataUrlSourceMap,
  type LineCounts,
  mapScript,
  mergeLineCounts,
  newTraceId,
  type ResolveContext,
  resolveFile,
} from '@lightpath/core';
import type {
  CollectorKind,
  DeltaMessage,
  DropReason,
  FileHits,
  IngestMessage,
  LinesIngest,
  ScriptInfo,
  Trace,
  TraceId,
} from '@lightpath/protocol';
import type { Store } from './store.js';

type Delta = DeltaMessage;

interface AgentState {
  kind: CollectorKind;
  pid: number;
  /** scriptId → info. Script IDs are only unique per agent. */
  scripts: Map<string, ScriptInfo>;
}

interface PendingTrace {
  trace: Trace;
  files: Map<string, { collector: CollectorKind; lines: LineCounts; firstSeenAt: number }>;
  dropped: Map<DropReason, number>;
}

/**
 * Turns ingest messages into mapped traces (docs/ARCHITECTURE.md sections 3, 4, and 6).
 * Pure in-memory logic with no I/O, so it's tested without sockets.
 */
export class Correlator {
  readonly #agents = new Map<string, AgentState>();
  /** Sources are cached by script hash, shared across agents (ADR 0006). */
  readonly #sources = new Map<string, string>();
  readonly #pending = new Map<TraceId, PendingTrace>();
  readonly #store: Store;
  #ctx: ResolveContext;

  constructor(store: Store, ctx: ResolveContext) {
    this.#store = store;
    this.#ctx = ctx;
  }

  /** Maps URLs served by a dev server (e.g. Vite at http://localhost:5173) onto a directory. */
  addDevServer(origin: string, root: string): void {
    const others = (this.#ctx.devServers ?? []).filter((s) => s.origin !== origin);
    this.#ctx = { ...this.#ctx, devServers: [...others, { origin, root }] };
  }

  get sourceCount(): number {
    return this.#sources.size;
  }

  ingest(agentId: string, message: IngestMessage): void {
    switch (message.type) {
      case 'hello':
        this.#agents.set(agentId, { kind: message.kind, pid: message.pid, scripts: new Map() });
        return;
      case 'scripts': {
        const agent = this.#agent(agentId);
        for (const s of message.scripts) agent.scripts.set(s.scriptId, s);
        return;
      }
      case 'source':
        this.#sources.set(message.hash, message.source);
        return;
      case 'traceStart': {
        // Merge rather than replace, in case a backend delta with this ID arrived first.
        const existing = this.#pending.get(message.traceId);
        if (existing) {
          existing.trace.label = message.label;
          existing.trace.origin = 'browser';
          existing.trace.startedAt = Math.min(existing.trace.startedAt, message.at);
        } else {
          this.#pending.set(
            message.traceId,
            this.#newPending(message.traceId, message.label, 'browser', message.at),
          );
        }
        return;
      }
      case 'traceEnd': {
        const p = this.#pending.get(message.traceId);
        if (p) {
          p.trace.endedAt = message.at;
          this.#publish(p);
        }
        return;
      }
      case 'delta':
        this.#onDelta(agentId, message);
        return;
      case 'lines':
        this.#onLines(agentId, message);
        return;
    }
  }

  #onDelta(agentId: string, delta: Delta): void {
    // Background deltas feed noise rules (ARCHITECTURE 4.6, M1); they never become traces.
    if (delta.phase === 'background') return;
    const agent = this.#agent(agentId);
    const pending = this.#pendingFor(
      delta.traceId,
      delta.request ? `${delta.request.method} ${delta.request.path}` : 'action',
      delta.startedAt,
    );

    for (const coverage of delta.coverage) {
      const info = agent.scripts.get(coverage.scriptId);
      const source = info ? this.#sources.get(info.hash) : undefined;
      if (source === undefined) {
        // Without the exact source V8 ran, offsets can't be turned into lines.
        const r = resolveFile(coverage.url, this.#ctx);
        this.#drop(pending, r.kind === 'dropped' ? r.reason : 'no-source');
        continue;
      }
      let sourceMap: ReturnType<typeof decodeDataUrlSourceMap>;
      try {
        sourceMap = info?.sourceMapURL ? decodeDataUrlSourceMap(info.sourceMapURL) : undefined;
      } catch {
        this.#drop(pending, 'no-source-map');
        continue;
      }
      const result = mapScript({ coverage, source, ...(sourceMap ? { sourceMap } : {}) }, this.#ctx);
      for (const [reason, n] of result.dropped) this.#drop(pending, reason, n);
      for (const [path, lines] of result.files)
        this.#addFile(pending, path, agent.kind, lines, delta.startedAt);
    }

    if (delta.request) {
      pending.trace.requests.push({
        collector: agent.kind,
        pid: agent.pid,
        method: delta.request.method,
        path: delta.request.path,
        ...(delta.request.status !== undefined ? { status: delta.request.status } : {}),
        durationMs: Math.max(0, delta.endedAt - delta.startedAt),
        overlapped: (delta.overlapped?.length ?? 0) > 0,
      });
    }
    // A browser trace ends only with traceEnd, after the frontend's own delta. Backend deltas
    // arrive mid-click and must not make the trace look finished to clients.
    if (pending.trace.origin === 'backend')
      pending.trace.endedAt = Math.max(pending.trace.endedAt ?? 0, delta.endedAt);
    this.#publish(pending);
  }

  #onLines(agentId: string, msg: LinesIngest): void {
    const agent = this.#agent(agentId);
    const label = msg.request ? `${msg.request.method} ${msg.request.path}` : 'action';
    const pending = this.#pendingFor(msg.traceId, label, msg.startedAt);
    for (const file of msg.files) {
      const r = resolveFile(file.path, this.#ctx);
      if (r.kind === 'dropped') {
        this.#drop(pending, r.reason);
        continue;
      }
      this.#addFile(pending, r.path, 'python', new Map(file.lines.map((l) => [l, 1])), msg.startedAt);
    }
    if (msg.request) {
      pending.trace.requests.push({
        collector: 'python',
        pid: agent.pid || msg.pid,
        method: msg.request.method,
        path: msg.request.path,
        ...(msg.request.status !== undefined ? { status: msg.request.status } : {}),
        durationMs: Math.max(0, msg.endedAt - msg.startedAt),
        overlapped: false,
      });
    }
    if (pending.trace.origin === 'backend')
      pending.trace.endedAt = Math.max(pending.trace.endedAt ?? 0, msg.endedAt);
    this.#publish(pending);
  }

  #agent(agentId: string): AgentState {
    let a = this.#agents.get(agentId);
    if (!a) {
      // A batch can arrive before (or without) hello, for example after a daemon restart.
      a = { kind: agentId.startsWith('py-') ? 'python' : 'node', pid: 0, scripts: new Map() };
      this.#agents.set(agentId, a);
    }
    return a;
  }

  /** Finds the browser-started trace for this ID, or starts a backend-only trace. */
  #pendingFor(traceId: TraceId | undefined, label: string, at: number): PendingTrace {
    if (traceId) {
      const existing = this.#pending.get(traceId) ?? this.#fromStore(traceId);
      if (existing) return existing;
    }
    const p = this.#newPending(traceId ?? newTraceId(), label, 'backend', at);
    this.#pending.set(p.trace.id, p);
    return p;
  }

  #fromStore(traceId: TraceId): PendingTrace | undefined {
    const trace = this.#store.get(traceId);
    if (!trace) return undefined;
    const p: PendingTrace = { trace: structuredClone(trace), files: new Map(), dropped: new Map() };
    for (const f of trace.files) {
      p.files.set(f.path, {
        collector: f.collector,
        lines: new Map(f.lines.map((l) => [l.line, l.count])),
        firstSeenAt: f.firstSeenAt,
      });
    }
    for (const d of trace.dropped) p.dropped.set(d.reason, d.count);
    this.#pending.set(traceId, p);
    return p;
  }

  #newPending(id: TraceId, label: string, origin: Trace['origin'], at: number): PendingTrace {
    return {
      trace: { id, label, origin, startedAt: at, files: [], requests: [], dropped: [] },
      files: new Map(),
      dropped: new Map(),
    };
  }

  #addFile(p: PendingTrace, path: string, collector: CollectorKind, lines: LineCounts, at: number): void {
    const existing = p.files.get(path);
    if (existing) existing.lines = mergeLineCounts(existing.lines, lines);
    else p.files.set(path, { collector, lines, firstSeenAt: at });
  }

  #drop(p: PendingTrace, reason: DropReason, n = 1): void {
    p.dropped.set(reason, (p.dropped.get(reason) ?? 0) + n);
  }

  #publish(p: PendingTrace): void {
    const files: FileHits[] = [];
    for (const [path, f] of p.files) {
      const lines = [...f.lines]
        .filter(([, c]) => c > 0)
        .sort((a, b) => a[0] - b[0])
        .map(([line, count]) => ({ line, count }));
      if (lines.length > 0) files.push({ path, collector: f.collector, lines, firstSeenAt: f.firstSeenAt });
    }
    files.sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.path.localeCompare(b.path));
    p.trace.files = files;
    p.trace.dropped = [...p.dropped].map(([reason, count]) => ({ reason, count }));
    this.#store.put(structuredClone(p.trace));
    // Keep at most 50 traces open for late backend deltas; older ones are re-read from the store.
    if (this.#pending.size > 50) {
      const oldest = this.#pending.keys().next().value;
      if (oldest !== undefined) this.#pending.delete(oldest);
    }
  }
}
