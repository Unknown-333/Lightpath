// Starts tududi for development on any OS: the same steps as `npm start`
// (scripts/start-all-dev.sh -> backend/cmd/start-dev.sh + webpack serve), without bash.
// Copied into each trial as dev.mjs. Ports: API 3611, web 8611 (override with PORT / FRONTEND_PORT).
//
//   node dev.mjs            prepare the database, create the dev user, start API + web
//
// Dev user: dev@tududi.test / DevPass123! (override with TUDUDI_USER_EMAIL / TUDUDI_USER_PASSWORD).
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const backend = join(root, 'backend');
const apiPort = process.env.PORT || '3611';
const webPort = process.env.FRONTEND_PORT || '8611';
const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: apiPort,
  DB_FILE: process.env.DB_FILE || 'db/development.sqlite3',
  FRONTEND_PORT: webPort,
  FRONTEND_HOST: process.env.FRONTEND_HOST || 'localhost',
  BACKEND_URL: process.env.BACKEND_URL || `http://localhost:${apiPort}`,
  FRONTEND_URL: process.env.FRONTEND_URL || `http://localhost:${webPort}`,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || `http://localhost:${webPort}`,
  TUDUDI_ALLOWED_ORIGINS: process.env.TUDUDI_ALLOWED_ORIGINS || `http://localhost:${webPort}`,
  TUDUDI_USER_EMAIL: process.env.TUDUDI_USER_EMAIL || 'dev@tududi.test',
  TUDUDI_USER_PASSWORD: process.env.TUDUDI_USER_PASSWORD || 'DevPass123!',
};

function step(args, cwd) {
  const res = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`dev.mjs: ${args.join(' ')} failed (${res.status})`);
    process.exit(1);
  }
}

// backend/cmd/start.sh: prepare the database, migrate, create the user, then start.
step(['scripts/db-prepare.js'], backend);
step(
  [
    join(root, 'node_modules', 'sequelize-cli', 'lib', 'sequelize'),
    'db:migrate',
    '--config',
    'config/database.js',
  ],
  backend,
);
step(['scripts/user-create.js', env.TUDUDI_USER_EMAIL, env.TUDUDI_USER_PASSWORD, 'true'], backend);

const children = [
  spawn(process.execPath, ['app.js'], { cwd: backend, env, stdio: 'inherit' }),
  // Source maps on, so stack traces and tools point at the TypeScript files.
  spawn(
    process.execPath,
    [
      join(root, 'node_modules', 'webpack-cli', 'bin', 'cli.js'),
      'serve',
      '--config',
      'webpack.config.js',
      '--devtool',
      'eval-source-map',
    ],
    { cwd: root, env, stdio: 'inherit' },
  ),
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
