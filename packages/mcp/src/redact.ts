const WORDS = 'token|key|secret|pass|auth|session|sig';
const R = '[redacted]';

/** Rule 2: URL query values whose name holds a secret word, any case. */
const QUERY = new RegExp(`([?&][^=&#\\s]*(?:${WORDS})[^=&#\\s]*=)([^&#\\s]*)`, 'gi');
/** Rule 3: bearer tokens. */
const BEARER = /\b(Bearer\s+)(?!\[redacted\])[^\s"',;]+/gi;
/** Rule 4: JWT-like strings, three base64url parts, the first starting `eyJ`. */
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]+/g;
/** Rule 5: `key=value` and `key: value` (quoted or not) whose key holds a secret word. */
const PAIR = new RegExp(
  `(["']?)([\\w.-]*(?:${WORDS})[\\w.-]*)\\1(\\s*[:=]\\s*)(["']?)(?!\\[redacted\\])([^\\s"'&,;)}\\]]+)\\4`,
  'gi',
);

/**
 * Redaction rules 2 to 5 (D-123, design section 9), for every runtime string a tool prints:
 * problem messages, request paths and URLs, the page URL, labels. Never for source slices.
 * Rules 2 and 5 over-redact on purpose (`monkey=1`): a missed secret is worse.
 */
export function redact(text: string): string {
  return text
    .replace(JWT, R)
    .replace(BEARER, `$1${R}`)
    .replace(QUERY, `$1${R}`)
    .replace(PAIR, (_m, q, key, sep, vq) => `${q}${key}${q}${sep}${vq}${R}${vq}`);
}

/** Shortest `fill` value that is redacted; shorter ones would hide ordinary words and numbers. */
export const MIN_SECRET_LENGTH = 4;

/**
 * Redaction rule 6 (D-123, design section 9): every occurrence of a value run_action filled in this
 * call, 4 characters or longer, becomes `[redacted]` in the result text. Rules 2 to 5 come with
 * build 4.
 */
export function redactFillValues(text: string, values: readonly string[]): string {
  // A value the app put in a URL appears percent-encoded there ('my pass' as 'my%20pass').
  const forms = values
    .filter((v) => v.length >= MIN_SECRET_LENGTH)
    .flatMap((v) => [v, encodeURIComponent(v)]);
  const secrets = [...new Set(forms)].sort((a, b) => b.length - a.length);
  let out = text;
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out;
}
