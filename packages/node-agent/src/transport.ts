import type { IngestMessage } from '@lightpath-dev/protocol';

const PROTOCOL_VERSION = 1;
const FLUSH_DELAY_MS = 50;
const MAX_BATCH = 200;
const MAX_QUEUE = 1000;
const MAX_BACKOFF_MS = 5000;

export type Fetch = typeof fetch;

/**
 * Queues messages and POSTs them to the daemon in batches (ADR 0006).
 * Timers are unref'd so the agent never keeps the user's process alive.
 */
export class Transport {
  readonly #queue: IngestMessage[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #sending = false;
  #backoff = 0;
  dropped = 0;
  readonly #url: string;
  readonly #token: string;
  readonly #agentId: string;
  readonly #log: (msg: string) => void;
  readonly #fetch: Fetch;

  constructor(
    url: string,
    token: string,
    agentId: string,
    log: (msg: string) => void,
    fetchImpl: Fetch = fetch,
  ) {
    this.#url = url;
    this.#token = token;
    this.#agentId = agentId;
    this.#log = log;
    this.#fetch = fetchImpl;
  }

  send(message: IngestMessage): void {
    this.#queue.push(message);
    if (this.#queue.length > MAX_QUEUE) {
      this.dropped += this.#queue.length - MAX_QUEUE;
      this.#queue.splice(0, this.#queue.length - MAX_QUEUE);
    }
    this.#schedule(FLUSH_DELAY_MS);
  }

  get pending(): number {
    return this.#queue.length;
  }

  /** Sends everything queued. Resolves when the queue is empty or a send fails. */
  async flush(): Promise<void> {
    if (this.#sending) return;
    this.#sending = true;
    try {
      while (this.#queue.length > 0) {
        const batch = this.#queue.splice(0, MAX_BATCH);
        const ok = await this.#post(batch);
        if (!ok) {
          this.#queue.unshift(...batch);
          this.#backoff = Math.min(MAX_BACKOFF_MS, this.#backoff ? this.#backoff * 2 : 250);
          this.#schedule(this.#backoff);
          return;
        }
        this.#backoff = 0;
      }
    } finally {
      this.#sending = false;
    }
  }

  async #post(messages: IngestMessage[]): Promise<boolean> {
    try {
      const res = await this.#fetch(`${this.#url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#token}` },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, agentId: this.#agentId, messages }),
      });
      if (res.status === 400) {
        // The daemon rejected the batch as malformed. Retrying won't help; drop it.
        this.dropped += messages.length;
        this.#log(`daemon rejected a batch: ${await res.text()}`);
        return true;
      }
      return res.ok;
    } catch (err) {
      this.#log(`send failed: ${(err as Error).message}`);
      return false;
    }
  }

  #schedule(delay: number): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, delay);
    this.#timer.unref();
  }
}
