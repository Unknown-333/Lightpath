// Builds trial folders: a standalone copy of examples/shop with one bug applied and one git commit.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CACHE_DIR, npm, REPO_DIR, run, SHOP_DIR, sha256, TRIALS_ROOT } from './common.mjs';

// Bump when the way the template is built changes, so old caches aren't reused.
const TEMPLATE_VERSION = 1;
const SKIP = new Set(['node_modules', 'dist', '.lightpath']);

function shopFiles(dir = SHOP_DIR) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...shopFiles(path));
    else files.push(path);
  }
  return files.sort();
}

function readJsonc(path) {
  // The shop's tsconfig files only use whole-line // comments.
  const text = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return JSON.parse(text);
}

/** The shop's tsconfig extends ../../tsconfig.base.json; a standalone copy needs those options inline. */
function inlineTsconfig(name) {
  const base = readJsonc(join(REPO_DIR, 'tsconfig.base.json'));
  const own = readJsonc(join(SHOP_DIR, name));
  const { extends: _ignored, ...rest } = own;
  const { $schema: _schema, ...baseRest } = base;
  return { ...rest, compilerOptions: { ...baseRest.compilerOptions, ...own.compilerOptions } };
}

function standalonePackageJson() {
  const pkg = JSON.parse(readFileSync(join(SHOP_DIR, 'package.json'), 'utf8'));
  const root = JSON.parse(readFileSync(join(REPO_DIR, 'package.json'), 'utf8'));
  // This script points into the monorepo, which a trial doesn't have.
  delete pkg.scripts.lightpath;
  // In the monorepo these come from the root; a standalone app lists them itself (same versions).
  pkg.devDependencies = {
    ...pkg.devDependencies,
    '@types/node': root.devDependencies['@types/node'],
    typescript: root.devDependencies.typescript,
  };
  return pkg;
}

/** Builds (once) a cached copy of the shop with dependencies installed. Returns its path. */
export function prepareTemplate(log = console.log) {
  const files = shopFiles();
  const parts = [`v${TEMPLATE_VERSION}`, readFileSync(join(REPO_DIR, 'tsconfig.base.json'), 'utf8')];
  for (const file of files) parts.push(relative(SHOP_DIR, file), readFileSync(file, 'utf8'));
  parts.push(JSON.stringify(standalonePackageJson()));
  const key = sha256(parts.join('\0')).slice(0, 12);
  const dir = join(CACHE_DIR, `shop-template-${key}`);
  if (existsSync(join(dir, '.ready'))) return dir;

  log(`building shop template ${dir}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const target = join(dir, relative(SHOP_DIR, file));
    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(file, target);
  }
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(inlineTsconfig('tsconfig.json'), null, 2)}\n`);
  writeFileSync(
    join(dir, 'tsconfig.server.json'),
    `${JSON.stringify(inlineTsconfig('tsconfig.server.json'), null, 2)}\n`,
  );
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(standalonePackageJson(), null, 2)}\n`);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.lightpath/\n*.log\n');
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, check: true });
  writeFileSync(join(dir, '.ready'), `${new Date().toISOString()}\n`);
  return dir;
}

const GIT_ID = [
  '-c',
  'user.name=Shop Dev',
  '-c',
  'user.email=dev@shop.example',
  '-c',
  'commit.gpgsign=false',
];

/**
 * Creates TRIALS_ROOT/<id>: the template, the bug patch, then `git init` with ONE commit,
 * so history can't show the bug. Returns the trial path.
 */
export function createTrial({ id, bugDir, template, fresh = false }) {
  const dir = join(TRIALS_ROOT, id);
  if (existsSync(dir)) {
    if (!fresh) throw new Error(`trial folder already exists: ${dir} (use --fresh to replace it)`);
    if (!dir.startsWith(TRIALS_ROOT + sep)) throw new Error(`refusing to delete ${dir}`);
    rmSync(dir, { recursive: true, force: true });
  }
  cpSync(template, dir, { recursive: true, filter: (src) => !src.endsWith(`${sep}.ready`) });
  applyPatch(dir, join(bugDir, 'bug.patch'));
  run('git', ['init', '-q', '-b', 'main'], { cwd: dir, check: true });
  run('git', ['add', '-A'], { cwd: dir, check: true });
  run('git', [...GIT_ID, 'commit', '-q', '-m', 'Initial commit'], { cwd: dir, check: true });
  return dir;
}

export function applyPatch(dir, patch, { reverse = false } = {}) {
  const args = ['apply', '--whitespace=nowarn'];
  if (reverse) args.push('-R');
  run('git', [...args, patch], { cwd: dir, check: true });
}

/** Runs the shop's own typecheck (tsc -p .) in a trial folder. */
export function typecheck(dir) {
  const res = npm(['run', 'typecheck', '--silent'], { cwd: dir, timeoutMs: 180_000 });
  return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() };
}
