// Proves each suite v2 bug (SELECTION.md, "Each bug"): its hidden check FAILS on the bugged app
// and PASSES after fix.patch, 3 times each, and after fix2.patch (a different correct fix) where
// the bug has one. The app's typecheck must pass after each fix. Every run is logged.
//
//   node bench/agent-suite-v2/prove.mjs [--bugs-dir <dir>] [--only v01,v02] [--runs 3] [--out <file>]
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, TRIALS_ROOT } from '../agent-suite/lib/common.mjs';
import { appFor, BUGS_DIR } from './lib/apps.mjs';

const args = parseArgs(process.argv.slice(2));
const bugsDir = resolve(args['bugs-dir'] ?? BUGS_DIR);
const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const runs = Number(args.runs ?? 3);
const out = args.out ? resolve(args.out) : null;
function log(line) {
  console.log(line);
  if (out) appendFileSync(out, `${line}\n`);
}

const ids = readdirSync(bugsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (!only || only.has(d.name)))
  .map((d) => d.name)
  .sort();
const logDir = join(TRIALS_ROOT, '_logs');
mkdirSync(logDir, { recursive: true });
log(
  `prove: ${new Date().toISOString()} bugs=${bugsDir} ids=${ids.join(',')} runs=${runs} node=${process.version}`,
);

let failures = 0;
for (const id of ids) {
  const bugDir = join(bugsDir, id);
  const meta = JSON.parse(readFileSync(join(bugDir, 'bug.json'), 'utf8'));
  const app = appFor(meta.app);
  app.assertPortsFree();
  const template = app.prepareTemplate(log);
  log(`\n== ${id} (${meta.app}@${app.APP.commit})`);
  const sides = [['bug', null]];
  sides.push(['fix', 'fix.patch']);
  if (existsSync(join(bugDir, 'fix2.patch'))) sides.push(['fix2', 'fix2.patch']);
  let ok = true;
  for (const [side, patch] of sides) {
    const trialDir = app.createTrial({ id: `prove-${id}-${side}`, bugDir, template, fresh: true });
    if (patch) app.applyPatch(trialDir, join(bugDir, patch));
    const results = [];
    for (let n = 1; n <= runs; n++) {
      const r = await app.runCheck({
        bugDir,
        trialDir,
        logFile: join(logDir, `prove-${id}-${side}-${n}.log`),
      });
      results.push(r.pass);
      log(`  ${side} run ${n}: check ${r.pass ? 'PASS' : 'FAIL'} (${r.ms} ms) - ${r.detail}`);
    }
    const types = app.typecheck(trialDir);
    log(`  ${side}: typecheck ${types.ok ? 'ok' : `errors\n${types.output.slice(0, 1500)}`}`);
    const want = side !== 'bug';
    const stable = results.every((p) => p === want);
    // The bugged app must build too: a compile error would point the agent at the code.
    if (!stable || !types.ok) ok = false;
  }
  if (!ok) failures++;
  log(`  => ${id}: ${ok ? 'PROVEN' : 'NOT PROVEN'}`);
}
log(`\nprove: ${ids.length - failures}/${ids.length} proven`);
process.exitCode = failures === 0 ? 0 : 1;
