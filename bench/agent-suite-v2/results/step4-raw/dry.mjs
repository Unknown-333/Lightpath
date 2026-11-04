// Step 4 no-agent dry run: per app, build the WITH trial exactly as run.mjs does (--dry-run), start
// `lightpath dev` as run.mjs does, record whether the app's backend answers at "watching", then call
// run_action through the agent's own server entry and print whether it returned a trace.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:/Users/user/lightpath-trials/goal/step4';
const lib = (p) => `file:///${repo}/bench/agent-suite/lib/${p}`;
const v2 = (p) => `file:///${repo}/bench/agent-suite-v2/lib/${p}`;
const { prepareLightpath, startLightpathDev, waitAppBackend } = await import(lib('lightpath.mjs'));
const { TRIALS_ROOT, killTree, sleep } = await import(lib('common.mjs'));
const apps = (await import(v2('apps.mjs'))).APPS;
const wait = process.argv.includes('--wait');

const cases = [
  { bug: 'v01', app: 'tududi', health: 'http://localhost:3611/api/version', html: 'public/index.html',
    args: { target: 'css=button[type="submit"]', fill: [
      { target: 'css=input[type="email"]', value: 'dev@tududi.test' },
      { target: 'css=input[type="password"]', value: 'DevPass123!' }] } },
  { bug: 'v06', app: 'invoices', health: 'http://127.0.0.1:3612/api/invoices', html: 'index.html',
    args: { target: 'button "Mark as paid"', within: 'INV-2042' } },
  { bug: 'v02', app: 'actual', health: null, args: { target: 'button "Try the demo"' } },
];
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

async function up(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

function callTool(entry, cwd, name, args, timeoutMs = 120_000) {
  return new Promise((res) => {
    const child = spawn(entry.command, entry.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buf = '';
    const timer = setTimeout(() => { killTree(child.pid); res({ error: 'timeout' }); }, timeoutMs);
    const write = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdout.setEncoding('utf8').on('data', (d) => {
      buf += d;
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.id === 1) {
          write({ jsonrpc: '2.0', method: 'notifications/initialized' });
          write({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
        } else if (m.id === 2) {
          clearTimeout(timer); child.stdin.end(); killTree(child.pid);
          res({ isError: Boolean(m.result?.isError), text: (m.result?.content ?? []).map((c) => c.text ?? '').join('\n') });
        }
      }
    });
    write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dry', version: '0' } } });
  });
}

const lp = prepareLightpath(() => {});
console.log(`lightpath ${lp.commit.slice(0, 12)} dirty=${lp.dirty} v${lp.version}`);
for (const c of cases) {
  if (only && c.bug !== only) continue;
  const r = spawnSync(process.execPath, ['bench/agent-suite/run.mjs', '--suite', 'v2', '--bug', c.bug,
    '--condition', 'with', '--run', '1', '--fresh', '--dry-run'], { cwd: repo, encoding: 'utf8', env: process.env });
  if (r.status !== 0) { console.log(`${c.bug}: dry-run exit ${r.status} ${(r.stderr || r.stdout).slice(-400)}`); continue; }
  const trialDir = join(TRIALS_ROOT, `${c.bug}-with-1`);
  const rec = JSON.parse(readFileSync(join(TRIALS_ROOT, '_runs', `${c.bug}-with-1`, 'dry-run.json'), 'utf8'));
  const dev = await startLightpathDev(trialDir, lp, join('C:/Users/user/lightpath-trials/goal/step4-raw', `dry-${c.app}-dev.log`));
  const atReady = c.health ? await up(c.health) : null;
  const bw = wait ? await waitAppBackend(trialDir, { backendUrl: c.health, pageHtml: c.html }) : null;
  const waitedMs = JSON.stringify(bw);
  let out = await callTool(rec.lightpath.serverEntry, trialDir, 'run_action', c.args);
  if (wait && out.isError && c.app === 'actual') {
    await sleep(30_000);
    out = await callTool(rec.lightpath.serverEntry, trialDir, 'run_action', c.args);
    out.text = `[after 30 s more] ${out.text}`;
  }
  const head = (out.text ?? out.error ?? '').replace(/\s+/g, ' ').slice(0, 220);
  console.log(`${c.app} ${c.bug}: ready ${dev.readyMs} ms, backend up at ready=${atReady}, waited ${waitedMs} ms; ` +
    `run_action isError=${out.isError} trace=${/\bt_[a-z0-9]{12}\b/.test(out.text ?? '')} | ${head}`);
  dev.stop();
  await sleep(2000);
  apps[c.app].cleanupTrial(trialDir, new Date(Date.now() - 3600_000).toISOString());
}
