// End-to-end test of checking a fix in one call (D-144) on examples/invoices, the README demo app.
// It plants the demo bug (markPaid() no longer clears the summary cache, as in
// examples/invoices/demo/record-run.mjs), traces "Mark as paid", puts the fix back, and makes one
// run_action call with compareTo "last". The diff must show the change: getSummary's early return
// is no longer taken, so its summing lines now run.
//
// The server restarts on the edit (tsx watch), which empties the cache by itself. So before the
// second click the test loads the invoices once, which fills the cache again, as a page reload
// would. Without the fix the early return is then taken again, and this test fails: run it with
// LP_E2E_NO_FIX=1 to see that (the edit only touches a comment).
//
// Usage: pnpm build && node scripts/e2e-invoices-fix.mjs

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(repo, 'examples', 'invoices');
const API = 'http://127.0.0.1:3002/api/invoices';
const MAX_CHARS = 16_000;
const noFix = process.env.LP_E2E_NO_FIX === '1';
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = async () => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const up = await fetch(API).then(
      () => true,
      () => false,
    );
    if (!up) return true;
    await sleep(200);
  }
  return false;
};
/** "16-27, 30" → [16, ..., 27, 30]. */
const expand = (ranges) =>
  ranges.split(',').flatMap((part) => {
    const [a, b = a] = part.trim().split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });

const ledgerPath = join(app, 'server', 'services', 'ledger.ts');
const original = readFileSync(ledgerPath, 'utf8');
const FIX_LINE = '  summaryCache = null; // the totals changed\n';
const lf = original.replace(/\r\n/g, '\n');
const config = join(app, 'lightpath.config.json');
const requireMcp = createRequire(join(repo, 'packages', 'mcp', 'package.json'));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const agent = new Client({ name: 'e2e-invoices-fix', version: '0.0.0' });

check(await portFree(), 'nothing is listening on the API port before the test');
check(lf.includes(FIX_LINE), 'ledger.ts has the line the demo bug removes');
const sumLine =
  lf.split('\n').findIndex((l) => l.includes('summary.outstandingCents += inv.amountCents;')) + 1;
try {
  // 1. The demo bug: the cache isn't cleared after a payment.
  writeFileSync(ledgerPath, lf.replace(FIX_LINE, ''));
  writeFileSync(config, JSON.stringify({ command: 'node dev.mjs', autoStart: true }));
  await agent.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(repo, 'packages', 'cli', 'dist', 'bin.js'), 'mcp', '--root', app],
    }),
  );
  const call = async (name, args) => {
    const res = await agent.callTool({ name, arguments: args });
    const out = res.content?.[0]?.text ?? '';
    console.log(`\n${name}(${JSON.stringify(args)}) →\n${out}\n`);
    return { out, isError: res.isError === true };
  };

  // 2. The trace with the bug.
  const before = await call('run_action', { target: 'button "Mark as paid"', within: 'Kestrel Labs' });
  const beforeId = /\nTrace (t_[a-z0-9]{12}): button: Mark as paid/.exec(before.out)?.[1];
  check(Boolean(beforeId), 'run_action traces "Mark as paid" on Kestrel Labs with the bug planted');
  const early = /^ {4}getSummary (\d+)-\d+ ×\d+ not run: ([\d, -]+)$/m.exec(before.out);
  check(
    Boolean(early && expand(early[2]).includes(sumLine)),
    `with the bug, getSummary took its early return (line ${sumLine} did not run)`,
  );
  const stale = await fetch(API).then((r) => r.json());
  check(
    stale.summary?.outstandingCents === 4_248_550,
    `with the bug, Outstanding stays at $42,485.50 (${stale.summary?.outstandingCents})`,
  );

  // 3. The fix (or, with LP_E2E_NO_FIX=1, an edit that changes only a comment).
  const planted = lf.replace(FIX_LINE, '');
  writeFileSync(
    ledgerPath,
    noFix
      ? planted.replace('// until something changes them.', '// until something changes them (edited).')
      : lf,
  );
  // tsx watch restarts the server, which puts the invoices back (Kestrel Labs is overdue again).
  // This load also fills the summary cache again.
  const deadline = Date.now() + 30_000;
  let restarted = false;
  while (Date.now() < deadline && !restarted) {
    await sleep(300);
    const list = await fetch(API).then(
      (r) => r.json(),
      () => undefined,
    );
    restarted = list?.invoices?.find((i) => i.id === 'INV-2041')?.status === 'overdue';
  }
  check(restarted, 'the API restarted after the edit and the cache was filled again');

  // 4. One call: the same action on another open invoice, compared with the last trace of it.
  const after = await call('run_action', {
    target: 'button "Mark as paid"',
    within: 'Oakline Coffee',
    compareTo: 'last',
  });
  check(after.out.length <= MAX_CHARS, `the answer is at most 16,000 characters (${after.out.length})`);
  check(
    after.out.includes(`compareTo: ${beforeId}; what changed against it is at the end.`),
    `run_action compared the new trace with the bug's trace (${beforeId})`,
  );
  const at = after.out.lastIndexOf(`\n\nTrace ${beforeId} (button: Mark as paid) → `);
  const diff = at >= 0 ? after.out.slice(at + 2) : '';
  check(at >= 0, 'the diff is at the end of the answer');
  const changed = /^ {2}server\/services\/ledger\.ts getSummary[^\n]*: now runs ([\d, -]+)/m.exec(diff);
  check(
    Boolean(changed && expand(changed[1]).includes(sumLine)),
    `the diff shows getSummary's early return no longer taken: it now runs line ${sumLine}`,
  );
  const fixedLine =
    lf.split('\n').findIndex((l) => l.includes('summaryCache = null; // the totals changed')) + 1;
  check(
    new RegExp(`\\n {0,3}${fixedLine} {4}summaryCache = null; // the totals changed\\n`).test(after.out),
    `the answer's code shows the fixed line ${fixedLine} ran`,
  );
  const fresh = await fetch(API).then((r) => r.json());
  check(
    fresh.summary?.outstandingCents === 3_862_500,
    `after the fix, Outstanding dropped to $38,625.00 (${fresh.summary?.outstandingCents})`,
  );
} catch (err) {
  failures.push(String(err?.stack ?? err));
  console.error(err);
} finally {
  writeFileSync(ledgerPath, original);
  await agent.close().catch(() => {});
  check(await portFree(), 'closing the MCP client stopped lightpath dev and the app');
  rmSync(config, { force: true });
  const log = join(app, '.lightpath', 'dev.log');
  if (existsSync(log)) rmSync(log, { force: true });
  check(readFileSync(ledgerPath, 'utf8') === original, 'ledger.ts is back as it was');
}

if (failures.length === 0) console.log('\nE2E INVOICES FIX CHECK PASSED');
else
  console.log(
    `\nE2E INVOICES FIX CHECK FAILED (${failures.length})\n${failures.map((f) => `- ${f}`).join('\n')}`,
  );
process.exit(failures.length === 0 ? 0 : 1);
