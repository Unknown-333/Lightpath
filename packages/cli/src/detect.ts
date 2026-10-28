// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences is the point.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}(?:\/[^\s'")\]]*)?/;

/**
 * Finds the first local dev-server URL in a chunk of output, e.g. Vite's
 * `➜  Local:   http://localhost:5173/`. Returns it without a trailing slash.
 */
export function findLocalUrl(output: string): string | undefined {
  const match = LOCAL_URL.exec(output.replace(ANSI, ''));
  return match?.[0].replace(/\/$/, '');
}

/** Line-buffers a stream of chunks and reports the first local URL seen. */
export class UrlWatcher {
  #buffer = '';
  #found: string | undefined;

  get found(): string | undefined {
    return this.#found;
  }

  push(chunk: string): string | undefined {
    if (this.#found) return undefined;
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? '';
    for (const line of lines) {
      const url = findLocalUrl(line);
      if (url) {
        this.#found = url;
        return url;
      }
    }
    // Keep memory bounded if the child prints a huge line without a newline.
    if (this.#buffer.length > 10_000) this.#buffer = this.#buffer.slice(-1000);
    return undefined;
  }
}
