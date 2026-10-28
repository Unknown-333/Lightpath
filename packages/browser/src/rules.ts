/** Resource types that carry app requests worth tagging (ADR 0004). */
const TAGGABLE = new Set(['fetch', 'xhr']);

/**
 * Tags only fetch/XHR requests to configured backend origins. Never touches other origins:
 * a custom header on a cross-origin request triggers a CORS preflight and changes app behavior.
 */
export function shouldTag(
  requestUrl: string,
  resourceType: string,
  backendOrigins: readonly string[],
): boolean {
  if (!TAGGABLE.has(resourceType)) return false;
  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return false;
  }
  return backendOrigins.includes(origin);
}

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
}

/** A short human label for a click target, like `button: Checkout`. */
export function labelFor(target: TargetInfo): string {
  const kind = target.role || target.tag || 'element';
  const name = (target.name || target.testId || target.text || '').replace(/\s+/g, ' ').trim();
  const short = name.length > 40 ? `${name.slice(0, 39)}…` : name;
  return short ? `${kind}: ${short}` : kind;
}

/** Scripts whose source never needs to leave the browser: dependencies and dev-server internals. */
export function isNoiseScript(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return true;
  return /\/node_modules\/|\/@vite\/|\/@react-refresh|\/@id\/__x00__|\/__vite/.test(url);
}
