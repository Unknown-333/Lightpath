// Records the README demo run (D-138): one real kiro-cli session fixing a bug planted in a local
// copy of tududi (github.com/chrisvel/tududi, MIT), with Lightpath's own browser filmed through a
// DevTools screencast. The app is never committed here: only this script, bug.patch and the run.
//
// What it does, in order:
//   1. Builds (once) tududi at the real-app suite's pinned commit, with no .git folder (D-110),
//      copies it and applies bug.patch: "Plan your day" lists low-priority tasks first.
//   2. Runs `lightpath init --agent kiro` there and writes a kiro-cli agent file whose Lightpath
//      server is this checkout's CLI (not npx), like the benchmark's `with` condition (D-130).
//   3. Starts the daemon, the app with the Node agent, and Lightpath's browser, headless, the way
//      `lightpath dev` does. Signs in, adds five tasks through the app's own API and opens Today.
//      Then starts a screencast of that page. Nothing is captured from the screen and no OS mouse
//      or keyboard is used: the agent's run_action calls do the clicking.
//   4. Runs kiro-cli once with the user's bug report, saving each stream-json line with the time
//      it arrived. Then stops everything and writes run.json (versions, model, credits, steps).
//
// Usage: pnpm build && node scripts/demo-gif/record-tududi.mjs --out <new folder>
//   LP_KIRO_CLI=<path to kiro-cli> (default: kiro-cli on PATH)
//   LP_TRIALS_ROOT=<folder outside any git repo> (default: <tmp>/lp-agent-trials)
//   --no-agent: everything but the kiro-cli run (checks the setup; costs no credits)
// Then: node scripts/demo-gif/render-gif.mjs --run <folder>
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const dist = (pkg) => pathToFileURL(join(repo, 'packages', pkg, 'dist', 'index.js')).href;
const fromRepo = (rel) => pathToFileURL(join(repo, rel)).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv } = await import(dist('cli'));
const bench = await import(fromRepo('bench/agent-suite/lib/agent.mjs'));
const { processesMentioning, TRIALS_ROOT } = await import(fromRepo('bench/agent-suite/lib/common.mjs'));
const tududi = await import(fromRepo('bench/agent-suite/realapp/lib/app.mjs'));

const { values } = parseArgs({
  options: { out: { type: 'string' }, 'no-agent': { type: 'boolean' }, after: { type: 'boolean' } },
});
if (!values.out) throw new Error('--out <folder> is required');
const out = resolve(values.out);
if (!values.after && existsSync(join(out, 'run.json')))
  throw new Error(`${out} has a run already; use a new --out folder`);

export const MODEL = 'claude-sonnet-5.5';
export const EFFORT = 'medium';
export const VIEWPORT = { width: 1280, height: 800 };
// Ports of their own, so a benchmark run (3402/8402) can go on at the same time.
const API_PORT = 3412;
const WEB_PORT = 8412;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
export const PROMPT = [
  'I click "Plan your day" on the Today page. The list starts with "Water the office plants" and',
  '"Call the dentist", which are low priority, and my high-priority "Send Q4 report to finance"',
  'comes last. Please fix it. The app is already running and I am signed in; use Lightpath to see',
  'what the click runs.',
].join(' ');
// The tasks the user has, added through the app's API before filming. Priority: 0 low, 1 medium, 2 high.
const TASKS = [
  ['Call the dentist', 0, null],
  ['Review pull requests', 1, 'Website relaunch'],
  ['Send Q4 report to finance', 2, 'Q4 planning'],
  ['Book flights for the offsite', 1, 'Q4 planning'],
  ['Water the office plants', 0, null],
];
const FIX_LINE = 'priorityRank(b.task.priority) - priorityRank(a.task.priority) ||';
const KIRO = process.env.LP_KIRO_CLI ?? 'kiro-cli';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cpu = () => {
  if (process.platform !== 'win32') return null;
  const ps = "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue";
  return Number(
    Number(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })).toFixed(1),
  );
};
const killTree = (pid) => {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch {}
};

// --after: no agent and no new copy. Starts the run's copy again (the agent's fix in place, the
// server restarted, which the agent could not do), adds the same tasks to a new database, clicks
// "Plan your day" once by script and saves the page as after.jpg.
const after = values.after;
let trial;
let rankingPath;
if (after) {
  trial = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')).trial;
  rankingPath = join(trial, 'backend', 'modules', 'daily-plan', 'ranking.js');
} else {
  // 1. The trial copy, with the bug planted.
  mkdirSync(out, { recursive: true });
  const template = tududi.prepareTemplate();
  trial = tududi.createTrial({ id: `demo-${Date.now()}`, bugDir: here, template });
  rankingPath = join(trial, 'backend', 'modules', 'daily-plan', 'ranking.js');
  if (readFileSync(rankingPath, 'utf8').includes(FIX_LINE)) throw new Error('bug.patch did not apply');

  // 2. Lightpath set up for Kiro, as a user would, then the agent file kiro-cli runs with.
  const cliBin = join(repo, 'packages', 'cli', 'dist', 'bin.js');
  const init = execFileSync(process.execPath, [cliBin, 'init', '--agent', 'kiro'], {
    cwd: trial,
    encoding: 'utf8',
  });
  writeFileSync(join(out, 'init.out'), init);
  const config = bench.agentConfig('with', {
    lightpathServer: { command: process.execPath, args: [cliBin, 'mcp'] },
  });
  config.name = 'demo';
  mkdirSync(join(trial, '.kiro', 'agents'), { recursive: true });
  writeFileSync(join(trial, '.kiro', 'agents', 'demo.json'), `${JSON.stringify(config, null, 2)}\n`);
  tududi.refreshPristine(trial);
}

// 3. Lightpath and the app, as `lightpath dev` runs them. The database lives outside the trial.
const dbDir = join(TRIALS_ROOT, '_db');
mkdirSync(dbDir, { recursive: true });
const daemon = await startDaemon({ workspaceRoots: [trial] });
const child = spawn(process.execPath, ['dev.mjs'], {
  cwd: trial,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: {
    ...agentEnv(process.env, { daemonUrl: daemon.url, token: daemon.token, roots: [trial], registerUrl }),
    PORT: String(API_PORT),
    FRONTEND_PORT: String(WEB_PORT),
    DB_FILE: join(dbDir, `demo-${Date.now()}.sqlite3`),
  },
});
let childOut = '';
for (const s of [child.stdout, child.stderr])
  s.on('data', (c) => {
    childOut = (childOut + c).slice(-200_000);
  });

// A visible pointer: screencasts don't draw the mouse. Injected with evaluate, so it has no script
// URL and the collector leaves it out of traces, like any script that isn't the app's.
const CURSOR = `(() => {
  if (document.getElementById('lp-demo-cursor')) return;
  const c = document.createElement('div');
  c.id = 'lp-demo-cursor';
  c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;' +
    'background:rgba(37,99,235,.30);border:2px solid #2563eb;pointer-events:none;z-index:2147483647;' +
    'transition:transform .12s;transform:translate(-100px,-100px)';
  let x = -100, y = -100, s = 1;
  const draw = () => { c.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; };
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
  addEventListener('pointerdown', (e) => { x = e.clientX; y = e.clientY; s = 0.7; draw(); }, true);
  addEventListener('pointerup', () => { s = 1; draw(); }, true);
  document.body.appendChild(c);
})()`;

const framesDir = join(out, 'frames');
if (!after) mkdirSync(framesDir, { recursive: true });
const frames = [];
const lines = [];
let collector;
let kiro;
let failed = false;
const run = {
  app: {
    name: 'tududi',
    repo: 'https://github.com/chrisvel/tududi',
    commit: tududi.APP.commit,
    license: 'MIT',
  },
  model: MODEL,
  effort: EFFORT,
  prompt: PROMPT,
  viewport: VIEWPORT,
  tasks: TASKS,
};
try {
  const up = (u) =>
    fetch(u, { signal: AbortSignal.timeout(5000) }).then(
      () => true,
      () => false,
    );
  const deadline = Date.now() + 240_000;
  while (!((await up(`${API}/api/version`)) && (await up(`${WEB}/`)))) {
    if (Date.now() > deadline) throw new Error(`app didn't start:\n${childOut.slice(-4000)}`);
    await sleep(1000);
  }
  daemon.correlator.addDevServer(new URL(WEB).origin, trial);
  collector = new BrowserCollector({
    url: `${WEB}/login`,
    headless: true,
    send: (m) => daemon.correlator.ingest('browser', m),
  });
  await collector.start();
  const page = collector.page;
  // The first-run page embeds a YouTube video; keep the demo on this machine.
  await page.context().route(/youtube|ytimg|googlevideo|doubleclick/, (r) => r.abort());
  await page.setViewportSize(VIEWPORT);

  // Sign in as the dev user dev.mjs created. A click on Login sometimes lands before the form's
  // handler is attached, so Enter in the password field is the fallback.
  await page.waitForSelector('input[type="email"]', { timeout: 60_000 });
  await page.fill('input[type="email"]', tududi.USER.email);
  await page.fill('input[type="password"]', tududi.USER.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  for (let i = 0; i < 10 && /login/.test(new URL(page.url()).pathname); i++) {
    await sleep(1000);
    if (i === 2) await page.press('input[type="password"]', 'Enter');
  }
  if (/login/.test(new URL(page.url()).pathname)) throw new Error('sign-in failed');

  // The user's data, through the app's own API with the page's session: the first-run page is
  // marked seen (what its button does), two projects, five tasks due today.
  run.seed = await page.evaluate(
    async ({ API, TASKS }) => {
      const csrf = (await (await fetch(`${API}/api/csrf-token`, { credentials: 'include' })).json())
        .csrfToken;
      const post = async (path, body) => {
        const r = await fetch(`${API}${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const log = [];
      const onboarding = await post('/api/onboarding/starter', { key: 'empty' });
      log.push(`${onboarding.status} onboarding`);
      const projects = {};
      for (const name of new Set(TASKS.map((t) => t[2]).filter(Boolean))) {
        const p = await post('/api/project', { name });
        projects[name] = p.body?.uid;
        log.push(`${p.status} project ${name}`);
      }
      const today = new Date().toISOString().slice(0, 10);
      for (const [name, priority, project] of TASKS) {
        const body = { name, priority, due_date: today };
        if (project) body.project_uid = projects[project];
        const t = await post('/api/task', body);
        log.push(`${t.status} task ${name}`);
      }
      return log;
    },
    { API, TASKS },
  );
  if (run.seed.some((l) => !/^20[01] /.test(l))) throw new Error(`seeding failed: ${run.seed.join('; ')}`);
  await page.goto(`${WEB}/today`);
  await page.getByText('Plan your day').first().waitFor({ timeout: 30_000 });
  await sleep(1500);
  if (!after) await page.evaluate(CURSOR);
  daemon.setActionRunner((request) => collector.runAction(request));

  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    if (after) return;
    const file = `f${String(frames.length).padStart(4, '0')}.jpg`;
    writeFileSync(join(framesDir, file), Buffer.from(f.data, 'base64'));
    frames.push({ at: Date.now(), file });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEWPORT.width });
  await sleep(1500);

  // 4. The agent run.
  if (after) {
    const result = await collector.runAction({ protocolVersion: 1, target: 'link "Plan your day"' });
    await page.getByText('What could you do today?').waitFor({ timeout: 15_000 });
    await sleep(2500);
    await page.screenshot({ path: join(out, 'after.jpg'), type: 'jpeg', quality: 92 });
    const order = await page.$$eval('a', (as) => as.map((a) => a.textContent.trim()));
    writeFileSync(
      join(out, 'after.json'),
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          by: 'record-tududi.mjs --after (scripted click, no agent)',
          actionOk: result.ok,
          fixLineInFile: readFileSync(rankingPath, 'utf8').includes(FIX_LINE),
          links: order.filter((t) => TASKS.some(([name]) => t.startsWith(name))),
        },
        null,
        2,
      )}\n`,
    );
  } else if (values['no-agent']) {
    run.startedAt = Date.now();
    await sleep(1000);
    run.endedAt = Date.now();
  } else {
    run.kiroCli = execFileSync(KIRO, ['--version'], { encoding: 'utf8' }).trim();
    run.cpuStart = cpu();
    const args = [
      'chat',
      '--no-interactive',
      '--trust-all-tools',
      '--trust-workspace',
      '--require-mcp-startup',
      '--agent',
      'demo',
      '--model',
      MODEL,
      '--effort',
      EFFORT,
      '--output-format',
      'stream-json',
      '--wrap',
      'never',
      bench.buildPrompt(PROMPT),
    ];
    run.args = args.slice(0, -1);
    run.startedAt = Date.now();
    kiro = spawn(KIRO, args, { cwd: trial, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buf = '';
    let err = '';
    kiro.stdout.on('data', (c) => {
      buf += c;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) lines.push({ at: Date.now(), line });
        nl = buf.indexOf('\n');
      }
    });
    kiro.stderr.on('data', (c) => {
      err += c;
    });
    run.exitCode = await new Promise((res) => {
      const timer = setTimeout(() => {
        run.timedOut = true;
        killTree(kiro.pid);
      }, 10 * 60_000);
      kiro.on('exit', (code) => {
        clearTimeout(timer);
        res(code);
      });
    });
    if (buf.trim()) lines.push({ at: Date.now(), line: buf.trim() });
    run.endedAt = Date.now();
    run.cpuEnd = cpu();
    writeFileSync(join(out, 'kiro-cli.stderr.log'), err);
  }
  await sleep(2500); // the page settles after the last action
  await cdp.send('Page.stopScreencast').catch(() => {});
} catch (e) {
  failed = true;
  console.error(e);
  writeFileSync(join(out, 'app.log'), childOut);
} finally {
  await collector?.stop().catch(() => {});
  killTree(kiro?.pid);
  killTree(child.pid);
  await daemon.close();
  // Leftovers of this run only: processes whose command line names the trial folder. (Not
  // cleanupTrial: it also stops whatever holds the benchmark's ports, which may be another run.)
  for (const p of processesMentioning(trial)) killTree(p.pid);
}

if (after) {
  console.log(failed ? 'after: failed' : readFileSync(join(out, 'after.json'), 'utf8'));
  process.exit(failed ? 1 : 0);
}
writeFileSync(join(out, 'transcript.jsonl'), lines.map((l) => `${l.line}\n`).join(''));
writeFileSync(join(out, 'timing.json'), `${JSON.stringify(lines.map((l) => l.at))}\n`);
writeFileSync(join(out, 'frames.json'), `${JSON.stringify(frames)}\n`);
const { diff, stat } = tududi.agentDiff(trial);
// Paths in the diff are this machine's (git quotes them, with doubled slashes on Windows); keep
// them relative to the app: "a/C://…/demo-123//backend//x.js" -> a/backend/x.js.
const rel = (s) =>
  s.replace(
    /"?([ab])\/[^"\n]*?demo-\d+(?:\/\/|\/|\\)([^"\n]*)"?/g,
    (_, side, path) => `${side}/${path.replace(/\/\/|\\/g, '/')}`,
  );
writeFileSync(join(out, 'agent-fix.diff'), rel(diff));
const events = lines.map((l) => {
  try {
    return JSON.parse(l.line);
  } catch {
    return { unparsed: l.line };
  }
});
const parsed = bench.parseTranscript(events);
const tokens = bench.estimateTokens(events, bench.buildPrompt(PROMPT));
Object.assign(run, {
  trial,
  steps: parsed.steps,
  credits: parsed.credits,
  tokensEst: tokens.tokensEst,
  tokensMethod: tokens.tokensMethod,
  status: parsed.status,
  wallMs: run.endedAt - run.startedAt,
  frames: frames.length,
  tools: parsed.toolCalls.map((c) => c.title),
  changedFiles: stat.split('\n').filter(Boolean),
  fixLineBack: readFileSync(rankingPath, 'utf8').includes(FIX_LINE),
});
writeFileSync(join(out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
console.log(JSON.stringify({ ...run, prompt: undefined, args: undefined, tasks: undefined }, null, 2));
process.exit(failed ? 1 : 0);
