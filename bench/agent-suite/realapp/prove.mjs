// Proves each real-app bug: its hidden check FAILS on the bugged app, PASSES after fix.patch,
// and the app still typechecks (tsc --noEmit) after fix.patch.
//
//   node bench/agent-suite/realapp/prove.mjs [--bugs-dir <dir>] [--only r01,r02] [--out <file>]
import { appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, TRIALS_ROOT } from '../lib/common.mjs';
import {
  APP,
  applyPatch,
  assertPortsFree,
  BUGS_DIR,
  createTrial,
  prepareTemplate,
  runCheck,
  typecheck,
} from './lib/app.mjs';

const args = parseArgs(process.argv.slice(2));
const bugsDir = resolve(args['bugs-dir'] ?? BUGS_DIR);
const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const out = args.out ? resolve(args.out) : null;
function log(line) {
  console.log(line);
  if (out) appendFileSync(out, `${line}\n`);
}

assertPortsFree();
const template = prepareTemplate(log);
log(
  `prove: ${new Date().toISOString()} app=${APP.name}@${APP.commit} bugs=${bugsDir} trials=${TRIALS_ROOT} node=${process.version}`,
);
const ids = readdirSync(bugsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (!only || only.has(d.name)))
  .map((d) => d.name)
  .sort();
let failures = 0;
const logDir = join(TRIALS_ROOT, '_logs');
mkdirSync(logDir, { recursive: true });
for (const id of ids) {
  const bugDir = join(bugsDir, id);
  const trialId = `prove-${id}`;
  const trialDir = createTrial({ id: trialId, bugDir, template, fresh: true });
  const bugged = await runCheck({ bugDir, trialDir, logFile: join(logDir, `${trialId}-bugged.log`) });
  const buggedTypes = typecheck(trialDir);
  applyPatch(trialDir, join(bugDir, 'fix.patch'));
  const fixed = await runCheck({ bugDir, trialDir, logFile: join(logDir, `${trialId}-fixed.log`) });
  const fixedTypes = typecheck(trialDir);
  const ok = !bugged.pass && fixed.pass && fixedTypes.ok;
  if (!ok) failures++;
  log(`\n== ${id}: ${ok ? 'PROVEN' : 'NOT PROVEN'}`);
  log(`  bugged app:  check ${bugged.pass ? 'PASS' : 'FAIL'} (${bugged.ms} ms) - ${bugged.detail}`);
  log(
    `  bugged app:  tsc --noEmit ${buggedTypes.ok ? 'ok' : `errors\n${buggedTypes.output.slice(0, 2000)}`}`,
  );
  log(`  after fix:   check ${fixed.pass ? 'PASS' : 'FAIL'} (${fixed.ms} ms) - ${fixed.detail}`);
  log(`  after fix:   tsc --noEmit ${fixedTypes.ok ? 'ok' : `errors\n${fixedTypes.output.slice(0, 2000)}`}`);
}
log(`\nprove: ${ids.length - failures}/${ids.length} proven`);
process.exitCode = failures === 0 ? 0 : 1;
