// README 10-second test: show a fresh agent the README's top section and ask what the tool does.
// Usage:
//   node bench/readme-test/run.mjs --write-variants          (writes variants/*.md, no agent)
//   node bench/readme-test/run.mjs --variant current --runs 5
// Rubric and pass line: README.md in this folder and score.mjs. Agent: kiro-cli, no tools.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  EFFORT,
  KIRO_CLI,
  kiroCliVersion,
  MODEL,
  parseTranscript,
  readJsonl,
  runAgent,
} from '../agent-suite/lib/agent.mjs';
import { score } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
/** main at the time of the first runs (merge of PR #16). */
export const README_COMMIT = 'e70966ccce726414dac2db04df5d3417d415196b';
export const QUESTION =
  'You saw this for 10 seconds. In one sentence: what does this tool do, and who is it for?';
export const MAX_CREDITS_PER_RUN = 2;
export const ITEM_CAP = 5;

const CURRENT_PITCH =
  '**Click anything in your running app and see the exact code it ran, frontend and backend, line by line.**';
/** Alternative pitch lines from docs/research/growth-study.md ("Pitch line candidates"). */
export const VARIANTS = {
  current: null,
  A: '**Show your coding agent the code that actually ran.**',
  B: '**Your agent clicks a button and sees every line it ran, frontend and backend.**',
};

/**
 * Everything above the first `##` heading. Linked badge images become `[Badge: <alt>]` and the GIF
 * becomes its alt text, since the agent can't see images.
 */
export function topSection(readme) {
  const lines = readme.replace(/\r\n/g, '\n').split('\n');
  const end = lines.findIndex((line) => /^##\s/.test(line));
  const top = (end < 0 ? lines : lines.slice(0, end)).join('\n').trim();
  return top
    .replace(/\[!\[([^\]]*)\]\([^)]*\)\]\([^)]*\)/g, (_, alt) => `[Badge: ${alt}]`)
    .replace(/!\[([^\]]*)\]\([^)]*\.gif\)/g, (_, alt) => `[Animated GIF. Alt text: ${alt}]`);
}

export function variantText(id) {
  const readme = execFileSync('git', ['show', `${README_COMMIT}:README.md`], { cwd: REPO, encoding: 'utf8' });
  const top = topSection(readme);
  if (!top.includes(CURRENT_PITCH)) throw new Error('pitch line not found in the README top section');
  const pitch = VARIANTS[id];
  if (pitch === undefined) throw new Error(`unknown variant ${id}`);
  return pitch === null ? top : top.replace(CURRENT_PITCH, pitch);
}

export function buildPrompt(text) {
  return `${text}\n\n---\n\n${QUESTION}\n`;
}

function creditsSoFar(files) {
  let total = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      total += JSON.parse(line).credits ?? 0;
    }
  }
  return total;
}

async function main() {
  const { values } = parseArgs({
    options: {
      variant: { type: 'string' },
      runs: { type: 'string', default: '5' },
      results: { type: 'string', default: join(HERE, 'results', 'results.jsonl') },
      'other-results': { type: 'string', multiple: true, default: [] },
      'write-variants': { type: 'boolean', default: false },
    },
  });
  if (values['write-variants']) {
    mkdirSync(join(HERE, 'variants'), { recursive: true });
    for (const id of Object.keys(VARIANTS)) {
      writeFileSync(join(HERE, 'variants', `${id}.md`), `${variantText(id)}\n`);
    }
    console.log('wrote variants/*.md');
    return;
  }
  const id = values.variant;
  const text = variantText(id);
  const prompt = buildPrompt(text);
  const runs = Number(values.runs);
  const version = kiroCliVersion();
  mkdirSync(dirname(values.results), { recursive: true });
  const root = join(tmpdir(), 'lp-readme-test');
  for (let n = 1; n <= runs; n++) {
    const spent = creditsSoFar([values.results, ...values['other-results']]);
    if (spent + 0.3 > ITEM_CAP) {
      console.log(`stop: ${spent.toFixed(3)} credits used, the next run could pass the ${ITEM_CAP} cap`);
      process.exitCode = 2;
      return;
    }
    // A fresh, empty folder and a new session for every run.
    const dir = join(root, `${id}-${n}-${Date.now()}`);
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
    writeFileSync(join(dir, 'prompt.txt'), prompt);
    const res = await runAgent({ trialDir: dir, prompt, outDir: dir, timeoutMs: 3 * 60_000 });
    const parsed = parseTranscript(readJsonl(res.transcript));
    const answer = (parsed.finalText ?? '').trim();
    const result = {
      test: 'readme-10s',
      variant: id,
      run: n,
      at: new Date().toISOString(),
      readmeCommit: README_COMMIT,
      kiroCli: version,
      kiroCliBin: KIRO_CLI,
      model: MODEL,
      effort: EFFORT,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      wallMs: res.wallMs,
      steps: parsed.steps,
      credits: parsed.credits,
      contextPctMax: parsed.contextPctMax,
      promptChars: prompt.length,
      answerChars: answer.length,
      answer,
      score: score(answer),
      runDir: dir,
    };
    appendFileSync(values.results, `${JSON.stringify(result)}\n`);
    console.log(
      `${id} #${n}: ${result.score.pass ? 'PASS' : 'fail'} ${result.score.total}/4, ${parsed.credits} credits: ${answer}`,
    );
    if ((parsed.credits ?? 0) > MAX_CREDITS_PER_RUN) {
      console.log(`stop: one run cost ${parsed.credits} credits, over ${MAX_CREDITS_PER_RUN}`);
      process.exitCode = 2;
      return;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
