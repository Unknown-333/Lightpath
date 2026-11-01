// Proves each seeded bug: its hidden check FAILS on the bugged shop, PASSES after fix.patch,
// and the shop still typechecks after fix.patch (in the trial copy and as `pnpm --filter shop typecheck`).
//
//   node bench/agent-suite/prove.mjs [--bugs-dir <dir>] [--only b01,b02] [--out <file>] [--skip-repo-typecheck]
import { appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCheck } from './lib/check.mjs';
import { BUGS_DIR, isWindows, parseArgs, REPO_DIR, run, TRIALS_ROOT } from './lib/common.mjs';
import { applyPatch, createTrial, prepareTemplate, typecheck } from './lib/trial.mjs';

const args = parseArgs(process.argv.slice(2));
const bugsDir = resolve(args['bugs-dir'] ?? BUGS_DIR);
const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const out = args.out ? resolve(args.out) : null;

function log(line) {
  console.log(line);
  if (out) appendFileSync(out, `${line}\n`);
}

function repoTypecheck(bugDir) {
  // Applies bug.patch then fix.patch to examples/shop in this checkout, typechecks, and reverts both.
  const shop = ['--directory=examples/shop'];
  const git = (...a) => run('git', a, { cwd: REPO_DIR, check: true });
  git('apply', ...shop, join(bugDir, 'bug.patch'));
  try {
    git('apply', ...shop, join(bugDir, 'fix.patch'));
    try {
      const res = run('pnpm', ['--filter', 'shop', 'typecheck'], { cwd: REPO_DIR, shell: isWindows });
      return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() };
    } finally {
      git('apply', '-R', ...shop, join(bugDir, 'fix.patch'));
    }
  } finally {
    git('apply', '-R', ...shop, join(bugDir, 'bug.patch'));
  }
}

const template = prepareTemplate(log);
log(`prove: ${new Date().toISOString()} bugs=${bugsDir} trials=${TRIALS_ROOT} node=${process.version}`);
const ids = readdirSync(bugsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (!only || only.has(d.name)))
  .map((d) => d.name)
  .sort();
let failures = 0;
for (const id of ids) {
  const bugDir = join(bugsDir, id);
  const trialId = `prove-${id}`;
  const trialDir = createTrial({ id: trialId, bugDir, template, fresh: true });
  const logDir = join(TRIALS_ROOT, '_logs');
  mkdirSync(logDir, { recursive: true });
  const bugged = await runCheck({ bugDir, trialDir, logFile: join(logDir, `${trialId}-bugged.log`) });
  const buggedTypes = typecheck(trialDir);
  applyPatch(trialDir, join(bugDir, 'fix.patch'));
  const fixed = await runCheck({ bugDir, trialDir, logFile: join(logDir, `${trialId}-fixed.log`) });
  const fixedTypes = typecheck(trialDir);
  const repoTypes = args['skip-repo-typecheck'] ? { ok: null, output: 'skipped' } : repoTypecheck(bugDir);
  const ok = !bugged.pass && fixed.pass && fixedTypes.ok && repoTypes.ok !== false;
  if (!ok) failures++;
  log(`\n== ${id}: ${ok ? 'PROVEN' : 'NOT PROVEN'}`);
  log(`  bugged shop:  check ${bugged.pass ? 'PASS' : 'FAIL'} (${bugged.ms} ms) - ${bugged.detail}`);
  log(
    `  bugged shop:  typecheck ${buggedTypes.ok ? 'ok' : 'errors'}${buggedTypes.ok ? '' : `\n${buggedTypes.output}`}`,
  );
  log(`  after fix:    check ${fixed.pass ? 'PASS' : 'FAIL'} (${fixed.ms} ms) - ${fixed.detail}`);
  log(
    `  after fix:    typecheck in trial (tsc -p .) ${fixedTypes.ok ? 'ok' : `errors\n${fixedTypes.output}`}`,
  );
  log(
    `  after fix:    pnpm --filter shop typecheck ${repoTypes.ok === null ? 'skipped' : repoTypes.ok ? 'ok' : 'errors'}`,
  );
  log(`    ${repoTypes.output.split('\n').join('\n    ')}`);
}
log(`\nprove: ${ids.length - failures}/${ids.length} proven`);
process.exitCode = failures === 0 ? 0 : 1;
