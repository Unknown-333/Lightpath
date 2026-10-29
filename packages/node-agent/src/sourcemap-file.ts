import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Largest .map file the agent forwards. Base64 adds a third, so a map at this limit plus a large
 * script still fits one ingest request (MAX_BODY_BYTES in transport.ts).
 */
export const MAX_MAP_BYTES = 3 * 1024 * 1024;

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;

interface RawSourceMap {
  version?: unknown;
  sources?: unknown;
  sourceRoot?: unknown;
  [key: string]: unknown;
}

/**
 * Reads the external source map a script points at (`//# sourceMappingURL=app.js.map`) and returns
 * it as a `data:` URL, the only form the protocol carries (ScriptInfo.sourceMapURL).
 *
 * The URL comes from the app's own files, so it's treated as untrusted:
 * - only `file:` maps of `file:` scripts (never the network);
 * - only maps inside the workspace roots (`inWorkspace`), so a comment can't make the agent send
 *   some other file on the machine;
 * - at most MAX_MAP_BYTES, and it must parse as a version 3 source map.
 *
 * `sources` are made absolute against the map's own location (and its `sourceRoot`), so the daemon
 * resolves them correctly even when the map isn't next to the script.
 * Returns `undefined` whenever any of that fails; the script is then shown as generated code.
 */
export function readExternalSourceMap(
  scriptUrl: string,
  sourceMapURL: string,
  inWorkspace: (fileUrl: string) => boolean,
): string | undefined {
  if (!sourceMapURL || sourceMapURL.startsWith('data:') || !scriptUrl.startsWith('file:')) return undefined;
  let mapUrl: URL;
  try {
    mapUrl = new URL(sourceMapURL, scriptUrl);
  } catch {
    return undefined;
  }
  if (mapUrl.protocol !== 'file:') return undefined;
  mapUrl.search = '';
  mapUrl.hash = '';
  if (!inWorkspace(mapUrl.href)) return undefined;

  let map: RawSourceMap;
  try {
    const path = fileURLToPath(mapUrl);
    if (statSync(path).size > MAX_MAP_BYTES) return undefined;
    map = JSON.parse(readFileSync(path, 'utf8')) as RawSourceMap;
  } catch {
    return undefined;
  }
  if (map.version !== 3 || !Array.isArray(map.sources)) return undefined;

  const root = typeof map.sourceRoot === 'string' && map.sourceRoot !== '' ? map.sourceRoot : undefined;
  const base = root ? toUrl(root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`, mapUrl) : mapUrl;
  if (!base) return undefined;
  map.sources = map.sources.map((s: unknown) => (typeof s === 'string' ? (toUrl(s, base)?.href ?? s) : s));
  delete map.sourceRoot;
  return `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
}

/**
 * Resolves a path or URL against `base`. Windows paths like `C:\a\b.ts` become file URLs first.
 *
 * A Windows absolute path is rewritten to a `file:` URL by hand rather than with `pathToFileURL`,
 * because that function reads the HOST OS: on a non-Windows runner it treats `C:\a\b.ts` as a
 * relative POSIX name, resolving it against the CWD and percent-encoding the backslashes. The map
 * carries the app author's machine paths regardless of where the daemon runs, so the mapping must
 * not depend on the OS running the test or the agent (CI runs this on Linux and macOS too).
 */
function toUrl(value: string, base: URL): URL | undefined {
  try {
    if (WINDOWS_ABSOLUTE.test(value)) {
      const [drive, ...rest] = value.split(/[\\/]/);
      const path = rest.map((segment) => encodeURIComponent(segment)).join('/');
      return new URL(`file:///${drive}/${path}`);
    }
    return new URL(value, base);
  } catch {
    return undefined;
  }
}
