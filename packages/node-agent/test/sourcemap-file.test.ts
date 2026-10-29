import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_MAP_BYTES, readExternalSourceMap } from '../src/sourcemap-file.js';

const base = mkdtempSync(join(tmpdir(), 'lightpath-map-'));
const workspace = join(base, 'app');
const outside = join(base, 'elsewhere');
mkdirSync(join(workspace, 'dist', 'maps'), { recursive: true });
mkdirSync(outside, { recursive: true });
afterAll(() => rmSync(base, { recursive: true, force: true }));

const url = (...parts: string[]) => pathToFileURL(join(...parts)).href;
const workspaceUrl = url(workspace);
const inWorkspace = (u: string) => u.toLowerCase().startsWith(`${workspaceUrl.toLowerCase()}/`);
const script = url(workspace, 'dist', 'a.js');
const map = (sources: string[], extra: object = {}) =>
  JSON.stringify({ version: 3, sources, names: [], mappings: 'AAAA', ...extra });
const decode = (dataUrl: string | undefined) =>
  dataUrl && JSON.parse(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64').toString('utf8'));

describe('readExternalSourceMap', () => {
  it('reads a map next to the script and makes its sources absolute', () => {
    writeFileSync(join(workspace, 'dist', 'a.js.map'), map(['../src/a.ts']));
    const result = readExternalSourceMap(script, 'a.js.map', inWorkspace);
    expect(result?.startsWith('data:application/json;base64,')).toBe(true);
    expect(decode(result)).toMatchObject({ version: 3, sources: [url(workspace, 'src', 'a.ts')] });
  });

  it('resolves sources against the map location and its sourceRoot', () => {
    writeFileSync(join(workspace, 'dist', 'maps', 'b.js.map'), map(['b.ts'], { sourceRoot: '../../src' }));
    const result = decode(readExternalSourceMap(script, 'maps/b.js.map?v=3', inWorkspace));
    expect(result.sources).toEqual([url(workspace, 'src', 'b.ts')]);
    expect(result.sourceRoot).toBeUndefined();
  });

  it('turns Windows absolute sources into file URLs', () => {
    writeFileSync(join(workspace, 'dist', 'c.js.map'), map(['C:\\repo\\src\\c.ts']));
    expect(decode(readExternalSourceMap(script, 'c.js.map', inWorkspace)).sources).toEqual([
      'file:///C:/repo/src/c.ts',
    ]);
  });

  it.each([
    ['an inline map (already handled by V8)', 'data:application/json;base64,e30='],
    ['no map', ''],
    ['a network map', 'https://example.com/a.js.map'],
    ['a map outside the workspace', url(outside, 'secret.js.map')],
    ['a relative path that climbs out of the workspace', '../../elsewhere/secret.js.map'],
    ['a missing file', 'missing.js.map'],
  ])('refuses %s', (_label, sourceMapURL) => {
    writeFileSync(join(outside, 'secret.js.map'), map(['secret.ts']));
    expect(readExternalSourceMap(script, sourceMapURL, inWorkspace)).toBeUndefined();
  });

  it('refuses files that are not version 3 source maps', () => {
    writeFileSync(join(workspace, 'dist', 'bad.js.map'), '{"not": "a map"}');
    writeFileSync(join(workspace, 'dist', 'broken.js.map'), '{');
    expect(readExternalSourceMap(script, 'bad.js.map', inWorkspace)).toBeUndefined();
    expect(readExternalSourceMap(script, 'broken.js.map', inWorkspace)).toBeUndefined();
  });

  it(`refuses maps larger than ${MAX_MAP_BYTES} bytes`, () => {
    writeFileSync(join(workspace, 'dist', 'huge.js.map'), map(['a.ts'], { pad: 'x'.repeat(MAX_MAP_BYTES) }));
    expect(readExternalSourceMap(script, 'huge.js.map', inWorkspace)).toBeUndefined();
  });

  it('ignores scripts that are not files', () => {
    expect(readExternalSourceMap('node:internal/x', 'x.js.map', inWorkspace)).toBeUndefined();
    expect(readExternalSourceMap('http://localhost:5173/a.js', 'a.js.map', inWorkspace)).toBeUndefined();
  });
});
