import { describe, expect, it } from 'vitest';
import { normalizePath, type ResolveContext, resolveFile } from '../src/resolve.js';

const win: ResolveContext = {
  workspaceRoots: ['C:\\Users\\me\\shop\\'],
  devServers: [{ origin: 'http://localhost:5173', root: 'C:\\Users\\me\\shop\\web' }],
};
const posix: ResolveContext = { workspaceRoots: ['/home/me/shop'] };

describe('resolveFile', () => {
  it.each([
    ['file:///C:/Users/me/shop/server/routes/orders.ts', 'server/routes/orders.ts'],
    ['file:///c:/Users/ME/shop/server/a.ts', 'server/a.ts'], // Windows paths compare case-insensitively
    ['file:///C:/Users/me/shop/my%20dir/a.ts', 'my dir/a.ts'],
    ['http://localhost:5173/src/Cart.tsx?t=1730000000', 'web/src/Cart.tsx'],
    ['http://localhost:5173/@fs/C:/Users/me/shop/shared/money.ts', 'shared/money.ts'],
    ['C:\\Users\\me\\shop\\server\\index.ts', 'server/index.ts'],
  ])('%s → %s', (url, path) => {
    expect(resolveFile(url, win)).toMatchObject({ kind: 'workspace', path });
  });

  it.each([
    ['file:///C:/Users/me/shop/node_modules/express/index.js', 'node_modules'],
    ['http://localhost:5173/node_modules/.vite/deps/react.js', 'node_modules'],
    ['node:internal/modules/run_main', 'internal'],
    ['http://localhost:5173/@vite/client', 'internal'],
    ['http://localhost:5173/@react-refresh', 'internal'],
    ['', 'internal'],
    ['file:///C:/Users/me/other/a.ts', 'outside-workspace'],
    ['https://cdn.example.com/lib.js', 'outside-workspace'],
  ])('%s is dropped as %s', (url, reason) => {
    expect(resolveFile(url, win)).toEqual({ kind: 'dropped', reason });
  });

  it('resolves POSIX file URLs case-sensitively', () => {
    expect(resolveFile('file:///home/me/shop/a.ts', posix)).toMatchObject({ path: 'a.ts' });
    expect(resolveFile('file:///home/me/Shop/a.ts', posix)).toEqual({
      kind: 'dropped',
      reason: 'outside-workspace',
    });
  });

  it('does not treat a sibling directory with the same prefix as inside the root', () => {
    expect(resolveFile('file:///home/me/shop-old/a.ts', posix)).toEqual({
      kind: 'dropped',
      reason: 'outside-workspace',
    });
  });
});

describe('normalizePath', () => {
  it.each([
    ['c:\\repo\\a\\', 'C:/repo/a'],
    ['C:/', 'C:/'],
    ['/home/me/', '/home/me'],
  ])('%s → %s', (input, out) => {
    expect(normalizePath(input)).toBe(out);
  });
});
