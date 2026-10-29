/**
 * Resource types that carry app requests worth tagging (ADR 0004). `navigation` is a main-frame
 * page load started by an action (the collector passes it explicitly): a server-rendered page or a
 * form post is backend work for that action. Navigations aren't subject to CORS, so the header
 * can't trigger a preflight.
 */
const TAGGABLE = new Set(['fetch', 'xhr', 'navigation']);

/**
 * Tags fetch/XHR requests to configured backend origins and to any loopback origin (D-086).
 *
 * The header is added by request interception after the browser has done its CORS checks, so it
 * never triggers a preflight, even when the API's CORS policy doesn't allow custom headers
 * (measured in Chrome). Loopback is the common dev setup: Vite on :5173 calling an API on :3001.
 * Remote origins (a payment provider, a CDN) are never tagged: the trace ID is no business of theirs.
 */
export function shouldTag(
  requestUrl: string,
  resourceType: string,
  backendOrigins: readonly string[],
): boolean {
  if (!TAGGABLE.has(resourceType)) return false;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }
  if (backendOrigins.includes(url.origin)) return true;
  return /^https?:$/.test(url.protocol) && LOOPBACK.has(url.hostname);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Requests that count toward the settle window. Long-lived streams would keep a click open forever. */
export function countsTowardSettle(resourceType: string): boolean {
  return !['websocket', 'eventsource', 'media', 'manifest', 'ping'].includes(resourceType);
}

export interface TargetInfo {
  tag?: string | undefined;
  role?: string | undefined;
  name?: string | undefined;
  testId?: string | undefined;
  text?: string | undefined;
  /** Set when the action was a key press (`Enter` or `Space`) rather than a pointer press. */
  key?: string | undefined;
}

/** A short human label for an action target, like `button: Checkout` or `button: Checkout (Enter)`. */
export function labelFor(target: TargetInfo): string {
  const kind = target.role || target.tag || 'element';
  const name = (target.name || target.testId || target.text || '').replace(/\s+/g, ' ').trim();
  const short = name.length > 40 ? `${name.slice(0, 39)}…` : name;
  const base = short ? `${kind}: ${short}` : kind;
  return target.key ? `${base} (${target.key})` : base;
}

/** Scripts whose source never needs to leave the browser: dependencies and dev-server internals. */
export function isNoiseScript(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return true;
  return /\/node_modules\/|\/@vite\/|\/@react-refresh|\/@id\/__x00__|\/__vite/.test(url);
}
