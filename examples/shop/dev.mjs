// Starts the API and the Vite dev server together. Under `lightpath dev`, NODE_OPTIONS loads the
// agent into both; the agent skips Vite's own process and instruments the API.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// Vite's exports map hides bin/vite.js, so find it through package.json's "bin" field.
const vitePkgPath = require.resolve('vite/package.json');
const vitePkg = JSON.parse(readFileSync(vitePkgPath, 'utf8'));
const viteBin = join(dirname(vitePkgPath), typeof vitePkg.bin === 'string' ? vitePkg.bin : vitePkg.bin.vite);

const [major, minor] = process.versions.node.split('.').map(Number);
// Type stripping is on by default from Node 22.18; earlier 22.x releases need the flag.
const stripFlag = major === 22 && minor < 18 ? ['--experimental-strip-types'] : [];

const children = [
  // Node runs the TypeScript server directly by stripping types: no build step, no source maps.
  spawn(process.execPath, [...stripFlag, 'server/index.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit' }),
];

const stop = () => {
  for (const child of children) child.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
}
