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

describe('mapToOriginal with Windows absolute sources', () => {
  // One mapping: generated line 2, column 0 → original line 3.
  const encoded = (sources: string[], sourceRoot?: string) => ({
    version: 3 as const,
    sources,
    names: [],
    mappings: ';AAEA',
    ...(sourceRoot ? { sourceRoot } : {}),
  });
  const segments = [{ start: 0, end: 100, count: 1 }];
  const gen = new LineIndex('a\nb\n');

  it.each([
    [['C:\\Users\\me\\my app\\src\\a.ts'], undefined, 'file:///C:/Users/me/my%20app/src/a.ts'],
    [['C:/Users/me/app/src/a.ts'], undefined, 'file:///C:/Users/me/app/src/a.ts'],
    [['src/a.ts'], 'C:\\Users\\me\\app\\', 'file:///C:/Users/me/app/src/a.ts'],
    [['/home/me/app/src/a.ts'], undefined, 'file:///home/me/app/src/a.ts'],
  ])('resolves %j (root %s) to %s', (sources, root, expected) => {
    // tsx on Windows writes sources like the first case; the map URL is the script's file:// URL.
    const result = mapToOriginal(segments, gen, encoded(sources, root), 'file:///C:/Users/me/app/dist/a.js');
    expect([...result.keys()]).toEqual([expected]);
  });
});

describe('mapToOriginal with mappings over whitespace', () => {
  it("doesn't light an untaken block's closing brace from tsc's end-of-node mapping", () => {
    // tsc writes two mappings for a `}`: one on it, one just after it (at the line's end).
    const js = ['if (a) {', '    b();', '}', 'c();'].join('\n');
    const gen = new LineIndex(js);
    const at = (line: number, col: number) => gen.lineStart(line - 1) + col;
    const mapped: DecodedSourceMap = {
      version: 3,
      sources: ['a.ts'],
      names: [],
      mappings: [
        [[0, 0, 0, 0]], // `if (a) {` → line 1
        [[4, 0, 1, 4]], // `b();` → line 2
        [
          [0, 0, 2, 0], // `}` → line 3
          [1, 0, 2, 1], // just after `}`: nothing but the line's end
        ],
        [[0, 0, 3, 0]], // `c();` → line 4
      ],
    };
    // The block didn't run: V8 counts its span, including the `}`, as 0. Right after it is 1 again.
    const segments = [
      { start: 0, end: at(1, 7), count: 1 },
      { start: at(1, 7), end: at(3, 1), count: 0 },
      { start: at(3, 1), end: js.length, count: 1 },
    ];
    const lines = mapToOriginal(segments, gen, mapped, 'file:///repo/a.js').get('file:///repo/a.ts');
    expect(lines && Object.fromEntries(lines)).toEqual({ 1: 1, 2: 0, 3: 0, 4: 1 });
  });

  it('LineIndex.codeStart skips whitespace and stops at the range end', () => {
    const idx = new LineIndex('a  \n  b');
    expect(idx.codeStart(1, 7)).toBe(6);
    expect(idx.codeStart(1, 5)).toBeUndefined();
    expect(idx.codeStart(0, 1)).toBe(0);
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
