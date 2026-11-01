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
