// pnpm accuracy: the trace accuracy audit (README.md). Usage: node run.mjs [node|web|truth ...] [--json <file>]
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readScenarios } from './lib/marks.mjs';
import { NODE_VARIANTS, nodeGroundTruth, nodeRoot, runNodeVariant } from './lib/node.mjs';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const parts = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
const want = (p) => parts.length === 0 || parts.includes(p);
const log = (m) => console.log(m);

const filesIn = (dir, re) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => re.test(f) && !f.includes('node_modules') && !f.startsWith('dist'))
    .map((f) => join(dir, f));

const nodeScenarios = readScenarios(nodeRoot, [...filesIn(join(nodeRoot, 'src'), /\.ts$/), join(nodeRoot, 'socket.mjs')]);
const report = { node: {}, web: {}, truth: {} };

if (want('node')) {
  for (const variant of Object.keys(NODE_VARIANTS)) {
    const { results } = await runNodeVariant(variant, nodeScenarios, log);
    report.node[variant] = results;
  }
}
if (want('truth')) {
  const { compareNodeTruth } = await import('./lib/truth.mjs');
  report.truth.node = await compareNodeTruth(nodeScenarios, await nodeGroundTruth(nodeScenarios), log);
}

let failures = 0;
for (const [side, variants] of Object.entries({ node: report.node, web: report.web })) {
  for (const [variant, results] of Object.entries(variants)) {
    for (const r of results) {
      const open = r.mismatches.filter((m) => !m.stated);
      const stated = r.mismatches.length - open.length;
      failures += open.length;
      const mark = open.length === 0 ? 'PASS' : 'FAIL';
      console.log(`${mark} ${side} ${variant} ${r.scenario}${stated ? ` (${stated} stated limit differences)` : ''}`);
      for (const m of r.mismatches)
        console.log(
          `    ${m.stated ? 'stated' : 'MISMATCH'} ${m.kind} ${m.path}:${m.line} expected ${m.expected}, got ${m.got}${m.text ? `   ${m.text}` : ''}`,
        );
    }
  }
}
if (jsonFile) writeFileSync(jsonFile, JSON.stringify(report, null, 2));
console.log(failures === 0 ? '\nACCURACY PASSED' : `\nACCURACY FAILED (${failures} mismatches)`);
process.exit(failures === 0 ? 0 : 1);
