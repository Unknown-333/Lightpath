// README 10-second test on the current README.md: show a fresh, cheap agent the top section (everything
// above the first `##`) and ask what the tool does. Reuses the committed rubric, question and
// top-section rules of bench/readme-test (unchanged), so the scores compare with 2026-11-01.
// Agent: kiro-cli, no tools, a new empty folder and session per run.
//
// Usage: LP_KIRO_CLI=<kiro-cli> node scripts/readme-10s.mjs --runs 5 --out docs/launch/readme-test
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  KIRO_CLI,
  kiroCliVersion,
  parseTranscript,
  readJsonl,
  runAgent,
} from '../bench/agent-suite/lib/agent.mjs';
import { buildPrompt, QUESTION, topSection } from '../bench/readme-test/run.mjs';
import { score } from '../bench/readme-test/score.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL = 'claude-haiku-5.5';
export const EFFORT = 'low';
const MAX_CREDITS_PER_RUN = 0.5;
const ITEM_CAP = 1.5;

const { values } = parseArgs({
  options: { runs: { type: 'string', default: '5' }, out: { type: 'string' } },
});
if (!values.out) throw new Error('--out <folder> is required');
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
const top = topSection(readme);
const prompt = buildPrompt(top);
writeFileSync(join(out, 'shown.md'), `${top}\n`);
const results = join(out, 'results.jsonl');
const version = kiroCliVersion();
let spent = 0;
for (let n = 1; n <= Number(values.runs); n++) {
  if (spent + MAX_CREDITS_PER_RUN > ITEM_CAP) {
    console.log(`stop: ${spent.toFixed(3)} credits used, the next run could pass ${ITEM_CAP}`);
    break;
  }
  const dir = join(tmpdir(), 'lp-readme-10s', `${n}-${Date.now()}`);
  mkdirSync(join(dir, '.kiro', 'agents'), { recursive: true });
  const config = {
    name: 'bench',
    description: 'Reader',
    prompt: null,
    tools: [],
    allowedTools: [],
    mcpServers: {},
    includeMcpJson: false,
    resources: [],
    model: MODEL,
  };
  writeFileSync(join(dir, '.kiro', 'agents', 'bench.json'), `${JSON.stringify(config, null, 2)}\n`);
  const res = await runAgent({
    trialDir: dir,
    prompt,
    outDir: dir,
    model: MODEL,
    effort: EFFORT,
    timeoutMs: 3 * 60_000,
  });
  const parsed = parseTranscript(readJsonl(res.transcript));
  const answer = (parsed.finalText ?? '').trim();
  spent += parsed.credits ?? 0;
  const result = {
    test: 'readme-10s',
    run: n,
    at: new Date().toISOString(),
    question: QUESTION,
    kiroCli: version,
    kiroCliBin: KIRO_CLI,
    model: MODEL,
    effort: EFFORT,
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    wallMs: res.wallMs,
    steps: parsed.steps,
    credits: parsed.credits,
    promptChars: prompt.length,
    answer,
    score: score(answer),
    runDir: dir,
  };
  appendFileSync(results, `${JSON.stringify(result)}\n`);
  console.log(
    `#${n}: ${result.score.pass ? 'PASS' : 'fail'} ${result.score.total}/4, ${parsed.credits} credits: ${answer}`,
  );
  if ((parsed.credits ?? 0) > MAX_CREDITS_PER_RUN) {
    console.log(`stop: one run cost ${parsed.credits} credits, over ${MAX_CREDITS_PER_RUN}`);
    break;
  }
}
console.log(`total credits ${spent.toFixed(3)}`);
