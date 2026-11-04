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
import { join, relative, resolve } from 'node:path';
import * as v2apps from '../agent-suite-v2/lib/apps.mjs';
import {
  AGENT_TIMEOUT_MS,
  agentConfig,
  auditShellCommands,
  buildPrompt,
  CONDITIONS,
  EFFORT,
  estimateTokens,
  excludeKiroDir,
  KIRO_CLI,
  kiroCliVersion,
  MODEL,
  parseTranscript,
  readJsonl,
  runAgent,
  writeAgentFiles,
} from './lib/agent.mjs';
import * as shopCheck from './lib/check.mjs';
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
import { initTrial, prepareLightpath, probeTools, startLightpathDev } from './lib/lightpath.mjs';
import { outsidePaths } from './lib/outside.mjs';
import * as shopApp from './lib/shop.mjs';
import * as shopTrial from './lib/trial.mjs';
import * as realapp from './realapp/lib/app.mjs';

const args = parseArgs(process.argv.slice(2));
const bug = String(args.bug ?? '');
const condition = String(args.condition ?? '');
const runNo = Number(args.run);
const suite = String(args.suite ?? 'shop');
if (
  !bug ||
  !CONDITIONS.includes(condition) ||
  !Number.isInteger(runNo) ||
  runNo < 1 ||
  !['shop', 'realapp', 'v2'].includes(suite)
) {
  console.error(
    'usage: run.mjs --bug <id> --condition without|with|browser --run <n> [--suite shop|realapp|v2] [--dry-run]',
  );
  process.exit(2);
}
// The shop suite (D-108) and the real-app suite (D-110) share everything but the app.
const SUITES = {
  shop: {
    bugsDir: BUGS_DIR,
    ports: SHOP_PORTS,
    assertPortsFree: shopApp.assertPortsFree,
    cleanupTrial: shopApp.cleanupTrial,
    createTrial: shopTrial.createTrial,
    prepareTemplate: shopTrial.prepareTemplate,
    typecheck: shopTrial.typecheck,
    runCheck: shopCheck.runCheck,
    agentDiff: null,
    // "with" (D-130): keys written before `lightpath init`; init adds `command` from the dev script.
    lightpathConfig: { headless: true },
    afterInit: (dir) => shopTrial.foldIntoInitialCommit(dir),
  },
  realapp: {
    bugsDir: realapp.BUGS_DIR,
    ports: realapp.PORTS,
    assertPortsFree: realapp.assertPortsFree,
    cleanupTrial: realapp.cleanupTrial,
    createTrial: realapp.createTrial,
    prepareTemplate: realapp.prepareTemplate,
    typecheck: realapp.typecheck,
    runCheck: realapp.runCheck,
    agentDiff: realapp.agentDiff,
    // tududi has no `dev` script and its start scripts need bash, so the command and URL are set.
    lightpathConfig: { command: 'node dev.mjs', url: realapp.WEB_URL, headless: true },
    afterInit: (dir) => realapp.refreshPristine(dir),
  },
};
if (suite === 'v2') {
  // Suite v2 (bench/agent-suite-v2): each bug's bug.json names its app, tududi or invoices.
  const v2BugsDir = resolve(args['bugs-dir'] ?? v2apps.BUGS_DIR);
  const app = v2apps.appFor(JSON.parse(readFileSync(join(v2BugsDir, bug, 'bug.json'), 'utf8')).app);
  SUITES.v2 = {
    bugsDir: v2apps.BUGS_DIR,
    ports: app.PORTS,
    app: app.APP,
    assertPortsFree: app.assertPortsFree,
    cleanupTrial: app.cleanupTrial,
    createTrial: app.createTrial,
    prepareTemplate: app.prepareTemplate,
    typecheck: app.typecheck,
    runCheck: app.runCheck,
    agentDiff: app.agentDiff,
    lightpathConfig: { command: 'node dev.mjs', url: app.WEB_URL, headless: true },
    afterInit: (dir) => app.refreshPristine(dir),
  };
}
const S = SUITES[suite];
const { assertPortsFree, cleanupTrial, createTrial, prepareTemplate, typecheck, runCheck } = S;
const bugsDir = resolve(args['bugs-dir'] ?? S.bugsDir);
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

async function main() {
  mkdirSync(outDir, { recursive: true });
  const started = new Date();
  const record = {
    trial: trialId,
    bug,
    condition,
    run: runNo,
    suite,
    ...(suite === 'realapp' ? { app: realapp.APP } : {}),
    ...(suite === 'v2' ? { app: S.app } : {}),
    heldout: bugsDir !== S.bugsDir,
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
  if (args.label) record.label = String(args.label);
  let lightpath = null;
  let lightpathServer;
  if (condition === 'with') {
    // D-130: set up the way a Kiro user does, from the packed branch under test.
    lightpath = prepareLightpath(log);
    const setup = initTrial(trialDir, lightpath, S.lightpathConfig, join(outDir, 'lightpath-init.log'));
    excludeKiroDir(trialDir);
    const folded = S.afterInit(trialDir);
    lightpathServer = setup.serverEntry;
    record.lightpath = {
      commit: lightpath.commit,
      dirty: lightpath.dirty,
      version: lightpath.version,
      initEntry: setup.initEntry,
      serverEntry: setup.serverEntry,
      configWritten: setup.configWritten,
      initOutput: setup.initOutput,
      ...(typeof folded === 'string' ? { initialCommit: folded } : {}),
    };
  }
  const config = writeAgentFiles(trialDir, condition, { lightpathServer });
  record.denyGlobs = checkDenyConversion(agentConfig(condition, { lightpathServer }));
  record.agentConfig = config;
  const prompt = buildPrompt(readFileSync(join(bugDir, 'report.md'), 'utf8'));
  writeFileSync(join(outDir, 'prompt.txt'), prompt);
  const hashesBefore = hashBugDir();

  if (lightpathServer) {
    // The tools the agent gets on top of the built-in ones, read from the server itself (no model call).
    record.lightpathTools = await probeTools(lightpathServer, trialDir);
    log(`lightpath tools: ${record.lightpathTools.tools.join(', ')}`);
  }
  if (args['dry-run']) {
    log(`dry run: trial ${trialDir}, ${record.denyGlobs} deny globs, prompt ${outDir}\\prompt.txt`);
    writeFileSync(join(outDir, 'dry-run.json'), `${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  let devServer = null;
  if (lightpath) {
    // D-130: the app runs under `lightpath dev` before the agent starts, so run_action can act on it.
    devServer = await startLightpathDev(trialDir, lightpath, join(outDir, 'lightpath-dev.log'));
    record.lightpathDev = { pid: devServer.pid, readyMs: devServer.readyMs };
    log(`lightpath dev ready in ${devServer.readyMs} ms (pid ${devServer.pid})`);
  }
  const load = await loadBeforeRun();
  record.cpuLoadStart = load;
  const agentStartIso = new Date().toISOString();
  log(`agent start (${MODEL}, effort ${EFFORT}, limit ${AGENT_TIMEOUT_MS / 60000} min)`);
  const maxSteps = args['max-steps'] === undefined ? null : Number(args['max-steps']);
  record.maxSteps = maxSteps;
  const agent = await runAgent({ trialDir, prompt, outDir, maxSteps });
  log(
    `agent stopped: exit ${agent.exitCode}${agent.timedOut ? ' (timed out)' : ''} after ${agent.wallMs} ms`,
  );
  record.cpuLoadEnd = cpuLoad();
  if (devServer) {
    // Stopped by PID before the usual cleanup and the check, which start the app on their own.
    devServer.stop();
    await sleep(2000);
  }
  record.cleanup = cleanupTrial(trialDir, agentStartIso);
  record.wallMs = agent.wallMs;
  record.exitCode = agent.exitCode;
  record.timedOut = agent.timedOut;
  // Suite v2 difficulty check: a run stopped at the step cap is scored as it stands (not void).
  record.stepCapped = agent.stepCapped;
  record.transcript = agent.transcript;

  const events = readJsonl(agent.transcript);
  const parsed = parseTranscript(events);
  record.engine = events.find((e) => e.type === 'runStarted')?.data?.engine ?? null;
  record.steps = parsed.steps;
  record.usedTools = parsed.usedTools;
  record.tokensIn = null;
  record.tokensOut = null;
  record.tokensNote = 'kiro-cli 2.37 stream-json reports credits, not tokens';
  Object.assign(record, estimateTokens(events, prompt));
  record.credits = parsed.credits;
  record.contextPctMax = parsed.contextPctMax;
  record.agentStatus = parsed.status;
  record.stopReason = parsed.stopReason;
  record.blockedCalls = parsed.toolCalls.filter((c) => c.blocked).length;
  if (record.lightpathTools) {
    // Which Lightpath tools the agent called, and how often (by the tool name in the call's title).
    const counts = {};
    for (const call of parsed.toolCalls) {
      const name = record.lightpathTools.tools.find((t) =>
        `${call.title ?? ''} ${call.kind ?? ''}`.includes(t),
      );
      if (name) counts[name] = (counts[name] ?? 0) + 1;
    }
    record.lightpathCalls = counts;
    // kiro-cli defers MCP tools: the agent loads them with tool_load before it can call them.
    record.lightpathLoaded = [
      ...new Set(
        parsed.toolCalls.flatMap((c) =>
          (c.input?.tool_ids ?? []).filter((id) => String(id).startsWith('lightpath::')),
        ),
      ),
    ];
  }
  record.shellFlags = auditShellCommands(parsed.toolCalls, trialDir);
  // D-147: hits void the run; what the D-108 rule also flagged but D-147 drops is kept for review.
  const outside = outsidePaths(parsed.toolCalls, trialDir);
  record.outsidePaths = outside.hits;
  record.ignoredOutsidePaths = outside.ignored;
  writeFileSync(join(outDir, 'tool-calls.json'), `${JSON.stringify(parsed.toolCalls, null, 2)}\n`);
  writeFileSync(join(outDir, 'final-text.md'), `${parsed.finalText ?? ''}\n`);

  // Score: the hidden check passes, the shop typechecks, and the check files are unchanged.
  const checkLog = join(outDir, suite === 'shop' ? 'check-shop.log' : 'check-app.log');
  const check = await runCheck({ bugDir, trialDir, logFile: checkLog });
  const types = typecheck(trialDir);
  const hashesAfter = hashBugDir();
  record.check = { pass: check.pass, detail: check.detail, ms: check.ms };
  record.typecheck = { ok: types.ok, output: types.ok ? '' : types.output.slice(0, 2000) };
  record.checkUntouched = JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter);
  // Suite v2 difficulty check: a run stopped at the step cap is not correct (SCORING.md v2).
  record.correct = check.pass && types.ok && record.checkUntouched && !record.stepCapped;
  if (S.agentDiff) {
    // The real-app trial has no .git (owner's rule): diff against its clean copy instead.
    const changes = S.agentDiff(trialDir);
    record.diff = changes.stat;
    writeFileSync(join(outDir, 'agent.diff'), changes.diff);
  } else {
    // Diff against the single initial commit, so agent commits and new files are included.
    const root = run('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: trialDir })
      .stdout.trim()
      .split('\n')[0];
    run('git', ['add', '-A', '-N'], { cwd: trialDir });
    record.diff = run('git', ['diff', '--stat', root], { cwd: trialDir }).stdout.trim();
    writeFileSync(join(outDir, 'agent.diff'), run('git', ['diff', root], { cwd: trialDir }).stdout);
  }

  const voidReasons = [];
  const harnessFailed =
    agent.error ||
    (!agent.timedOut && !agent.stepCapped && (agent.exitCode !== 0 || record.agentStatus === null));
  if (harnessFailed)
    voidReasons.push(`harness: kiro-cli exit ${agent.exitCode}${agent.error ? ` ${agent.error}` : ''}`);
  if (record.cleanup.leftAlone.length > 0)
    voidReasons.push(
      `harness: a process the harness did not start held ${suite === 'shop' ? 'a shop port' : 'an app port'}`,
    );
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
      `tokensEst=${record.tokensEst} ` +
      `wall=${(record.wallMs / 1000).toFixed(0)} s -> ${resultsFile}`,
  );
  log(
    `ports after cleanup: ${S.ports.join(', ')}; result ${relative(TRIALS_ROOT, join(outDir, 'result.json'))}`,
  );
}

await main();
