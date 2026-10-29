import type { IngestMessage } from '@lightpath-dev/protocol';

const PROTOCOL_VERSION = 1;
const FLUSH_DELAY_MS = 50;
const MAX_BATCH = 200;
const MAX_QUEUE = 1000;
const MAX_BACKOFF_MS = 5000;
/**
 * Largest request body the agent sends. The daemon rejects bodies over MAX_MESSAGE_BYTES (8 MB) in
 * @lightpath-dev/protocol; the agent can't import it (ADR 0002), so test/transport.test.ts checks
 * this stays below it with room for the envelope.
 */
export const MAX_BODY_BYTES = 7 * 1024 * 1024;

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
  readonly #maxBodyBytes: number;

  constructor(
    url: string,
    token: string,
    agentId: string,
    log: (msg: string) => void,
    fetchImpl: Fetch = fetch,
    maxBodyBytes = MAX_BODY_BYTES,
  ) {
    this.#url = url;
    this.#token = token;
    this.#agentId = agentId;
    this.#log = log;
    this.#fetch = fetchImpl;
    this.#maxBodyBytes = maxBodyBytes;
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
        const { count, body } = this.#nextBatch();
        if (count === 0) continue; // the head message was too large and has been dropped
        const ok = await this.#post(body, count);
        if (!ok) {
          this.#backoff = Math.min(MAX_BACKOFF_MS, this.#backoff ? this.#backoff * 2 : 250);
          this.#schedule(this.#backoff);
          return;
        }
        this.#queue.splice(0, count);
        this.#backoff = 0;
      }
    } finally {
      this.#sending = false;
    }
  }

  /**
   * Takes messages from the head of the queue until the batch would exceed MAX_BATCH messages or
   * the body size limit. Each message is serialized once, and the body is joined from those parts.
   * A single message over the limit can never be sent, so it's dropped here.
   */
  #nextBatch(): { count: number; body: string } {
    const head = `{"protocolVersion":${PROTOCOL_VERSION},"agentId":${JSON.stringify(this.#agentId)},"messages":[`;
    const tail = ']}';
    let bytes = Buffer.byteLength(head) + tail.length;
    const parts: string[] = [];
    while (parts.length < MAX_BATCH && parts.length < this.#queue.length) {
      const json = JSON.stringify(this.#queue[parts.length]);
      const size = Buffer.byteLength(json) + (parts.length > 0 ? 1 : 0); // comma
      if (bytes + size > this.#maxBodyBytes) {
        if (parts.length === 0) {
          const [message] = this.#queue.splice(0, 1);
          this.dropped++;
          this.#log(`dropped a ${message?.type} message of ${size} bytes (limit ${this.#maxBodyBytes})`);
        }
        break;
      }
      parts.push(json);
      bytes += size;
    }
    return { count: parts.length, body: `${head}${parts.join(',')}${tail}` };
  }

  /** True when the batch is done with: delivered, or rejected in a way a retry can't fix. */
  async #post(body: string, count: number): Promise<boolean> {
    try {
      const res = await this.#fetch(`${this.#url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#token}` },
        body,
      });
      if (res.status === 400 || res.status === 413) {
        // Malformed or too large: sending the same batch again would fail the same way. Drop it,
        // or it would block everything queued behind it.
        this.dropped += count;
        this.#log(`daemon rejected a batch (${res.status}): ${await res.text()}`);
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
