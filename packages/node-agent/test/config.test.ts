import { AgentEnv } from '@lightpath/protocol';
import { describe, expect, it } from 'vitest';
import { ENV, readConfig } from '../src/config.js';

const base = { LIGHTPATH_URL: 'http://127.0.0.1:4000', LIGHTPATH_TOKEN: 'x'.repeat(43) };

describe('readConfig', () => {
  it('uses the same environment variable names as the protocol', () => {
    expect(ENV).toEqual(AgentEnv);
  });

  it('stays off unless launched by lightpath', () => {
    expect(readConfig({}, ['node', 'app.js'])).toMatchObject({ ok: false });
  });

  it('parses roots and strips a trailing slash from the URL', () => {
    const r = readConfig(
      { ...base, LIGHTPATH_URL: 'http://127.0.0.1:4000/', LIGHTPATH_ROOTS: 'C:\\Repo\\, /srv/app' },
      ['node', 'server.js'],
    );
    expect(r).toEqual({
      ok: true,
      config: {
        url: 'http://127.0.0.1:4000',
        token: base.LIGHTPATH_TOKEN,
        roots: ['c:/repo', '/srv/app'],
        debug: false,
      },
    });
  });

  it.each([
    ['C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs run dev'],
    ['/usr/lib/node_modules/npm/bin/npm-cli.js'],
    ['C:\\repo\\node_modules\\vite\\bin\\vite.js'],
    ['C:\\Users\\me\\AppData\\Local\\node\\corepack\\v1\\pnpm\\12.16.1\\bin\\pnpm.cjs install'],
    ['/repo/node_modules/tsx/dist/cli.mjs server.ts'],
  ])('skips tool process %s', (cmd) => {
    expect(readConfig(base, ['node', cmd])).toMatchObject({ ok: false });
  });

  it.each([['/repo/server/index.ts'], ['C:\\repo\\dist\\main.js'], ['/repo/npm-scripts/serve.js']])(
    'instruments app process %s',
    (cmd) => {
      expect(readConfig(base, ['node', cmd])).toMatchObject({ ok: true });
    },
  );

  it('honors LIGHTPATH_SKIP and ignores an invalid regex', () => {
    expect(readConfig({ ...base, LIGHTPATH_SKIP: 'worker\\.js' }, ['node', 'worker.js'])).toMatchObject({
      ok: false,
    });
    expect(readConfig({ ...base, LIGHTPATH_SKIP: '(' }, ['node', 'server.js'])).toMatchObject({ ok: true });
  });

  it('refuses to send data to a non-local daemon', () => {
    expect(
      readConfig({ ...base, LIGHTPATH_URL: 'http://evil.example:4000' }, ['node', 'a.js']),
    ).toMatchObject({
      ok: false,
    });
  });
});
