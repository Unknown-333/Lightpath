import type { Trace } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { findLocalUrl, UrlWatcher } from '../src/detect.js';
import { agentEnv, nodeVersionProblem, toShellCommand, withImport } from '../src/env.js';
import { formatTrace } from '../src/format.js';

const url = 'file:///C:/Users/me/my%20tools/node-agent/dist/register.js';

describe('withImport', () => {
  it('adds a quoted --import flag', () => {
    expect(withImport(undefined, url)).toBe(`--import="${url}"`);
  });
  it("keeps the user's own options", () => {
    expect(withImport('--max-old-space-size=4096', url)).toBe(`--max-old-space-size=4096 --import="${url}"`);
  });
  it('is idempotent', () => {
    expect(withImport(withImport('', url), url)).toBe(`--import="${url}"`);
  });
});

describe('agentEnv', () => {
  it('sets everything the agent reads', () => {
    const env = agentEnv(
      { PATH: '/bin' },
      {
        daemonUrl: 'http://127.0.0.1:4000',
        token: 'tok',
        roots: ['C:\\a', 'C:\\b'],
        registerUrl: url,
        debug: true,
      },
    );
    expect(env).toMatchObject({
      PATH: '/bin',
      LIGHTPATH_URL: 'http://127.0.0.1:4000',
      LIGHTPATH_TOKEN: 'tok',
      LIGHTPATH_ROOTS: 'C:\\a,C:\\b',
      LIGHTPATH_DEBUG: '1',
    });
    expect(env.NODE_OPTIONS).toContain('--import=');
    expect(env.LIGHTPATH_SKIP).toBeUndefined();
  });
});

describe('toShellCommand', () => {
  it('leaves simple arguments alone and quotes the rest', () => {
    expect(toShellCommand(['npm', 'run', 'dev'])).toBe('npm run dev');
    expect(toShellCommand(['node', 'C:\\my app\\server.js', '--port=3000'])).toBe(
      'node "C:\\my app\\server.js" --port=3000',
    );
    expect(toShellCommand(['echo', 'say "hi"'])).toBe('echo "say ""hi"""');
  });
});

describe('nodeVersionProblem', () => {
  it.each([
    ['v24.13.0', false],
    ['v22.12.0', false],
    ['v22.11.0', true],
    ['v20.18.1', true],
  ])('%s problem=%s', (v, problem) => {
    expect(Boolean(nodeVersionProblem(v))).toBe(problem);
  });
});

describe('findLocalUrl', () => {
  it.each([
    [
      '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m',
      'http://localhost:5173',
    ],
    ['Server listening on http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['ready - started server on 0.0.0.0:3000, url: http://localhost:3000', 'http://localhost:3000'],
    ['see https://vitejs.dev/config for help', undefined],
  ])('%s → %s', (line, expected) => {
    expect(findLocalUrl(line)).toBe(expected);
  });

  it('handles URLs split across chunks', () => {
    const w = new UrlWatcher();
    expect(w.push('  Local:   http://local')).toBeUndefined();
    expect(w.push('host:5173/\n')).toBe('http://localhost:5173');
    expect(w.push('Network: http://localhost:9999\n')).toBeUndefined();
    expect(w.found).toBe('http://localhost:5173');
  });
});

describe('formatTrace with background files', () => {
  it('lists background files last, with a note', () => {
    const file = (path: string, background?: boolean) => ({
      path,
      collector: 'browser' as const,
      lines: [{ line: 3, count: 1 }],
      firstSeenAt: 0,
      ...(background ? { background } : {}),
    });
    const trace: Trace = {
      id: 't_abc123def456',
      label: 'button: Save',
      origin: 'browser',
      startedAt: 0,
      endedAt: 10,
      files: [file('src/clock.ts', true), file('src/Save.tsx')],
      requests: [],
      dropped: [],
    };
    const out = formatTrace(trace, false).split('\n');
    expect(out[1]).toContain('src/Save.tsx');
    expect(out[2]).toContain('src/clock.ts');
    expect(out[2]).toContain('(background)');
    expect(out[1]).not.toContain('(background)');
  });
});
describe('formatTrace', () => {
  it('prints a readable tree without colors', () => {
    const trace: Trace = {
      id: 't_abc123def456',
      label: 'button: Checkout',
      origin: 'browser',
      startedAt: 1000,
      endedAt: 1340,
      files: [
        {
          path: 'web/src/Cart.tsx',
          collector: 'browser',
          lines: [
            { line: 10, count: 1 },
            { line: 11, count: 4 },
          ],
          firstSeenAt: 0,
        },
        {
          path: 'server/routes/orders.ts',
          collector: 'node',
          lines: [{ line: 5, count: 1 }],
          firstSeenAt: 1,
        },
      ],
      requests: [
        {
          collector: 'node',
          pid: 1,
          method: 'POST',
          path: '/api/orders',
          status: 201,
          durationMs: 9,
          overlapped: false,
        },
      ],
      dropped: [{ reason: 'node_modules', count: 3 }],
    };
    expect(formatTrace(trace, false)).toBe(
      [
        '◆ button: Checkout 340 ms t_abc123def456',
        '  → POST /api/orders 201',
        '  ├─ web/src/Cart.tsx :10-11 ×4',
        '  └─ server/routes/orders.ts :5',
        '  3 scripts hidden (node_modules)',
      ].join('\n'),
    );
  });
});
