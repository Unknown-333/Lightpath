// One demo take for the screen recording (docs/media/demo-run/RECORDING.md). Scripts the run, not
// the recorder: start Recordly's recording first, then run this, then stop the recording.
//
//   pnpm demo:take          a real take: kiro-cli fixes a bug planted in a local copy of tududi
//   pnpm demo:take --dry    everything but the model call: the script does the agent's loop itself
//                           (click, undo the bug, click again) and shows Lightpath's answers
//
// What it does, in order:
//   1. A fresh copy of tududi (github.com/chrisvel/tududi, MIT) at the real-app suite's commit,
//      with no .git folder, and bug.patch applied: "Plan your day" lists low-priority tasks first.
//      `lightpath init --agent kiro` in it, and a kiro-cli agent file using this checkout's CLI.
//   2. The daemon, then tududi with the Node agent the way `lightpath dev` runs it, except that the
//      API runs under `node --watch`, so the agent's edit restarts it. Lightpath's browser opens
//      headed (on screen), signs in, adds five tasks through tududi's own API and opens Today.
//   3. Windows Terminal opens (scripts/demo-take/view.mjs). Both windows are moved with the Win32
//      API (no mouse or keyboard input): terminal on the left, browser on the right, together
//      covering 1920x1080 at the top-left of the main display.
//   4. 3-2-1, the bug report, then kiro-cli with the fixed prompt. The terminal prints its output.
//   5. When kiro-cli exits: 3 s on the end state, then the loop reset: the browser opens Today
//      again and the terminal shows its first screen again, so the last frame matches the first.
//      3 s on that, then everything this script started is stopped.
//
// Each take writes a folder (default <home>/lightpath-demo-takes/take-<time>): transcript.jsonl,
// timing.json, run.json (kiro-cli version, model, credits, steps, tokens), agent-fix.diff,
// end.png (the page when kiro-cli exited) and the logs.
//
// Needs: Windows, Windows Terminal (wt.exe), Chrome, Node 22.12+, kiro-cli signed in
// (LP_KIRO_CLI=<path>, default kiro-cli on PATH). LP_TRIALS_ROOT: where tududi copies go
// (default <tmp>/lp-agent-trials); the first take builds tududi there (git clone + npm ci).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
// tududi copies go to one fixed place, so the first take builds tududi there and later takes reuse
// it (bench/agent-suite/lib/common.mjs reads this when it loads).
process.env.LP_TRIALS_ROOT ??= join(homedir(), 'lightpath-demo-takes', 'trials');
const dist = (pkg) => pathToFileURL(join(repo, 'packages', pkg, 'dist', 'index.js')).href;
const fromRepo = (rel) => pathToFileURL(join(repo, rel)).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv } = await import(dist('cli'));
const { postAction } = await import(dist('protocol'));
const { describeActionResult } = await import(dist('mcp'));
const bench = await import(fromRepo('bench/agent-suite/lib/agent.mjs'));
const { cpuLoad, killTree, listeners, processesMentioning, TRIALS_ROOT } = await import(
  fromRepo('bench/agent-suite/lib/common.mjs')
);
const tududi = await import(fromRepo('bench/agent-suite/realapp/lib/app.mjs'));

const { values } = parseArgs({ options: { dry: { type: 'boolean' }, out: { type: 'string' } } });
const dry = values.dry === true;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = resolve(
  values.out ?? join(homedir(), 'lightpath-demo-takes', `${dry ? 'dry' : 'take'}-${stamp}`),
);
if (existsSync(join(out, 'session.json'))) throw new Error(`${out} is used already; pass a new --out`);
mkdirSync(out, { recursive: true });

export const MODEL = 'claude-sonnet-5.5';
export const EFFORT = 'medium';
// The user's bug report: what they see, no file or function names.
export const HEADLINE = 'Plan your day lists my low-priority tasks first.';
export const DETAILS = [
  'On the Today page I click "Plan your day". The list starts with "Water the office plants" and',
  '"Call the dentist", which are low priority, and my high-priority "Send Q4 report to finance"',
  'comes last. Please fix it, then check the fix in the app. The app is running, I am signed in,',
  'and the server restarts by itself when a file changes. Use Lightpath to see what the click runs.',
].join(' ');
const PROMPT = bench.buildPrompt(`${HEADLINE} ${DETAILS}`);
// Same tasks as scripts/demo-gif/record-tududi.mjs (PR #56). Priority: 0 low, 1 medium, 2 high.
const TASKS = [
  ['Call the dentist', 0, null],
  ['Review pull requests', 1, 'Website relaunch'],
  ['Send Q4 report to finance', 2, 'Q4 planning'],
  ['Book flights for the offsite', 1, 'Q4 planning'],
  ['Water the office plants', 0, null],
];
const FIX_LINE = 'priorityRank(b.task.priority) - priorityRank(a.task.priority) ||';
// Ports of the demo's own (as in PR #56), so a benchmark run (3402/8402) can go on at the same time.
const API_PORT = 3412;
const WEB_PORT = 8412;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
// Screen layout, in screen pixels at 100% display scaling. Recordly crops the display to REGION.
export const REGION = { x: 0, y: 0, width: 1920, height: 1080 };
export const TERMINAL = { x: 0, y: 0, width: 860, height: 1080 };
export const BROWSER = { x: 860, y: 0, width: 1060, height: 1080 };
// Text columns the terminal view wraps at: fits 860 px at 16 pt Cascadia Mono with the padding.
const COLS = 62;
const TERMINAL_TITLE = 'Lightpath demo take';
const PROFILE = 'Lightpath demo';
// --dry: the agent's loop by script, no model: click, undo the bug, open Today, click again.
const DRY_STEPS = [
  { target: 'link "Plan your day"' },
  { fix: true },
  { target: 'button "Today"' },
  { target: 'link "Plan your day"' },
];
const HOLD_START_MS = 2500;
const HOLD_END_MS = 3000;
const HOLD_LOOP_MS = 3000;
const KIRO = process.env.LP_KIRO_CLI ?? 'kiro-cli';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(`[demo:take] ${s}`);
const waitFor = async (name, timeoutMs = 15 * 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(join(out, name))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${name}`);
    await sleep(100);
  }
};
const place = (title, rect, extra = []) => {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(here, 'place-window.ps1'),
    '-Title',
    title,
  ];
  if (rect) args.push('-X', rect.x, '-Y', rect.y, '-W', rect.width, '-H', rect.height);
  return execFileSync('powershell', [...args, ...extra].map(String), { encoding: 'utf8' }).trim();
};

if (process.platform !== 'win32')
  throw new Error('demo:take places windows with the Win32 API: Windows only');
const busy = listeners([API_PORT, WEB_PORT]);
if (busy.length) throw new Error(`ports in use: ${busy.map((b) => `${b.port} (pid ${b.pid})`).join(', ')}`);
const run = {
  mode: dry ? 'dry' : 'take',
  date: new Date().toISOString(),
  app: {
    name: 'tududi',
    repo: 'https://github.com/chrisvel/tududi',
    commit: tududi.APP.commit,
    license: 'MIT',
  },
  lightpath: {
    version: JSON.parse(readFileSync(join(repo, 'packages', 'cli', 'package.json'), 'utf8')).version,
    commit: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim(),
  },
  model: MODEL,
  effort: EFFORT,
  prompt: PROMPT,
  tasks: TASKS,
  layout: { region: REGION, terminal: TERMINAL, browser: BROWSER },
};
if (!dry) run.kiroCli = execFileSync(KIRO, ['--version'], { encoding: 'utf8' }).trim();

// 1. The copy with the bug planted, and Lightpath set up for Kiro.
log(`take folder: ${out}`);
const template = tududi.prepareTemplate((s) => log(s));
const trial = tududi.createTrial({ id: `demo-take-${Date.now()}`, bugDir: here, template });
const rankingPath = join(trial, 'backend', 'modules', 'daily-plan', 'ranking.js');
if (readFileSync(rankingPath, 'utf8').includes(FIX_LINE)) throw new Error('bug.patch did not apply');
const cliBin = join(repo, 'packages', 'cli', 'dist', 'bin.js');
writeFileSync(
  join(out, 'init.out'),
  execFileSync(process.execPath, [cliBin, 'init', '--agent', 'kiro'], { cwd: trial, encoding: 'utf8' }),
);
const config = bench.agentConfig('with', {
  lightpathServer: { command: process.execPath, args: [cliBin, 'mcp'] },
});
config.name = 'demo';
mkdirSync(join(trial, '.kiro', 'agents'), { recursive: true });
writeFileSync(join(trial, '.kiro', 'agents', 'demo.json'), `${JSON.stringify(config, null, 2)}\n`);
tududi.refreshPristine(trial);
run.trial = trial;

// The terminal profile: a Windows Terminal "fragment" adds it without touching the user's
// settings.json (delete the folder to remove it). Fixed font and size, the brand's indigo.
const fragmentDir = join(
  process.env.LOCALAPPDATA,
  'Microsoft',
  'Windows Terminal',
  'Fragments',
  'Lightpath demo',
);
mkdirSync(fragmentDir, { recursive: true });
writeFileSync(
  join(fragmentDir, 'profile.json'),
  `${JSON.stringify(
    {
      profiles: [
        {
          name: PROFILE,
          guid: '{6b2c0f3e-4f2a-4d8e-9a51-1c0a7d0e5f11}',
          hidden: false,
          commandline: 'cmd.exe',
          font: { face: 'Cascadia Mono', size: 16 },
          colorScheme: 'Lightpath indigo',
          padding: '24, 20, 16, 16',
          scrollbarState: 'hidden',
          closeOnExit: 'always',
          bellStyle: 'none',
          suppressApplicationTitle: true,
          useAcrylic: false,
          opacity: 100,
        },
      ],
      schemes: [
        {
          name: 'Lightpath indigo',
          background: '#1E1B4B',
          foreground: '#FFF7F2',
          cursorColor: '#FF7AC6',
          selectionBackground: '#3B3680',
          black: '#1E1B4B',
          red: '#FF7AC6',
          green: '#C9C5EC',
          yellow: '#FFF7F2',
          blue: '#8A85BD',
          purple: '#FF7AC6',
          cyan: '#C9C5EC',
          white: '#FFF7F2',
          brightBlack: '#5D5895',
          brightRed: '#FF7AC6',
          brightGreen: '#C9C5EC',
          brightYellow: '#FFF7F2',
          brightBlue: '#8A85BD',
          brightPurple: '#FF7AC6',
          brightCyan: '#C9C5EC',
          brightWhite: '#FFFFFF',
        },
      ],
    },
    null,
    2,
  )}\n`,
);

// 2. Lightpath and the app. The database lives outside the copy.
const dbDir = join(TRIALS_ROOT, '_db');
mkdirSync(dbDir, { recursive: true });
const daemon = await startDaemon({ workspaceRoots: [trial] });
const env = {
  ...agentEnv(process.env, { daemonUrl: daemon.url, token: daemon.token, roots: [trial], registerUrl }),
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DB_FILE: join(dbDir, `demo-take-${Date.now()}.sqlite3`),
  FRONTEND_PORT: String(WEB_PORT),
  FRONTEND_HOST: 'localhost',
  BACKEND_URL: API,
  FRONTEND_URL: WEB,
  FRONTEND_ORIGIN: WEB,
  TUDUDI_ALLOWED_ORIGINS: WEB,
  TUDUDI_USER_EMAIL: tududi.USER.email,
  TUDUDI_USER_PASSWORD: tududi.USER.password,
  // One secret per take, kept across API restarts: without it tududi makes a new one at each start,
  // and the restart after the agent's edit signed the user out (proof run 1).
  TUDUDI_SESSION_SECRET: randomBytes(32).toString('hex'),
};
const backend = join(trial, 'backend');
let appLog = '';
const children = [];
const startChild = (args, cwd) => {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  for (const s of [child.stdout, child.stderr])
    s.on('data', (c) => {
      appLog = (appLog + c).slice(-400_000);
    });
  children.push(child);
  return child;
};
let collector;
let watcher;
let failed = false;
let viewDone = false;
try {
  // The steps of the realapp suite's dev.mjs (tududi's backend/cmd/start.sh), then the API under
  // --watch and webpack's dev server.
  for (const args of [
    ['scripts/db-prepare.js'],
    [
      join(trial, 'node_modules', 'sequelize-cli', 'lib', 'sequelize'),
      'db:migrate',
      '--config',
      'config/database.js',
    ],
    ['scripts/user-create.js', tududi.USER.email, tududi.USER.password, 'true'],
  ]) {
    const res = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', windowsHide: true });
    appLog += `${res.stdout}${res.stderr}`;
    if (res.status !== 0) throw new Error(`${args[0]} failed (${res.status})`);
  }
  // The API restarts when a backend .js file's content changes. Not `node --watch`: on this
  // machine it restarted over and over with no file changed (dry runs 1 and 2), and requests
  // failed with 504 in between. Here an event only counts if the file's hash changed.
  let api = startChild(['app.js'], backend);
  const hashes = new Map();
  const hashOf = (p) => {
    try {
      return createHash('sha256').update(readFileSync(p)).digest('hex');
    } catch {
      return null;
    }
  };
  const isSource = (rel) =>
    /\.(c|m)?js$/.test(rel) && !/(^|[\\/])(node_modules|tests?|migrations|seeders)[\\/]/.test(rel);
  const sourceFiles = (dir) => readdirSync(dir, { recursive: true }).filter((rel) => isSource(String(rel)));
  for (const rel of sourceFiles(backend)) hashes.set(String(rel), hashOf(join(backend, String(rel))));
  let restartTimer;
  run.apiRestarts = [];
  watcher = watch(backend, { recursive: true }, (_event, name) => {
    if (!name || !isSource(name)) return;
    const now = hashOf(join(backend, name));
    if (now === hashes.get(name)) return;
    hashes.set(name, now);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      run.apiRestarts.push({ at: new Date().toISOString(), file: name.replace(/\\/g, '/') });
      appLog += `\n[demo:take] ${name} changed: restarting the API\n`;
      killTree(api.pid);
      api = startChild(['app.js'], backend);
    }, 300);
  });
  startChild(
    [
      join(trial, 'node_modules', 'webpack-cli', 'bin', 'cli.js'),
      'serve',
      '--config',
      'webpack.config.js',
      '--devtool',
      'eval-source-map',
    ],
    trial,
  );
  const up = (u) =>
    fetch(u, { signal: AbortSignal.timeout(5000) }).then(
      () => true,
      () => false,
    );
  const deadline = Date.now() + 240_000;
  while (!((await up(`${API}/api/version`)) && (await up(`${WEB}/`)))) {
    if (Date.now() > deadline) throw new Error("app didn't start");
    await sleep(1000);
  }
  daemon.correlator.addDevServer(new URL(WEB).origin, trial);

  collector = new BrowserCollector({
    url: `${WEB}/login`,
    headless: false,
    send: (m) => daemon.correlator.ingest('browser', m),
  });
  await collector.start();
  const page = collector.page;
  // The first-run page embeds a YouTube video; keep the demo on this machine.
  await page.context().route(/youtube|ytimg|googlevideo|doubleclick/, (r) => r.abort());
  // tududi's Today page shows a quote picked with Math.random, so the loop's last frame (Today
  // opened again) showed another quote than the first (dry run 4). A fixed-seed Math.random in the
  // page makes each load pick the same one. It changes no data and no code path; the init script
  // has no URL, so traces leave it out like any script that isn't the app's.
  await page.context().addInitScript(() => {
    let s = 0x2545f491;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  // Window first, so the app lays out at its filmed size from the start. Only a window of the
  // Chrome that Lightpath launched is moved: its process id comes from Chrome itself.
  const cdpBrowser = await page.context().browser().newBrowserCDPSession();
  const { processInfo } = await cdpBrowser.send('SystemInfo.getProcessInfo');
  const chromePid = processInfo.find((p) => p.type === 'browser')?.id;
  if (!chromePid) throw new Error("couldn't find the browser's process id");
  const placeBrowser = (extra = []) => place(' - ', BROWSER, ['-ProcessId', chromePid, ...extra]);
  run.browserFrame = JSON.parse(placeBrowser());

  // Sign in as the dev user (as record-tududi.mjs does; Enter is the fallback when the click
  // lands before the form's handler is attached).
  await page.waitForSelector('input[type="email"]', { timeout: 60_000 });
  await page.fill('input[type="email"]', tududi.USER.email);
  await page.fill('input[type="password"]', tududi.USER.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  for (let i = 0; i < 10 && /login/.test(new URL(page.url()).pathname); i++) {
    await sleep(1000);
    if (i === 2) await page.press('input[type="password"]', 'Enter');
  }
  if (/login/.test(new URL(page.url()).pathname)) throw new Error('sign-in failed');

  // The user's data, through tududi's own API with the page's session.
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
      const logLines = [];
      const onboarding = await post('/api/onboarding/starter', { key: 'empty' });
      logLines.push(`${onboarding.status} onboarding`);
      const projects = {};
      for (const name of new Set(TASKS.map((t) => t[2]).filter(Boolean))) {
        const p = await post('/api/project', { name });
        projects[name] = p.body?.uid;
        logLines.push(`${p.status} project ${name}`);
      }
      const today = new Date().toISOString().slice(0, 10);
      for (const [name, priority, project] of TASKS) {
        const body = { name, priority, due_date: today };
        if (project) body.project_uid = projects[project];
        const t = await post('/api/task', body);
        logLines.push(`${t.status} task ${name}`);
      }
      return logLines;
    },
    { API, TASKS },
  );
  if (run.seed.some((l) => !/^20[01] /.test(l))) throw new Error(`seeding failed: ${run.seed.join('; ')}`);

  // A visible pointer for the agent's clicks: they are CDP input, so the OS cursor doesn't move.
  // Injected with evaluate: it has no script URL, so the collector leaves it out of traces.
  const CURSOR = `(() => {
    if (document.getElementById('lp-demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'lp-demo-cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;' +
      'background:rgba(255,122,198,.35);border:2px solid #ff7ac6;pointer-events:none;z-index:2147483647;' +
      'transition:transform .12s;transform:translate(-100px,-100px)';
    let x = -100, y = -100, s = 1;
    const draw = () => { c.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; };
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
    addEventListener('pointerdown', (e) => { x = e.clientX; y = e.clientY; s = 0.7; draw(); }, true);
    addEventListener('pointerup', () => { s = 1; draw(); }, true);
    document.body.appendChild(c);
  })()`;
  const openToday = async () => {
    await page.goto(`${WEB}/today`);
    await page.getByText('Plan your day').first().waitFor({ timeout: 30_000 });
    // The dot stays off the page until the agent's first click moves the pointer.
    await page.evaluate(CURSOR);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1500);
  };
  await openToday();
  daemon.setActionRunner((request) => collector.runAction(request));

  // 3. The terminal.
  writeFileSync(
    join(out, 'session.json'),
    `${JSON.stringify(
      {
        dry: dry ? DRY_STEPS : false,
        trial,
        model: MODEL,
        lightpathVersion: run.lightpath.version,
        headline: HEADLINE,
        details: DETAILS,
        footer: bench.SAFETY_LINE,
        prompt: PROMPT,
        kiro: KIRO,
        args: [
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
        ],
        holdMs: HOLD_START_MS,
        cols: COLS,
      },
      null,
      2,
    )}\n`,
  );
  spawn(
    'wt.exe',
    [
      '-w',
      'new',
      '--focus',
      '--pos',
      `${TERMINAL.x},${TERMINAL.y}`,
      '--size',
      '70,40',
      '-p',
      PROFILE,
      '--title',
      TERMINAL_TITLE,
      process.execPath,
      join(here, 'view.mjs'),
      out,
    ],
    { stdio: 'ignore', detached: true },
  ).unref();
  await waitFor('view.ready', 30_000);
  run.terminalFrame = JSON.parse(place(TERMINAL_TITLE, TERMINAL, ['-Topmost']));
  run.browserFrame = JSON.parse(placeBrowser(['-Topmost']));
  log(`terminal ${JSON.stringify(run.terminalFrame)}, browser ${JSON.stringify(run.browserFrame)}`);
  await sleep(1500);

  // 4. 3-2-1 and the run.
  run.cpuStart = cpuLoad();
  writeFileSync(join(out, 'go'), '');
  if (dry) {
    for (const [n, step] of DRY_STEPS.entries()) {
      await waitFor(`dry-${n}.go`);
      let text;
      if (step.fix) {
        const restarts = run.apiRestarts.length;
        tududi.applyPatch(trial, join(here, 'bug.patch'), { reverse: true });
        const until = Date.now() + 30_000;
        while (run.apiRestarts.length === restarts && Date.now() < until) await sleep(200);
        while (!(await up(`${API}/api/version`)) && Date.now() < until) await sleep(300);
        text = `API restarted: ${run.apiRestarts.length > restarts ? 'yes' : 'no'}`;
      } else {
        const input = { target: step.target };
        const result = await postAction(
          Number(new URL(daemon.url).port),
          daemon.token,
          { protocolVersion: 1, ...input },
          40_000,
        );
        text = describeActionResult(input, result);
      }
      writeFileSync(join(out, `dry-${n}.txt`), text);
    }
  }
  await waitFor('agent.done');
  const agent = JSON.parse(readFileSync(join(out, 'agent.done'), 'utf8'));
  run.cpuEnd = cpuLoad();
  Object.assign(run, { exitCode: agent.exitCode, startedAt: agent.startedAt, endedAt: agent.endedAt });
  await page.screenshot({ path: join(out, 'end.png') });
  run.endPage = page.url();
  run.endOrder = await page
    .$$eval('a, li, div', (els) => els.map((e) => e.textContent.trim()))
    .then((texts) => {
      const names = TASKS.map(([n]) => n);
      // Task names in the order the page shows them (the first element that is exactly one name).
      const seen = [];
      for (const t of texts) if (names.includes(t) && !seen.includes(t)) seen.push(t);
      return seen;
    })
    .catch(() => null);

  // 5. The end state, then the loop reset to the first frame.
  await sleep(HOLD_END_MS);
  await openToday();
  writeFileSync(join(out, 'reset.done'), '');
  await waitFor('view.done', 30_000);
  viewDone = true;
  await sleep(HOLD_LOOP_MS);
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  try {
    place(TERMINAL_TITLE, null, ['-Release', '-TimeoutMs', '1000']);
  } catch {}
  writeFileSync(join(out, 'close'), '');
  if (!viewDone) writeFileSync(join(out, 'reset.done'), '');
  await sleep(500);
  watcher?.close();
  await collector?.stop().catch(() => {});
  for (const c of children) killTree(c.pid);
  await daemon.close();
  for (const p of processesMentioning(trial)) killTree(p.pid);
  writeFileSync(join(out, 'app.log'), appLog);
}

// The record of the take.
const lines = existsSync(join(out, 'transcript.jsonl'))
  ? readFileSync(join(out, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean)
  : [];
const events = lines.map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return { unparsed: l };
  }
});
const { diff, stat } = tududi.agentDiff(trial);
const rel = (s) =>
  s.replace(
    /"?([ab])\/[^"\n]*?demo-take-\d+(?:\/\/|\/|\\)([^"\n]*)"?/g,
    (_, side, p) => `${side}/${p.replace(/\/\/|\\/g, '/')}`,
  );
writeFileSync(join(out, 'agent-fix.diff'), rel(diff));
if (!dry) {
  const parsed = bench.parseTranscript(events);
  const tokens = bench.estimateTokens(events, PROMPT);
  Object.assign(run, {
    steps: parsed.steps,
    credits: parsed.credits,
    tokensEst: tokens.tokensEst,
    tokensMethod: tokens.tokensMethod,
    status: parsed.status,
    tools: parsed.toolCalls.map((c) => c.title),
  });
}
Object.assign(run, {
  wallMs: run.endedAt && run.startedAt ? run.endedAt - run.startedAt : null,
  changedFiles: stat.split('\n').filter(Boolean),
  fixLineBack: readFileSync(rankingPath, 'utf8').includes(FIX_LINE),
  failed,
});
writeFileSync(join(out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
log(JSON.stringify({ ...run, prompt: undefined, tasks: undefined, seed: undefined }, null, 2));
log(`done: ${out}. Stop the recording now.`);
process.exit(failed ? 1 : 0);
