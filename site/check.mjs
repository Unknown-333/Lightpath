// Checks the built page in site/dist: `pnpm site:check` (builds first).
// HTML validity, links and anchors, palette, no third-party requests, SEO tags, copy rules,
// then the page in Chrome under the real /Lightpath/ prefix: axe, 404s, outside requests, weight.
// Exits 1 if anything fails. Pass --json <file> to save the report.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HtmlValidate } from 'html-validate';
import { chromium } from 'playwright-core';
import { PALETTE } from '../brand/src/palette.mjs';
import { SITE_URL } from './build.mjs';
import { serve } from './tools/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const dist = join(here, 'dist');
const fails = [];
const report = { checks: {} };
const fail = (check, msg) => fails.push(`${check}: ${msg}`);
const read = (f) => readFileSync(join(dist, f), 'utf8');

const html = read('index.html');
const css = read('styles.css');

// 1. HTML validity.
{
  const v = new HtmlValidate({
    extends: ['html-validate:recommended'],
    rules: {
      // Each pixel-font word sets its width with one custom property (--w): data, not styling.
      'no-inline-style': 'off',
      // Curly quotes and apostrophes are typeset on purpose.
      'no-raw-characters': ['error', { relaxed: true }],
    },
  });
  const out = [];
  for (const f of ['index.html', '404.html']) {
    const r = await v.validateString(read(f), f);
    for (const res of r.results)
      for (const m of res.messages) out.push(`${f}:${m.line}:${m.column} ${m.ruleId} ${m.message}`);
  }
  report.checks.html = { errors: out.length };
  for (const m of out) fail('html', m);
}

// 2. Links: anchors exist, relative files exist, links into this repo point at real files.
{
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  let n = 0;
  for (const ref of refs) {
    n++;
    if (ref.startsWith('#')) {
      if (!ids.has(ref.slice(1))) fail('links', `no element with id ${ref}`);
    } else if (ref.startsWith(SITE_URL)) {
      if (!existsSync(join(dist, ref.slice(SITE_URL.length) || 'index.html')))
        fail('links', `missing ${ref}`);
    } else if (/^https?:/.test(ref)) {
      const m = /^https:\/\/github\.com\/Unknown-333\/Lightpath\/(?:blob|tree)\/main\/([^#?]+)/.exec(ref);
      if (m && !existsSync(join(repo, decodeURIComponent(m[1])))) fail('links', `repo has no ${m[1]}`);
    } else if (!existsSync(join(dist, ref.split(/[?#]/)[0]))) fail('links', `missing file ${ref}`);
  }
  report.checks.links = { checked: n };
}

// 3. Palette: every colour in the CSS, the page's inline SVG and the SVG files is one of the nine.
{
  const allowed = new Set(PALETTE.map((p) => p.hex.toLowerCase()));
  const sources = { 'styles.css': css, 'index.html': html, 'favicon.svg': read('favicon.svg') };
  const seen = new Set();
  for (const [f, text] of Object.entries(sources)) {
    for (const m of text.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|%23[0-9a-f]{6}\b|rgba?\(|hsla?\(/gi)) {
      const c = m[0].toLowerCase().replace('%23', '#');
      if (c.startsWith('#') && allowed.has(c)) seen.add(c);
      else fail('palette', `${f} uses ${m[0]}`);
    }
    // feColorMatrix rows set the grain colour from palette channels; check them too.
  }
  const banned =
    /gradient\(|box-shadow:[^;]*\d+px\s+\d+px\s+[1-9]\d*px|filter:\s*blur|drop-shadow|text-shadow/i;
  const m = banned.exec(css);
  if (m) fail('palette', `styles.css has a soft effect: ${m[0]}`);
  report.checks.palette = { colours: [...seen].sort() };
}

// 4. No third-party requests from markup or CSS; no analytics.
{
  const res = [
    ...html.matchAll(/<(?:link|script|img|source|video|iframe)\b[^>]*\s(?:href|src)="([^"]+)"/g),
    ...css.matchAll(/url\("?([^")]+)"?\)/g),
  ].map((m) => m[1]);
  for (const r of res) {
    if (r.startsWith('data:') || r.startsWith('#')) continue;
    const tag = html.includes(`rel="canonical" href="${r}"`);
    if (/^(https?:)?\/\//.test(r) && !tag) fail('requests', `loads ${r}`);
    if (r.startsWith('/')) fail('requests', `root path ${r} breaks under ${new URL(SITE_URL).pathname}`);
  }
  if (
    /gtag|google-analytics|googletagmanager|plausible|umami|segment|hotjar|clarity|sendBeacon/i.test(
      html + read('main.js'),
    )
  )
    fail('requests', 'analytics or beacon code found');
  report.checks.requests = { resources: res.length };
}

// 5. SEO basics.
{
  const one = (re) => [...html.matchAll(re)];
  if (one(/<h1\b/g).length !== 1) fail('seo', 'not exactly one h1');
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? '';
  const desc = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] ?? '';
  if (!title.includes('Lightpath MCP')) fail('seo', 'title lacks "Lightpath MCP"');
  if (!desc.includes('Lightpath MCP')) fail('seo', 'description lacks "Lightpath MCP"');
  if (title.length > 65) fail('seo', `title is ${title.length} characters`);
  if (desc.length > 170) fail('seo', `description is ${desc.length} characters`);
  for (const p of ['og:title', 'og:description', 'twitter:title', 'twitter:description']) {
    const v = new RegExp(`(?:property|name)="${p}" content="([^"]+)"`).exec(html)?.[1] ?? '';
    if (!v.includes('Lightpath MCP')) fail('seo', `${p} lacks "Lightpath MCP"`);
  }
  for (const p of ['og:image', 'twitter:image', 'og:url']) {
    const v = new RegExp(`(?:property|name)="${p}" content="([^"]+)"`).exec(html)?.[1] ?? '';
    if (!v.startsWith(SITE_URL)) fail('seo', `${p} is not an absolute URL under ${SITE_URL}`);
  }
  if (!html.includes(`<link rel="canonical" href="${SITE_URL}">`)) fail('seo', 'canonical missing');
  const levels = one(/<h([1-6])\b/g).map((m) => Number(m[1]));
  levels.forEach((l, i) => {
    if (i && l > levels[i - 1] + 1) fail('seo', `heading jumps from h${levels[i - 1]} to h${l}`);
  });
  for (const m of one(/<img\b[^>]*>/g))
    if (!/\salt="[^"]{10,}"/.test(m[0])) fail('seo', `img without alt: ${m[0]}`);
  const lds = one(/<script type="application\/ld\+json">([^<]+)<\/script>/g).map((m) => JSON.parse(m[1]));
  const types = lds.map((o) => o['@type']);
  if (!types.includes('SoftwareApplication') || !types.includes('FAQPage'))
    fail('seo', `JSON-LD types: ${types}`);
  if (/aggregateRating|"review"/i.test(JSON.stringify(lds))) fail('seo', 'JSON-LD has ratings or reviews');
  const sitemap = read('sitemap.xml');
  if (!sitemap.includes(`<loc>${SITE_URL}</loc>`)) fail('seo', 'sitemap lacks the site URL');
  if (!read('robots.txt').includes(`Sitemap: ${SITE_URL}sitemap.xml`))
    fail('seo', 'robots.txt lacks the sitemap');
  report.checks.seo = { title, titleLength: title.length, description: desc, descriptionLength: desc.length };
}

// 6. Copy rules from the owner's brief and docs/launch/facts.md "Don't claim".
{
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const rules = [
    [/fix(?:es)? bugs faster(?!\?)/i, 'a faster-fix claim'],
    [/more bugs fixed/i, 'a more-bugs claim'],
    [/\bthe only\b/i, '"the only"'],
    [/trusted by|testimonial|★|stars on github/i, 'social proof'],
    [
      /\b(blazing|seamless|effortless|supercharge|revolution|game.?chang|unlock|leverage|robust|delve)/i,
      'puffery',
    ],
    [/—/, 'an em dash'],
  ];
  for (const [re, what] of rules) {
    const m = re.exec(text);
    if (m) fail('copy', `${what}: "…${text.slice(Math.max(0, m.index - 40), m.index + 40)}…"`);
  }
  report.checks.copy = { words: text.split(' ').length };
}

// 7. In Chrome, served under the real prefix: axe (effects on and off), 404s, outside requests, weight.
{
  const site = await serve();
  const browser = await chromium.launch({ channel: process.env.LP_BROWSER_CHANNEL ?? 'chrome' });
  const axeSource = readFileSync(join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8');
  try {
    report.checks.axe = {};
    for (const fx of ['on', 'off']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript((v) => localStorage.setItem('lp-fx', v), fx);
      const page = await ctx.newPage();
      const outside = [];
      const bytes = { total: 0, media: 0 };
      page.on('request', (r) => {
        if (!r.url().startsWith(site.url) && !r.url().startsWith('data:')) outside.push(r.url());
      });
      page.on('response', async (r) => {
        const len = (await r.body().catch(() => Buffer.alloc(0))).length;
        if (/\.(gif|png)$/.test(r.url())) bytes.media += len;
        else bytes.total += len;
      });
      await page.goto(site.url, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        for (const i of document.querySelectorAll('img[loading="lazy"]')) i.loading = 'eager';
      });
      await page.waitForLoadState('networkidle');
      await page.addScriptTag({ content: axeSource });
      const res = await page.evaluate(() =>
        window.axe.run(document, {
          runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        }),
      );
      report.checks.axe[fx] = {
        violations: res.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
        passes: res.passes.length,
        incomplete: res.incomplete.map((v) => v.id),
      };
      for (const v of res.violations)
        fail('axe', `effects ${fx}: ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`);
      for (const u of outside) fail('requests', `effects ${fx}: request to ${u}`);
      if (fx === 'on') {
        report.checks.weight = {
          beforeMediaKB: +(bytes.total / 1024).toFixed(1),
          mediaKB: +(bytes.media / 1024).toFixed(1),
        };
        if (bytes.total > 300 * 1024) fail('weight', `${report.checks.weight.beforeMediaKB} KB before media`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    site.close();
  }
  for (const p of new Set(site.misses)) fail('links', `404 under ${new URL(SITE_URL).pathname}: ${p}`);
}

report.fails = fails;
report.ok = fails.length === 0;
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.checks, null, 2));
if (fails.length) {
  console.error(`site check failed:\n${fails.join('\n')}`);
  process.exit(1);
}
console.log('site check passed');
