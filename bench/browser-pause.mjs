// Benchmark: how long does Lightpath pause the page on each click? (docs/ROADMAP.md, M3)
//
// The page is paused at every action boundary while the collector reads coverage (ADR 0003).
// Chrome drops the mouse release if it arrives during the pause, so the pause must stay well under
// a human press (50 to 150 ms); the budget is 20 ms p99.
//
// Generates React apps with N components (each with a state hook, a handler, and two helpers,
// all rendered so V8 compiles them), serves them with the shop's Vite and React, and presses a
// button 40 times through the real BrowserCollector. The pause comes from the collector's log.
//
// Usage: pnpm build && node bench/browser-pause.mjs [--sizes 100,1000,3000] [--clicks 40]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const shop = join(repo, 'examples', 'shop');
const { BrowserCollector } = await import(new URL('../packages/browser/dist/index.js', import.meta.url).href);
const requireShop = createRequire(join(shop, 'package.json'));
// import() needs file:// URLs on Windows; a raw C:\ path fails.
const { createServer } = await import(pathToFileURL(requireShop.resolve('vite')).href);
const react = (await import(pathToFileURL(requireShop.resolve('@vitejs/plugin-react')).href)).default;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SIZES = arg('sizes', '100,1000,3000').split(',').map(Number);
const CLICKS = Number(arg('clicks', '40'));
const PER_FILE = 50;

/** Writes a React app with `count` components under examples/shop/.bench-app (gitignored). */
function generate(count) {
  const dir = join(shop, '.bench-app');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  const files = Math.ceil(count / PER_FILE);
  for (let f = 0; f < files; f++) {
    const comps = [];
    for (let c = 0; c < PER_FILE && f * PER_FILE + c < count; c++) {
      const n = f * PER_FILE + c;
      comps.push(`function fmt${n}(v: number) {
  return v > 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
}
function next${n}(v: number) {
  return v % 2 === 0 ? v + ${n} : v * 2;
}
export function C${n}() {
  const [v, setV] = useState(${n});
  const onClick = () => setV(next${n}(v));
  return <span onClick={onClick}>{fmt${n}(v)} </span>;
}`);
    }
    const names = comps.map((_, c) => `C${f * PER_FILE + c}`);
    writeFileSync(
      join(dir, 'src', `part${f}.tsx`),
      `import { useState } from 'react';\n${comps.join('\n')}\nexport const all = [${names.join(', ')}];\n`,
    );
  }
  const imports = Array.from({ length: files }, (_, f) => `import { all as p${f} } from './part${f}.tsx';`);
  writeFileSync(
    join(dir, 'src', 'main.tsx'),
    `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
${imports.join('\n')}
const parts = [${Array.from({ length: files }, (_, f) => `...p${f}`).join(', ')}];
function App() {
  const [clicks, setClicks] = useState(0);
  return (
    <main>
      <button id="go" onClick={() => setClicks(clicks + 1)}>Clicked {clicks}</button>
      <div>{parts.map((C, i) => <C key={i} />)}</div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
`,
  );
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  );
  return dir;
}

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
};

const rows = [];
for (const size of SIZES) {
  const root = generate(size);
  const server = await createServer({
    root,
    configFile: false,
    plugins: [react()],
    logLevel: 'silent',
    server: { port: 5199, strictPort: true },
  });
  await server.listen();
  const logs = [];
  let functions = 0;
  const collector = new BrowserCollector({
    url: 'http://localhost:5199',
    headless: true,
    settleMs: 100,
    send: (m) => {
      if (m.type === 'delta' && m.phase === 'background' && functions === 0)
        functions = m.coverage.reduce((n, s) => n + s.functions.length, 0);
    },
    log: (m) => logs.push(m),
  });
  try {
    await collector.start();
    const page = collector.page;
    await page.waitForSelector('#go', { timeout: 60_000 });
    const box = await page.locator('#go').boundingBox();
    for (let i = 0; i < CLICKS; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await new Promise((r) => setTimeout(r, 80));
      await page.mouse.up();
      await page.waitForSelector(`#go:has-text("Clicked ${i + 1}")`, { timeout: 10_000 });
      await new Promise((r) => setTimeout(r, 150)); // let the trace settle before the next click
    }
  } finally {
    await collector.stop();
    await server.close();
  }
  const pauses = logs.flatMap((l) => {
    const m = /paused ([\d.]+)ms/.exec(l);
    return m ? [Number(m[1])] : [];
  });
  // The first click's read includes everything since page load; report it separately.
  const steady = pauses.slice(1);
  const boundary = logs.some((l) => l.includes('boundary release')) ? 'release' : 'press';
  rows.push({
    size,
    functions,
    boundary,
    first: pauses[0],
    p50: pct(steady, 50),
    p99: pct(steady, 99),
    max: Math.max(...steady),
    n: pauses.length,
  });
  console.error(`size ${size}: ${pauses.length} clicks measured`);
}
rmSync(join(shop, '.bench-app'), { recursive: true, force: true });

console.log(`\n${CLICKS} clicks per app, headless Chrome, press held 80 ms\n`);
console.log(
  '| Components | Functions in first read | Boundary | First pause | Pause p50 | Pause p99 | Pause max |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    `| ${r.size} | ${r.functions} | ${r.boundary} | ${r.first?.toFixed(1)} ms | ${r.p50.toFixed(1)} ms | ${r.p99.toFixed(1)} ms | ${r.max.toFixed(1)} ms |`,
  );
}
