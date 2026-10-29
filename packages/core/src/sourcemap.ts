import { eachMapping, type SourceMapInput, TraceMap } from '@jridgewell/trace-mapping';
import { countAt, type Segment } from './flatten.js';
import type { LineIndex } from './line-index.js';
import type { LineCounts } from './lines.js';

/** Original source URL or path (as resolved by the source map) → line counts. */
export type OriginalCounts = Map<string, LineCounts>;

/**
 * Maps flattened segments of a generated script back to original source lines.
 *
 * Walks every mapping in the source map. Each mapped generated position takes the count of the
 * segment containing it, and its original line keeps the maximum count seen. Generated code with
 * no mapping (compiler helpers, HMR glue) contributes nothing, which is what we want.
 *
 * Source map columns and V8 offsets are both UTF-16 code units, so they line up directly.
 */
export function mapToOriginal(
  segments: readonly Segment[],
  generated: LineIndex,
  map: SourceMapInput,
  mapUrl?: string,
): OriginalCounts {
  const tracer = new TraceMap(withWindowsSourcesAsUrls(map), mapUrl);
  const out: OriginalCounts = new Map();
  eachMapping(tracer, (m) => {
    if (m.source == null || m.originalLine == null) return;
    const offset = generated.lineStart(m.generatedLine - 1) + m.generatedColumn;
    const count = countAt(segments, offset);
    if (count === undefined) return;
    let lines = out.get(m.source);
    if (!lines) {
      lines = new Map();
      out.set(m.source, lines);
    }
    const prev = lines.get(m.originalLine);
    if (prev === undefined || count > prev) lines.set(m.originalLine, count);
  });
  return out;
}

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;

/**
 * Rewrites Windows absolute paths in `sources` (and `sourceRoot`) as `file:///C:/...` URLs.
 *
 * Some tools write them as-is: tsx on Windows emits `C:\repo\src\a.ts`. trace-mapping only knows
 * URLs and POSIX paths, so it treats `C:\...` as relative and appends it to the map URL, which
 * yields a path that exists nowhere. POSIX absolute paths and URLs already resolve correctly.
 */
function withWindowsSourcesAsUrls(map: SourceMapInput): SourceMapInput {
  if (map instanceof TraceMap) return map;
  const parsed =
    typeof map === 'string' ? (JSON.parse(map) as Exclude<SourceMapInput, string | TraceMap>) : map;
  const root = parsed.sourceRoot;
  const rootIsWindows = typeof root === 'string' && WINDOWS_ABSOLUTE.test(root);
  if (!rootIsWindows && !parsed.sources.some((s) => s != null && WINDOWS_ABSOLUTE.test(s))) return parsed;
  return {
    ...parsed,
    ...(rootIsWindows ? { sourceRoot: `${windowsPathToUrl(root)}/` } : {}),
    sources: parsed.sources.map((s) => (s != null && WINDOWS_ABSOLUTE.test(s) ? windowsPathToUrl(s) : s)),
  };
}

/** `C:\a b\c#.ts` → `file:///C:/a%20b/c%23.ts`. Only characters that would break URL parsing are escaped. */
function windowsPathToUrl(path: string): string {
  const escaped = path
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/[%#? ]/g, (c) => encodeURIComponent(c));
  return `file:///${escaped}`;
}

/**
 * Decodes an inline `data:` source map URL (base64 or percent-encoded JSON).
 * Returns `undefined` for non-data URLs, which the caller must fetch itself.
 */
export function decodeDataUrlSourceMap(url: string): SourceMapInput | undefined {
  if (!url.startsWith('data:')) return undefined;
  const comma = url.indexOf(',');
  if (comma < 0) return undefined;
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const json = meta.endsWith(';base64') ? decodeBase64Utf8(body) : decodeURIComponent(body);
  return JSON.parse(json) as SourceMapInput;
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
