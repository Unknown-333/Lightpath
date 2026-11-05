// Scores Step 4 exactly by STEP4-RULE.md. Prints a markdown per-bug table and the headline.
// Steps per run: the recorded tool calls, with a run stopped at the cap counted as 12 (the cap).
// Sensitivity (reported, not used for the verdict): mean steps over correct runs only.
import { existsSync, readFileSync } from 'node:fs';

const files = [
  'C:/Users/user/lightpath-trials/goal/step4/bench/agent-suite-v2/results/2026-11-05-step4.jsonl',
  'C:/Users/user/lightpath-trials/goal/suite2-heldout/step4-heldout.jsonl',
];
const RATE = 1.381e-4;
const rows = files.flatMap((f) =>
  existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [],
);
const last = new Map();
for (const r of rows) last.set(r.trial, r); // the last line of a trial is the scored one
const runs = [...last.values()];
const cost = (r) => r.credits ?? (r.tokensEst ?? 0) * RATE;
const steps = (r) => (r.stepCapped ? 12 : Math.min(r.steps ?? 12, 12));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const f1 = (x) => (Number.isNaN(x) ? '-' : x.toFixed(1));
const bugs = ['v01', 'v02', 'v03', 'v04', 'v05', 'v06', 'v07', 'v08', 'v09', 'h01', 'h02', 'h03'];
const out = [];
out.push(
  '| Bug | Without fixed | With fixed | Without steps (mean, min-max, sd) | With steps (mean, min-max, sd) | Verdict | Without credits | With credits | Without tokens est. | With tokens est. | With runs that called Lightpath |',
);
out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
let wins = 0,
  losses = 0,
  alt = { wins: 0, losses: 0 };
const verdicts = {};
const tools = {};
for (const bug of bugs) {
  const per = {};
  for (const c of ['without', 'with']) {
    const rs = runs.filter((r) => r.bug === bug && r.condition === c);
    const ok = rs.filter((r) => r.correct && !r.void);
    const st = rs.map(steps);
    per[c] = {
      n: rs.length,
      ok: ok.length,
      solved: ok.length >= 2,
      st,
      mean: mean(st),
      okMean: mean(ok.map(steps)),
      credits: rs.reduce((s, r) => s + cost(r), 0),
      tokens: rs.reduce((s, r) => s + (r.tokensEst ?? 0), 0),
      rs,
    };
  }
  const W = per.with,
    O = per.without;
  const verdict = (useOk) => {
    const wm = useOk ? W.okMean : W.mean,
      om = useOk ? O.okMean : O.mean;
    if (W.solved && !O.solved) return 'win';
    if (O.solved && !W.solved) return 'loss';
    if (W.solved && O.solved && om - wm >= 2) return 'win';
    if (W.solved && O.solved && wm - om >= 2) return 'loss';
    return 'no difference';
  };
  const v = verdict(false),
    va = verdict(true);
  verdicts[bug] = { v, va };
  const inHeadline = bug !== 'v05' && bug !== 'v09';
  if (inHeadline) {
    if (v === 'win') wins++;
    if (v === 'loss') losses++;
    if (va === 'win') alt.wins++;
    if (va === 'loss') alt.losses++;
  }
  const called = W.rs.filter((r) => Object.keys(r.lightpathCalls ?? {}).length > 0).length;
  for (const r of W.rs)
    for (const [t, k] of Object.entries(r.lightpathCalls ?? {})) tools[t] = (tools[t] ?? 0) + k;
  const s = (p) => `${f1(p.mean)} (${Math.min(...p.st)}-${Math.max(...p.st)}, ${f1(sd(p.st))})`;
  out.push(
    `| ${bug}${bug === 'v05' ? ' (out of headline)' : bug === 'v09' ? ' (control)' : ''} | ${O.ok}/${O.n} | ${W.ok}/${W.n} | ${s(O)} | ${s(W)} | ${v}${va !== v ? ` (correct-runs mean: ${va})` : ''} | ${O.credits.toFixed(2)} | ${W.credits.toFixed(2)} | ${O.tokens} | ${W.tokens} | ${called}/${W.n} |`,
  );
}
const tot = (c) => runs.filter((r) => r.condition === c).reduce((s, r) => s + cost(r), 0);
const totTok = (c) => runs.filter((r) => r.condition === c).reduce((s, r) => s + (r.tokensEst ?? 0), 0);
const reported = rows.reduce((s, r) => s + (r.credits ?? 0), 0);
const estimated = rows.filter((r) => r.credits == null).reduce((s, r) => s + (r.tokensEst ?? 0) * RATE, 0);
out.push('');
out.push(
  `HEADLINE (10 bugs, not v05 or v09): wins ${wins}, losses ${losses}, wins minus losses ${wins - losses}. Control v09: ${verdicts.v09?.v}.`,
);
out.push(`Sensitivity, mean steps over correct runs only: wins ${alt.wins}, losses ${alt.losses}.`);
out.push(
  `Runs scored ${runs.length}, lines ${rows.length}, void lines ${rows.filter((r) => r.void).length}, capped ${runs.filter((r) => r.stepCapped).length}.`,
);
out.push(
  `Credits: without ${tot('without').toFixed(2)}, with ${tot('with').toFixed(2)}, all lines ${(reported + estimated).toFixed(2)} (${reported.toFixed(2)} reported, ${estimated.toFixed(2)} estimated). Tokens est.: without ${totTok('without')}, with ${totTok('with')}.`,
);
out.push(`Lightpath tool calls in with runs: ${JSON.stringify(tools)}.`);
console.log(out.join('\n'));
