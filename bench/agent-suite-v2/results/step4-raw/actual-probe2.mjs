// No-agent probe 2: Lightpath's own BrowserCollector on Actual. What is on its page?
import { spawn } from 'node:child_process';
const repo = 'C:/Users/user/lightpath-trials/goal/step4';
const { BrowserCollector, parseTarget, resolveTarget } = await import(`file:///${repo}/packages/browser/dist/index.js`);
const { killTree, sleep } = await import(`file:///${repo}/bench/agent-suite/lib/common.mjs`);
const trial = 'C:/Users/user/lightpath-trials/goal/step4-trials/v02-with-1';
const dev = spawn(process.execPath, ['dev.mjs'], { cwd: trial, stdio: 'ignore', windowsHide: true });
const url = 'http://localhost:8613/';
for (let t = Date.now(); Date.now() - t < 180_000; await sleep(1000)) {
  try { await fetch(url); break; } catch {}
}
await sleep(20_000);
const notes = [];
const c = new BrowserCollector({ url, headless: true, send: () => {}, log: (m) => notes.push(m), notice: (m) => notes.push(m) });
await c.start();
const page = c.page;
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
for (const s of [5, 20]) {
  await sleep(s === 5 ? 5000 : (s === 20 ? 15000 : 25000));
  const pw = await page.getByRole('button', { name: 'Try the demo' }).count().catch((e) => `err ${e.message}`);
  const body = (await page.locator('body').innerText().catch((e) => `err ${e.message}`)).replace(/\s+/g, ' ').slice(0, 140);
  const info = await page.evaluate(() => `${location.href} iso=${self.crossOriginIsolated} ready=${document.readyState}`).catch((e) => `err ${e.message}`);
  let lp = '';
  try { const r = await resolveTarget(page, 'button "Try the demo"'); lp = r.ok ? 'ok' : JSON.stringify(r.error).slice(0, 300); } catch (e) { lp = `err ${String(e.message).slice(0, 200)}`; }
  console.log(`t+${s}s: pwButtons=${pw} ${info} body="${body}" lightpathResolve=${lp}`);
}
console.log(`errs=${JSON.stringify(errs.slice(0, 5))}`);
console.log(`notes=${JSON.stringify(notes.slice(0, 8)).slice(0, 800)}`);
await c.stop().catch(() => {});
killTree(dev.pid);
process.exit(0);
