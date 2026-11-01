// Can another browser MCP drive the Chrome that Lightpath controls, and does the trace survive?
// Lightpath launches Chrome over a pipe (no CDP port), so this prototype adds
// --remote-debugging-port to the launch for this process only, then attaches Chrome DevTools MCP
// (--browserUrl) or Playwright MCP (--cdp-endpoint) to it and clicks Add to cart then Checkout.
//
// The MCP servers are not repo dependencies. Install them in a scratch folder and pass its path:
//   npm install chrome-devtools-mcp @playwright/mcp   (in <scratch>)
//   node bench/prototypes/browser-control/attach-mcp.mjs <devtools|playwright> <scratch> [--n 20] [--port 9334]
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { boundaryOf, cpuLoad, loadGate, repo, signature, sleep, startStack } from './harness.mjs';

const args = process.argv.slice(2);
const which = args[0];
const scratch = args[1];
const n = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 20;
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 9334;
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'browser-raw');
const endpoint = `http://127.0.0.1:${port}`;

const SERVERS = {
  devtools: {
    args: [
      join(scratch, 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'),
      '--browserUrl',
      endpoint,
      // Its usage statistics and CrUX lookups are on by default; nothing leaves this machine here.
      '--no-usage-statistics',
      '--no-performance-crux',
      '--no-page-id-routing',
    ],
    list: { name: 'list_pages', arguments: {} },
    snapshot: { name: 'take_snapshot', arguments: {} },
    // Lines look like: uid=1_7 button "Add to cart"
    refs: (text, label) =>
      [...text.matchAll(new RegExp(`uid=(\\S+) button "${label}"`, 'g'))].map((m) => m[1]),
    click: (ref) => ({ name: 'click', arguments: { uid: ref } }),
  },
  playwright: {
    args: [join(scratch, 'node_modules', '@playwright', 'mcp', 'cli.js'), '--cdp-endpoint', endpoint],
    list: { name: 'browser_tabs', arguments: { action: 'list' } },
    snapshot: { name: 'browser_snapshot', arguments: {} },
    // Lines look like: - button "Add to cart" [ref=e12]
    refs: (text, label) =>
      [...text.matchAll(new RegExp(`button "${label}"[^\\n]*\\[ref=(e\\d+)\\]`, 'g'))].map((m) => m[1]),
    // 0.0.84 takes the snapshot ref as `target` (older releases called it `ref`).
    click: (ref, label) => ({
      name: 'browser_click',
      arguments: { element: `${label} button`, target: ref },
    }),
  },
};
const server = SERVERS[which];
if (!server || !scratch) throw new Error('usage: attach-mcp.mjs <devtools|playwright> <scratch dir>');

mkdirSync(join(outDir, 'runs'), { recursive: true });
const file = join(outDir, 'runs', `mcp-${which}-headless.jsonl`);
writeFileSync(file, '');
const write = (o) => appendFileSync(file, `${JSON.stringify(o)}\n`);
const text = (res) => (res.content ?? []).map((c) => c.text ?? '').join('\n');

const gate = await loadGate(console.log);
const stack = await startStack({ headless: true, launchArgs: [`--remote-debugging-port=${port}`] });
const { traces, seen, logs } = stack;
write({ kind: 'start', method: `mcp-${which}`, n, cpuStart: gate, at: new Date().toISOString() });

const requireMcp = createRequire(join(repo, 'packages', 'mcp', 'package.json'));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const client = new Client({ name: 'browser-control-probe', version: '0.0.0' });
let failures = 0;
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: server.args,
      env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1' },
      stderr: 'pipe',
    }),
  );
  const tools = (await client.listTools()).tools.map((t) => t.name);
  write({ kind: 'tools', tools });
  const pages = text(await client.callTool(server.list));
  write({ kind: 'pages', text: pages });

  async function act(i, action, label, index, needNode) {
    const t0 = performance.now();
    const snap = text(await client.callTool(server.snapshot));
    const snapMs = performance.now() - t0;
    const ref = server.refs(snap, label)[index];
    if (!ref) {
      write({ kind: 'action', i, action, error: `no ref for ${label}`, snapshot: snap.slice(0, 2000) });
      return undefined;
    }
    const before = new Set(traces.keys());
    const t1 = performance.now();
    const res = await client.callTool(server.click(ref, label));
    const callMs = performance.now() - t1;
    let trace;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !trace) {
      trace = [...traces.values()].find((t) => {
        const s = seen.get(t.id);
        return !before.has(t.id) && s?.ended && (!needNode || s.node);
      });
      if (!trace) await sleep(10);
    }
    const s = trace ? seen.get(trace.id) : undefined;
    write({
      kind: 'action',
      i,
      action,
      snapshotMs: Math.round(snapMs * 10) / 10,
      callMs: Math.round(callMs * 10) / 10,
      readyMs: s ? Math.round((Math.max(s.ended, needNode ? s.node : 0) - t1) * 10) / 10 : null,
      isError: res.isError ?? false,
      result: text(res).slice(0, 300),
      newTraces: [...traces.keys()].filter((id) => !before.has(id)).length,
      traceId: trace?.id,
      ...(trace ? boundaryOf(logs, trace.id) : {}),
      ...(trace ? signature(trace) : {}),
    });
    return trace;
  }

  for (let i = 0; i < n; i++) {
    const add = await act(i, 'add', 'Add to cart', 1, false); // second Add to cart: Coffee mug
    const checkout = await act(i, 'checkout', 'Checkout', 0, true);
    if (!add || !checkout) failures++;
    await sleep(300);
  }
} catch (err) {
  write({ kind: 'error', error: String(err?.stack ?? err).slice(0, 2000) });
  failures = -1;
} finally {
  await client.close().catch(() => {});
  write({ kind: 'end', failures, cpuEnd: cpuLoad(), notices: stack.notices, at: new Date().toISOString() });
  writeFileSync(join(outDir, 'runs', `mcp-${which}-headless.log`), logs.map((l) => l.msg).join('\n'));
  await stack.stop();
}
console.log(`mcp-${which}: ${n} iterations, failures ${failures} -> ${file}`);
process.exit(0);
