import type { DropReason } from '@lightpath/protocol';

export interface ResolveContext {
  /** Absolute workspace roots, any slash style. */
  workspaceRoots: readonly string[];
  /** Dev servers whose URL paths map onto a directory, e.g. Vite at http://localhost:5173 → C:/repo/web. */
  devServers?: readonly { origin: string; root: string }[];
  /** Extra substrings that mark a URL as noise. */
  ignore?: readonly string[];
}

export type Resolved =
  | { kind: 'workspace'; path: string; absolute: string }
  | { kind: 'dropped'; reason: DropReason };

const INTERNAL_MARKERS = [
  '/@vite/',
  '/@react-refresh',
  '/@id/__x00__',
  '/__vite',
  '/lightpath-agent/',
  '/@lightpath/',
];

/**
 * Resolves a script URL (or a resolved source map `sources` entry) to a workspace-relative path.
 * Pure string logic so it runs in the daemon, the extension, and tests alike.
 */
export function resolveFile(url: string, ctx: ResolveContext): Resolved {
  if (url === '' || url.startsWith('node:') || url.startsWith('data:') || url.startsWith('evalmachine')) {
    return { kind: 'dropped', reason: 'internal' };
  }
  if (INTERNAL_MARKERS.some((m) => url.includes(m)) || ctx.ignore?.some((m) => url.includes(m))) {
    return { kind: 'dropped', reason: 'internal' };
  }
  if (/[/\\]node_modules[/\\]/.test(url)) return { kind: 'dropped', reason: 'node_modules' };

  const absolute = toAbsolutePath(url, ctx);
  if (absolute === undefined) return { kind: 'dropped', reason: 'outside-workspace' };

  for (const root of ctx.workspaceRoots) {
    const rel = relativeTo(normalizePath(root), absolute);
    if (rel !== undefined) return { kind: 'workspace', path: rel, absolute };
  }
  return { kind: 'dropped', reason: 'outside-workspace' };
}

/** Forward slashes, no trailing slash, uppercase drive letter. */
export function normalizePath(p: string): string {
  let out = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(out)) out = out[0]?.toUpperCase() + out.slice(1);
  if (out.length > 1 && out.endsWith('/') && !/^[A-Z]:\/$/.test(out)) out = out.slice(0, -1);
  return out;
}

function toAbsolutePath(url: string, ctx: ResolveContext): string | undefined {
  if (url.startsWith('file://')) {
    // file:///C:/repo/a.ts → C:/repo/a.ts ; file:///home/me/a.ts → /home/me/a.ts
    let p = decodeURIComponent(url.slice('file://'.length).split(/[?#]/)[0] ?? '');
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return normalizePath(p);
  }
  if (/^https?:\/\//.test(url)) {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    // Vite serves files outside its root as /@fs/<absolute path>.
    if (pathname.startsWith('/@fs/'))
      return normalizePath(pathname.slice('/@fs'.length).replace(/^\/([a-zA-Z]:)/, '$1'));
    const server = ctx.devServers?.find((s) => s.origin === parsed.origin);
    if (!server) return undefined;
    return normalizePath(`${normalizePath(server.root)}${pathname}`);
  }
  if (/^[a-zA-Z]:[/\\]/.test(url) || url.startsWith('/')) return normalizePath(url);
  return undefined;
}

function relativeTo(root: string, absolute: string): string | undefined {
  // Windows paths compare case-insensitively.
  const windows = /^[A-Z]:/.test(root);
  const a = windows ? absolute.toLowerCase() : absolute;
  const r = windows ? root.toLowerCase() : root;
  if (a === r) return undefined;
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return a.startsWith(prefix) ? absolute.slice(prefix.length) : undefined;
}
