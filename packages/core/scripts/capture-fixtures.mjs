// Captures real V8 coverage fixtures for the core pipeline tests (docs/ROADMAP.md, M1).
//
// Each sample in test/fixtures/samples runs in its own Node process with an in-process inspector
// session, using the same take, act, take pattern as the agents (ADR 0001): load the module,
// discard the load-time coverage, call its `run()` export, then take the delta for that call.
// The script's source and source map are saved exactly as V8 reports them, with machine-specific
// paths replaced by file:///repo/... so the fixtures are identical on every machine.
//
// Usage (Node 22.18+ so type stripping is on by default):
//   node packages/core/scripts/capture-fixtures.mjs          capture every Node sample
//   node packages/core/scripts/capture-fixtures.mjs plain-js capture one
//
// Expected lines are NOT written here. They live in test/fixtures.test.ts and were checked by hand,
// so a re-capture that changes behavior fails the test instead of silently updating it.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'test', 'fixtures');
const samples = join(fixtures, 'samples');
const samplesUrl = pathToFileURL(samples).href; // file:///C:/.../samples
const PORTABLE = 'file:///repo/samples';
/** Replacements that turn this machine's sample paths into file:///repo/samples. */
const SAMPLE_SWAPS = [
  [samplesUrl, PORTABLE],
  // tsx on Windows writes map sources as C:\...\samples\x.ts.
  [`${samples}\\`, `${PORTABLE}/`],
  [`${samples.replaceAll('\\', '/')}/`, `${PORTABLE}/`],
];

/** name → how Node loads it. */
const NODE_SAMPLES = {
  'plain-js': { file: 'plain-js.mjs', loader: 'none', note: 'Plain JavaScript run as-is.' },
  'ts-strip': {
    file: 'ts-strip.ts',
    loader: 'strip-types',
    note: "TypeScript run with Node's type stripping.",
  },
  'tsx-transform': {
    file: 'tsx-transform.ts',
    loader: 'tsx',
    note: 'TypeScript with an enum and parameter properties, compiled by tsx (esbuild) with an inline map.',
  },
  'non-ascii': {
    file: 'non-ascii.mjs',
    loader: 'none',
    note: 'Emoji, Japanese, and Nepali text in and before code.',
  },
};

if (process.argv[2] === '--child') {
  await child(process.argv[3]);
} else {
  const only = process.argv.slice(2);
  for (const [name, spec] of Object.entries(NODE_SAMPLES)) {
    if (only.length > 0 && !only.includes(name)) continue;
    captureNode(name, spec);
  }
  if (only.length === 0 || only.includes('vite-jsx')) await captureViteJsx();
}

/**
 * The Vite fixture: runs examples/shop (API + Vite) without Lightpath, opens it in Chrome, adds an
 * item, and takes coverage around one Checkout click. Saves Cart.tsx exactly as Vite served it,
 * with its inline source map. Uses playwright-core from the browser package, so core gains no
 * dependency for this.
 */
async function captureViteJsx() {
  const repo = join(here, '..', '..', '..');
  const shop = join(repo, 'examples', 'shop');
  const { chromium } = createRequire(join(repo, 'packages', 'browser', 'package.json'))('playwright-core');
  const origin = 'http://localhost:5173';

  const server = spawn(process.execPath, ['dev.mjs'], { cwd: shop, stdio: 'ignore' });
  let browser;
  try {
    await waitForHttp(`${origin}/`, 30_000);
    browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch());
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    const scripts = new Map();
    cdp.on('Debugger.scriptParsed', (s) => scripts.set(s.scriptId, s));
    await cdp.send('Debugger.enable');
    await cdp.send('Debugger.setSkipAllPauses', { skip: true });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

    await page.goto(origin);
    await page.click('li:has-text("Desk lamp") button');
    await page.waitForSelector('text=/Subtotal/');
    await new Promise((r) => setTimeout(r, 300));
    await cdp.send('Profiler.takePreciseCoverage'); // discard: page load and "Add to cart"

    await page.click('button:has-text("Checkout")');
    await page.waitForSelector('text=/Order #\\d+ placed/');
    await new Promise((r) => setTimeout(r, 300)); // let React finish the last render
    const { result } = await cdp.send('Profiler.takePreciseCoverage');

    const script = result.find((s) => new URL(s.url).pathname === '/src/Cart.tsx');
    if (!script) throw new Error(`no Cart.tsx coverage; saw ${result.map((s) => s.url).join(', ')}`);
    const info = scripts.get(script.scriptId);
    const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId });
    const raw = {
      url: script.url,
      functions: script.functions,
      source: scriptSource,
      sourceMapURL: info?.sourceMapURL,
    };
    const shopSrc = pathToFileURL(join(shop, 'src')).href;
    const fixture = {
      name: 'vite-jsx',
      note: 'examples/shop/src/Cart.tsx as served by Vite (React JSX transform), one Checkout click in Chrome.',
      capturedWith: { browser: browser.version(), loader: 'vite' },
      sampleSha256: createHash('sha256')
        .update(readFileSync(join(shop, 'src', 'Cart.tsx'), 'utf8'))
        .digest('hex'),
      ...portable(raw, [
        [`${origin}/src/`, 'http://localhost:5173/src/'],
        [`${shopSrc}/`, 'file:///repo/shop/src/'],
        [`${join(shop, 'src')}\\`, 'file:///repo/shop/src/'],
        [`${join(shop, 'src').replaceAll('\\', '/')}/`, '/repo/shop/src/'],
      ]),
    };
    fixture.coverage.url = fixture.coverage.url.split('?')[0]; // drop Vite's ?t= cache buster
    // Vite's React transform writes the absolute path into the code (`_jsxFileName`). Replace it with
    // a placeholder of exactly the same length, so no coverage offset or map column moves.
    fixture.source = redactSameLength(fixture.source, shop.replaceAll('\\', '/'));
    fixture.source = redactSameLength(fixture.source, shop);
    if (fixture.source.includes(shop.replaceAll('\\', '/'))) throw new Error('machine path left in source');
    writeFileSync(join(fixtures, 'vite-jsx.json'), `${JSON.stringify(fixture, null, 2)}\n`);
    const fns = fixture.coverage.functions.length;
    console.log(
      `vite-jsx: ${fns} functions, ${fixture.source.length} chars, sources: ${fixture.sourceMap?.sources}`,
    );
  } finally {
    await browser?.close();
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else server.kill('SIGTERM');
  }
}

/** `C:/a/b/shop` → `/repo_____/shop`: same length, so every later offset stays valid. */
function redactSameLength(text, path) {
  const head = '/repo';
  const tail = '/shop';
  if (path.length < head.length + tail.length) throw new Error(`path too short to redact: ${path}`);
  return text.replaceAll(path, head + '_'.repeat(path.length - head.length - tail.length) + tail);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not start within ${timeoutMs} ms`);
}

function captureNode(name, spec) {
  const args = [];
  if (spec.loader === 'tsx') args.push('--import', 'tsx');
  args.push(fileURLToPath(import.meta.url), '--child', join(samples, spec.file));
  const res = spawnSync(process.execPath, args, { cwd: join(here, '..'), encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${name}: capture failed\n${res.stderr}`);
  const raw = JSON.parse(res.stdout);
  const sample = readFileSync(join(samples, spec.file), 'utf8');

  const fixture = {
    name,
    note: spec.note,
    capturedWith: { node: process.version, loader: spec.loader },
    // Lets the test notice a sample edited without re-capturing its fixture.
    sampleSha256: createHash('sha256').update(sample).digest('hex'),
    ...portable(raw),
  };
  const out = join(fixtures, `${name}.json`);
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  const fns = fixture.coverage.functions.length;
  console.log(
    `${name}: ${fns} functions, ${fixture.source.length} chars, map: ${Boolean(fixture.sourceMap)}`,
  );
}

/**
 * Makes a capture machine-independent: applies `swaps` to the script URL and the map's sources,
 * and drops the inline map comment. The executed source is otherwise kept byte for byte, because
 * every coverage offset and map column points into it.
 */
function portable(raw, swaps = SAMPLE_SWAPS) {
  const swap = (s) => swaps.reduce((acc, [from, to]) => acc.replaceAll(from, to), s);
  let source = raw.source;
  let sourceMap;
  if (raw.sourceMapURL) {
    if (!raw.sourceMapURL.startsWith('data:')) throw new Error(`external source map: ${raw.sourceMapURL}`);
    const comma = raw.sourceMapURL.indexOf(',');
    const body = raw.sourceMapURL.slice(comma + 1);
    const json = raw.sourceMapURL.slice(0, comma).endsWith(';base64')
      ? Buffer.from(body, 'base64').toString('utf8')
      : decodeURIComponent(body);
    sourceMap = JSON.parse(json);
    sourceMap.sources = sourceMap.sources.map(swap);
    if (sourceMap.sourceRoot) sourceMap.sourceRoot = swap(sourceMap.sourceRoot);
    // The trailing //# sourceMappingURL comment embeds this machine's paths. Cutting it only
    // shortens the end of the file; no coverage range of real code starts there.
    const at = source.lastIndexOf('//# sourceMappingURL=');
    if (at >= 0) source = source.slice(0, at);
  }
  const functions = raw.functions.map((fn) => ({
    ...fn,
    ranges: fn.ranges.map((r) => ({
      ...r,
      startOffset: Math.min(r.startOffset, source.length),
      endOffset: Math.min(r.endOffset, source.length),
    })),
  }));
  return {
    coverage: { scriptId: '1', url: swap(raw.url), functions },
    source,
    ...(sourceMap ? { sourceMap } : {}),
  };
}

/** Runs inside the child process: take, import + run, take, and print the sample's delta. */
async function child(file) {
  const inspector = await import('node:inspector');
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) => {
    let result;
    let error;
    session.post(method, params, (err, res) => {
      error = err;
      result = res;
    });
    if (error) throw error;
    return result;
  };
  const scripts = new Map();
  session.on('Debugger.scriptParsed', ({ params }) => scripts.set(params.scriptId, params));
  post('Debugger.enable');
  post('Profiler.enable');
  post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

  const url = pathToFileURL(file).href;
  const mod = await import(url);
  post('Profiler.takePreciseCoverage'); // discard: module load
  await mod.run();
  const { result } = post('Profiler.takePreciseCoverage');

  // tsx may add a query string to the URL, so match on the path.
  const script = result.find((s) => s.url.split('?')[0] === url);
  if (!script) throw new Error(`no coverage for ${url}; saw ${result.map((s) => s.url).join(', ')}`);
  const info = scripts.get(script.scriptId);
  const { scriptSource } = post('Debugger.getScriptSource', { scriptId: script.scriptId });
  process.stdout.write(
    JSON.stringify({
      url: script.url,
      functions: script.functions,
      source: scriptSource,
      sourceMapURL: info?.sourceMapURL ?? '',
    }),
  );
}
