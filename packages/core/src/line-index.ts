/**
 * Line lookup for one script source. Offsets are UTF-16 code unit indexes,
 * which is what V8 coverage reports and what JavaScript string indexes use.
 */
export class LineIndex {
  /** Offset of the first character of each line. */
  readonly #starts: Uint32Array;
  /** Offset of the first non-whitespace character per line, or -1 for blank lines. */
  readonly #contentStart: Int32Array;
  /** Offset just past the last non-whitespace character per line, or -1 for blank lines. */
  readonly #contentEnd: Int32Array;

  constructor(source: string) {
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
    }
    this.#starts = Uint32Array.from(starts);
    this.#contentStart = new Int32Array(starts.length).fill(-1);
    this.#contentEnd = new Int32Array(starts.length).fill(-1);

    for (let line = 0; line < starts.length; line++) {
      const from = starts[line] as number;
      const to = line + 1 < starts.length ? (starts[line + 1] as number) - 1 : source.length;
      let a = from;
      while (a < to && isSpace(source.charCodeAt(a))) a++;
      let b = to;
      while (b > a && isSpace(source.charCodeAt(b - 1))) b--;
      if (b > a) {
        this.#contentStart[line] = a;
        this.#contentEnd[line] = b;
      }
    }
  }

  get lineCount(): number {
    return this.#starts.length;
  }

  /** Offset of the start of a zero-based line. */
  lineStart(line: number): number {
    return this.#starts[line] ?? Number.POSITIVE_INFINITY;
  }

  /** Zero-based line containing `offset`. */
  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.#starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if ((this.#starts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** `[start, end)` of the non-whitespace content of a zero-based line, or `undefined` if blank. */
  content(line: number): readonly [number, number] | undefined {
    const start = this.#contentStart[line] ?? -1;
    if (start < 0) return undefined;
    return [start, this.#contentEnd[line] as number];
  }
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10 || code === 0xfeff;
}
