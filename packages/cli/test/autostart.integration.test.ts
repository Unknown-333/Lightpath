import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// `lightpath mcp` starts `lightpath dev` by itself when autoStart is on (D-122, design section 11).
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightpath-autostart-'));
  // A tiny "dev server" that just stays up.
  await writeFile(join(root, 'tiny.mjs'), "console.log('tiny up'); setInterval(() => {}, 1000);\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function listTraces() {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp', '--root', root] }),
  );
  const res = await client.callTool({ name: 'list_traces', arguments: {} });
  return { client, text: (res.content as { text: string }[])[0]?.text ?? '' };
}

describe('lightpath mcp auto-start', () => {
  it('starts lightpath dev when a tool needs it, logs to .lightpath/dev.log, and stops it on close', async () => {
    await writeFile(
      join(root, 'lightpath.config.json'),
      JSON.stringify({ command: 'node tiny.mjs', autoStart: true, browser: false }),
    );
    const { client, text } = await listTraces();
    let pid = 0;
    try {
      expect(text.split('\n')[0]).toBe(
        'started lightpath dev ("node tiny.mjs") in the background; log: .lightpath/dev.log',
      );
      expect(text).toContain('No traces yet');
      expect(existsSync(join(root, '.lightpath', 'dev.log'))).toBe(true);
      pid = (JSON.parse(readFileSync(join(root, '.lightpath', 'daemon.json'), 'utf8')) as { pid: number })
        .pid;
      expect(alive(pid)).toBe(true);
      // A second call reuses it, with no start line.
      const again = await client.callTool({ name: 'list_traces', arguments: {} });
      expect((again.content as { text: string }[])[0]?.text).not.toContain('started lightpath dev');
    } finally {
      await client.close();
    }
    const deadline = Date.now() + 10_000;
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(alive(pid)).toBe(false);
  }, 90_000);

  it('without autoStart, says how to start it and starts nothing', async () => {
    await writeFile(join(root, 'lightpath.config.json'), JSON.stringify({ command: 'node tiny.mjs' }));
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp', '--root', root] }),
    );
    try {
      const res = await client.callTool({ name: 'list_traces', arguments: {} });
      const text = (res.content as { text: string }[])[0]?.text ?? '';
      expect(text).toContain(`Lightpath isn't running in ${root}`);
      expect(text).toContain('it runs "node tiny.mjs" from lightpath.config.json');
      expect(text).toContain('"autoStart": true');
      expect(existsSync(join(root, '.lightpath', 'dev.log'))).toBe(false);
    } finally {
      await client.close();
    }
  }, 30_000);
});
