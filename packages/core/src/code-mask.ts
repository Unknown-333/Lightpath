/**
 * Character classes of a script, for the line rule (D-149): space or comment, punctuation, or code.
 *
 * A line takes its count from its code characters. Brackets, braces, parentheses, `;` and `,` count
 * only on a line with nothing else, and comments never count: a `;` or `)` closing a whole statement,
 * the `}` of the block before an `else`, or a trailing comment sits in an outer V8 range, whose count
 * is not the line's.
 *
 * A small lexer, not a parser: strings, template literals (with `${}` nesting), regular expression
 * literals and comments are recognised so `//` inside a string is code. JSX never reaches it: a
 * script with JSX is always source-mapped, and the mask is taken of the generated JavaScript.
 */
export const SPACE = 0;
export const PUNCT = 1;
export const CODE = 2;

const PUNCTUATION = new Set(['{', '}', '(', ')', '[', ']', ';', ',']);
/** After these keywords a `/` starts a regular expression, not a division. */
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

export function codeMask(source: string): Uint8Array {
  const n = source.length;
  const mask = new Uint8Array(n);
  /** Brace depth at which each open template's `${` started. */
  const templates: number[] = [];
  let depth = 0;
  /** The previous code token decides whether `/` starts a regular expression. */
  let regexAllowed = true;
  let i = 0;

  const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff || c === 0xa0;
  const isWord = (c: number) =>
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95 || c > 127;

  /** Marks a template's text from `i` (just after a backtick or `}`) up to its end or a `${`. */
  const templateText = () => {
    while (i < n) {
      const ch = source[i];
      if (ch === '\\') {
        mask[i] = CODE;
        if (i + 1 < n) mask[i + 1] = CODE;
        i += 2;
        continue;
      }
      if (ch === '`') {
        mask[i++] = CODE;
        regexAllowed = false;
        return;
      }
      if (ch === '$' && source[i + 1] === '{') {
        mask[i] = CODE;
        mask[i + 1] = CODE;
        i += 2;
        templates.push(depth);
        depth++;
        regexAllowed = true;
        return;
      }
      mask[i] = isSpace(source.charCodeAt(i)) ? SPACE : CODE;
      i++;
    }
  };

  while (i < n) {
    const c = source.charCodeAt(i);
    const ch = source[i] as string;
    if (isSpace(c)) {
      i++;
      continue;
    }
    // Comments
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    // Strings
    if (ch === "'" || ch === '"') {
      mask[i++] = CODE;
      while (i < n && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') mask[i++] = CODE;
        if (i < n) mask[i++] = CODE;
      }
      if (i < n && source[i] === ch) mask[i++] = CODE;
      regexAllowed = false;
      continue;
    }
    if (ch === '`') {
      mask[i++] = CODE;
      templateText();
      continue;
    }
    // Regular expression literals
    if (ch === '/' && regexAllowed) {
      mask[i++] = CODE;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const r = source[i];
        mask[i++] = CODE;
        if (r === '\\') {
          if (i < n) mask[i++] = CODE;
        } else if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
      }
      while (i < n && isWord(source.charCodeAt(i))) mask[i++] = CODE; // flags
      regexAllowed = false;
      continue;
    }
    // Words (names, keywords, numbers)
    if (isWord(c)) {
      const start = i;
      const numeric = c >= 48 && c <= 57;
      while (i < n) {
        const k = source[i] as string;
        // A number keeps its dot and exponent sign: 1.5, 1e-3.
        const inNumber =
          numeric && (k === '.' || ((k === '+' || k === '-') && /[eE]/.test(source[i - 1] ?? '')));
        if (!isWord(source.charCodeAt(i)) && !inNumber) break;
        mask[i++] = CODE;
      }
      regexAllowed = REGEX_AFTER_WORD.has(source.slice(start, i));
      continue;
    }
    // Punctuation and operators
    if (ch === '}' && templates.length > 0 && templates[templates.length - 1] === depth - 1) {
      // The end of a `${…}` inside a template: back to the template's text.
      templates.pop();
      depth--;
      mask[i++] = CODE;
      templateText();
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    mask[i] = PUNCTUATION.has(ch) ? PUNCT : CODE;
    regexAllowed = ch !== ')' && ch !== ']' && ch !== '}';
    i++;
  }
  return mask;
}

const JUMP = /^(?:break|continue)(?:\s+[A-Za-z_$][\w$]*)?$/;

/** True when the code characters in `[from, to)` are only `break` or `continue` (and a label). */
export function isJumpOnly(source: string, mask: Uint8Array, from: number, to: number): boolean {
  let text = '';
  let gap = false;
  for (let i = from; i < to; i++) {
    if (mask[i] === CODE) {
      if (gap && text) text += ' ';
      text += source[i];
      gap = false;
    } else gap = true;
    if (text.length > 40) return false;
  }
  return JUMP.test(text);
}

/** The last offset before `pos` that is code or punctuation, or undefined. */
export function previousCode(mask: Uint8Array, pos: number): number | undefined {
  for (let i = pos - 1; i >= 0; i--) if (mask[i] !== SPACE) return i;
  return undefined;
}
