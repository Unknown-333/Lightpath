// Runs inside VS Code's extension host, started by test/editor/run.mjs. CommonJS and plain JS so it
// loads in every supported VS Code without a build step.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');

/** Polls `check` until it returns something truthy; the error says what never happened. */
async function until(what, check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Same rule as heatBucket in packages/core/src/ids.ts (log2 buckets, 8 levels). */
const bucket = (count) => (count <= 1 ? 0 : Math.min(7, Math.floor(Math.log2(count))));

const describe = (map) =>
  map
    ? [...map]
        .sort((a, b) => a[0] - b[0])
        .map(([l, b]) => `${l}:${b}`)
        .join(' ')
    : '(nothing drawn)';

exports.run = async () => {
  const shop = process.env.LIGHTPATH_TEST_SHOP;
  const ext = vscode.extensions.getExtension('lightpath-dev.lightpath-vscode');
  assert.ok(ext, 'the extension is loaded');

  // Not calling ext.activate(): the workspaceContains activation event has to do it by itself.
  await until('the extension to activate on .lightpath/daemon.json', () => ext.isActive);
  const api = ext.exports;
  await until('the extension to connect to the daemon', () => api.isConnected());
  console.log('[lightpath test] activated and connected');

  const cart = join(shop, 'src', 'Cart.tsx');
  const orders = join(shop, 'server', 'routes', 'orders.ts');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(cart), {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(orders), {
    viewColumn: vscode.ViewColumn.Two,
    preview: false,
  });
  // Keep highlights from fading while we read them (also exercises a command).
  await vscode.commands.executeCommand('lightpath.togglePin');

  const res = await fetch(`${process.env.LIGHTPATH_TEST_CONTROL}/click`, { method: 'POST' });
  if (!res.ok) throw new Error(`the click failed: ${await res.text()}`);
  const trace = await res.json();
  console.log(`[lightpath test] clicked Checkout: trace ${trace.id} with ${trace.files.length} files`);

  // Every line of the trace is drawn, in the right heat bucket, and nothing else is.
  for (const [fsPath, rel] of [
    [cart, 'src/Cart.tsx'],
    [orders, 'server/routes/orders.ts'],
  ]) {
    const file = trace.files.find((f) => f.path === rel);
    assert.ok(file, `the trace includes ${rel}`);
    const expected = new Map(file.lines.map((h) => [h.line, bucket(h.count)]));
    try {
      await until(`${rel} to light up`, () => describe(api.drawnLines(fsPath)) === describe(expected));
    } catch (err) {
      throw new Error(
        `${err.message}\n  expected ${describe(expected)}\n  drawn    ${describe(api.drawnLines(fsPath))}`,
      );
    }
    console.log(`[lightpath test] ${rel}: ${expected.size} lines lit, matching the trace`);
  }

  // The same two lines the golden e2e checks, now as the user would see them.
  const lineOf = (path, text) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .findIndex((l) => l.includes(text)) + 1;
  const okLine = lineOf(cart, 'placed:');
  assert.ok(api.drawnLines(cart).has(okLine), `Cart.tsx line ${okLine} (success message) is lit`);
  const emptyLine = lineOf(orders, "'Your cart is empty.'");
  assert.ok(emptyLine > 0 && !api.drawnLines(orders).has(emptyLine), `orders.ts line ${emptyLine} is dark`);
  assert.equal(api.traceIds()[0], trace.id, 'the Actions view lists the Checkout trace first');

  await vscode.commands.executeCommand('lightpath.clear');
  await until(
    'Clear Highlights to remove every highlight',
    () => !api.drawnLines(cart) && !api.drawnLines(orders),
  );
  console.log('[lightpath test] Clear Highlights removed them');

  // Replay walks the trace's files in the order the collectors saw them and lights each one.
  // The command resolves when the walk ends, so the last file is the one left in front.
  const order = [...trace.files].sort(
    (a, b) => a.firstSeenAt - b.firstSeenAt || a.path.localeCompare(b.path),
  );
  const opened = [];
  const watch = vscode.window.onDidChangeActiveTextEditor((e) => {
    if (e) opened.push(e.document.uri.fsPath);
  });
  await vscode.commands.executeCommand('lightpath.replay');
  watch.dispose();
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
  const want = order.map((f) => norm(join(shop, f.path)));
  const seen = opened.map(norm).filter((p, i, all) => want.includes(p) && p !== all[i - 1]);
  assert.deepEqual(seen, want, 'replay opens every file of the trace, in order');
  const last = order.at(-1);
  const lastPath = join(shop, last.path);
  assert.equal(
    describe(api.drawnLines(lastPath)),
    describe(new Map(last.lines.map((h) => [h.line, bucket(h.count)]))),
    `replay lights ${last.path}`,
  );
  console.log(`[lightpath test] Replay walked ${order.length} files in order`);
};
