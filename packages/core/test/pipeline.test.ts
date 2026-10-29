import { describe, expect, it } from 'vitest';
import { mapScript } from '../src/pipeline.js';
import type { ResolveContext } from '../src/resolve.js';

const ctx: ResolveContext = {
  workspaceRoots: ['/home/me/app'],
  devServers: [{ origin: 'http://localhost:8080', root: '/home/me/app' }],
};
const source = 'function a() {\n  return 1;\n}\na();\n';
const coverage = (url: string) => ({
  scriptId: '1',
  url,
  functions: [
    {
      functionName: '',
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
    },
  ],
});

describe('mapScript', () => {
  it("drops a webpack module that has no source map instead of lighting the loader's output (D-087)", () => {
    const result = mapScript({ coverage: coverage('webpack://app/./src/a.tsx?'), source }, ctx);
    expect(result.files.size).toBe(0);
    expect(result.dropped.get('no-source-map')).toBe(1);
  });

  it('still maps a plain served file without a map by its own offsets', () => {
    const result = mapScript({ coverage: coverage('http://localhost:8080/src/a.js'), source }, ctx);
    expect([...result.files.keys()]).toEqual(['src/a.js']);
  });
});
