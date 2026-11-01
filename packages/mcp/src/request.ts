import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { TRACE_HEADER, type Trace, type TraceId } from '@lightpath-dev/protocol';

/** Longest wait after the response for the backend trace (design section 4A, D-125). */
export const REQUEST_TRACE_WAIT_MS = 1500;

export const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];

export interface RunRequestInput {
  method?: RequestMethod | undefined;
  /** A path (`/api/orders`), resolved against the app's URL, or a full loopback URL. */
  url: string;
  body?: string | undefined;
  contentType?: string | undefined;
  timeoutMs?: number | undefined;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True for 127.0.0.0/8 and ::1 (and ::ffff:127.x), the only addresses a request may go to. */
export function isLoopbackAddress(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)) return true;
  return address === '::1' || address === '0:0:0:0:0:0:0:1';
}

export type Target =
  | { ok: true; url: URL; address: string; family: number }
  | { ok: false; code: 'not_loopback' | 'no_app_url'; message: string };

/**
 * Checks where a request would go, before any network call (design section 4A): http or https,
 * host `localhost`, `127.0.0.1` or `[::1]`, and every address `localhost` resolves to on loopback.
 * Returns the vetted address, so the request connects there and can't be sent elsewhere by a
 * second lookup.
 */
export async function resolveTarget(
  raw: string,
  appUrl: string | undefined,
  resolve: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true }),
): Promise<Target> {
  let url: URL;
  if (raw.startsWith('/')) {
    if (!appUrl) {
      return {
        ok: false,
        code: 'no_app_url',
        message: `"${pathOnly(raw)}" is a path, but no app URL is set. Pass a full loopback URL like http://localhost:3001${pathOnly(raw)}, or set "url" in lightpath.config.json.`,
      };
    }
    try {
      url = new URL(raw, appUrl);
    } catch {
      return { ok: false, code: 'not_loopback', message: `"url" in lightpath.config.json isn't a URL.` };
    }
  } else {
    try {
      url = new URL(raw);
    } catch {
      return {
        ok: false,
        code: 'not_loopback',
        message: 'Not a URL. Pass a path like /api/orders or http://localhost:3001/api/orders.',
      };
    }
  }
  const refuse = (why: string): Target => ({
    ok: false,
    code: 'not_loopback',
    message: `Refused before sending: ${why}. run_request only sends to localhost, 127.0.0.1 or [::1], so nothing leaves this machine.`,
  });
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return refuse(`the scheme is ${url.protocol.replace(':', '')}`);
  if (url.username || url.password) return refuse('the URL has a user name or password');
  if (!LOOPBACK_HOSTS.has(url.hostname)) return refuse(`the host is ${url.hostname}`);
  if (url.hostname === '127.0.0.1') return { ok: true, url, address: '127.0.0.1', family: 4 };
  if (url.hostname === '[::1]') return { ok: true, url, address: '::1', family: 6 };
  let addresses: { address: string; family: number }[];
  try {
    addresses = await resolve('localhost');
  } catch {
    return refuse('localhost did not resolve');
  }
  if (addresses.length === 0 || !addresses.every((a) => isLoopbackAddress(a.address))) {
    return refuse(
      `localhost resolves to ${addresses.map((a) => a.address).join(', ') || 'nothing'}, not only loopback`,
    );
  }
  // Prefer IPv4, as dev servers bound to 127.0.0.1 are the common case; fall back to the rest.
  const first =
    addresses.find((a) => a.family === 4) ?? (addresses[0] as { address: string; family: number });
  return { ok: true, url, address: first.address, family: first.family };
}

/** `/api/orders?token=x` → `/api/orders`: queries never reach the output (they can hold secrets). */
export const pathOnly = (pathOrUrl: string) => pathOrUrl.split(/[?#]/)[0] ?? pathOrUrl;

/** `t_` + 12 random base36 characters, the TraceId format (packages/protocol/src/model.ts). */
export function newRequestTraceId(): TraceId {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(12);
  let id = 't_';
  for (const b of bytes) id += alphabet[b % 36];
  return id as TraceId;
}

export type Sent =
  | { ok: true; status: number; bytes: number; durationMs: number; location?: string | undefined }
  | { ok: false; message: string };

/**
 * Sends one request to a vetted loopback address with Lightpath's trace header. Uses node:http
 * with its own agent: no proxy (HTTP_PROXY, HTTPS_PROXY and NODE_USE_ENV_PROXY are ignored), no
 * redirect followed, and the connection goes to the address `resolveTarget` checked. The response
 * body is read for its size only and never kept.
 */
export function sendRequest(
  target: Extract<Target, { ok: true }>,
  input: RunRequestInput,
  traceId: TraceId,
): Promise<Sent> {
  const { url } = target;
  const lib = url.protocol === 'https:' ? https : http;
  const agent = new lib.Agent({ keepAlive: false });
  const lookup: LookupFunction = (_host, options, callback) => {
    const all = typeof options === 'object' && options !== null && 'all' in options && options.all;
    if (all)
      (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address: target.address, family: target.family },
      ]);
    else callback(null, target.address, target.family);
  };
  const headers: Record<string, string> = { [TRACE_HEADER]: traceId };
  if (input.body !== undefined) {
    headers['content-type'] = input.contentType ?? 'application/json';
    headers['content-length'] = String(Buffer.byteLength(input.body));
  } else if (input.contentType) headers['content-type'] = input.contentType;
  const started = performance.now();
  const timeoutMs = input.timeoutMs ?? 10_000;
  return new Promise((resolve) => {
    const req = lib.request(
      url,
      { method: input.method ?? 'GET', headers, agent, lookup, timeout: timeoutMs },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
        });
        res.on('end', () => {
          agent.destroy();
          resolve({
            ok: true,
            status: res.statusCode ?? 0,
            bytes,
            durationMs: performance.now() - started,
            location: typeof res.headers.location === 'string' ? res.headers.location : undefined,
          });
        });
        res.on('error', (err) => {
          agent.destroy();
          resolve({ ok: false, message: err.message });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`no response within ${timeoutMs} ms`)));
    req.on('error', (err) => {
      agent.destroy();
      resolve({ ok: false, message: (err as NodeJS.ErrnoException).code ?? err.message });
    });
    if (input.body !== undefined) req.write(input.body);
    req.end();
  });
}

/** Where a redirect points, when that is loopback too: its origin only. Undefined otherwise. */
export function loopbackLocation(location: string | undefined, base: URL): string | undefined {
  if (!location) return undefined;
  try {
    const to = new URL(location, base);
    return LOOPBACK_HOSTS.has(to.hostname) ? `${to.origin}${pathOnly(to.pathname)}` : undefined;
  } catch {
    return undefined;
  }
}

/** True once the trace holds the backend side of the request (a non-browser request entry). */
export const hasBackend = (t: Trace | null | undefined) =>
  Boolean(t?.requests.some((r) => r.collector !== 'browser'));
