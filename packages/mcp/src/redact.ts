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
 * problem messages, request paths and URLs, the page URL, labels. Source code gets
 * `redactSource` instead (D-145).
 * Rules 2 and 5 over-redact on purpose (`monkey=1`): a missed secret is worse.
 */
export function redact(text: string): string {
  return text
    .replace(JWT, R)
    .replace(BEARER, `$1${R}`)
    .replace(QUERY, `$1${R}`)
    .replace(PAIR, (_m, q, key, sep, vq) => `${q}${key}${q}${sep}${vq}${R}${vq}`);
}

/** A PEM private key, from its BEGIN line to its END line. */
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
/** Well-known key formats, whatever the variable is called (Stripe, AWS, GitHub, Slack, Google). */
const KNOWN_KEY =
  /\b(?:(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|xox[abeprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35})/g;
/** Rule 3 in code: not a template placeholder (`Bearer ${token}` stays). */
const BEARER_CODE = /\b(Bearer\s+)(?!\[redacted\]|\$\{)[^\s"'`,;]+/gi;
/** Rule 2 in code: a query value inside a string, not a template placeholder. */
const QUERY_CODE = new RegExp(
  `([?&][^=&#\\s'"\`]*(?:${WORDS})[^=&#\\s'"\`]*=)(?!\\$\\{|\\[redacted\\])([^&#\\s'"\`]+)`,
  'gi',
);
/**
 * Rule 5 in code: a string literal assigned to, compared with, or keyed by a name holding a
 * secret word (`apiKey = "…"`, `token: '…'`, `"Authorization": "…"`, `password === '…'`).
 */
const LITERAL = new RegExp(
  `(["']?)([\\w$-]*(?:${WORDS})[\\w$-]*)\\1(\\s*(?::|={1,3}(?!>)|!==?)\\s*)(["'\`])((?:\\\\.|(?!\\4)[^\\\\\\n])*)\\4`,
  'gi',
);

/** `[redacted]`, keeping the newlines of what it hides so line numbers don't move. */
const sameLines = (m: string) => `${R}${'\n'.repeat((m.match(/\n/g) ?? []).length)}`;

/**
 * Redaction for source code returned by a tool (D-145): trace answers' code and get_trace slices.
 * Rules 3 and 4 as for runtime text, rule 2 inside URLs, rule 5 for string literals only (so
 * `const session = await getSession()` stays readable), well-known key formats and PEM private
 * keys. Line count never changes. Rule 6 (`fill` values) runs on the result separately.
 */
export function redactSource(text: string): string {
  return text
    .replace(PEM, sameLines)
    .replace(JWT, R)
    .replace(KNOWN_KEY, R)
    .replace(BEARER_CODE, `$1${R}`)
    .replace(QUERY_CODE, `$1${R}`)
    .replace(LITERAL, (m, q, key, sep, lq, value: string) =>
      value === '' || value === R || (lq === '`' && value.includes('${'))
        ? m
        : `${q}${key}${q}${sep}${lq}${R}${lq}`,
    );
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
