import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the real browser: start() fetches the URL the way page.goto would load it, and
// fails the same way when nothing listens yet (D-126). No Chrome is needed.
const opened = vi.hoisted(() => [] as string[]);
vi.mock('@lightpath-dev/browser', () => ({
  BrowserCollector: class {
    readonly #url: string;
    constructor(opts: { url: string }) {
      this.#url = opts.url;
    }
    async start(): Promise<void> {
      try {
        await fetch(this.#url);
        opened.push('ok');
      } catch {
        opened.push('refused');
        throw new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${this.#url}`);
      }
    }
    async stop(): Promise<void> {}
  },
}));

const { dev } = await import('../src/dev.js');

const dir = mkdtempSync(join(tmpdir(), 'lightpath-url-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  opened.length = 0;
});

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });
}

/** A dev command whose server starts listening after `listenAfterMs` (never, if undefined). */
function devScript(name: string, port: number, listenAfterMs: number | undefined, exitAfterMs: number) {
  const file = join(dir, `${name}.cjs`);
  writeFileSync(
    file,
    [
      "const http = require('node:http');",
      listenAfterMs === undefined
        ? ''
        : `setTimeout(() => http.createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1', () => console.log('Local: http://127.0.0.1:${port}/')), ${listenAfterMs});`,
      `setTimeout(() => process.exit(0), ${exitAfterMs});`,
    ].join('\n'),
  );
  return [process.execPath, file];
}

describe('lightpath dev --url (D-126)', () => {
  it('opens the page once the dev server answers, not before', async () => {
    const port = await freePort();
    const code = await dev({
      command: devScript('late', port, 1500, 5000),
      url: `http://127.0.0.1:${port}`,
      cwd: dir,
    });
    expect(code).toBe(0);
    expect(opened).toEqual(['ok']);
  }, 20_000);

  it('opens at once when the server already answers', async () => {
    const port = await freePort();
    const server = createHttpServer((_q, s) => s.end('ok'));
    await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
    try {
      const code = await dev({
        command: devScript('early', port, undefined, 2000),
        url: `http://127.0.0.1:${port}`,
        cwd: dir,
      });
      expect(code).toBe(0);
      expect(opened).toEqual(['ok']);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  }, 20_000);

  it('opens nothing and still exits when the URL never answers', async () => {
    const port = await freePort();
    const code = await dev({
      command: devScript('never', port, undefined, 1500),
      url: `http://127.0.0.1:${port}`,
      cwd: dir,
    });
    expect(code).toBe(0);
    expect(opened).toEqual([]);
  }, 20_000);

  it('without --url, still opens the URL the command prints', async () => {
    const port = await freePort();
    const code = await dev({ command: devScript('detect', port, 500, 3000), cwd: dir });
    expect(code).toBe(0);
    expect(opened).toEqual(['ok']);
  }, 20_000);
});

describe('waitForUrl', () => {
  it('gives up after its time limit when nothing listens', async () => {
    const { waitForUrl } = await import('../src/ready.js');
    const port = await freePort();
    const t0 = Date.now();
    expect(await waitForUrl(`http://127.0.0.1:${port}`, { timeoutMs: 400, intervalMs: 50 })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('stops waiting when aborted', async () => {
    const { waitForUrl } = await import('../src/ready.js');
    const port = await freePort();
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 200);
    expect(await waitForUrl(`http://127.0.0.1:${port}`, { signal: stop.signal })).toBe(false);
  });
});
