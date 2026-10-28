import type { DecodedSourceMap } from '@jridgewell/trace-mapping';
import { describe, expect, it } from 'vitest';
import { flattenRanges } from '../src/flatten.js';
import { LineIndex } from '../src/line-index.js';
import { mapScript } from '../src/pipeline.js';
import { decodeDataUrlSourceMap, mapToOriginal } from '../src/sourcemap.js';

// Generated output of a transpiler. Line 1 is an injected helper with no mapping.
const generated = [
  'import { jsx } from "react/jsx-runtime";', //          gen line 1 (unmapped)
  'export function Cart({ items }) {', //                  gen line 2 → src line 3
  '  if (items.length === 0) return jsx("p", {});', //   gen line 3 → src line 4
  '  return jsx("ul", {});', //                           gen line 4 → src line 6
  '}', //                                                  gen line 5 → src line 7
].join('\n');

// Decoded mappings: [generatedColumn, sourceIndex, originalLine(0-based), originalColumn]
const map: DecodedSourceMap = {
  version: 3,
  file: 'Cart.js',
  sources: ['Cart.tsx'],
  names: [],
  mappings: [
    [],
    [[0, 0, 2, 0]],
    [
      [2, 0, 3, 2],
      [28, 0, 3, 28],
    ],
    [[2, 0, 5, 2]],
    [[0, 0, 6, 0]],
  ],
};

const idx = new LineIndex(generated);
const line = (n: number) => idx.lineStart(n - 1);

describe('mapToOriginal', () => {
  it('maps covered generated positions to original lines and drops unmapped helpers', () => {
    // Function ran once, the early return was not taken.
    const segments = flattenRanges([
      {
        functionName: 'Cart',
        isBlockCoverage: true,
        ranges: [
          { startOffset: line(2), endOffset: line(5) + 1, count: 1 },
          { startOffset: line(3) + 28, endOffset: line(4), count: 0 },
        ],
      },
    ]);
    const result = mapToOriginal(segments, idx, map, 'http://localhost:5173/src/Cart.tsx');
    const lines = result.get('http://localhost:5173/src/Cart.tsx');
    expect(lines && Object.fromEntries(lines)).toEqual({ 3: 1, 4: 1, 6: 1, 7: 1 });
  });
});

describe('decodeDataUrlSourceMap', () => {
  it('decodes base64 UTF-8 maps', () => {
    const json = JSON.stringify({ version: 3, sources: ['ü.ts'], names: [], mappings: '' });
    const url = `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
    expect(decodeDataUrlSourceMap(url)).toMatchObject({ sources: ['ü.ts'] });
  });

  it('decodes percent-encoded maps and ignores non-data URLs', () => {
    const json = JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: '' });
    expect(decodeDataUrlSourceMap(`data:application/json,${encodeURIComponent(json)}`)).toMatchObject({
      sources: ['a.ts'],
    });
    expect(decodeDataUrlSourceMap('Cart.js.map')).toBeUndefined();
  });
});

describe('mapScript', () => {
  it('runs the whole pipeline to workspace-relative paths', () => {
    const result = mapScript(
      {
        coverage: {
          scriptId: '7',
          url: 'http://localhost:5173/src/Cart.tsx',
          functions: [
            {
              functionName: 'Cart',
              isBlockCoverage: true,
              ranges: [{ startOffset: line(2), endOffset: line(5) + 1, count: 2 }],
            },
          ],
        },
        source: generated,
        sourceMap: map,
      },
      {
        workspaceRoots: ['/repo'],
        devServers: [{ origin: 'http://localhost:5173', root: '/repo/web' }],
      },
    );
    expect([...result.files.keys()]).toEqual(['web/src/Cart.tsx']);
    expect(result.files.get('web/src/Cart.tsx')?.get(4)).toBe(2);
  });

  it('drops node_modules scripts without mapping them', () => {
    const result = mapScript(
      { coverage: { scriptId: '1', url: 'file:///repo/node_modules/x/index.js', functions: [] }, source: '' },
      { workspaceRoots: ['/repo'] },
    );
    expect(result.files.size).toBe(0);
    expect(result.dropped.get('node_modules')).toBe(1);
  });
});
