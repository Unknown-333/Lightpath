import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupChecks } from '../src/doctor.js';
import { AGENT_SETUP, AGENTS, configWithEntry, init, mcpCommand, mcpEntry } from '../src/init.js';
import { parseJsonc, parseTree } from '../src/jsonc.js';

// D-151: init sets its own entry in an MCP config that already lists other servers, and leaves
// every other byte alone. Each fixture is a config as a user might have it: 4-space indents and
// inline arrays (Claude Code), tabs and CRLF (Cursor), comments and trailing commas (VS Code), and
// an old lightpath entry between two others (Kiro).
const FIXTURES = fileURLToPath(new URL('./fixtures/mcp-merge/', import.meta.url));
const TOOLS = ['run_action', 'list_traces', 'get_trace', 'find_code_for_action', 'diff_traces'];
const V = '9.9.9';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lightpath merge '));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The fixture's config as it is on disk for the test: Cursor's with CRLF (git stores it as LF). */
function setUp(agent: (typeof AGENTS)[number]): string {
  cpSync(join(FIXTURES, agent), dir, { recursive: true });
  const path = join(dir, AGENT_SETUP[agent].file);
  if (agent === 'cursor') writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  return readFileSync(path, 'utf8');
}

/** Each member of `servers` other than lightpath, as its exact text from key to end of value. */
function otherServerTexts(text: string, key: string): string[] {
  const root = parseTree(text);
  const servers = root?.members?.find((m) => m.key === key)?.value;
  return (servers?.members ?? [])
    .filter((m) => m.key !== 'lightpath')
    .map((m) => text.slice(m.keyStart, m.value.end));
}

describe('init merges into an existing MCP config (D-151)', () => {
  for (const agent of AGENTS) {
    for (const platform of ['linux', 'win32'] as const) {
      it(`${agent} on ${platform}: adds only its entry, keeps every other byte, then changes nothing`, async () => {
        const setup = AGENT_SETUP[agent];
        const before = setUp(agent);
        const lines: string[] = [];
        const run = () =>
          init({ cwd: dir, agent, version: V, tools: TOOLS, platform, out: (l) => lines.push(l) });

        expect(await run()).toBe(0);
        const after = readFileSync(join(dir, setup.file), 'utf8');
        expect(lines).toContain(`updated   ${setup.file}`);

        // The other servers, as text: byte for byte, and in the same order.
        const others = otherServerTexts(before, setup.key);
        expect(others.length).toBeGreaterThan(0);
        expect(otherServerTexts(after, setup.key)).toEqual(others);
        // Everything outside the servers object is unchanged too: here, VS Code's comments and inputs.
        for (const comment of before.match(/\/\/.*|\/\*[\s\S]*?\*\//g) ?? [])
          expect(after).toContain(comment);
        // The values parse back equal, with lightpath set.
        const b = parseJsonc(before) as Record<string, Record<string, unknown>>;
        const a = parseJsonc(after) as Record<string, Record<string, unknown>>;
        const { lightpath: _old, ...othersBefore } = b[setup.key] ?? {};
        const { lightpath, ...othersAfter } = a[setup.key] ?? {};
        expect(lightpath).toEqual(mcpEntry(agent, V, platform));
        expect(Object.keys(othersAfter)).toEqual(Object.keys(othersBefore));
        expect(othersAfter).toEqual(othersBefore);
        // Line endings kept: Cursor's file is CRLF throughout.
        if (agent === 'cursor') expect(after).not.toMatch(/[^\r]\n/);
        else expect(after).not.toContain('\r');
        // The whole file, LF-normalised, as reviewed in the snapshot.
        await expect(after.replace(/\r\n/g, '\n')).toMatchFileSnapshot(
          join(FIXTURES, agent, `expected.${platform}.json`),
        );

        lines.length = 0;
        expect(await run()).toBe(0);
        expect(readFileSync(join(dir, setup.file), 'utf8')).toBe(after);
        expect(lines).toContain(`unchanged ${setup.file}`);

        // doctor reads the same file, comments and all, and passes it.
        const checks = await setupChecks(dir, undefined, {
          platform,
          version: V,
          tools: TOOLS,
          probe: async () => ({ ok: true, tools: TOOLS, stderr: '' }),
        });
        const config = checks.find((c) => c.name === `${setup.name} MCP config`);
        expect(await config?.run()).toMatchObject({ ok: true });
      });
    }
  }

  it('leaves an entry that is already right alone, whatever its key order and formatting', () => {
    const entry = mcpEntry('vscode', V, 'linux');
    const raw = `{"servers":{"lightpath":{"args":${JSON.stringify(entry.args)},"command":"npx","type":"stdio"}}}`;
    expect(configWithEntry(raw, 'servers', entry)).toBe(raw);
  });

  it('replaces an old entry where it stands, between the others', () => {
    const before = setUp('kiro');
    const after = configWithEntry(before, 'mcpServers', mcpEntry('kiro', V, 'linux')) as string;
    expect(Object.keys((parseJsonc(after) as { mcpServers: object }).mcpServers)).toEqual([
      'fetch',
      'lightpath',
      'aws-docs',
    ]);
    expect(after).not.toContain('@lightpath-dev/cli@0.1.0');
  });

  it('writes the entry with the platform form: cmd /c npx on Windows, npx elsewhere', () => {
    const win = parseJsonc(configWithEntry('{}', 'mcpServers', mcpEntry('cursor', V, 'win32')) as string);
    const posix = parseJsonc(configWithEntry('{}', 'mcpServers', mcpEntry('cursor', V, 'darwin')) as string);
    expect(win).toEqual({ mcpServers: { lightpath: mcpCommand(V, 'win32') } });
    expect(posix).toEqual({ mcpServers: { lightpath: mcpCommand(V, 'darwin') } });
  });
});
