// Re-scores the 2026-11-01 and 2026-11-03 results under D-147's void check, from saved data only.
// Runs no agent, app or browser, and edits no result file.
//
//   node bench/agent-suite/rescore-d147.mjs [--json <out.json>]
//
// For each run it re-parses the saved transcript, re-runs the D-108 rule and requires it to give
// the stored `outsidePaths` exactly (so the re-parse matches the run), then applies the D-147 rule.
// Slots: a bug has 3 planned runs (shop) or 5 (tududi). A void run is rerun once (SCORING.md); a
// run past the planned count is the rerun of that bug's earliest void run without one. Under the
// new rule, a slot whose first run is no longer void counts that run, and its rerun is listed as
// extra, not counted.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript, readJsonl } from './lib/agent.mjs';
import { outsidePaths, outsidePathsD108 } from './lib/outside.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results');
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const files = readdirSync(resultsDir)
  .filter((f) => /^2026-11-0[13]-.*\.jsonl$/.test(f))
  .sort();

const OUTSIDE_REASON = /^read outside the trial folder/;
const out = { files: [], mismatches: [], changed: [] };

for (const file of files) {
  const rows = readFileSync(join(resultsDir, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  for (const r of rows) {
    const otherReasons = (r.voidReasons ?? []).filter((x) => !OUTSIDE_REASON.test(x));
    const parsed = parseTranscript(readJsonl(r.transcript));
    const old = outsidePathsD108(parsed.toolCalls, r.trialDir);
    if (r.outsidePaths !== undefined && JSON.stringify(old) !== JSON.stringify(r.outsidePaths)) {
      out.mismatches.push({ file, trial: r.trial, stored: r.outsidePaths, reparsed: old });
    }
    const now = outsidePaths(parsed.toolCalls, r.trialDir);
    r.newVoidReasons = [...otherReasons];
    if (now.hits.length > 0) r.newVoidReasons.push(`read outside the trial folder (${now.hits.length})`);
    r.newVoid = r.newVoidReasons.length > 0;
    r.newHits = now.hits;
    r.newIgnored = now.ignored;
    r.storedHasAudit = r.outsidePaths !== undefined;
    if (r.newVoid !== Boolean(r.void)) {
      out.changed.push({
        file,
        trial: r.trial,
        oldVoid: Boolean(r.void),
        newVoid: r.newVoid,
        oldReasons: r.voidReasons,
        newReasons: r.newVoidReasons,
        ignored: now.ignored,
        checkPassed: r.check?.pass ?? null,
        correct: r.correct,
      });
    }
  }

  const planned = rows.some((r) => r.suite === 'realapp') ? 5 : 3;
  const score = (voidOf) => {
    const slots = [];
    const extra = [];
    const byBug = new Map();
    for (const r of rows) {
      if (!byBug.has(r.bug)) byBug.set(r.bug, []);
      byBug.get(r.bug).push(r);
    }
    for (const [, list] of byBug) {
      list.sort((a, b) => a.run - b.run);
      const firsts = list.filter((r) => r.run <= planned);
      const reruns = list.filter((r) => r.run > planned);
      // Each rerun belongs to the earliest void first run (by the stored void flags) without one.
      const storedVoid = firsts.filter((r) => r.void);
      const rerunOf = new Map();
      reruns.forEach((rr, i) => {
        const of = rr.rerunOf ? firsts.find((f) => f.trial === rr.rerunOf) : storedVoid[i];
        if (of) rerunOf.set(of.trial, rr);
      });
      for (const f of firsts) {
        const rr = rerunOf.get(f.trial);
        if (!voidOf(f)) {
          slots.push({ run: f, counted: f });
          if (rr) extra.push(rr);
        } else if (rr) {
          slots.push({ run: f, counted: voidOf(rr) ? null : rr, voidAgain: voidOf(rr) ? rr : null });
        } else {
          slots.push({ run: f, counted: null });
        }
      }
    }
    const counted = slots.map((s) => s.counted).filter(Boolean);
    const correct = slots.filter((s) => s.counted?.correct).length;
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      slots: slots.length,
      correct,
      voidRuns: rows.filter(voidOf).length,
      notCountedVoid: slots.filter((s) => !s.counted).map((s) => s.run.trial),
      extraRuns: extra.map((r) => r.trial),
      stepsMean: mean(counted.map((r) => r.steps)),
      creditsMean: mean(counted.map((r) => r.credits)),
      tokensEstMean: mean(counted.map((r) => r.tokensEst)),
    };
  };
  out.files.push({
    file,
    rows: rows.length,
    condition: [...new Set(rows.map((r) => r.condition))].join(','),
    suite: rows[0].suite ?? 'shop',
    heldout: rows.some((r) => r.heldout),
    planned,
    noStoredAudit: rows.filter((r) => !r.storedHasAudit).map((r) => r.trial),
    old: score((r) => Boolean(r.void)),
    new: score((r) => r.newVoid),
  });
}

const f2 = (x) => (x === null ? '-' : x.toFixed(2));
const f3 = (x) => (x === null ? '-' : x.toFixed(3));
console.log(
  '| File | Rows | Correct old | Correct new | Void runs old | Void runs new | Steps mean old / new | Credits mean old / new |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const f of out.files) {
  console.log(
    `| ${f.file} | ${f.rows} | ${f.old.correct} of ${f.old.slots} | ${f.new.correct} of ${f.new.slots} | ${f.old.voidRuns} | ${f.new.voidRuns} | ${f2(f.old.stepsMean)} / ${f2(f.new.stepsMean)} | ${f3(f.old.creditsMean)} / ${f3(f.new.creditsMean)} |`,
  );
}
console.log(`\nre-parse mismatches against stored outsidePaths: ${out.mismatches.length}`);
for (const m of out.mismatches) console.log(JSON.stringify(m));
console.log(`runs whose void flag changes: ${out.changed.length}`);
for (const c of out.changed)
  console.log(
    `${c.trial} (${c.file}): void ${c.oldVoid} -> ${c.newVoid}; check passed ${c.checkPassed}; dropped ${c.ignored.map((i) => `${i.path} [${i.reason}]`).join('; ')}`,
  );
for (const f of out.files) {
  if (
    f.old.extraRuns.length ||
    f.new.extraRuns.length ||
    f.old.notCountedVoid.length ||
    f.new.notCountedVoid.length
  )
    console.log(
      `${f.file}: not counted (void again) old [${f.old.notCountedVoid}] new [${f.new.notCountedVoid}]; extra runs old [${f.old.extraRuns}] new [${f.new.extraRuns}]`,
    );
  if (f.noStoredAudit.length) console.log(`${f.file}: no stored audit (rebuilt line): ${f.noStoredAudit}`);
}
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(out, null, 2)}\n`);
