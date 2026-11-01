import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ProbeResult, setupChecks } from '../src/index.js';
import {
  AGENT_SETUP,
  AGENTS,
  agentsBlock,
  devCommand,
  findBlock,
  init,
  mcpCommand,
  upsertBlock,
} from '../src/init.js';
import { serverToolNames } from '../src/mcp-probe.js';

const TOOLS = ['list_traces', 'get_trace', 'find_code_for_action', 'diff_traces'];
const TOOLS_WITH_RUN = ['run_action', ...TOOLS];
const V = '9.9.9';

let dir: string;
let lines: string[];

beforeEach(async () => {
  // A space in the path, like "C:\Users\Jane Doe\my app".
  dir = await mkdtemp(join(tmpdir(), 'lightpath init '));
  lines = [];
  write('package.json', JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function write(file: string, text: string) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const json = (file: string) => JSON.parse(read(file));
const run = (agent: (typeof AGENTS)[number], platform: NodeJS.Platform = 'linux', tools = TOOLS) =>
  init({ cwd: dir, agent, version: V, tools, platform, out: (l) => lines.push(l) });

describe('mcpCommand', () => {
  it('pins this version and starts npx directly on macOS and Linux', () => {
    expect(mcpCommand(V, 'linux')).toEqual({
      command: 'npx',
      args: ['-y', `@lightpath-dev/cli@${V}`, 'mcp'],
    });
    expect(mcpCommand(V, 'darwin')).toEqual(mcpCommand(V, 'linux'));
  });
  it('wraps npx in cmd /c on Windows', () => {
    expect(mcpCommand(V, 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'npx', '-y', `@lightpath-dev/cli@${V}`, 'mcp'],
    });
  });
});

describe('lightpath init --agent', () => {
  for (const agent of AGENTS) {
    for (const platform of ['linux', 'win32'] as const) {
      it(`${agent} on ${platform}: writes the config, AGENTS.md and lightpath.config.json, then changes nothing`, async () => {
        expect(await run(agent, platform)).toBe(0);
        const setup = AGENT_SETUP[agent];
        const entry = json(setup.file)[setup.key].lightpath;
        expect(entry).toEqual({ ...setup.extra, ...mcpCommand(V, platform) });
        expect(findBlock(read('AGENTS.md'))).toBe(agentsBlock(TOOLS));
        expect(json('lightpath.config.json')).toMatchObject({ command: 'npm run dev' });
        expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);

        const before = [setup.file, 'AGENTS.md', 'lightpath.config.json'].map(read);
        lines = [];
        expect(await run(agent, platform)).toBe(0);
        expect([setup.file, 'AGENTS.md', 'lightpath.config.json'].map(read)).toEqual(before);
        expect(lines.filter((l) => /^(created|updated)/.test(l))).toEqual([]);
      });
    }
  }

  it('vscode uses "servers" with type stdio', async () => {
    await run('vscode');
    expect(json('.vscode/mcp.json')).toEqual({
      servers: { lightpath: { type: 'stdio', ...mcpCommand(V, 'linux') } },
    });
  });

  it('keeps other servers and keys in an existing config', async () => {
    const other = { command: 'node', args: ['other.js'], env: { A: '1' } };
    write('.mcp.json', JSON.stringify({ mcpServers: { other }, extra: true }));
    await run('claude-code');
    expect(json('.mcp.json')).toEqual({
      mcpServers: { other, lightpath: mcpCommand(V, 'linux') },
      extra: true,
    });
  });

  it('updates an old lightpath entry in place', async () => {
    write(
      '.kiro/settings/mcp.json',
      JSON.stringify({ mcpServers: { lightpath: { command: 'npx', args: ['old'] } } }),
    );
    await run('kiro', 'win32');
    expect(json('.kiro/settings/mcp.json').mcpServers.lightpath).toEqual(mcpCommand(V, 'win32'));
    expect(lines.some((l) => l.startsWith('updated   .kiro/settings/mcp.json'))).toBe(true);
    expect(lines.some((l) => l.includes('file://AGENTS.md'))).toBe(true);
  });

  it('leaves a config with comments alone and prints the entry to paste', async () => {
    const jsonc = '// my servers\n{ "servers": {} }\n';
    write('.vscode/mcp.json', jsonc);
    expect(await run('vscode')).toBe(1);
    expect(read('.vscode/mcp.json')).toBe(jsonc);
    expect(lines.join('\n')).toContain('"type": "stdio"');
    expect(lines.join('\n')).toContain('skipped');
    // The rest is still written.
    expect(findBlock(read('AGENTS.md'))).toBe(agentsBlock(TOOLS));
  });

  it('keeps the rest of an existing AGENTS.md and replaces only its own block', async () => {
    write('AGENTS.md', '# Team rules\r\n\r\nUse tabs.\r\n');
    await run('cursor');
    const first = read('AGENTS.md');
    expect(first.startsWith('# Team rules\r\n\r\nUse tabs.\r\n\r\n<!-- lightpath:start -->')).toBe(true);
    expect(first).not.toMatch(/[^\r]\n/); // kept CRLF

    // A later CLI with run_action replaces the block, not the rest.
    await run('cursor', 'linux', TOOLS_WITH_RUN);
    const second = read('AGENTS.md');
    expect(second.startsWith('# Team rules\r\n\r\nUse tabs.\r\n')).toBe(true);
    expect(findBlock(second)).toBe(agentsBlock(TOOLS_WITH_RUN));
    expect(second.match(/lightpath:start/g)).toHaveLength(1);
  });

  it('writes the block into CLAUDE.md too when it exists', async () => {
    write('CLAUDE.md', '# Claude notes\n');
    await run('claude-code');
    expect(read('CLAUDE.md').startsWith('# Claude notes\n\n<!-- lightpath:start -->')).toBe(true);
    expect(findBlock(read('CLAUDE.md'))).toBe(agentsBlock(TOOLS));
    expect(findBlock(read('AGENTS.md'))).toBe(agentsBlock(TOOLS));
  });

  it('adds only the keys an existing lightpath.config.json lacks', async () => {
    write('lightpath.config.json', JSON.stringify({ command: 'make dev', ignore: ['gen/**'] }));
    await run('kiro');
    expect(json('lightpath.config.json')).toEqual({
      command: 'make dev',
      ignore: ['gen/**'],
      $schema: './node_modules/@lightpath-dev/cli/lightpath.config.schema.json',
      // Build 4 (D-122, D-132): the schema knows autoStart now, so init turns it on.
      autoStart: true,
    });
  });

  it('writes no command when package.json has no dev script, and says so', async () => {
    write('package.json', JSON.stringify({ name: 'app' }));
    await run('kiro');
    expect(json('lightpath.config.json').command).toBeUndefined();
    expect(lines.join('\n')).toContain('no "dev" script');
  });

  it('stops without package.json', async () => {
    await rm(join(dir, 'package.json'));
    expect(await run('kiro')).toBe(1);
    expect(existsSync(join(dir, '.kiro'))).toBe(false);
  });

  it('leaves a lightpath.config.json that is not JSON alone', async () => {
    write('lightpath.config.json', '{ broken');
    expect(await run('claude-code')).toBe(1);
    expect(read('lightpath.config.json')).toBe('{ broken');
  });
});

describe('devCommand', () => {
  const pkg = { scripts: { dev: 'vite' } };
  it.each([
    ['pnpm-lock.yaml', 'pnpm run dev'],
    ['yarn.lock', 'yarn dev'],
    ['bun.lock', 'bun run dev'],
    ['bun.lockb', 'bun run dev'],
    ['package-lock.json', 'npm run dev'],
  ])('%s → %s', (lock, command) => {
    write(lock, '');
    expect(devCommand(dir, pkg)).toBe(command);
  });
  it('npm with no lockfile; nothing with no dev script', () => {
    expect(devCommand(dir, pkg)).toBe('npm run dev');
    expect(devCommand(dir, { scripts: { start: 'node .' } })).toBeUndefined();
  });
});

describe('agentsBlock', () => {
  it('names only tools the server lists', () => {
    for (const tools of [TOOLS, TOOLS_WITH_RUN]) {
      const named = [...agentsBlock(tools).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
      expect(named.length).toBeGreaterThan(0);
      for (const n of named) expect(tools).toContain(n);
    }
  });
  it('matches the design text once run_action ships (design section 10.1)', () => {
    expect(agentsBlock(TOOLS_WITH_RUN)).toBe(
      [
        '<!-- lightpath:start -->',
        '## Lightpath: what code actually ran',
        '',
        'This app runs under `lightpath dev`, which records the source files, functions and lines that ran, frontend and backend, for each click, key press or request.',
        '',
        '- Asked which code handles a button, page or request, or why an action fails? Call the Lightpath MCP tool `run_action` with the target, like `button "Checkout"`, before searching files. To read the last recorded action instead, call `find_code_for_action`.',
        '- Output is capped. To see more, follow its "not shown" line.',
        '- After a fix, call `run_action` again with the same target and compare the two traces with `diff_traces`.',
        "- If Lightpath says it isn't running, start `lightpath dev` in the project folder, or ask the user to.",
        '<!-- lightpath:end -->',
      ].join('\n'),
    );
  });
  it('upsertBlock is idempotent', () => {
    const b = agentsBlock(TOOLS);
    const once = upsertBlock('# x\n', b);
    expect(upsertBlock(once, b)).toBe(once);
  });
});

describe('serverToolNames', () => {
  it("reads this CLI's own MCP server's tools/list", async () => {
    const names = await serverToolNames(V);
    expect(names).toEqual(
      expect.arrayContaining(['find_code_for_action', 'get_trace', 'list_traces', 'diff_traces']),
    );
  });
});

describe('doctor setup checks', () => {
  const ok = (tools = TOOLS): ProbeResult => ({ ok: true, tools, stderr: '' });
  const results = async (
    platform: NodeJS.Platform,
    probe: (c: string, a: readonly string[]) => ProbeResult,
  ) => {
    const calls: string[][] = [];
    const checks = await setupChecks(dir, undefined, {
      platform,
      version: V,
      tools: TOOLS,
      probe: async (c, a, o) => {
        calls.push([c, ...a, o.env?.npm_config_offline ?? '']);
        return probe(c, a);
      },
    });
    const out = [];
    for (const c of checks) out.push({ name: c.name, ...(await c.run()) });
    return { out, calls };
  };

  it('passes what init wrote, and starts the command offline once per command', async () => {
    await run('claude-code', 'win32');
    await run('kiro', 'win32');
    const { out, calls } = await results('win32', () => ok());
    expect(out.every((r) => r.ok)).toBe(true);
    expect(out.map((r) => r.name)).toEqual([
      'Claude Code MCP config',
      'Kiro MCP config',
      'AGENTS.md block',
      'Auto-start',
    ]);
    expect(calls).toEqual([['cmd', '/c', 'npx', '-y', `@lightpath-dev/cli@${V}`, 'mcp', 'true']]);
  });

  it('fails a bare npx on Windows and cmd elsewhere, with the fix', async () => {
    await run('cursor', 'linux');
    let { out } = await results('win32', () => ok());
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0]?.detail).toContain('"command": "cmd"');
    await run('cursor', 'win32');
    ({ out } = await results('linux', () => ok()));
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0]?.detail).toContain('"command": "npx"');
  });

  it('says npx would download instead of failing when the package is not cached', async () => {
    await run('vscode');
    const { out } = await results('linux', () => ({
      ok: false,
      error: 'exited before answering',
      exit: '1',
      stderr: 'npm error code ENOTCACHED\n',
    }));
    expect(out[0]).toMatchObject({ ok: true });
    expect(out[0]?.detail).toContain(
      `npx would download @lightpath-dev/cli@${V} on first start; not checked offline`,
    );
  });

  it('fails a command that does not answer, or lists other tools', async () => {
    await run('vscode');
    let { out } = await results('linux', () => ({
      ok: false,
      error: 'no answer within 20 s',
      stderr: 'boom',
    }));
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0]?.detail).toContain('boom');
    ({ out } = await results('linux', () => ok(['get_trace'])));
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0]?.detail).toContain('missing list_traces');
  });

  it('fails a version that is not this CLI', async () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { lightpath: mcpCommand('0.0.1', 'linux') } }));
    write('AGENTS.md', agentsBlock(TOOLS));
    const { out } = await results('linux', () => ok());
    expect(out[0]?.detail).toContain('pins @lightpath-dev/cli@0.0.1');
  });

  it('fails an out-of-date block and a missing CLAUDE.md block', async () => {
    await run('claude-code');
    write('AGENTS.md', agentsBlock(['run_action', ...TOOLS.slice(1)]));
    write('CLAUDE.md', '# no block\n');
    const { out } = await results('linux', () => ok());
    const byName = Object.fromEntries(out.map((r) => [r.name, r]));
    expect(byName['AGENTS.md block']).toMatchObject({ ok: false });
    expect(byName['AGENTS.md block']?.detail).toContain('names run_action');
    expect(byName['CLAUDE.md block']).toMatchObject({ ok: false });
  });

  it("flags a lightpath entry in a file it can't parse", async () => {
    write('.vscode/mcp.json', '{ // c\n "servers": { "lightpath": {} } }');
    write('AGENTS.md', agentsBlock(TOOLS));
    const { out } = await results('linux', () => ok());
    expect(out[0]).toMatchObject({ name: 'VS Code MCP config', ok: false });
  });

  it('shows one optional line when nothing is set up', async () => {
    const { out } = await results('linux', () => ok());
    expect(out).toEqual([expect.objectContaining({ name: 'Agent setup', ok: true })]);
  });
});
