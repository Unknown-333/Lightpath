import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** 32 random bytes, base64url-encoded (43 characters). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokensEqual(expected: string, actual: string | undefined | null): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Checks a request against the daemon's rules (ARCHITECTURE section 7.2):
 * - no `Origin` header, so web pages in the user's browser can't talk to the daemon;
 * - the token in `Authorization: Bearer <token>` or, for WebSocket upgrades, `?token=`.
 */
export function authorize(req: IncomingMessage, token: string): 'ok' | 'forbidden' | 'unauthorized' {
  if (req.headers.origin !== undefined) return 'forbidden';
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
  return tokensEqual(token, bearer ?? query) ? 'ok' : 'unauthorized';
}
