// Starts the API (under tsx watch, so an edit to server/ restarts it) and the Vite dev server.
// Under `lightpath dev`, NODE_OPTIONS loads the agent into both; the agent skips Vite's and tsx's
// own processes and instruments the API.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// Vite's and tsx's exports maps hide their bin files, so find them through package.json's "bin".
const binOf = (pkg, name) => {
  const path = require.resolve(`${pkg}/package.json`);
  const bin = JSON.parse(readFileSync(path, 'utf8')).bin;
  return join(dirname(path), typeof bin === 'string' ? bin : bin[name]);
};

const children = [
  spawn(process.execPath, [binOf('tsx', 'tsx'), 'watch', '--clear-screen=false', 'server/index.ts'], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, [binOf('vite', 'vite')], { stdio: 'inherit' }),
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
