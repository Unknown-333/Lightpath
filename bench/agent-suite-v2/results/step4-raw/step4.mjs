// Suite v2 Step 4 driver (STEP4-RULE.md, pushed at 34b5d98 before any run). 12 bugs x 3 without
// x 3 with, --max-steps 12, interleaved per bug. Resumable: a trial with a scored (non-void) line,
// or two lines, is skipped; a void trial is rerun once. Stops before the next run if the total plus
// 3 would pass 120 credits, or a run cost over 3 credits.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:/Users/user/lightpath-trials/goal/step4';
const trialsRoot = 'C:/Users/user/lightpath-trials/goal/step4-trials';
const visible = `${repo}/bench/agent-suite-v2/results/2026-11-05-step4.jsonl`;
const heldDir = 'C:/Users/user/lightpath-trials/goal/suite2-heldout/bugs';
const heldResults = 'C:/Users/user/lightpath-trials/goal/suite2-heldout/step4-heldout.jsonl';
const progress = 'C:/Users/user/lightpath-trials/goal/step4-raw/step4.progress';
const RATE = 1.381e-4; // credits per estimated token, from the difficulty check's reported runs
const bugs = [
  ...['v01', 'v02', 'v03', 'v04', 'v05', 'v06', 'v07', 'v08', 'v09'].map((id) => [id, false]),
  ...['h01', 'h02', 'h03'].map((id) => [id, true]),
];
const env = {
  ...process.env,
  LP_TRIALS_ROOT: trialsRoot,
  LP_ACTUAL_SRC: 'C:/Users/user/lightpath-trials/goal/suite2-actual-src',
  LP_TUDUDI_SRC: 'C:/Users/user/lightpath-trials/goal/suite2-tududi-src',
  LP_KIRO_CLI: 'C:/Users/user/lightpath-trials/tools/kiro-cli-2.37.0/LocalApp/Kiro-Cli/kiro-cli.exe',
  PATH: `${process.env.LOCALAPPDATA}\\corepack-shims;${process.env.PATH}`,
};
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const all = () => [...read(visible), ...read(heldResults)];
const cost = (r) => r.credits ?? (r.tokensEst ?? 0) * RATE;
const say = (s) => {
  console.log(s);
  appendFileSync(progress, `${new Date().toISOString()} ${s}\n`);
};

for (const [bug, held] of bugs) {
  for (const runNo of [1, 2, 3]) {
    for (const condition of ['without', 'with']) {
      const id = `${bug}-${condition}-${runNo}`;
      for (;;) {
        const lines = all().filter((r) => r.trial === id);
        if (lines.length >= 2 || (lines.length === 1 && !lines[0].void)) break;
        const done = all();
        const total = done.reduce((s, r) => s + cost(r), 0);
        const worst = Math.max(0, ...done.map(cost));
        if (worst > 3 || total + 3 > 120) {
          say(`STOP before ${id}: total ${total.toFixed(3)}, worst run ${worst.toFixed(3)}`);
          process.exit(3);
        }
        const args = ['bench/agent-suite/run.mjs', '--suite', 'v2', '--bug', bug, '--condition', condition,
          '--run', String(runNo), '--max-steps', '12', '--fresh', '--results', held ? heldResults : visible];
        if (held) args.push('--bugs-dir', heldDir);
        if (lines.length === 1) args.push('--label', 'void-rerun');
        const r = spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8', timeout: 2_400_000 });
        const tail = `${r.stdout}${r.stderr}`.trim().split('\n').filter((l) => /correct=|Error|error/.test(l)).slice(-1)[0] ?? '';
        const after = all().filter((x) => x.trial === id);
        if (after.length === lines.length) {
          // run.mjs threw before writing a line: a harness failure. Record it as a void line.
          const line = { trial: id, bug, condition, run: runNo, suite: 'v2', heldout: held, void: true,
            voidReasons: [`harness: run.mjs exit ${r.status}: ${tail.slice(0, 300)}`], correct: false, credits: 0,
            finishedAt: new Date().toISOString(), ...(lines.length === 1 ? { label: 'void-rerun' } : {}) };
          appendFileSync(held ? heldResults : visible, `${JSON.stringify(line)}\n`);
        }
        const last = all().filter((x) => x.trial === id).at(-1);
        const sum = all().reduce((s, x) => s + cost(x), 0);
        say(`${id}: correct=${last.correct} void=${last.void} steps=${last.steps} cost=${cost(last).toFixed(3)} total=${sum.toFixed(2)}`);
        const dir = join(trialsRoot, id);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}
say(`ALL DONE: runs ${all().length}, total ${all().reduce((s, r) => s + cost(r), 0).toFixed(2)}`);
