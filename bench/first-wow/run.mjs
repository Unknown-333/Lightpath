// Time to first wow: from `npx` to the agent's first useful answer on a fresh clone of a real app.
// Usage:
//   node bench/first-wow/run.mjs --app stepful
//   node bench/first-wow/run.mjs --app stepful --lightpath C:/path/lightpath-dev-cli-0.0.3.tgz
// Method, rules and limits: README.md in this folder.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { isWindows, killTree, powershell, run } from '../agent-suite/lib/common.mjs';
import { checkAnswer } from './check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LIGHTPATH = '@lightpath-dev/cli@0.0.2';
export const TARGET_MS = 2 * 60_000;
const APP_OPEN_TIMEOUT_MS = 3 * 60_000;
const AGENT_TIMEOUT_MS = 5 * 60_000;
const ITEM_CAP = 5;
const MAX_CREDITS_PER_RUN = 2;
/** The one question, with the app's action filled in. */
export const question = (action) => `Which code handles ${action} in this app? Name the files and lines.`;

const sh = (line, cwd) => run(line, [], { cwd, shell: true, timeoutMs: 15 * 60_000 });

function cpuLoad() {
  const res = powershell(
    "(Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 3).CounterSamples.CookedValue | Measure-Object -Average | % Average",
  );
  const value = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

async function settledCpu(log) {
  let load = cpuLoad();
  log(`cpu ${load}%`);
  if (load !== null && load > 20) {
    log('cpu over 20%, waiting 60 s');
    await new Promise((r) => setTimeout(r, 60_000));
    load = cpuLoad();
    log(`cpu ${load}%`);
  }
  return load;
}

function listeners(ports) {
  const res = powershell(
    `Get-NetTCPConnection -State Listen -LocalPort ${ports.join(',')} -ErrorAction SilentlyContinue | % { "$($_.LocalPort) $($_.OwningProcess)" }`,
  );
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [port, pid] = l.split(' ');
      return { port: Number(port), pid: Number(pid) };
    });
}

function creditsSoFar(files) {
  let total = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim()) total += JSON.parse(line).credits ?? 0;
    }
  }
  return total;
}

/** The pinned agent: only the Lightpath MCP server's tools, no built-in tools, no global MCP servers. */
export function agentConfig(lightpathSpec, appDir) {
  const args = ['-y', `--package=${lightpathSpec}`, 'lightpath', 'mcp', '--root', appDir];
  return {
    name: 'bench',
    description: 'Coding agent for this repository',
    prompt: null,
    tools: ['@lightpath'],
    allowedTools: [],
    mcpServers: {
      lightpath: isWindows ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: 'npx', args },
    },
    includeMcpJson: false,
    resources: [],
    model: MODEL,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      app: { type: 'string', default: 'stepful' },
      lightpath: { type: 'string', default: DEFAULT_LIGHTPATH },
      results: { type: 'string', default: join(HERE, 'results', 'results.jsonl') },
      'other-results': { type: 'string', multiple: true, default: [] },
    },
  });
  const app = (await import(pathToFileURL(join(HERE, 'apps', `${values.app}.mjs`)).href)).default;
  const spec = existsSync(values.lightpath) ? resolve(values.lightpath) : values.lightpath;
  const spent = creditsSoFar([values.results, ...values['other-results']]);
  if (spent + 1 > ITEM_CAP) {
    console.log(`stop: ${spent.toFixed(3)} credits used, a run could pass the ${ITEM_CAP} cap`);
    process.exitCode = 2;
    return;
  }
  const ports = [app.ports.web, app.ports.api];
  const busy = listeners(ports);
  if (busy.length > 0) throw new Error(`ports in use: ${JSON.stringify(busy)}`);

  const runDir = join(tmpdir(), 'lp-first-wow', `${app.name}-${Date.now()}`);
  const appDir = join(runDir, 'app');
  mkdirSync(runDir, { recursive: true });
  const logFile = join(runDir, 'run.log');
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    appendFileSync(logFile, `${line}\n`);
  };
  const result = {
    test: 'first-wow',
    app: app.name,
    repo: app.repo,
    commit: app.commit,
    ports: app.ports,
    lightpath: spec,
    action: app.action,
    question: question(app.action),
    kiroCli: kiroCliVersion(),
    kiroCliBin: KIRO_CLI,
    model: MODEL,
    effort: EFFORT,
    node: process.version,
    startedAt: new Date().toISOString(),
    runDir,
  };
  log(`run dir ${runDir}`);

  // Untimed for the score: fresh clone at the pinned commit, config files, dependencies.
  let t = Date.now();
  const clone = sh(`git clone --quiet ${app.repo} app && git -C app checkout --quiet ${app.commit}`, runDir);
  result.cloneMs = Date.now() - t;
  if (clone.code !== 0) throw new Error(`clone failed: ${clone.stderr}`);
  for (const [file, text] of Object.entries(app.files)) writeFileSync(join(appDir, file), text);
  t = Date.now();
  for (const line of app.install) {
    const res = sh(line, appDir);
    appendFileSync(join(runDir, 'install.log'), `$ ${line}\n${res.stdout}\n${res.stderr}\n`);
    if (res.code !== 0) throw new Error(`install step failed: ${line}\n${res.stderr.slice(-2000)}`);
  }
  result.installMs = Date.now() - t;
  log(`clone ${result.cloneMs} ms, install ${result.installMs} ms`);

  // The agent config goes in before the clock starts, as `lightpath init` would write it.
  mkdirSync(join(appDir, '.kiro', 'agents'), { recursive: true });
  const config = agentConfig(spec, appDir);
  writeFileSync(join(appDir, '.kiro', 'agents', 'bench.json'), `${JSON.stringify(config, null, 2)}\n`);
  appendFileSync(join(appDir, '.git', 'info', 'exclude'), '.kiro/\n.lightpath/\n');
  result.agentConfig = config;

  result.cpuStart = await settledCpu(log);

  // The clock starts here.
  const clock = Date.now();
  const devArgs = ['-y', `--package=${spec}`, 'lightpath', 'dev', '--headless', ...app.lightpathFlags];
  const devLine = `npx ${devArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')} -- ${app.dev}`;
  result.devCommand = devLine;
  log(`$ ${devLine}`);
  const devOut = createWriteStream(join(runDir, 'lightpath-dev.log'));
  const dev = spawn(devLine, {
    cwd: appDir,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  result.devPid = dev.pid;
  let devText = '';
  const onData = (chunk) => {
    devOut.write(chunk);
    devText += chunk.toString();
  };
  dev.stdout.on('data', onData);
  dev.stderr.on('data', onData);

  try {
    const opened = await new Promise((resolveOpen) => {
      const timer = setInterval(() => {
        if (/watching \S*http/.test(devText.replace(/\u001b\[[0-9;]*m/g, ''))) {
          clearInterval(timer);
          resolveOpen(true);
        } else if (Date.now() - clock > APP_OPEN_TIMEOUT_MS || dev.exitCode !== null) {
          clearInterval(timer);
          resolveOpen(false);
        }
      }, 100);
    });
    result.appOpenMs = opened ? Date.now() - clock : null;
    log(opened ? `app open after ${result.appOpenMs} ms` : 'app did not open');
    if (!opened) throw new Error('app did not open');

    const agentStart = Date.now();
    const res = await runAgent({
      trialDir: appDir,
      prompt: question(app.action),
      outDir: runDir,
      timeoutMs: AGENT_TIMEOUT_MS,
    });
    const end = Date.now();
    const parsed = parseTranscript(readJsonl(res.transcript));
    const answer = (parsed.finalText ?? '').trim();
    const check = checkAnswer(answer, app.expected);
    Object.assign(result, {
      agentMs: end - agentStart,
      totalMs: end - clock,
      agentExit: res.exitCode,
      agentTimedOut: res.timedOut,
      steps: parsed.steps,
      tools: parsed.toolCalls.map((c) => ({ title: c.title, status: c.status, input: c.input })),
      credits: parsed.credits,
      contextPctMax: parsed.contextPctMax,
      answer,
      check,
      pass: check.pass,
      timeToWowMs: check.pass ? end - clock : null,
      underTarget: check.pass && end - clock <= TARGET_MS,
    });
    log(
      `agent ${result.agentMs} ms, total ${result.totalMs} ms, pass ${check.pass}, credits ${parsed.credits}`,
    );
  } catch (err) {
    result.error = String(err?.message ?? err);
  } finally {
    // Stop everything this run started, by PID: npx -> lightpath dev -> npm -> servers, and Chrome.
    killTree(dev.pid);
    await new Promise((r) => setTimeout(r, 2000));
    result.leftoverListeners = listeners(ports);
    devOut.end();
    result.cpuEnd = cpuLoad();
    result.endedAt = new Date().toISOString();
    mkdirSync(dirname(values.results), { recursive: true });
    appendFileSync(values.results, `${JSON.stringify(result)}\n`);
    log(`result written to ${values.results}`);
    if ((result.credits ?? 0) > MAX_CREDITS_PER_RUN) log(`over ${MAX_CREDITS_PER_RUN} credits in one run`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
