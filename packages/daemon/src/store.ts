import type { Trace, TraceId, TraceSummary } from '@lightpath-dev/protocol';

export interface TraceQuery {
  limit?: number | undefined;
  /** Case-insensitive substring match on the trace label. */
  label?: string | undefined;
}

export interface Store {
  put(trace: Trace): void;
  get(id: TraceId): Trace | undefined;
  /** Newest first. */
  list(query?: TraceQuery): TraceSummary[];
  subscribe(listener: (trace: Trace) => void): () => void;
}

/** Keeps the most recent traces in memory (ARCHITECTURE section 7.3). */
export class MemoryStore implements Store {
  readonly #traces = new Map<TraceId, Trace>();
  readonly #listeners = new Set<(trace: Trace) => void>();
  readonly #capacity: number;

  constructor(capacity = 200) {
    this.#capacity = capacity;
  }

  put(trace: Trace): void {
    // Re-inserting moves the trace to the newest position.
    this.#traces.delete(trace.id);
    this.#traces.set(trace.id, trace);
    while (this.#traces.size > this.#capacity) {
      const oldest = this.#traces.keys().next().value;
      if (oldest === undefined) break;
      this.#traces.delete(oldest);
    }
    for (const listener of this.#listeners) listener(trace);
  }

  get(id: TraceId): Trace | undefined {
    return this.#traces.get(id);
  }

  list(query: TraceQuery = {}): TraceSummary[] {
    const needle = query.label?.toLowerCase();
    const out: TraceSummary[] = [];
    for (const t of [...this.#traces.values()].reverse()) {
      if (needle && !t.label.toLowerCase().includes(needle)) continue;
      out.push({ id: t.id, label: t.label, startedAt: t.startedAt, fileCount: t.files.length });
      if (query.limit && out.length >= query.limit) break;
    }
    return out;
  }

  subscribe(listener: (trace: Trace) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
