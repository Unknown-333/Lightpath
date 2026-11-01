// Makes the ground-truth copy of the example shop: every app function logs its own key when it is
// called, so the real call order on both sides can be compared with what each technique reports.
//
// The log calls are inserted on the function's own first line, so every line number stays the same
// as in examples/shop. A key is "<file>:<line of the function start>".
//
// Output: examples/.bench-app/shop-gt (gitignored). node_modules is a junction to examples/shop's.
// Usage: node bench/prototypes/call-order/make-gt.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const shop = join(repo, 'examples', 'shop');
export const gtRoot = join(repo, 'examples', '.bench-app', 'shop-gt');

const L = (key) => `__lp('${key}')`;
/** [file, line, find, replace]: `find` must occur exactly once on that line. */
const edits = [];
const block = (file, line, find) => edits.push([file, line, find, `${find}${L(`${file}:${line}`)};`]);
const expr = (file, line, find) => edits.push([file, line, find, `${find}${L(`${file}:${line}`)}, `]);
const wrap = (file, line, find, body) =>
  edits.push([file, line, `${find}${body}`, `${find}(${L(`${file}:${line}`)}, ${body})`]);

block('src/App.tsx', 6, 'export function App() {');
block('src/App.tsx', 10, 'useEffect(() => {');
block('src/App.tsx', 14, 'function addToCart(product: Product) {');
block('src/App.tsx', 15, 'setCart((lines) => {');
wrap('src/App.tsx', 16, 'lines.find((l) => ', 'l.productId === product.id');
expr('src/App.tsx', 18, 'lines.map((l) => (');
expr('src/App.tsx', 29, 'products.map((p) => (');
wrap('src/App.tsx', 34, 'onClick={() => ', 'addToCart(p)');
wrap('src/App.tsx', 40, 'onCheckedOut={() => ', 'setCart([])');
block('src/Cart.tsx', 11, 'export function Cart({ lines, products, onCheckedOut }: CartProps) {');
block('src/Cart.tsx', 16, 'lines.reduce((sum, line) => {');
wrap('src/Cart.tsx', 17, 'products.find((p) => ', 'p.id === line.productId');
block('src/Cart.tsx', 21, 'async function checkout() {');
wrap('src/Cart.tsx', 42, 'onChange={(e) => ', 'setCoupon(e.target.value)');
block('src/api.ts', 20, 'export async function fetchProducts(): Promise<Product[]> {');
block(
  'src/api.ts',
  25,
  'export async function placeOrder(lines: CartLine[], coupon?: string): Promise<OrderResult> {',
);
block('src/money.ts', 3, 'export function formatCents(cents: number): string {');
block('server/routes/orders.ts', 11, 'export function createOrder(req: Request, res: Response): void {');
block('server/routes/products.ts', 4, 'export function listProducts(_req: Request, res: Response): void {');
block('server/services/pricing.ts', 12, 'coupon?: string): Quote {');
block('server/services/payment.ts', 6, 'export function charge(totalCents: number): PaymentResult {');
block('server/db.ts', 22, 'export function allProducts(): Product[] {');
block('server/db.ts', 26, 'export function findProduct(id: string): Product | undefined {');
wrap('server/db.ts', 27, 'products.find((p) => ', 'p.id === id');
block('server/db.ts', 30, "export function saveOrder(order: Omit<Order, 'id'>): Order {");

/** Every function the ground truth can see. */
export const gtKeys = edits.map(([f, l]) => `${f}:${l}`);

const BROWSER_LOG = `// Ground-truth call log (bench/prototypes/call-order). Not part of the shop.
const g = globalThis as unknown as { __lpOrder: [string, number][]; __lp: (k: string) => void };
g.__lpOrder = [];
g.__lp = (k) => {
  g.__lpOrder.push([k, performance.timeOrigin + performance.now()]);
};
`;

// The server log also runs technique (c) on the Node side when LP_NODE_PROFILE is set: a sampling
// CPU profile per request, started and stopped on the same diagnostics channels the agent uses.
const SERVER_LOG = `// Ground-truth call log (bench/prototypes/call-order). Not part of the shop.
import { subscribe } from 'node:diagnostics_channel';
import { Session } from 'node:inspector';

const g = globalThis as unknown as { __lpOrder: [string, number][]; __lp: (k: string) => void };
g.__lpOrder = [];
g.__lp = (k) => {
  g.__lpOrder.push([k, performance.timeOrigin + performance.now()]);
  // Technique (d): what a stack captured at the route handler shows, and what it costs.
  if (k === 'server/routes/orders.ts:11') {
    const t0 = performance.now();
    const stack = new Error().stack ?? '';
    const ms = performance.now() - t0;
    const frames = stack.split('\\n').slice(1);
    const app = frames.filter((f) => f.includes('/shop-gt/') && !f.includes('node_modules') && !f.includes('lp-log'));
    stacks.push({ ms, frames: frames.length, appFrames: app.map((f) => f.trim()) });
  }
};

export const stacks: unknown[] = [];
export const profiles: unknown[] = [];
const interval = Number(process.env.LP_NODE_PROFILE ?? 0);
if (interval > 0) {
  const session = new Session();
  session.connect();
  session.post('Profiler.enable');
  session.post('Profiler.setSamplingInterval', { interval });
  let started = 0;
  subscribe('http.server.request.start', (m) => {
    const url = (m as { request: { url?: string } }).request.url ?? '';
    if (url.startsWith('/__lp')) return;
    started = performance.now();
    session.post('Profiler.start');
  });
  subscribe('http.server.response.finish', (m) => {
    const url = (m as { request: { url?: string } }).request.url ?? '';
    if (url.startsWith('/__lp')) return;
    const t0 = performance.now();
    session.post('Profiler.stop', (err, r) => {
      if (!err) profiles.push({ profile: r.profile, startMs: started, stopMs: performance.now() - t0 });
    });
  });
}
`;

export function makeGt() {
  rmSync(gtRoot, { recursive: true, force: true });
  mkdirSync(gtRoot, { recursive: true });
  for (const p of [
    'src',
    'server',
    'dev.mjs',
    'index.html',
    'package.json',
    'vite.config.ts',
    'tsconfig.json',
  ]) {
    cpSync(join(shop, p), join(gtRoot, p), { recursive: true });
  }
  // One level deeper than examples/shop.
  const tsconfig = join(gtRoot, 'tsconfig.json');
  writeFileSync(
    tsconfig,
    readFileSync(tsconfig, 'utf8').replace('"../../tsconfig.base.json"', '"../../../tsconfig.base.json"'),
  );
  if (!existsSync(join(gtRoot, 'node_modules')))
    symlinkSync(join(shop, 'node_modules'), join(gtRoot, 'node_modules'), 'junction');

  const files = new Map();
  const read = (f) => files.get(f) ?? readFileSync(join(gtRoot, f), 'utf8').split('\n');
  for (const [file, line, find, replace] of edits) {
    const lines = read(file);
    const text = lines[line - 1];
    if (text === undefined || text.split(find).length !== 2)
      throw new Error(`${file}:${line}: "${find}" not found once`);
    lines[line - 1] = text.replace(find, replace);
    files.set(file, lines);
  }
  for (const [file, lines] of files) writeFileSync(join(gtRoot, file), lines.join('\n'));

  writeFileSync(join(gtRoot, 'src', 'lp-log.ts'), BROWSER_LOG);
  writeFileSync(join(gtRoot, 'server', 'lp-log.ts'), SERVER_LOG);
  const main = join(gtRoot, 'src', 'main.tsx');
  // Same line count as before: the import shares line 1.
  writeFileSync(main, `import './lp-log.ts'; ${readFileSync(main, 'utf8')}`);
  const index = join(gtRoot, 'server', 'index.ts');
  let server = readFileSync(index, 'utf8');
  server = `import { profiles, stacks } from './lp-log.ts'; ${server}`;
  server = server.replace(
    "app.post('/api/orders', createOrder);",
    "app.post('/api/orders', createOrder); app.get('/__lp', (_q, r) => { const g = globalThis as any; r.json({ order: g.__lpOrder.splice(0), profiles: profiles.splice(0), stacks: stacks.splice(0) }); });",
  );
  writeFileSync(index, server);
  // Enough mugs for every timed run (the shop has 20); same code path.
  const db = join(gtRoot, 'server', 'db.ts');
  writeFileSync(
    db,
    readFileSync(db, 'utf8').replace('priceCents: 1200, stock: 20 }', 'priceCents: 1200, stock: 100000 }'),
  );
  return gtRoot;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`ground-truth shop at ${makeGt()} (${gtKeys.length} functions logged)`);
}
