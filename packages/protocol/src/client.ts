import { type ClientMessage, DaemonToClientMessage } from './messages.js';
import type { Trace, TraceId, TraceSummary } from './model.js';

type Pending = { resolve: (m: DaemonToClientMessage) => void; reject: (e: Error) => void };

/**
 * Client for the daemon's `/v1/client` WebSocket feed. Uses the global `WebSocket`
 * (Node 22+, VS Code's extension host, browsers), which sends no `Origin` header (measured),
 * so it passes the daemon's origin check.
 */
export class DaemonClient {
  readonly #ws: WebSocket;
  readonly #pending = new Map<string, Pending>();
  readonly #traceListeners = new Set<(trace: Trace) => void>();
  readonly #closeListeners = new Set<() => void>();
  #nextId = 1;
  /** Workspace roots the daemon resolves file paths against; trace paths are relative to these. */
  readonly workspaceRoots: readonly string[];

  private constructor(ws: WebSocket, workspaceRoots: readonly string[]) {
    this.#ws = ws;
    this.workspaceRoots = workspaceRoots;
    ws.addEventListener('message', (e) => this.#onMessage(String(e.data)));
    ws.addEventListener('close', () => {
      for (const p of this.#pending.values()) p.reject(new Error('daemon connection closed'));
      this.#pending.clear();
      for (const fn of this.#closeListeners) fn();
    });
  }

  /** Connects and waits for the daemon's welcome message. */
  static connect(port: number, token: string, timeoutMs = 5000): Promise<DaemonClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/client?token=${encodeURIComponent(token)}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`no response from the Lightpath daemon on port ${port}`));
      }, timeoutMs);
      const onFirst = (e: MessageEvent) => {
        const parsed = DaemonToClientMessage.safeParse(JSON.parse(String(e.data)));
        if (parsed.success && parsed.data.type === 'welcome') {
          clearTimeout(timer);
          ws.removeEventListener('message', onFirst);
          resolve(new DaemonClient(ws, parsed.data.workspaceRoots));
        }
      };
      ws.addEventListener('message', onFirst);
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`could not connect to the Lightpath daemon on port ${port}`));
      });
    });
  }

  /** Called for every new or updated trace. Returns an unsubscribe function. */
  onTrace(listener: (trace: Trace) => void): () => void {
    this.#traceListeners.add(listener);
    return () => this.#traceListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  async listTraces(query: { limit?: number; label?: string } = {}): Promise<TraceSummary[]> {
    const reply = await this.#request({ type: 'listTraces', requestId: this.#id(), ...query });
    return reply.type === 'traces' ? reply.traces : [];
  }

  async getTrace(traceId: TraceId): Promise<Trace | null> {
    const reply = await this.#request({ type: 'getTrace', requestId: this.#id(), traceId });
    return reply.type === 'traceResult' ? reply.trace : null;
  }

  close(): void {
    this.#ws.close();
  }

  #id(): string {
    return String(this.#nextId++);
  }

  #request(message: ClientMessage): Promise<DaemonToClientMessage> {
    return new Promise((resolve, reject) => {
      this.#pending.set(message.requestId, { resolve, reject });
      this.#ws.send(JSON.stringify(message));
    });
  }

  #onMessage(raw: string): void {
    let parsed: ReturnType<typeof DaemonToClientMessage.safeParse>;
    try {
      parsed = DaemonToClientMessage.safeParse(JSON.parse(raw));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.type === 'trace' || m.type === 'traceUpdate') {
      for (const fn of this.#traceListeners) fn(m.trace);
    } else if (m.type === 'traces' || m.type === 'traceResult') {
      const p = this.#pending.get(m.requestId);
      this.#pending.delete(m.requestId);
      p?.resolve(m);
    }
  }
}
