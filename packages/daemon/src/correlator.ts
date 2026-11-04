import {
  decodeDataUrlSourceMap,
  type LineCounts,
  mapFunctions,
  mapScript,
  mergeLineCounts,
  newTraceId,
  originalLocation,
  PeriodicFunctions,
  type ResolveContext,
  resolveFile,
} from '@lightpath-dev/core';
import {
  type CollectorKind,
  type DeltaMessage,
  type DropReason,
  type FileHits,
  type FunctionHit,
  type IngestMessage,
  type LinesIngest,
  MAX_TRACE_PROBLEMS,
  type ProblemMessage,
  type ScriptInfo,
  type Trace,
  type TraceId,
  type TracePhase,
} from '@lightpath-dev/protocol';
import type { Store } from './store.js';

type Delta = DeltaMessage;

interface AgentState {
  kind: CollectorKind;
  pid: number;
  /** scriptId → info. Script IDs are only unique per agent. */
  scripts: Map<string, ScriptInfo>;
  /** Functions this agent keeps running while idle (ARCHITECTURE 4.6, rule 2). */
  periodic: PeriodicFunctions;
}

/** A phase while the trace is open; ordered and numbered when it is published (D-116). */
interface OpenPhase {
  kind: TracePhase['kind'];
  /** Sort key: when the read was taken, or when the request started. */
  at: number;
  /** before-request: the request that left the page. */
  leaving?: { method: string; path: string };
  /** backend: index into trace.requests. */
  request?: number;
}

interface OpenFunction {
  phase: OpenPhase;
  hit: Omit<FunctionHit, 'phase'>;
}

interface PendingTrace {
  phases: OpenPhase[];
  /** The browser phase for reads that aren't before a request (closing, leaving), made on first use. */
  closing?: OpenPhase;
  /** `phase|path|name|startLine` → the function, merged over deltas of that phase. */
  functions: Map<string, OpenFunction>;
  trace: Trace;
  files: Map<
    string,
    {
      collector: CollectorKind;
      lines: LineCounts;
      firstSeenAt: number;
      /** True once any line ran from code that isn't periodic. */
      foreground: boolean;
    }
  >;
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
        this.#agents.set(agentId, {
          kind: message.kind,
          pid: message.pid,
          scripts: new Map(),
          periodic: new PeriodicFunctions(),
        });
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
      case 'problem':
        this.#onProblem(agentId, message);
        return;
    }
  }

  /** Attaches an error or failed request to its trace (D-121). Without an open trace, dropped. */
  #onProblem(agentId: string, msg: ProblemMessage): void {
    if (!msg.traceId) return;
    const agent = this.#agent(agentId);
    // A backend crash during run_request comes before any delta for its trace: it opens one.
    const pending =
      this.#pending.get(msg.traceId) ??
      this.#fromStore(msg.traceId) ??
      (agent.kind === 'browser' ? undefined : this.#pendingFor(msg.traceId, 'uncaught error', msg.at));
    if (!pending) return;
    pending.trace.problems ??= [];
    const problems = pending.trace.problems;
    if (problems.length >= MAX_TRACE_PROBLEMS) {
      pending.trace.problemsDropped = (pending.trace.problemsDropped ?? 0) + 1;
      this.#publish(pending);
      return;
    }
    const where = msg.location ? this.#locate(agent, msg.location) : undefined;
    problems.push({
      collector: agent.kind,
      kind: msg.kind,
      message: msg.message,
      at: msg.at,
      ...(where ? { path: where.path, line: where.line } : {}),
      ...(msg.request ? { request: msg.request } : {}),
    });
    this.#publish(pending);
  }

  /** A problem's generated location as a workspace path and original line, if it maps there. */
  #locate(
    agent: AgentState,
    loc: { url: string; line: number; column: number },
  ): { path: string; line: number } | undefined {
    if (loc.line < 1) return undefined;
    const info = [...agent.scripts.values()].reverse().find((s) => s.url === loc.url);
    let source = loc.url;
    let line = loc.line;
    if (info?.sourceMapURL) {
      try {
        const map = decodeDataUrlSourceMap(info.sourceMapURL);
        const orig = map ? originalLocation(map, info.url, loc.line, loc.column) : undefined;
        if (!orig) return undefined;
        source = orig.source;
        line = orig.line;
      } catch {
        return undefined;
      }
    }
    const r = resolveFile(source, this.#ctx);
    return r.kind === 'workspace' ? { path: r.path, line } : undefined;
  }

  #onDelta(agentId: string, delta: Delta): void {
    const agent = this.#agent(agentId);
    // Background deltas only feed the periodic-function rule (ARCHITECTURE 4.6); never traces.
    if (delta.phase === 'background') {
      agent.periodic.observeBackground(delta.coverage, (id) => agent.scripts.get(id)?.hash);
      return;
    }
    const pending = this.#pendingFor(
      delta.traceId,
      delta.request ? `${delta.request.method} ${delta.request.path}` : 'action',
      delta.startedAt,
    );
    // Which phase this delta's functions belong to (D-116). A backend phase is made below, once
    // the request has its index.
    let phase: OpenPhase | undefined;
    if (delta.beforeRequest) {
      phase = { kind: 'before-request', at: delta.endedAt, leaving: delta.beforeRequest };
      pending.phases.push(phase);
    } else if (!delta.request) {
      phase = this.#closingPhase(pending, delta.endedAt);
    } else {
      phase = { kind: 'backend', at: delta.startedAt, request: pending.trace.requests.length };
      pending.phases.push(phase);
    }

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
      const map = (c: typeof coverage) =>
        mapScript({ coverage: c, source, ...(sourceMap ? { sourceMap } : {}) }, this.#ctx);
      const result = map(coverage);
      for (const [reason, n] of result.dropped) this.#drop(pending, reason, n);
      // Lines are never removed. A file whose lit lines all come from periodic code (a timer that
      // happened to fire during the action) is marked background so clients can tone it down.
      const fg = info ? agent.periodic.foreground(coverage, info.hash) : coverage;
      const fgFiles = fg === coverage ? result.files : fg ? map(fg).files : new Map<string, LineCounts>();
      for (const [path, lines] of result.files) {
        const fgLines = fgFiles.get(path);
        const foreground = fgLines !== undefined && [...fgLines.values()].some((c) => c > 0);
        this.#addFile(pending, path, agent.kind, lines, delta.startedAt, foreground);
      }
      const fns = mapFunctions(
        { coverage, source, ...(sourceMap ? { sourceMap } : {}) },
        result.files,
        this.#ctx,
        result.unknown,
      );
      for (const fn of fns) this.#addFunction(pending, phase, agent.kind, fn);
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

  /** Adds one function to its phase, summing calls and keeping lines not run in every delta. */
  #addFunction(
    p: PendingTrace,
    phase: OpenPhase,
    collector: CollectorKind,
    fn: ReturnType<typeof mapFunctions>[number],
  ): void {
    const key = `${p.phases.indexOf(phase)}|${phase.kind}|${fn.path}|${fn.name}|${fn.startLine}`;
    const prev = p.functions.get(key);
    if (!prev) {
      p.functions.set(key, {
        phase,
        hit: {
          path: fn.path,
          collector,
          name: fn.name,
          startLine: fn.startLine,
          endLine: fn.endLine,
          count: fn.count,
          ...(fn.notRun.length ? { notRun: fn.notRun } : {}),
          ...(fn.notRunSpans.length ? { notRunSpans: fn.notRunSpans } : {}),
          ...(fn.unknown.length ? { unknown: fn.unknown } : {}),
        },
      });
      return;
    }
    const hit = prev.hit;
    hit.count += fn.count;
    hit.endLine = Math.max(hit.endLine, fn.endLine);
    const notRun = (hit.notRun ?? []).filter((l) => fn.notRun.includes(l));
    const spans = (hit.notRunSpans ?? []).filter((s) =>
      fn.notRunSpans.some((t) => t.line === s.line && t.startColumn === s.startColumn),
    );
    if (notRun.length) hit.notRun = notRun;
    else delete hit.notRun;
    if (spans.length) hit.notRunSpans = spans;
    else delete hit.notRunSpans;
    // Unknown lines (D-153) add up; a line another delta ran is shown as run by its file.
    if (fn.unknown.length) {
      const merged = new Map((hit.unknown ?? []).map((u) => [u.threwAfter, new Set(u.lines)]));
      for (const u of fn.unknown) {
        const lines = merged.get(u.threwAfter) ?? new Set<number>();
        for (const l of u.lines) lines.add(l);
        merged.set(u.threwAfter, lines);
      }
      hit.unknown = [...merged].map(([threwAfter, lines]) => ({
        lines: [...lines].sort((a, b) => a - b),
        threwAfter,
      }));
    }
  }

  /** The one browser phase for reads not taken before a request (D-116), made on first use. */
  #closingPhase(p: PendingTrace, at: number): OpenPhase {
    if (!p.closing) {
      p.closing = { kind: 'browser', at };
      p.phases.push(p.closing);
    }
    p.closing.at = Math.max(p.closing.at, at);
    return p.closing;
  }

  #onLines(agentId: string, msg: LinesIngest): void {
    const agent = this.#agent(agentId);
    const label = msg.request ? `${msg.request.method} ${msg.request.path}` : 'action';
    const pending = this.#pendingFor(msg.traceId, label, msg.startedAt);
    // Python files have no function list; the summary lists them by line range in this phase.
    if (msg.request)
      pending.phases.push({ kind: 'backend', at: msg.startedAt, request: pending.trace.requests.length });
    for (const file of msg.files) {
      const r = resolveFile(file.path, this.#ctx);
      if (r.kind === 'dropped') {
        this.#drop(pending, r.reason);
        continue;
      }
      this.#addFile(pending, r.path, 'python', new Map(file.lines.map((l) => [l, 1])), msg.startedAt, true);
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
      a = {
        kind: agentId.startsWith('py-') ? 'python' : 'node',
        pid: 0,
        scripts: new Map(),
        periodic: new PeriodicFunctions(),
      };
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
    const p: PendingTrace = {
      trace: structuredClone(trace),
      files: new Map(),
      dropped: new Map(),
      phases: [],
      functions: new Map(),
    };
    // Phases keep their published order: their old sort keys are their positions, which sort
    // before any new read's time. The closing browser phase stays last.
    for (const [i, ph] of (trace.phases ?? []).entries()) {
      const open: OpenPhase = {
        kind: ph.kind,
        at: i,
        ...(ph.request !== undefined ? { request: ph.request } : {}),
      };
      if (ph.kind === 'before-request' && ph.request !== undefined) {
        const r = trace.requests[ph.request];
        if (r) open.leaving = { method: r.method, path: r.path };
      }
      if (ph.kind === 'browser' || ph.kind === 'after-response') p.closing = open;
      p.phases.push(open);
    }
    for (const f of trace.functions ?? []) {
      const phase = p.phases[f.phase];
      if (!phase) continue;
      const { phase: _, ...hit } = f;
      p.functions.set(`${f.phase}|${phase.kind}|${f.path}|${f.name}|${f.startLine}`, { phase, hit });
    }
    for (const f of trace.files) {
      p.files.set(f.path, {
        collector: f.collector,
        lines: new Map(f.lines.map((l) => [l.line, l.count])),
        firstSeenAt: f.firstSeenAt,
        foreground: !f.background,
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
      phases: [],
      functions: new Map(),
    };
  }

  /**
   * Orders the phases and numbers them (design section 5.3): reads and requests in time order, the
   * closing browser phase last. It is `after-response` when any request left the page before it,
   * else `browser`. Each before-request phase is tied to the first unmatched backend request with
   * the same method and path.
   */
  #phasesOf(
    p: PendingTrace,
    published: ReadonlySet<string>,
  ): { phases: TracePhase[]; functions: FunctionHit[] } | undefined {
    if (p.phases.length === 0) return undefined;
    const ordered = p.phases.filter((ph) => ph !== p.closing).sort((a, b) => a.at - b.at);
    if (p.closing) ordered.push(p.closing);
    const hasBefore = ordered.some((ph) => ph.kind === 'before-request');
    const matched = new Set<number>();
    const phases: TracePhase[] = ordered.map((ph) => {
      if (ph === p.closing) return { kind: hasBefore ? 'after-response' : 'browser' };
      if (ph.kind === 'backend')
        return { kind: 'backend', ...(ph.request !== undefined ? { request: ph.request } : {}) };
      if (ph.kind === 'before-request' && ph.leaving) {
        const { method, path } = ph.leaving;
        const i = p.trace.requests.findIndex(
          (r, j) => !matched.has(j) && r.collector !== 'browser' && r.method === method && r.path === path,
        );
        if (i >= 0) {
          matched.add(i);
          return { kind: 'before-request', request: i };
        }
      }
      return { kind: ph.kind };
    });
    const functions: FunctionHit[] = [];
    for (const { phase, hit } of p.functions.values()) {
      if (!published.has(hit.path)) continue; // its file has no lit line, so it isn't in the trace
      functions.push({ ...hit, phase: ordered.indexOf(phase) });
    }
    functions.sort((a, b) => a.phase - b.phase || a.path.localeCompare(b.path) || a.startLine - b.startLine);
    return { phases, functions };
  }

  #addFile(
    p: PendingTrace,
    path: string,
    collector: CollectorKind,
    lines: LineCounts,
    at: number,
    foreground: boolean,
  ): void {
    const existing = p.files.get(path);
    if (existing) {
      existing.lines = mergeLineCounts(existing.lines, lines);
      existing.foreground ||= foreground;
    } else p.files.set(path, { collector, lines, firstSeenAt: at, foreground });
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
      if (lines.length === 0) continue;
      files.push({
        path,
        collector: f.collector,
        lines,
        firstSeenAt: f.firstSeenAt,
        ...(f.foreground ? {} : { background: true }),
      });
    }
    files.sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.path.localeCompare(b.path));
    p.trace.files = files;
    p.trace.dropped = [...p.dropped].map(([reason, count]) => ({ reason, count }));
    const shaped = this.#phasesOf(p, new Set(files.map((f) => f.path)));
    if (shaped) {
      p.trace.phases = shaped.phases;
      p.trace.functions = shaped.functions;
    }
    this.#store.put(structuredClone(p.trace));
    // Keep at most 50 traces open for late backend deltas; older ones are re-read from the store.
    if (this.#pending.size > 50) {
      const oldest = this.#pending.keys().next().value;
      if (oldest !== undefined) this.#pending.delete(oldest);
    }
  }
}
