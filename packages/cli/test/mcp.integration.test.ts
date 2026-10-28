import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RunningDaemon, startDaemon } from '@lightpath-dev/daemon';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
let root: string;
let daemon: RunningDaemon;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightpath-mcp-'));
  daemon = await startDaemon({ workspaceRoots: [root] });
  daemon.store.put({
    id: 't_abc123def456',
    label: 'button: Checkout',
    origin: 'browser',
    startedAt: 1,
    endedAt: 400,
    files: [
      {
        path: 'src/Cart.tsx',
        collector: 'browser',
        lines: [
          { line: 21, count: 1 },
          { line: 22, count: 1 },
        ],
        firstSeenAt: 1,
      },
    ],
    requests: [],
    dropped: [],
  });
});

afterAll(async () => {
  await daemon.close();
  await rm(root, { recursive: true, force: true });
});

describe('lightpath mcp over stdio', () => {
  it('lists its tools and answers find_code_for_action from the running daemon', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp', '--root', root] }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'diff_traces',
        'find_code_for_action',
        'get_trace',
        'list_traces',
      ]);

      const result = await client.callTool({
        name: 'find_code_for_action',
        arguments: { action: 'checkout' },
      });
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
      expect(text).toContain('Trace t_abc123def456: button: Checkout');
      expect(text).toContain('src/Cart.tsx [browser] lines 21-22');
    } finally {
      await client.close();
    }
  }, 20_000);
});
