// Runs ONE trial of the seeded-bug suite: (bug, condition, run number). See README.md and SCORING.md.
//
//   node bench/agent-suite/run.mjs --bug b01 --condition without --run 1
//        [--bugs-dir <dir>] [--results <file>] [--fresh] [--dry-run]
//
// --dry-run builds the trial folder and the agent config, checks them, and stops before kiro-cli.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  AGENT_TIMEOUT_MS,
  agentConfig,
  auditShellCommands,
  buildPrompt,
  CONDITIONS,
  EFFORT,
  KIRO_CLI,
  kiroCliVersion,
  MODEL,
  parseTranscript,
  readJsonl,
  runAgent,
  writeAgentFiles,
} from './lib/agent.mjs';
import { runCheck } from './lib/check.mjs';
import {
  BUGS_DIR,
  cpuLoad,
  parseArgs,
  REPO_DIR,
  run,
  SHOP_PORTS,
  sha256File,
  sleep,
  TRIALS_ROOT,
} from './lib/common.mjs';
import { prepareLightpath } from './lib/lightpath.mjs';
import { assertPortsFree, cleanupTrial } from './lib/shop.mjs';
import { createTrial, prepareTemplate, typecheck } from './lib/trial.mjs';

const args = parseArgs(process.argv.slice(2));
const bug = String(args.bug ?? '');
const condition = String(args.condition ?? '');
const runNo = Number(args.run);
if (!bug || !CONDITIONS.includes(condition) || !Number.isInteger(runNo) || runNo < 1) {
  console.error('usage: run.mjs --bug <id> --condition without|with|browser --run <n> [--dry-run]');
  process.exit(2);
}
const bugsDir = resolve(args['bugs-dir'] ?? BUGS_DIR);
const bugDir = join(bugsDir, bug);
if (!existsSync(join(bugDir, 'bug.patch'))) throw new Error(`no bug ${bug} in ${bugsDir}`);
const resultsFile = resolve(args.results ?? join(TRIALS_ROOT, 'results.jsonl'));
const trialId = `${bug}-${condition}-${runNo}`;
const outDir = join(TRIALS_ROOT, '_runs', trialId);
const log = (line) => console.log(`[${trialId}] ${line}`);

/** CPU load before a timed run (owner's rule): over 20%, wait 60 s and read again. */
async function loadBeforeRun() {
  const first = cpuLoad();
  if (first === null || first <= 20) return { first, second: null, busy: false };
  log(`CPU load ${first}% > 20%, waiting 60 s`);
  await sleep(60_000);
  const second = cpuLoad();
  return { first, second, busy: second !== null && second > 20 };
}

/** kiro-cli turns deniedCommands into globs; a regex it can't convert becomes `*` (block all). */
function checkDenyConversion(config) {
  const dir = join(outDir, 'deny-conversion');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bench.json'), JSON.stringify(config, null, 2));
  run(KIRO_CLI, ['agent', 'upgrade', '--no-backup', dir], { check: true });
  const upgraded = JSON.parse(readFileSync(join(dir, 'bench.json'), 'utf8'));
  const globs =
    upgraded.permissions?.rules?.find((r) => r.capability === 'shell' && r.effect === 'deny')?.match ?? [];
  if (globs.length === 0 || globs.includes('*')) {
    throw new Error(
      `deny rules did not convert cleanly (${globs.length} globs, '*' present: ${globs.includes('*')})`,
    );
  }
  return globs.length;
}

/** Hashes of every file in the bug folder, to prove the check wasn't touched. */
function hashBugDir() {
  return Object.fromEntries(
    readdirSync(bugDir)
      .sort()
      .map((f) => [f, sha256File(join(bugDir, f))]),
  );
}

const PATH_KEYS = /path|file|dir|cwd|target|source|pattern|glob/i;
/**
 * Paths a tool call names that resolve outside the trial folder. Looks at ACP `locations`,
 * path-like input fields, and absolute paths or `..` escapes inside shell commands.
 * Conservative: a human can review every hit in `outsidePaths`.
 */
function outsidePaths(toolCalls, trialDir) {
  const root = trialDir.toLowerCase();
  const isOutside = (p, base) => {
    const full = resolve(base, p).toLowerCase();
    return full !== root && !full.startsWith(`${root}\\`) && !full.startsWith(`${root}/`);
  };
  const hits = [];
  for (const call of toolCalls) {
    const base = typeof call.input?.cwd === 'string' ? call.input.cwd : trialDir;
    const candidates = [];
    for (const loc of call.locations ?? []) if (loc?.path) candidates.push(loc.path);
    for (const [key, value] of Object.entries(call.input ?? {})) {
      if (key === 'command' || typeof value !== 'string' || !PATH_KEYS.test(key)) continue;
      if (/^[a-z]:[\\/]|^[\\/]|\.\.[\\/]|^\.\.$/i.test(value)) candidates.push(value);
    }
    if (typeof call.input?.command === 'string') {
      const cmd = call.input.command;
      // A drive path, not the "p://" inside "http://".
      candidates.push(...(cmd.match(/(?<![a-z])[a-z]:[\\/][^\s"'`;|,)]*/gi) ?? []));
      candidates.push(
        ...(cmd.match(/(?:^|[\s"'])(\.\.(?:[\\/][^\s"'`;|,)]*)?)/g) ?? []).map((m) =>
          m.trim().replace(/^["']/, ''),
        ),
      );
    }
    for (const p of candidates) {
      if (isAbsolute(p) || p.startsWith('..')) {
        if (isOutside(p, base)) hits.push({ tool: call.title ?? call.kind, path: p });
      }
    }
  }
  return hits;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const started = new Date();
  const record = {
    trial: trialId,
    bug,
    condition,
    run: runNo,
    heldout: bugsDir !== BUGS_DIR,
    suiteCommit: run('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR }).stdout.trim(),
    model: MODEL,
    effort: EFFORT,
    kiroCli: kiroCliVersion(),
    timeoutMs: AGENT_TIMEOUT_MS,
    startedAt: started.toISOString(),
    host: { node: process.version, platform: process.platform },
  };

  assertPortsFree();
  const template = prepareTemplate(log);
  const trialDir = createTrial({ id: trialId, bugDir, template, fresh: Boolean(args.fresh) });
  record.trialDir = trialDir;
  let lightpath = null;
  if (condition === 'with') {
    lightpath = prepareLightpath(log);
    record.lightpath = { commit: lightpath.commit, dirty: lightpath.dirty, version: lightpath.version };
  }
  const config = writeAgentFiles(trialDir, condition, { lightpathBin: lightpath?.bin });
  record.denyGlobs = checkDenyConversion(agentConfig(condition, { lightpathBin: lightpath?.bin }));
  record.agentConfig = config;
  const prompt = buildPrompt(readFileSync(join(bugDir, 'report.md'), 'utf8'));
  writeFileSync(join(outDir, 'prompt.txt'), prompt);
  const hashesBefore = hashBugDir();

  if (args['dry-run']) {
    log(`dry run: trial ${trialDir}, ${record.denyGlobs} deny globs, prompt ${outDir}\\prompt.txt`);
    writeFileSync(join(outDir, 'dry-run.json'), `${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  const load = await loadBeforeRun();
  record.cpuLoadStart = load;
  const agentStartIso = new Date().toISOString();
  log(`agent start (${MODEL}, effort ${EFFORT}, limit ${AGENT_TIMEOUT_MS / 60000} min)`);
  const agent = await runAgent({ trialDir, prompt, outDir });
  log(
    `agent stopped: exit ${agent.exitCode}${agent.timedOut ? ' (timed out)' : ''} after ${agent.wallMs} ms`,
  );
  record.cpuLoadEnd = cpuLoad();
  record.cleanup = cleanupTrial(trialDir, agentStartIso);
  record.wallMs = agent.wallMs;
  record.exitCode = agent.exitCode;
  record.timedOut = agent.timedOut;
  record.transcript = agent.transcript;

  const events = readJsonl(agent.transcript);
  const parsed = parseTranscript(events);
  record.engine = events.find((e) => e.type === 'runStarted')?.data?.engine ?? null;
  record.steps = parsed.steps;
  record.usedTools = parsed.usedTools;
  record.tokensIn = null;
  record.tokensOut = null;
  record.tokensNote = 'kiro-cli 2.37 stream-json reports credits, not tokens';
  record.credits = parsed.credits;
  record.contextPctMax = parsed.contextPctMax;
  record.agentStatus = parsed.status;
  record.stopReason = parsed.stopReason;
  record.blockedCalls = parsed.toolCalls.filter((c) => c.blocked).length;
  record.shellFlags = auditShellCommands(parsed.toolCalls, trialDir);
  record.outsidePaths = outsidePaths(parsed.toolCalls, trialDir);
  writeFileSync(join(outDir, 'tool-calls.json'), `${JSON.stringify(parsed.toolCalls, null, 2)}\n`);
  writeFileSync(join(outDir, 'final-text.md'), `${parsed.finalText ?? ''}\n`);

  // Score: the hidden check passes, the shop typechecks, and the check files are unchanged.
  const check = await runCheck({ bugDir, trialDir, logFile: join(outDir, 'check-shop.log') });
  const types = typecheck(trialDir);
  const hashesAfter = hashBugDir();
  record.check = { pass: check.pass, detail: check.detail, ms: check.ms };
  record.typecheck = { ok: types.ok, output: types.ok ? '' : types.output.slice(0, 2000) };
  record.checkUntouched = JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter);
  record.correct = check.pass && types.ok && record.checkUntouched;
  // Diff against the single initial commit, so agent commits and new files are included.
  const root = run('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: trialDir })
    .stdout.trim()
    .split('\n')[0];
  run('git', ['add', '-A', '-N'], { cwd: trialDir });
  record.diff = run('git', ['diff', '--stat', root], { cwd: trialDir }).stdout.trim();
  writeFileSync(join(outDir, 'agent.diff'), run('git', ['diff', root], { cwd: trialDir }).stdout);

  const voidReasons = [];
  const harnessFailed =
    agent.error || (!agent.timedOut && (agent.exitCode !== 0 || record.agentStatus === null));
  if (harnessFailed)
    voidReasons.push(`harness: kiro-cli exit ${agent.exitCode}${agent.error ? ` ${agent.error}` : ''}`);
  if (record.cleanup.leftAlone.length > 0)
    voidReasons.push('harness: a process the harness did not start held a shop port');
  if (agent.timedOut) voidReasons.push('timeout');
  if (record.outsidePaths.length > 0)
    voidReasons.push(`read outside the trial folder (${record.outsidePaths.length})`);
  record.void = voidReasons.length > 0;
  record.voidReasons = voidReasons;
  record.finishedAt = new Date().toISOString();

  mkdirSync(resolve(resultsFile, '..'), { recursive: true });
  await appendFile(resultsFile, `${JSON.stringify(record)}\n`);
  writeFileSync(join(outDir, 'result.json'), `${JSON.stringify(record, null, 2)}\n`);
  copyFileSync(join(bugDir, 'report.md'), join(outDir, 'report.md'));
  log(
    `correct=${record.correct} void=${record.void} steps=${record.steps} credits=${record.credits?.toFixed(3)} ` +
      `wall=${(record.wallMs / 1000).toFixed(0)} s -> ${resultsFile}`,
  );
  log(
    `ports after cleanup: ${SHOP_PORTS.join(', ')}; result ${relative(TRIALS_ROOT, join(outDir, 'result.json'))}`,
  );
}

await main();
