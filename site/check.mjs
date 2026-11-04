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

// Non-text contrast (WCAG 1.4.11), measured on the rendered page: graphics that carry meaning need
// 3:1 against what is next to them. Colours are read from computed styles (and from the halftone
// data URIs), so changing a colour in the CSS changes the result.
// Shadows and ticks listed here are decoration: the thing they sit on has its own 3:1 edge.
const DECORATIVE = {
  '.btn-quiet': 'misprint shadow; the button has a 2px indigo border',
  '.card-local': 'misprint shadow; the card is filled indigo',
  '.card': 'misprint shadow; the card has a 2px indigo border',
  '.trace': 'misprint shadow; the box has a 2px indigo border',
  '.cmd': 'misprint shadow; the box is filled indigo',
  '.demo img': 'misprint shadow; the image has a 2px indigo border',
  '.why-lit': 'misprint shadow; the box has a 2px indigo border',
  '[role="tab"][aria-selected="true"]': 'misprint shadow; selection is shown by the indigo fill',
  '.ticks li': 'list bullet; the list is marked up as a list',
};

// The halftone count bars stay bubblegum pink (2.83:1) by the owner's choice (2026-11-04); every count
// is also shown as ×N text. They are measured and reported, not failed.
const EXEMPT_BARS = 'owner choice 2026-11-04: bars stay bubblegum pink; every count is also shown as ×N text';

async function nonTextContrast(page) {
  const rows = await page.evaluate(
    ({ decorative, exemptBars }) => {
      const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (!m) return null;
        const [r, g, b, a = 1] = m[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return { r, g, b, a };
      };
      const fromHex = (h) => ({
        r: Number.parseInt(h.slice(0, 2), 16),
        g: Number.parseInt(h.slice(2, 4), 16),
        b: Number.parseInt(h.slice(4, 6), 16),
        a: 1,
      });
      const hex = (c) =>
        `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      const lum = (c) => {
        const l = [c.r, c.g, c.b].map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
        return (x + 0.05) / (y + 0.05);
      };
      const behind = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c.a > 0) return c;
        }
        return parse(getComputedStyle(document.body).backgroundColor);
      };
      const out = [];
      const EXEMPT_BARS = exemptBars;
      const add = (what, fg, bg, extra = {}) => {
        const r = ratio(fg, bg);
        out.push({
          what,
          fg: hex(fg),
          bg: hex(bg),
          ratio: +r.toFixed(2),
          pass: r >= 3 || Boolean(extra.exempt),
          ...extra,
        });
      };
      // 1. Halftone count bars (trace and legend), one per density step and place.
      const seen = new Set();
      for (const bar of document.querySelectorAll('.t-bar')) {
        const place = bar.closest('.legend') ? 'legend' : 'trace';
        const key = `${place} ${[...bar.classList].join('.')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const st = getComputedStyle(bar);
        let fg = parse(st.backgroundColor);
        if (!fg || fg.a === 0) {
          const m = /%23([0-9a-f]{6})/i.exec(st.backgroundImage);
          fg = m ? fromHex(m[1]) : null;
        }
        // Exempt by name: the owner keeps the bars in bubblegum pink (2.83:1) by choice (2026-11-04).
        // Every count is also printed as ×N text, so no information depends on the dots alone.
        // The ratio is still measured and reported.
        if (fg) add(`count bar (${key})`, fg, behind(bar.parentElement), { exempt: EXEMPT_BARS });
      }
      // 2. Control edges: a border or a fill must stand out from what is around the control.
      for (const sel of [
        '.btn-primary',
        '.btn-quiet',
        '[role="tab"]',
        '.copy',
        '.fx-toggle',
        '.motion-toggle',
      ]) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const st = getComputedStyle(el);
        const around = behind(el.parentElement);
        const border = parse(st.borderTopColor);
        const fill = parse(st.backgroundColor);
        const best = [border, fill]
          .filter((c) => c && c.a > 0)
          .sort((a, b) => ratio(b, around) - ratio(a, around))[0];
        if (best) add(`control edge (${sel})`, best, around);
      }
      // 3. State marks: the effects switch's dot when on, and the FAQ's open marker.
      const fx = document.querySelector('.fx-toggle');
      if (fx) {
        const was = document.documentElement.classList.contains('fx');
        fx.setAttribute('aria-pressed', 'true');
        const dot = getComputedStyle(fx, '::before');
        add('effects switch, "on" dot vs its ring', parse(dot.backgroundColor), parse(dot.borderTopColor));
        fx.setAttribute('aria-pressed', String(was));
      }
      const qa = document.querySelector('details.qa');
      if (qa) {
        const was = qa.open;
        qa.open = true;
        const sum = qa.querySelector('summary');
        add('FAQ open marker', parse(getComputedStyle(sum, '::before').backgroundColor), behind(sum));
        qa.open = was;
      }
      // 4. Misprint shadows and bullets: each must be listed as decoration or reach 3:1.
      for (const el of document.querySelectorAll(
        '.btn, .card, .trace, .cmd, .demo img, .why-col, [role="tab"], .ticks li',
      )) {
        const target = el.matches('.ticks li') ? el : el;
        const st = el.matches('.ticks li') ? getComputedStyle(el, '::before') : getComputedStyle(target);
        const shadow = st.boxShadow;
        if (!shadow || shadow === 'none') continue;
        const sel = Object.keys(decorative).find((s) => el.matches(s));
        const c = parse(shadow);
        const what = `misprint shadow (${el.className || el.tagName.toLowerCase()})`;
        if (seen.has(what)) continue;
        seen.add(what);
        if (sel) out.push({ what, fg: hex(c), decorative: decorative[sel], pass: true });
        else add(what, c, behind(el.parentElement));
      }
      return out;
    },
    { decorative: DECORATIVE, exemptBars: EXEMPT_BARS },
  );
  // 5. Focus rings, reached the way a keyboard user reaches them.
  await page.evaluate(() => window.scrollTo(0, 0));
  const ringSeen = new Set();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        const [r, g, b] = m[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return [r, g, b];
      };
      let bg = null;
      for (let e = el.parentElement; e; e = e.parentElement) {
        const c = /rgba?\(([^)]+)\)/.exec(getComputedStyle(e).backgroundColor);
        const parts = c
          ? c[1]
              .split(/[\s,/]+/)
              .filter(Boolean)
              .map(Number)
          : [];
        if (parts.length && (parts[3] ?? 1) > 0) {
          bg = parts.slice(0, 3);
          break;
        }
      }
      return {
        ring: parse(getComputedStyle(el).outlineColor),
        bg,
        tag: el.tagName.toLowerCase(),
        cls: el.className,
      };
    });
    if (!r) break;
    const key = `${r.ring} on ${r.bg}`;
    if (ringSeen.has(key)) continue;
    ringSeen.add(key);
    const [a, b] = [r.ring, r.bg ?? [252, 245, 236]].map(([x, y, z]) => ({ r: x, g: y, b: z }));
    const l = (c) =>
      [c.r, c.g, c.b]
        .map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, k) => s + v * [0.2126, 0.7152, 0.0722][k], 0);
    const [x, y] = [l(a), l(b)].sort((m, n) => n - m);
    const ratio = +((x + 0.05) / (y + 0.05)).toFixed(2);
    const hx = (c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    rows.push({
      what: `focus ring (first seen on ${r.tag}.${r.cls || '-'})`,
      fg: hx(a),
      bg: hx(b),
      ratio,
      pass: ratio >= 3,
    });
  }
  return rows;
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
      const nt = await nonTextContrast(page);
      report.checks.nonText ??= {};
      report.checks.nonText[fx] = nt;
      for (const r of nt.filter((x) => !x.pass))
        fail('non-text', `effects ${fx}: ${r.what}: ${r.fg} on ${r.bg} is ${r.ratio}:1, needs 3:1`);
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
