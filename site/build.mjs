// Builds the landing page into site/dist: `pnpm site:build`.
// Art, the headline's pixel type and the trace are generated from files in this repo
// (brand/src, docs/media/tududi-run), so the page can't drift from them.
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defs, heroSvg, pixelWord, spotSvgs, wordmarkSvg } from './lib/art.mjs';
import { readTrace, traceHtml } from './lib/trace.mjs';

// The one place the site's address lives. Change it here when the site gets its own domain.
export const SITE_URL = 'https://unknown-333.github.io/Lightpath/';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const src = join(here, 'src');
const out = join(here, 'dist');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const AGENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    writes: '.mcp.json',
    status: 'Setup tested in CI. How Claude Code picks and calls tools is from its docs.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    writes: '.cursor/mcp.json',
    status: 'Setup tested in CI. How Cursor picks and calls tools is from its docs.',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    writes: '.vscode/mcp.json',
    status: 'Setup tested in CI. How VS Code picks and calls tools is from its docs.',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    writes: '.kiro/settings/mcp.json',
    status: 'Run end to end with kiro-cli 2.37.0, in the benchmark and the demo.',
  },
];

function tabs() {
  const tablist = AGENTS.map(
    (a, i) =>
      `<button type="button" role="tab" id="tab-${a.id}" aria-controls="panel-${a.id}" aria-selected="${i === 0}"${i === 0 ? '' : ' tabindex="-1"'}>${a.name}</button>`,
  ).join('\n        ');
  const panels = AGENTS.map((a, i) => {
    const cmd = `npx @lightpath-dev/cli init --agent ${a.id}\nnpx @lightpath-dev/cli doctor`;
    return `<div class="panel" role="tabpanel" id="panel-${a.id}" aria-labelledby="tab-${a.id}" tabindex="0"${i === 0 ? '' : ' hidden'}>
        <div class="cmd"><pre><code>${esc(cmd)}</code></pre><button type="button" class="copy" data-copy="${esc(cmd)}">Copy<span class="visually-hidden"> the ${a.name} commands</span></button></div>
        <p><code>init</code> writes <code>${a.writes}</code>, <code>lightpath.config.json</code> and a short block in <code>AGENTS.md</code>. <code>doctor</code> checks what it wrote. Then restart ${a.name}.</p>
        <p class="src">${a.status} <a href="https://github.com/Unknown-333/Lightpath/blob/main/docs/agents/${a.id}.md">${a.name} guide</a>.</p>
      </div>`;
  }).join('\n      ');
  return { tablist, panels };
}

// The FAQ, written once: the page shows it and the FAQPage JSON-LD repeats the same text.
const BENCH =
  'https://github.com/Unknown-333/Lightpath/blob/main/bench/agent-suite/results/2026-11-03-full-benchmark.md';
const FAQ = [
  {
    q: 'Does any of my data leave my machine?',
    a: [
      'Lightpath doesn’t send anything anywhere. Its daemon listens on 127.0.0.1 and needs a token. Secrets in what it returns are replaced with [redacted], and request and response bodies and headers are never collected.',
      'The trace does go to your agent, and your agent sends tool results to its model, as it does with any other tool.',
    ],
  },
  {
    q: 'Which agents does it work with?',
    a: [
      'Claude Code, Cursor, VS Code and Kiro, with one init command each. We ran Kiro (kiro-cli 2.37.0) end to end. For the other three, CI tests the setup on Linux, macOS and Windows, and how they use MCP tools is from their docs.',
    ],
  },
  {
    q: 'What does it cost?',
    a: [
      'Lightpath is free and open source under the MIT licence. Your agent spends tokens reading its answers: each one is at most 16,000 characters, about 4,000 tokens, and the tool list is under 4,000 characters. In our benchmark, runs with Lightpath used more credits than runs without it.',
    ],
  },
  {
    q: 'Which Node version do I need?',
    a: ['Node.js 22.12 or newer, and Chrome or Edge for the browser side.'],
  },
  {
    q: 'Does it make agents fix bugs faster?',
    a: [
      'Not in our benchmark. With Lightpath the agent didn’t fix more bugs, and it used more steps and tokens. On 7 seeded bugs in our example shop it fixed 21 of 21 runs without Lightpath and 20 of 21 with it. On 3 bugs in tududi it fixed 15 of 15 both ways. On 2 held-out tududi bugs it fixed 9 of 10 without and 6 of 10 with.',
      'The shop’s bugs were easy, the tududi sample is small, and all 5 tududi fixes are public, so the model may have seen them. Only Kiro CLI with one model was run.',
      'What Lightpath does is show the agent the exact lines a click ran, without asking you to click.',
    ],
    link: { href: BENCH, text: 'Read the full benchmark' },
  },
  {
    q: 'Can I use it in production?',
    a: ['No. Lightpath is a development tool. It traces clicks in your dev server on your own machine.'],
  },
];

function faqHtml() {
  return FAQ.map(
    (f, i) => `<details class="qa"${i === 4 ? ' id="faster"' : ''}>
      <summary><h3>${esc(f.q)}</h3></summary>
      <div>${f.a.map((p) => `<p>${esc(p)}</p>`).join('')}${f.link ? `<p><a href="${f.link.href}">${esc(f.link.text)}</a></p>` : ''}</div>
    </details>`,
  ).join('\n    ');
}

const jsonApp = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Lightpath MCP',
  alternateName: 'Lightpath',
  description:
    'An open-source MCP server for coding agents. The agent clicks in your running React app and gets back the browser and Node server lines that click ran, from V8 coverage.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Windows, macOS, Linux',
  url: SITE_URL,
  codeRepository: 'https://github.com/Unknown-333/Lightpath',
  license: 'https://opensource.org/licenses/MIT',
  image: `${SITE_URL}og.png`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

const jsonFaq = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a.join(' ') },
  })),
};

// JSON inside <script>: escape "<" so no string can close the tag.
const ld = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

export function build() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'media'), { recursive: true });

  const trace = traceHtml(readTrace(join(repo, 'docs/media/tududi-run/transcript.jsonl')));
  const [s1, s2, s3] = spotSvgs();
  const { tablist, panels } = tabs();
  const h1 = 'See the exact lines one click ran.'
    .split(' ')
    .map((w) => pixelWord(w))
    .join(' ');
  const gif = readFileSync(join(repo, 'docs/media/tududi-demo.gif'));
  const gifW = gif.readUInt16LE(6);
  const gifH = gif.readUInt16LE(8);

  const values = {
    SITE_URL,
    BASE: new URL(SITE_URL).pathname,
    JSONLD_APP: ld(jsonApp),
    JSONLD_FAQ: ld(jsonFaq),
    DEFS: defs(),
    WORDMARK: wordmarkSvg(),
    H1: h1,
    HERO: heroSvg(),
    TRACE: trace.html,
    TRACE_SHOWN: String(trace.lines),
    TRACE_TOTAL: String(trace.total),
    SPOT1: s1,
    SPOT2: s2,
    SPOT3: s3,
    TABS: tablist,
    PANELS: panels,
    FAQ: faqHtml(),
    GIF_W: String(gifW),
    GIF_H: String(gifH),
  };
  const fill = (file) => {
    const html = readFileSync(join(src, file), 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
        if (!(k in values)) throw new Error(`no value for ${m} in ${file}`);
        return values[k];
      });
    writeFileSync(join(out, file), html);
  };
  fill('index.html');
  fill('404.html');

  for (const f of ['styles.css', 'main.js', 'favicon.svg', 'paper.svg'])
    copyFileSync(join(src, f), join(out, f));
  cpSync(join(src, 'fonts'), join(out, 'fonts'), { recursive: true });
  copyFileSync(join(repo, 'docs/media/tududi-demo.gif'), join(out, 'media/tududi-demo.gif'));
  copyFileSync(join(repo, 'brand/out/og.png'), join(out, 'og.png'));

  writeFileSync(
    join(out, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}</loc></url>\n</urlset>\n`,
  );
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
  // GitHub Pages: serve files as they are (no Jekyll).
  writeFileSync(join(out, '.nojekyll'), '');
  return { out, trace };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { out: dir, trace } = build();
  console.log(`site built in ${dir}; trace shows ${trace.lines} of ${trace.total} lines`);
}
