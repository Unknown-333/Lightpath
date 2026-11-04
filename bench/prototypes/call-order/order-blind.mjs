// Can V8 precise coverage tell call order? Runs the same three functions in two different orders,
// each between two coverage reads, and compares what the two reads return.
// Usage: node bench/prototypes/call-order/order-blind.mjs

import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = join(tmpdir(), `lp-order-blind-${process.pid}.mjs`);
writeFileSync(
  file,
  [
    'export function a(x) { if (x > 0) { return x + 1; } return 0; }',
    'export function b(x) { return a(x) * 2; }',
    'export function c(x) { for (let i = 0; i < 3; i++) x += i; return x; }',
    '',
  ].join('\n'),
);

const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
const mod = await import(pathToFileURL(file).href);
const take = async () => {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  return result.filter((s) => s.url.endsWith('.mjs') && s.url.includes('lp-order-blind'));
};
await take(); // drop module evaluation

mod.a(1);
mod.b(2);
mod.c(3);
const order1 = await take();

mod.c(3);
mod.b(2);
mod.a(1);
const order2 = await take();

const strip = (cov) => cov.map((s) => ({ url: s.url, functions: s.functions }));
const j1 = JSON.stringify(strip(order1));
const j2 = JSON.stringify(strip(order2));
console.log('order 1: a(1), b(2), c(3)');
console.log('order 2: c(3), b(2), a(1)');
for (const f of order1[0].functions) {
  console.log(`  ${f.functionName || '(module)'}: ranges ${JSON.stringify(f.ranges)}`);
}
console.log(`identical coverage for both orders: ${j1 === j2}`);
console.log(`coverage bytes per read: ${j1.length}`);
console.log(
  'fields per function in a read: ' +
    Object.keys(order1[0].functions[0]).join(', ') +
    '; per range: ' +
    Object.keys(order1[0].functions[0].ranges[0]).join(', '),
);
await session.post('Profiler.stopPreciseCoverage');
session.disconnect();
