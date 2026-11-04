// The accuracy audit's Node app: GET /s/<scenario> runs one scenario with fixed arguments.
// Plain node:http, so the trace holds only this file and the scenario's own module.
// Run as TypeScript (type stripping, tsx) or built by tsc. The port comes from ACCURACY_PORT.
import http from 'node:http';
import { doubleAll, loadCart, quote } from './src/async.ts';
import { badge, clamp, displayName, fall, grade, ifElse, ifThen, label, price } from './src/branches.ts';
import { checkQty, lookup, nameOf, parseAge, parseCount } from './src/interrupts.ts';
import { fact, firstNegative, invoice, nonEmpty, shout, sumTo, total } from './src/loops.ts';
import { slowA, slowB } from './src/overlap.ts';

const scenarios: Record<string, () => unknown> = {
  'if-then': () => ifThen(5),
  'if-else': () => ifElse(-5),
  'else-if-chain': () => grade('b'),
  'single-line-if': () => clamp(-5),
  'switch-case': () => price('pear'),
  'switch-fallthrough': () => fall('a'),
  'ternary-multiline': () => label(true),
  'ternary-inline': () => badge(false),
  'logical-multiline': () => displayName(null),
  'for-loop': () => sumTo(3),
  'while-break': () => firstNegative([5, 8, -1, 9]),
  'for-of-continue': () => nonEmpty(['a', '', 'b', '']),
  'loop-zero-times': () => total([]),
  'callback-count': () => shout(['x', 'y', 'z', 'w']),
  'nested-calls': () => invoice([100, 200, 300, 400, 500]),
  recursion: () => fact(4),
  'early-return': () => nameOf(null),
  'throw-catch-finally': () => parseAge(''),
  'try-no-throw': () => parseCount('41'),
  'call-throws': () => checkQty(-1),
  'throw-escapes': () => lookup(''),
  'await-sequence': () => loadCart('7'),
  'await-reject': () => quote('gone'),
  'promise-all': () => doubleAll([1, 2, 3]),
  'overlap-a': () => slowA(),
  'overlap-b': () => slowB(),
};

const server = http.createServer(async (req, res) => {
  const name = (req.url ?? '/').split('?')[0]?.replace(/^\/s\//, '') ?? '';
  const run = scenarios[name];
  if (!run) {
    res.writeHead(404).end('no such scenario');
    return;
  }
  let status = 200;
  let body: unknown;
  try {
    body = await run();
  } catch (err) {
    status = 400;
    body = String((err as Error).message);
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});

const port = Number(process.env.ACCURACY_PORT ?? 0);
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  console.log(`accuracy app listening on port ${typeof address === 'object' && address ? address.port : port}`);
});
