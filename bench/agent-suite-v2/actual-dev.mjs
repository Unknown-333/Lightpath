// Starts Actual Budget in browser mode on any OS: what `yarn start:browser` does
// (packages/desktop-client/bin/watch-browser + the plugins service build), without sh.
// Copied into each trial as dev.mjs. Web on http://localhost:8613 (override with PORT).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || '8613';
const env = { ...process.env, PORT: port, REACT_APP_BACKEND_WORKER_HASH: 'dev', BROWSER: 'none' };
const viteIn = (dir) => {
  const req = createRequire(join(dir, 'package.json'));
  return join(dirname(req.resolve('vite/package.json')), 'bin', 'vite.js');
};
const plugins = join(root, 'packages', 'plugins-service');
const web = join(root, 'packages', 'desktop-client');
const children = [
  spawn(process.execPath, [viteIn(plugins), 'build', '--watch'], {
    cwd: plugins,
    env: { ...env, NODE_ENV: 'development' },
    stdio: 'inherit',
  }),
  spawn(process.execPath, [viteIn(web), '--mode=browser', '--port', port, '--strictPort'], {
    cwd: web,
    env,
    stdio: 'inherit',
  }),
];
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', (code) => {
    console.error(`dev.mjs: a process exited (${code}); stopping`);
    stop();
  });
