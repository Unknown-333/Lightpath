// Recomputes the D-111 token estimate for saved runs from their transcripts.
//
//   node bench/agent-suite/tokens.mjs --results <file.jsonl> [--write]
//
// Prints one line per run and a per-bug summary. With --write, adds ONLY the token fields
// (tokensEst, tokensEstIn, tokensEstOut, tokensMethod) to each line, in place; nothing else changes.
// The prompt is read from prompt.txt next to the transcript, else rebuilt from the bug's report.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildPrompt, estimateTokens, readJsonl } from './lib/agent.mjs';
import { BUGS_DIR, parseArgs } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.results !== 'string') {
  console.error('usage: tokens.mjs --results <file.jsonl> [--write] [--transcripts-root <dir>]');
  process.exit(2);
}
const file = resolve(args.results);
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const out = [];
const perBug = new Map();
for (const line of lines) {
  const rec = JSON.parse(line);
  if (!existsSync(rec.transcript)) throw new Error(`${rec.trial}: transcript missing at ${rec.transcript}`);
  const promptFile = join(dirname(rec.transcript), 'prompt.txt');
  const prompt = existsSync(promptFile)
    ? readFileSync(promptFile, 'utf8')
    : buildPrompt(readFileSync(join(BUGS_DIR, rec.bug, 'report.md'), 'utf8'));
  const est = estimateTokens(readJsonl(rec.transcript), prompt);
  console.log(
    `${rec.trial}\tsteps=${rec.steps}\tcredits=${rec.credits?.toFixed(3)}\ttokensEst=${est.tokensEst}\tin=${est.tokensEstIn}\tout=${est.tokensEstOut}`,
  );
  if (!perBug.has(rec.bug)) perBug.set(rec.bug, []);
  perBug.get(rec.bug).push(est.tokensEst);
  out.push(JSON.stringify({ ...rec, ...est }));
}
const all = [];
for (const [bug, values] of perBug) {
  all.push(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`${bug}\tmean=${Math.round(mean)}\tmin=${Math.min(...values)}\tmax=${Math.max(...values)}`);
}
const mean = all.reduce((a, b) => a + b, 0) / all.length;
const sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, all.length - 1));
console.log(
  `all\tn=${all.length}\ttotal=${all.reduce((a, b) => a + b, 0)}\tmean=${Math.round(mean)}\tmin=${Math.min(...all)}\tmax=${Math.max(...all)}\tsd=${Math.round(sd)}`,
);
if (args.write) {
  writeFileSync(file, `${out.join('\n')}\n`);
  console.log(`wrote ${out.length} lines to ${file}`);
}
