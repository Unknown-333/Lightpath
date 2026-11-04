// End-to-end test for examples/invoices, the app in the README demo (D-136). Nothing is started by
// hand: an agent's first run_action makes `lightpath mcp` start `lightpath dev` from the app's
// config (D-122), and the click on "Mark as paid" must come back with the React code, the Express
// route and the ledger service in one trace.
//
// Usage: pnpm build && node scripts/e2e-invoices.mjs

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(repo, 'examples', 'invoices');
const API = 'http://127.0.0.1:3002/api/invoices';
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};
const portFree = async () => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const up = await fetch(API).then(
      () => true,
      () => false,
    );
    if (!up) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
const lineOf = (file, text) =>
  readFileSync(join(app, file), 'utf8')
    .split('\n')
    .findIndex((l) => l.includes(text)) + 1;
const namesFile = (out, path) =>
  new RegExp(`^ {2}${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`, 'm').test(out);

check(await portFree(), 'nothing is listening on the API port before the test');
const config = join(app, 'lightpath.config.json');
writeFileSync(config, JSON.stringify({ command: 'node dev.mjs', autoStart: true }));
const requireMcp = createRequire(join(repo, 'packages', 'mcp', 'package.json'));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const agent = new Client({ name: 'e2e-invoices', version: '0.0.0' });
try {
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

  const paid = await call('run_action', { target: 'button "Mark as paid"', within: 'Kestrel Labs' });
  check(
    paid.out.startsWith('started lightpath dev ("node dev.mjs") in the background'),
    'auto-start: the first run_action started lightpath dev',
  );
  check(/\nTrace t_[a-z0-9]{12}: button: Mark as paid/.test(paid.out), 'run_action returns the click trace');
  check(
    paid.out.includes('request: POST /api/invoices/INV-2041/pay → 200'),
    'the trace has POST /api/invoices/INV-2041/pay → 200',
  );
  for (const file of [
    'src/App.tsx',
    'src/api.ts',
    'server/routes/invoices.ts',
    'server/services/ledger.ts',
  ]) {
    check(namesFile(paid.out, file), `the trace lists ${file}`);
  }
  check(/^ {4}payInvoice /m.test(paid.out), 'the trace names the route handler payInvoice');
  check(/^ {4}markPaid /m.test(paid.out), 'the trace names the service function markPaid');

  // D-145: the answer carries the code that ran, the browser's as its original .tsx source.
  const codeLine = (file, text) => {
    const n = lineOf(file, text);
    const src = readFileSync(join(app, file), 'utf8').split('\n')[n - 1]?.replace(/\r$/, '');
    return n > 0 && paid.out.includes(`\n${String(n).padStart(4)}  ${src}\n`);
  };
  check(
    paid.out.length <= 16_000,
    `the Mark as paid answer is at most 16,000 characters (${paid.out.length})`,
  );
  check(paid.out.includes('\n\ncode that ran, most-used files first'), 'the answer has the code that ran');
  check(
    codeLine('server/services/ledger.ts', 'summaryCache = null; // the totals changed'),
    'the code shows ledger.ts clearing the cache, with its line number',
  );
  check(
    codeLine('src/App.tsx', 'const { invoice, summary } = await payInvoice(id);'),
    'the code shows App.tsx pay() as written in the .tsx file',
  );
  check(!/jsxDEV|_jsx\(|import\.meta\.hot/.test(paid.out), 'the code has no Vite or JSX-transform output');

  // The line that clears the cache ran, and the totals were summed again for the response.
  const id = /Trace (t_[a-z0-9]{12})/.exec(paid.out)?.[1];
  const ledger = await call('get_trace', { traceId: id, file: 'server/services/ledger.ts' });
  const lit = (line) => new RegExp(`^ {0,3}${line} {2}`, 'm').test(ledger.out);
  const clear = lineOf('server/services/ledger.ts', 'summaryCache = null;');
  const sum = lineOf('server/services/ledger.ts', 'summary.outstandingCents += inv.amountCents;');
  check(clear > 0 && lit(clear), `ledger.ts line ${clear} (clears the cache) ran`);
  check(sum > 0 && lit(sum), `ledger.ts line ${sum} (sums the open invoices) ran`);

  const summary = await fetch(API).then((r) => r.json());
  check(
    summary.summary?.outstandingCents === 3_008_550,
    `the API's Outstanding dropped to $30,085.50 (${summary.summary?.outstandingCents})`,
  );

  const draft = await call('run_action', { target: 'button "Mark as paid"', within: 'Fernway Apparel' });
  // The draft row has no button of its own, so nothing is clicked (the match falls back to the table).
  check(
    draft.isError && !draft.out.startsWith('Trace') && draft.out.includes('nothing was clicked'),
    'run_action clicks nothing for the draft row, which has no "Mark as paid" button',
  );
} catch (err) {
  failures.push(String(err?.stack ?? err));
  console.error(err);
} finally {
  await agent.close().catch(() => {});
  check(await portFree(), 'closing the MCP client stopped lightpath dev and the app');
  rmSync(config, { force: true });
  const log = join(app, '.lightpath', 'dev.log');
  if (existsSync(log)) rmSync(log, { force: true });
}

if (failures.length === 0) console.log('\nE2E INVOICES PASSED');
else console.log(`\nE2E INVOICES FAILED (${failures.length})\n${failures.map((f) => `- ${f}`).join('\n')}`);
process.exit(failures.length === 0 ? 0 : 1);
