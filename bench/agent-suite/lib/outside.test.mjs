// node --test bench/agent-suite/lib/outside.test.mjs  (D-149)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outsidePaths, outsidePathsD108 } from './outside.mjs';

const T = 'C:\\trials\\b06-with-2';
const none = () => false;
const all = () => true;

test('a /c:/ URL-form path inside the trial is not a hit (b06-with-2 case)', () => {
  const calls = [{ title: 'Edit', locations: [{ path: '/c:/trials/b06-with-2/server/routes/orders.ts' }] }];
  assert.equal(outsidePathsD108(calls, T).length, 1);
  const r = outsidePaths(calls, T, { exists: all });
  assert.deepEqual(r.hits, []);
  assert.equal(r.ignored.length, 1);
});

test('a /c:/ URL-form path outside the trial is still a hit', () => {
  const calls = [{ title: 'Read', locations: [{ path: '/c:/trials/suite/check.mjs' }] }];
  assert.equal(outsidePaths(calls, T, { exists: all }).hits.length, 1);
});

test("require('../utils') text in a command is not a hit when it names nothing (h02 case)", () => {
  const command =
    "$c=\"const { d } = require('$(if($x){'../utils'}else{'../../utils'})/upload-filename');\"; Set-Content $x $c";
  const calls = [{ title: 'Run Command', input: { command, cwd: T } }];
  assert.equal(outsidePathsD108(calls, T).length, 2);
  const r = outsidePaths(calls, T, { exists: none });
  assert.deepEqual(r.hits, []);
  assert.equal(r.ignored.length, 2);
});

test('a .. read that names a real place outside is still a hit', () => {
  const calls = [{ title: 'Run Command', input: { command: 'Get-Content ..\\suite\\check.mjs', cwd: T } }];
  assert.equal(outsidePaths(calls, T, { exists: all }).hits.length, 1);
});

test('a bare .. and drive paths and path fields are unchanged', () => {
  const calls = [
    { title: 'Run Command', input: { command: 'ls ..', cwd: T } },
    { title: 'Run Command', input: { command: 'type C:\\trials\\suite\\x.txt', cwd: T } },
    { title: 'Read', input: { path: '..\\other\\x.txt' } },
  ];
  const r = outsidePaths(calls, T, { exists: (p) => p.toLowerCase() === 'c:\\trials' });
  assert.equal(r.hits.length, 3);
  assert.deepEqual(outsidePathsD108(calls, T).length, 3);
});

test('paths inside the trial are never hits', () => {
  const calls = [
    { title: 'Read', input: { path: 'C:\\trials\\b06-with-2\\src\\a.ts' } },
    { title: 'Run Command', input: { command: 'cd backend; cat ../package.json', cwd: `${T}\\backend` } },
  ];
  const r = outsidePaths(calls, T, { exists: all });
  assert.deepEqual(r, { hits: [], ignored: [] });
});
