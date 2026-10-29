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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'test', 'fixtures');
const samples = join(fixtures, 'samples');
const samplesUrl = pathToFileURL(samples).href; // file:///C:/.../samples
const PORTABLE = 'file:///repo/samples';

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

/** Replaces this machine's paths with file:///repo/samples and drops the inline map comment. */
function portable(raw) {
  // tsx on Windows writes map sources as C:\...\samples\x.ts; replace that form too. The portable
  // form uses file:// so the fixture behaves the same on every OS.
  const swap = (s) =>
    s
      .replaceAll(samplesUrl, PORTABLE)
      .replaceAll(`${samples}\\`, `${PORTABLE}/`)
      .replaceAll(`${samples.replaceAll('\\', '/')}/`, `${PORTABLE}/`);
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
