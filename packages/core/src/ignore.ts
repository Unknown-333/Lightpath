/**
 * `ignore` patterns from `lightpath.config.json`, matched against workspace-relative paths with
 * forward slashes. `*` and `?` stay inside one path segment, `**` spans any number of them. A
 * pattern without a `/` matches a file or folder name at any depth, like `.gitignore`. A pattern
 * that matches a folder hides everything inside it.
 */
export function compileIgnore(patterns: readonly string[]): (path: string) => boolean {
  const regexes = patterns
    .map((p) => p.trim().replace(/\\/g, '/'))
    .filter((p) => p !== '' && !p.startsWith('#'))
    .map((p) => {
      let body = p.replace(/^\.\//, '').replace(/\/+$/, '');
      if (body.startsWith('/')) body = body.slice(1);
      else if (!body.includes('/')) body = `**/${body}`;
      return new RegExp(`^${globToRegex(body)}(?:/.*)?$`, 'i');
    });
  if (regexes.length === 0) return () => false;
  return (path) => {
    const p = path.replace(/\\/g, '/');
    return regexes.some((r) => r.test(p));
  };
}

function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more folders; a trailing `**` matches the rest.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}
