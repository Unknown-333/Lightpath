import { connect } from 'node:net';

export interface WaitOptions {
  /** Give up after this long. */
  timeoutMs?: number | undefined;
  /** Time between tries. */
  intervalMs?: number | undefined;
  /** Stop waiting early, e.g. when the dev command exits. */
  signal?: AbortSignal | undefined;
}

/**
 * Resolves true once something accepts a TCP connection on the URL's host and port, and false on
 * timeout or abort (D-126). A TCP check, not an HTTP request, so a 404 page, a redirect or a
 * self-signed https certificate all count as "up", the same as for the browser that opens next.
 */
export async function waitForUrl(url: string, opts: WaitOptions = {}): Promise<boolean> {
  const { hostname, port, protocol } = new URL(url);
  const host = hostname.replace(/^\[(.*)\]$/, '$1');
  const portNumber = Number(port) || (protocol === 'https:' ? 443 : 80);
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  const intervalMs = opts.intervalMs ?? 200;
  while (!opts.signal?.aborted) {
    if (await accepts(host, portNumber)) return true;
    if (Date.now() + intervalMs > deadline) return false;
    await sleep(intervalMs, opts.signal);
  }
  return false;
}

function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    // net tries IPv4 and IPv6 for `localhost` (autoSelectFamily), so a server on ::1 only counts.
    const socket = connect({ host, port, timeout: 2_000 });
    const finish = (up: boolean) => {
      socket.destroy();
      done(up);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      done();
    }
  });
}
