// Serves site/dist under the same path GitHub Pages will use (/Lightpath/), on 127.0.0.1 only.
// Anything outside the prefix is a 404, so a root-relative asset path shows up as broken.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../build.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
export const BASE = new URL(SITE_URL).pathname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** Start the server; resolves to { url, close, misses } where misses lists every 404 path. */
export function serve(port = 0) {
  const misses = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (path.startsWith(BASE)) {
      const rel = normalize(path.slice(BASE.length) || 'index.html');
      if (!rel.startsWith('..')) file = join(dist, rel);
      if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    }
    if (!file || !existsSync(file)) {
      misses.push(path);
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(join(dist, '404.html')).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      ok({ url: `http://127.0.0.1:${p}${BASE}`, close: () => server.close(), misses });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await serve(Number(process.env.PORT ?? 4321));
  console.log(`serving site/dist at ${url}`);
}
