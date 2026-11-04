// Launch-kit case study harness (item it_eb7c75d9). Subcommands:
//   node lk.mjs setup        three trial copies of examples/invoices with the demo bug planted
//   node lk.mjs d1           init -> doctor -> scripted run_action over MCP in trials/d1
//   node lk.mjs pass A|B     one kiro-cli run, stopped at the 6th tool call (max 5 steps)
// Built from Lightpath commit LP_COMMIT, with the packed 0.1.2 tarballs in ./tgz.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAW = dirname(fileURLToPath(import.meta.url));
const BUILD = 'C:\\Users\\user\\lightpath-trials\\goal\\lk-build';
const LP_COMMIT = execSync(`git -C ${BUILD} rev-parse HEAD`, { encoding: 'utf8' }).trim();
const APP = join(BUILD, 'examples', 'invoices');
const TRIALS = join(RAW, 'trials');
const TGZ = join(RAW, 'tgz');
const KIRO = process.env.LP_KIRO_CLI ?? 'kiro-cli';
const PROMPT =
  'I click "Mark as paid" on the Kestrel Labs invoice. The row turns Paid, but Outstanding at the top stays at $42,485.50. Please fix it.';
const MAX_STEPS = 5;
const bench = await import(pathToFileURL(join(BUILD, 'bench', 'agent-suite', 'lib', 'agent.mjs')).href);
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const cpu = () =>
  Number(
    Number(
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue",
        ],
        { encoding: 'utf8' },
      ),
    ).toFixed(1),
  );
const killTree = (pid) => {
  try {
    execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
  } catch {}
};
const save = (name, data) =>
  writeFileSync(join(RAW, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);

// The hidden check: list, pay INV-2041 (Kestrel Labs), list again, through the app's own route handlers.
// Passes when Outstanding drops in the pay response and in the next list.
function hiddenCheck(trial) {
  const file = join(trial, '..', `check-${trial.split('\\').pop()}.mjs`);
  const routes = pathToFileURL(join(trial, 'server', 'routes', 'invoices.ts')).href;
  writeFileSync(
    file,
    `const r = await import(${JSON.stringify(routes)});
const call = (fn, req) => new Promise((ok) => { const res = { status() { return res; }, json: ok }; fn(req, res); });
const a = await call(r.listInvoices, {});
const p = await call(r.payInvoice, { params: { id: 'INV-2041' } });
const b = await call(r.listInvoices, {});
const out = { before: a.summary?.outstandingCents, payResponse: p.summary?.outstandingCents, after: b.summary?.outstandingCents };
out.pass = out.payResponse < out.before && out.after < out.before;
console.log(JSON.stringify(out));`,
  );
  try {
    return JSON.parse(
      sh(`node "${join(trial, 'node_modules', 'tsx', 'dist', 'cli.mjs')}" "${file}"`, trial)
        .trim()
        .split('\n')
        .pop(),
    );
  } catch (e) {
    return { pass: false, error: String(e.stderr ?? e).slice(0, 400) };
  }
}

function makeTrial(name, withLightpath) {
  const trial = join(TRIALS, name);
  if (existsSync(trial)) throw new Error(`${trial} exists`);
  cpSync(APP, trial, {
    recursive: true,
    filter: (s) => !/[\\/](node_modules|\.lightpath|demo)([\\/]|$)/.test(s.slice(APP.length)),
  });
  cpSync(join(BUILD, 'tsconfig.base.json'), join(trial, 'tsconfig.base.json'));
  const ts = join(trial, 'tsconfig.json');
  writeFileSync(ts, readFileSync(ts, 'utf8').replace('"../../tsconfig.base.json"', '"./tsconfig.base.json"'));
  const tgz = withLightpath
    ? readdirSync(TGZ)
        .map((f) => `"${join(TGZ, f)}"`)
        .join(' ')
    : '';
  sh('npm install --no-audit --no-fund --loglevel=error', trial);
  if (tgz) sh(`npm install --no-save --no-audit --no-fund --loglevel=error ${tgz}`, trial);
  if (name === 'A') writeFileSync(join(TRIALS, 'check-unplanted.json'), JSON.stringify(hiddenCheck(trial)));
  const ledger = join(trial, 'server', 'services', 'ledger.ts');
  const FIX = '  summaryCache = null; // the totals changed\n';
  const text = readFileSync(ledger, 'utf8').replace(/\r\n/g, '\n');
  if (!text.includes(FIX)) throw new Error('fix line missing');
  writeFileSync(ledger, text.replace(FIX, ''));
  return trial;
}

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'setup') {
  mkdirSync(TRIALS, { recursive: true });
  const result = { lpCommit: LP_COMMIT, tarballs: readdirSync(TGZ), node: process.version };
  for (const [name, lp] of [
    ['d1', true],
    ['A', false],
    ['B', true],
  ]) {
    const t = makeTrial(name, lp);
    result[`check_${name}_planted`] = hiddenCheck(t);
  }
  writeFileSync(
    join(TRIALS, 'planted-ledger.ts'),
    readFileSync(join(TRIALS, 'A', 'server', 'services', 'ledger.ts')),
  );
  result.cliVersionB = sh('npx --no-install lightpath --version', join(TRIALS, 'B')).trim();
  save('setup.json', result);
  console.log(JSON.stringify(result));
}

if (cmd === 'd1') {
  const trial = join(TRIALS, 'd1');
  const r = { lpCommit: LP_COMMIT };
  const t0 = Date.now();
  try {
    r.init = sh('npx -y @lightpath-dev/cli@0.1.2 init --agent kiro', trial);
  } catch (e) {
    r.initError = `${e.stdout}\n${e.stderr}`;
  }
  r.initMs = Date.now() - t0;
  const t1 = Date.now();
  try {
    r.doctor = sh('npx -y @lightpath-dev/cli@0.1.2 doctor', trial);
    r.doctorExit = 0;
  } catch (e) {
    r.doctor = `${e.stdout}\n${e.stderr}`;
    r.doctorExit = e.status;
  }
  r.doctorMs = Date.now() - t1;
  const mcpJson = JSON.parse(readFileSync(join(trial, '.kiro', 'settings', 'mcp.json'), 'utf8'));
  const server = mcpJson.mcpServers.lightpath;
  r.server = server;
  const req = createRequire(join(BUILD, 'packages', 'mcp', 'package.json'));
  const { Client } = req('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = req('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'lk-d1', version: '0.0.0' });
  const t2 = Date.now();
  try {
    await client.connect(
      new StdioClientTransport({ command: server.command, args: server.args, cwd: trial, stderr: 'pipe' }),
    );
    const res = await client.callTool({
      name: 'run_action',
      arguments: { target: 'button "Mark as paid"', within: 'Kestrel Labs' },
    });
    r.runActionMs = Date.now() - t2;
    const out = res.content?.map((c) => c.text ?? '').join('\n') ?? '';
    r.isError = res.isError === true;
    r.chars = out.length;
    save('d1-run_action.txt', out);
    const line = (fn) => out.split('\n').find((l) => new RegExp(`^\\s+${fn} \\d`).test(l)) ?? null;
    r.lines = {
      getSummary: line('getSummary'),
      markPaid: line('markPaid'),
      payInvoice: line('payInvoice'),
      listInvoices: line('listInvoices'),
    };
    r.checks = {
      under16k: out.length < 16_000,
      getSummaryNotRun16to27: /getSummary 14-28 ×\d+ not run: 16-27$/.test(r.lines.getSummary ?? ''),
      markPaidAllRun: /markPaid \d+-\d+ ×1$/.test(r.lines.markPaid ?? ''),
      payInvoiceCatchNotRun: /payInvoice 9-20 ×1 not run: 14-19$/.test(r.lines.payInvoice ?? ''),
    };
  } catch (e) {
    r.error = String(e?.stack ?? e);
  } finally {
    await client.close().catch(() => {});
  }
  await new Promise((ok) => setTimeout(ok, 3000));
  r.apiPortFreeAfter = !(await fetch('http://127.0.0.1:3002/api/invoices').then(
    () => true,
    () => false,
  ));
  save('d1.json', r);
  console.log(
    JSON.stringify({
      chars: r.chars,
      checks: r.checks,
      doctorExit: r.doctorExit,
      error: r.error,
      initError: r.initError,
      portFree: r.apiPortFreeAfter,
    }),
  );
}

if (cmd === 'pass') {
  const condition = arg === 'B' ? 'with' : 'without';
  const trial = join(TRIALS, arg);
  const outDir = join(RAW, `pass-${arg}`);
  mkdirSync(outDir, { recursive: true });
  let server;
  if (condition === 'with') {
    writeFileSync(join(outDir, 'init.out'), sh('npx -y @lightpath-dev/cli@0.1.2 init --agent kiro', trial));
    server = JSON.parse(readFileSync(join(trial, '.kiro', 'settings', 'mcp.json'), 'utf8')).mcpServers
      .lightpath;
  }
  bench.writeAgentFiles(trial, condition, { lightpathServer: server });
  const prompt = bench.buildPrompt(PROMPT);
  const args = [
    'chat',
    '--no-interactive',
    '--trust-all-tools',
    '--trust-workspace',
    '--require-mcp-startup',
    '--agent',
    'bench',
    '--model',
    bench.MODEL,
    '--effort',
    bench.EFFORT,
    '--output-format',
    'stream-json',
    '--wrap',
    'never',
    prompt,
  ];
  const run = {
    pass: arg,
    condition,
    lpCommit: LP_COMMIT,
    kiroCli: sh(`"${KIRO}" --version`).trim(),
    model: bench.MODEL,
    effort: bench.EFFORT,
    prompt,
    maxSteps: MAX_STEPS,
    cpuStart: cpu(),
  };
  run.startedAt = Date.now();
  const kiro = spawn(KIRO, args, { cwd: trial, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const lines = [];
  const ids = new Set();
  let buf = '';
  let err = '';
  run.stoppedAtStepCap = false;
  kiro.stdout.on('data', (c) => {
    buf += c;
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      lines.push(line);
      try {
        const u = JSON.parse(line).data?.update;
        if (u?.sessionUpdate === 'tool_call' && u.toolCallId && !ids.has(u.toolCallId)) {
          ids.add(u.toolCallId);
          if (ids.size > MAX_STEPS && !run.stoppedAtStepCap) {
            run.stoppedAtStepCap = true;
            run.capCall = { title: u.title, input: u.rawInput };
            killTree(kiro.pid);
          }
        }
      } catch {}
    }
  });
  kiro.stderr.on('data', (c) => (err += c));
  run.exitCode = await new Promise((ok) => {
    const timer = setTimeout(() => {
      run.timedOut = true;
      killTree(kiro.pid);
    }, 10 * 60_000);
    kiro.on('exit', (code) => {
      clearTimeout(timer);
      ok(code);
    });
  });
  killTree(kiro.pid);
  if (buf.trim()) lines.push(buf.trim());
  run.endedAt = Date.now();
  run.wallMs = run.endedAt - run.startedAt;
  run.cpuEnd = cpu();
  await new Promise((ok) => setTimeout(ok, 3000));
  run.apiPortFreeAfter = !(await fetch('http://127.0.0.1:3002/api/invoices').then(
    () => true,
    () => false,
  ));
  writeFileSync(join(outDir, 'transcript.jsonl'), lines.map((l) => `${l}\n`).join(''));
  writeFileSync(join(outDir, 'kiro-cli.stderr.log'), err);
  const events = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { unparsed: l };
    }
  });
  const p = bench.parseTranscript(events);
  const tok = bench.estimateTokens(events, prompt);
  // Steps actually done: tool calls before the one the cap stopped.
  const done = p.toolCalls.filter((c) => !run.capCall || c.id !== [...ids].at(-1) || !run.stoppedAtStepCap);
  Object.assign(run, {
    stepsDone: done.length,
    toolCalls: done.map((c) => ({
      title: c.title,
      kind: c.kind,
      status: c.status,
      input: c.input,
      locations: c.locations?.map((l) => l.path),
    })),
    credits: p.credits,
    contextPctMax: p.contextPctMax,
    status: p.status,
    stopReason: p.stopReason,
    finalText: p.finalText,
    tokens: tok,
    lightpathCalls: done.filter((c) =>
      /lightpath|run_action|get_trace|find_code|list_traces|diff_traces|run_request/i.test(c.title ?? ''),
    ).length,
    audit: bench.auditShellCommands(p.toolCalls, trial),
  });
  // Credits are only in turn_completion. If the cap stopped the run first, keep kiro-cli's own session
  // files written during the run, so the usage record there can be read.
  if (run.credits == null) {
    const sdir = join(process.env.USERPROFILE, '.kiro', 'sessions');
    const found = [];
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const pth = join(d, f);
        const st = statSync(pth);
        if (st.isDirectory()) walk(pth);
        else if (st.mtimeMs >= run.startedAt) found.push(pth);
      }
    };
    try {
      walk(sdir);
    } catch {}
    mkdirSync(join(outDir, 'kiro-sessions'), { recursive: true });
    for (const f of found)
      cpSync(f, join(outDir, 'kiro-sessions', f.slice(sdir.length + 1).replace(/[\\/]/g, '__')));
    run.sessionFilesSaved = found.length;
  }
  writeFileSync(
    join(outDir, 'ledger-after.ts'),
    readFileSync(join(trial, 'server', 'services', 'ledger.ts')),
  );
  try {
    run.diff = execSync(
      `git diff --no-index --stat -- "${join(TRIALS, 'planted-ledger.ts')}" "${join(trial, 'server', 'services', 'ledger.ts')}"`,
      { encoding: 'utf8' },
    );
  } catch (e) {
    run.diff = String(e.stdout ?? '');
  }
  run.hiddenCheck = hiddenCheck(trial);
  writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  console.log(
    JSON.stringify({
      pass: arg,
      stepsDone: run.stepsDone,
      capped: run.stoppedAtStepCap,
      credits: run.credits,
      tokens: tok.tokensEst,
      lightpathCalls: run.lightpathCalls,
      check: run.hiddenCheck,
      status: run.status,
      portFree: run.apiPortFreeAfter,
      sessionFiles: run.sessionFilesSaved,
      audit: run.audit.length,
    }),
  );
}
