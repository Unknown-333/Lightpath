import { describe, expect, it } from 'vitest';
import { parseJsonc, setMember, setMemberChecked } from '../src/jsonc.js';

const E = { command: 'npx', args: ['-y', 'x'] };
const set = (text: string, key = 'servers') => setMemberChecked(text, key, 'lightpath', E);

describe('parseJsonc', () => {
  it('reads comments, trailing commas and a byte order mark', () => {
    expect(parseJsonc('\uFEFF{ // a\n "a": [1, 2,], /* b */ "b": { "c": "//not a comment", }, }')).toEqual({
      a: [1, 2],
      b: { c: '//not a comment' },
    });
  });
  it.each(['{ broken', '{ "a": 1 /* open', '{ "a": "open }', '', '{ "a" 1 }', '{} {}', '[1 2]'])(
    'gives undefined for %j',
    (text) => {
      expect(parseJsonc(text)).toBeUndefined();
    },
  );
});

describe('setMember', () => {
  it('opens an empty object', () => {
    expect(set('{\n  "servers": {}\n}\n')).toBe(
      '{\n  "servers": {\n    "lightpath": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "x"\n      ]\n    }\n  }\n}\n',
    );
  });
  it('adds the servers key when it is missing, after the other keys', () => {
    const out = set('{\n\t"inputs": []\n}\n') as string;
    expect(out.startsWith('{\n\t"inputs": [],\n\t"servers": {\n\t\t"lightpath": {\n')).toBe(true);
    expect(parseJsonc(out)).toEqual({ inputs: [], servers: { lightpath: E } });
  });
  it('keeps a one-line object on one line', () => {
    expect(set('{ "servers": { "a": 1 } }')).toBe(
      '{ "servers": { "a": 1, "lightpath": {"command":"npx","args":["-y","x"]} } }',
    );
    expect(set('{ "servers": { "a": 1, } }')).toBe(
      '{ "servers": { "a": 1, "lightpath": {"command":"npx","args":["-y","x"]}, } }',
    );
  });
  it('keeps a comment on the line of the last member with that member', () => {
    const out = set('{\n  "servers": {\n    "a": 1 // about a\n  }\n}\n') as string;
    expect(out).toContain('"a": 1, // about a\n    "lightpath": {');
  });
  it('keeps a trailing comma style', () => {
    const out = set('{\n  "servers": {\n    "a": 1,\n  },\n}\n') as string;
    expect(out).toContain('"a": 1,\n    "lightpath": {');
    expect(out).toMatch(/\n {4}\},\n {2}\},\n\}\n$/);
  });
  it('keeps comments inside an otherwise empty object', () => {
    const out = set('{ "servers": { /* none yet */ } }') as string;
    expect(out).toContain('/* none yet */');
    expect(parseJsonc(out)).toEqual({ servers: { lightpath: E } });
  });
  it('replaces the value of an existing member and nothing else', () => {
    const text =
      '{\n  "servers": {\n    "a": 1,\n    "lightpath": {"command": "old"}, // mine\n    "b": 2\n  }\n}';
    const out = set(text) as string;
    expect(out.startsWith('{\n  "servers": {\n    "a": 1,\n    "lightpath": {\n')).toBe(true);
    expect(out.endsWith('}, // mine\n    "b": 2\n  }\n}')).toBe(true);
  });
  it('refuses a root that is not an object, or servers that are not an object', () => {
    expect(set('[]')).toBeUndefined();
    expect(set('{ "servers": [] }')).toBeUndefined();
    expect(set('{ "servers": "x" }')).toBeUndefined();
    expect(setMember('"x"', 'servers', 'lightpath', E)).toBeUndefined();
  });
});
