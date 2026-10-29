import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, configJsonSchema, loadConfig } from '../src/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lightpath-config-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (json: unknown, name = 'lightpath.config.json') =>
  writeFileSync(join(dir, name), typeof json === 'string' ? json : JSON.stringify(json));

describe('loadConfig', () => {
  it('returns undefined when there is no config file', async () => {
    expect(await loadConfig(dir)).toBeUndefined();
  });

  it('reads every key and makes paths absolute against the file', async () => {
    write({
      $schema: './node_modules/@lightpath-dev/cli/lightpath.config.schema.json',
      command: 'npm run dev',
      url: 'http://localhost:5173',
      webRoot: 'web',
      backend: ['https://api.example.com/v1'],
      roots: ['.', '../shared'],
      ignore: ['src/generated/**'],
      settleMs: 500,
      maxSettleMs: 8000,
      browser: true,
      headless: false,
    });
    const loaded = await loadConfig(dir);
    expect(loaded?.path).toBe(join(dir, 'lightpath.config.json'));
    expect(loaded?.config).toEqual({
      $schema: './node_modules/@lightpath-dev/cli/lightpath.config.schema.json',
      command: 'npm run dev',
      url: 'http://localhost:5173/',
      webRoot: resolve(dir, 'web'),
      backend: ['https://api.example.com'], // an origin, so the path is dropped
      roots: [resolve(dir), resolve(dir, '../shared')],
      ignore: ['src/generated/**'],
      settleMs: 500,
      maxSettleMs: 8000,
      browser: true,
      headless: false,
    });
  });

  it('accepts a command as an argument list and a UTF-8 BOM', async () => {
    write(`\uFEFF${JSON.stringify({ command: ['pnpm', 'dev'] })}`);
    expect((await loadConfig(dir))?.config.command).toEqual(['pnpm', 'dev']);
  });

  it('names every problem, including typos', async () => {
    write({ comand: 'npm run dev', settleMs: 5, backend: ['localhost:3001'] });
    const err = await loadConfig(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as Error).message;
    expect(msg).toContain('has problems');
    expect(msg).toContain('comand');
    expect(msg).toContain('settleMs');
    expect(msg).toContain('backend.0: must be an http(s) origin');
  });

  it('reports broken JSON', async () => {
    write('{ "command": "npm run dev", }');
    await expect(loadConfig(dir)).rejects.toThrow(/isn't valid JSON/);
  });

  it('reads an explicit file and fails when it is missing', async () => {
    write({ headless: true }, 'other.json');
    expect((await loadConfig(dir, 'other.json'))?.config).toEqual({ headless: true });
    await expect(loadConfig(dir, 'missing.json')).rejects.toThrow(/can't read/);
  });
});

describe('lightpath.config.schema.json', () => {
  it('matches the config definition (regenerate with UPDATE_SCHEMA=1)', () => {
    const file = fileURLToPath(new URL('../lightpath.config.schema.json', import.meta.url));
    const expected = configJsonSchema();
    if (process.env.UPDATE_SCHEMA) writeFileSync(file, `${JSON.stringify(expected, null, 2)}\n`);
    // Compared as JSON, so formatting the file (Biome does) doesn't matter.
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(expected);
  });
});
