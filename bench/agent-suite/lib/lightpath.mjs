// Packs this checkout's Lightpath packages into tarballs and installs them outside the repo, for
// the "with" condition. Nothing is published: `pnpm pack` writes local .tgz files only.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, isWindows, npm, REPO_DIR, run } from './common.mjs';

const PACKAGES = ['protocol', 'core', 'browser', 'daemon', 'mcp', 'node-agent', 'cli'];

/** Returns { dir, bin, version, commit } for an install of the packed branch under test. */
export function prepareLightpath(log = console.log) {
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR, check: true }).stdout.trim();
  const dirty =
    run('git', ['status', '--porcelain', '--', 'packages'], { cwd: REPO_DIR }).stdout.trim() !== '';
  const dir = join(CACHE_DIR, `lightpath-${commit.slice(0, 12)}${dirty ? '-dirty' : ''}`);
  const bin = join(dir, 'node_modules', '@lightpath-dev', 'cli', 'dist', 'bin.js');
  if (!dirty && existsSync(join(dir, '.ready'))) return { dir, bin, commit, dirty, version: version(bin) };

  log(
    `packing Lightpath ${commit.slice(0, 12)}${dirty ? ' (uncommitted changes in packages/)' : ''} into ${dir}`,
  );
  rmSync(dir, { recursive: true, force: true });
  const tgzDir = join(dir, 'tgz');
  mkdirSync(tgzDir, { recursive: true });
  run('pnpm', ['build'], { cwd: REPO_DIR, shell: isWindows, check: true });
  for (const name of PACKAGES) {
    run('pnpm', ['pack', '--pack-destination', tgzDir], {
      cwd: join(REPO_DIR, 'packages', name),
      shell: isWindows,
      check: true,
    });
  }
  writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
  const tarballs = readdirSync(tgzDir)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => `./tgz/${f}`);
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs], { cwd: dir, check: true });
  writeFileSync(join(dir, '.ready'), `${commit}\n`);
  return { dir, bin, commit, dirty, version: version(bin) };
}

function version(bin) {
  return run(process.execPath, [bin, '--version']).stdout.trim();
}
