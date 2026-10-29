import { describe, expect, it } from 'vitest';
import { compileIgnore } from '../src/ignore.js';
import { resolveFile } from '../src/resolve.js';

describe('compileIgnore', () => {
  it.each([
    // pattern, path, ignored?
    ['src/generated/**', 'src/generated/api.ts', true],
    ['src/generated/**', 'src/generated/deep/x.ts', true],
    ['src/generated/**', 'src/generatedx/a.ts', false],
    ['src/generated', 'src/generated/api.ts', true], // a folder hides what's inside
    ['src/generated/', 'src/generated/api.ts', true],
    ['generated', 'packages/web/generated/a.ts', true], // no slash: any depth
    ['generated', 'packages/web/generated.ts', false],
    ['*.test.ts', 'server/routes/orders.test.ts', true],
    ['*.test.ts', 'server/routes/orders.ts', false],
    ['/server/*.ts', 'server/index.ts', true], // leading slash: from the root only
    ['/server/*.ts', 'other/server/index.ts', false],
    ['server/*.ts', 'server/routes/orders.ts', false], // * stays in one folder
    ['server/**/*.ts', 'server/index.ts', true], // **/ also matches no folder
    ['server/**/*.ts', 'server/routes/orders.ts', true],
    ['src/?.ts', 'src/a.ts', true],
    ['src/?.ts', 'src/ab.ts', false],
    ['./src/legacy/**', 'src/legacy/a.ts', true],
    ['src\\legacy\\**', 'src/legacy/a.ts', true],
    ['src/a+b.ts', 'src/a+b.ts', true], // regex characters are literal
    ['src/a+b.ts', 'src/aab.ts', false],
    ['SRC/Legacy/**', 'src/legacy/a.ts', true], // case doesn't matter (Windows paths vary)
  ])('%s on %s → %s', (pattern, path, ignored) => {
    expect(compileIgnore([pattern])(path)).toBe(ignored);
  });

  it('skips blank lines and comments', () => {
    const m = compileIgnore(['', '  ', '# src/a.ts']);
    expect(m('src/a.ts')).toBe(false);
  });
});

describe('resolveFile with ignore', () => {
  const ctx = { workspaceRoots: ['/home/me/shop'], ignore: ['server/legacy/**', '*.gen.ts'] };
  it('drops matching workspace files as ignored', () => {
    expect(resolveFile('file:///home/me/shop/server/legacy/old.ts', ctx)).toEqual({
      kind: 'dropped',
      reason: 'ignored',
    });
    expect(resolveFile('/home/me/shop/src/api.gen.ts', ctx)).toEqual({ kind: 'dropped', reason: 'ignored' });
  });
  it('keeps the others', () => {
    expect(resolveFile('file:///home/me/shop/server/routes/orders.ts', ctx)).toMatchObject({
      kind: 'workspace',
      path: 'server/routes/orders.ts',
    });
  });
  it('still reports node_modules and outside files by their own reason', () => {
    expect(resolveFile('/home/me/shop/node_modules/x/a.gen.ts', ctx)).toEqual({
      kind: 'dropped',
      reason: 'node_modules',
    });
    expect(resolveFile('/tmp/a.gen.ts', ctx)).toEqual({ kind: 'dropped', reason: 'outside-workspace' });
  });
});
