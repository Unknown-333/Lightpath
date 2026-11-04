// The Node half of the audit (README sections 2 and 3): the fixture app under Lightpath's real Node
// agent and daemon, each scenario sent with run_request through `lightpath mcp`, in each variant;
// then the same requests under NODE_V8_COVERAGE with no Lightpath.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareScenario, limitLine } from './compare.mjs';
import {
  accuracyDir,
  core,
  daemonPkg,
  mcpClient,
  node,
  registerUrl,
  startProcess,
  traceIdOf,
  until,
} from './util.mjs';

export const nodeRoot = join(accuracyDir, 'fixtures', 'node');
const tscBin = (() => {
  const pkgPath = createRequire(join(accuracyDir, '..', '..', 'package.json')).resolve(
    'typescript/package.json',
  );
  const { bin } = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return join(dirname(pkgPath), typeof bin === 'string' ? bin : bin.tsc);
})();
const [major, minor] = process.versions.node.split('.').map(Number);
const strip = major === 22 && minor < 18 ? ['--experimental-strip-types', '--no-warnings'] : [];

export const NODE_VARIANTS = {
  strip: { args: [...strip, 'server.ts'] },
  // Resolved from the fixture folder, like `tsx server.ts` does in its child process.
  tsx: { args: ['--import', 'tsx', 'server.ts'] },
  tsc: { build: true, args: ['dist/server.js'] },
};

function buildTsc(removeMap) {
  rmSync(join(nodeRoot, 'dist'), { recursive: true, force: true });
  execFileSync(node, [tscBin, '-p', 'tsconfig.json'], { cwd: nodeRoot, stdio: 'inherit' });
  if (removeMap) rmSync(join(nodeRoot, removeMap));
}

/** Scenarios this variant can check against the marks; the rest are checked another way. */
function expectationFor(variant, scenario) {
  if (variant === 'tsc-no-map' && scenario.files.has('src/branches.ts')) return 'unmapped';
  return 'marks';
}

/** Runs every Node scenario in one variant; returns `{ results, traces }`. */
export async function runNodeVariant(variant, scenarios, log) {
  const v = NODE_VARIANTS[variant];
  if (v.build) buildTsc(v.removeMap);
  const store = new daemonPkg.MemoryStore();
  const daemon = await daemonPkg.startDaemon({ workspaceRoots: [nodeRoot], store });
  let app;
  let mcp;
  const results = [];
  const traces = {};
  try {
    app = await startProcess(node, ['--import', registerUrl, ...v.args], {
      cwd: nodeRoot,
      env: {
        LIGHTPATH_URL: daemon.url,
        LIGHTPATH_TOKEN: daemon.token,
        LIGHTPATH_ROOTS: nodeRoot,
        ACCURACY_PORT: '0',
      },
      ready: /listening on port (\d+)/,
      name: `node ${variant}`,
    });
    const base = `http://127.0.0.1:${app.match[1]}`;
    mcp = await mcpClient(nodeRoot);
    const list = [...scenarios.values()].filter(
      (s) => !s.click && !s.id.startsWith('overlap') && s.id !== 'websocket',
    );
    for (const s of list) {
      const answer = await mcp.call('run_request', { method: 'GET', url: `${base}/s/${s.id}` });
      const trace = store.get(traceIdOf(answer) ?? '');
      if (!trace) {
        results.push({
          variant,
          scenario: s.id,
          mismatches: [
            {
              scenario: s.id,
              kind: 'no-trace',
              expected: 'a trace',
              got: answer.slice(0, 200),
              path: '',
              line: 0,
              text: '',
            },
          ],
          answer,
        });
        continue;
      }
      traces[s.id] = trace;
      results.push(check(variant, s, scenarios, trace, answer));
    }
    // Overlap (a limit) was dropped from this round (credit freeze, 2026-11-04); its fixture stays.
    if (process.env.ACCURACY_LIMITS === '1') {
      // Overlap: both requests at once. Each answer must state the limit.
      const [a, b] = await Promise.all([
        mcp.call('run_request', { method: 'GET', url: `${base}/s/overlap-a` }),
        mcp.call('run_request', { method: 'GET', url: `${base}/s/overlap-b` }),
      ]);
      for (const [id, answer] of [
        ['overlap-a', a],
        ['overlap-b', b],
      ]) {
        const trace = store.get(traceIdOf(answer) ?? '');
        const s = scenarios.get(id);
        if (!trace) {
          results.push({
            variant,
            scenario: id,
            mismatches: [
              {
                scenario: id,
                kind: 'no-trace',
                expected: 'a trace',
                got: answer.slice(0, 200),
                path: '',
                line: 0,
                text: '',
              },
            ],
            answer,
          });
          continue;
        }
        traces[id] = trace;
        results.push(check(variant, s, scenarios, trace, answer));
      }
    }
  } finally {
    await mcp?.close().catch(() => {});
    await app?.stop();
    await daemon.close();
  }
  log(`node ${variant}: ${results.length} scenarios`);
  return { results, traces };

  function check(variantName, s, all, trace, answer) {
    const mode = expectationFor(variantName, s);
    let mismatches;
    if (mode === 'unmapped') {
      mismatches = [];
      const shown = trace.files.some((f) => f.path === 'src/branches.ts');
      if (shown)
        mismatches.push({
          scenario: s.id,
          path: 'src/branches.ts',
          line: 0,
          kind: 'unmapped',
          expected: 'no src/branches.ts lines (no map)',
          got: 'src/branches.ts lines shown',
          text: '',
        });
      if (!answer.includes('[unmapped source]'))
        mismatches.push({
          scenario: s.id,
          path: 'dist/src/branches.js',
          line: 0,
          kind: 'unmapped',
          expected: '[unmapped source] in the answer',
          got:
            answer
              .split('\n')
              .filter((l) => l.includes('branches'))
              .join(' / ') || 'not named',
          text: '',
        });
    } else {
      mismatches = compareScenario(trace, s, all, { sourceOf: sourceLines });
      if (
        variantName.startsWith('tsc') &&
        trace.files.some((f) => f.path.startsWith('dist/') && f.path !== 'dist/src/branches.js')
      )
        mismatches.push({
          scenario: s.id,
          path: 'dist/',
          line: 0,
          kind: 'path',
          expected: 'no dist/ path',
          got: trace.files.map((f) => f.path).join(', '),
          text: '',
        });
    }
    if (s.limit) {
      const stated = limitLine(answer, s.limit);
      for (const m of mismatches) m.stated = Boolean(stated);
      if (!stated)
        mismatches.push({
          scenario: s.id,
          path: '',
          line: 0,
          kind: 'limit',
          expected: `limit (${s.limit}): line`,
          got: 'none',
          text: '',
        });
    }
    return { variant: variantName, scenario: s.id, mismatches, answer, traceId: trace.id };
  }
}

const sources = new Map();
export function sourceLines(path) {
  if (!sources.has(path)) {
    try {
      sources.set(path, readFileSync(join(nodeRoot, path), 'utf8').split(/\r?\n/));
    } catch {
      sources.set(path, undefined);
    }
  }
  return sources.get(path);
}

/**
 * Ground truth (README section 3): the strip app under NODE_V8_COVERAGE, the same requests one at a
 * time, then a normal exit. Returns per-scenario line counts for each fixture file, from V8's own
 * whole-process coverage, counted with the same line rule.
 */
export async function nodeGroundTruth(scenarios) {
  const dir = mkdtempSync(join(tmpdir(), 'lp-accuracy-v8-'));
  const app = await startProcess(node, [...strip, 'server.ts'], {
    cwd: nodeRoot,
    env: { NODE_V8_COVERAGE: dir, ACCURACY_PORT: '0' },
    ready: /listening on port (\d+)/,
    name: 'node (NODE_V8_COVERAGE)',
  });
  const base = `http://127.0.0.1:${app.match[1]}`;
  const ids = [...scenarios.values()].filter((s) => !s.click && s.id !== 'websocket').map((s) => s.id);
  for (const id of ids) await fetch(`${base}/s/${id}`).then((r) => r.text());
  await fetch(`${base}/__exit`)
    .then((r) => r.text())
    .catch(() => {});
  await app.exited;
  const file = await until(
    'the coverage file',
    () => readdirSync(dir).find((f) => f.endsWith('.json')),
    10_000,
  );
  const { result } = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  const counts = new Map();
  for (const script of result) {
    if (!script.url.startsWith('file:')) continue;
    const abs = fileURLToPath(script.url);
    const rel = abs.slice(nodeRoot.length + 1).replace(/\\/g, '/');
    if (!rel.startsWith('src/')) continue;
    const text = readFileSync(abs, 'utf8');
    const source = abs.endsWith('.ts') ? stripTypeScriptTypes(text) : text;
    const mapped = core.mapScript({ coverage: script, source }, { workspaceRoots: [nodeRoot] });
    for (const [path, lines] of mapped.files) counts.set(path, lines);
  }
  return counts;
}
