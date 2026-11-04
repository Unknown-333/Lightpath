// Extra checks for the PR, beyond site:check: node site/tools/audit.mjs <out dir>
// 1 contrast of every text/background pair the CSS uses; 2 a keyboard-only pass; 3 emulated
// mid-range phone (390 px, CPU slowed 4x) frame times and long tasks, effects on and off;
// 4 the social image at 500 px on white and dark; 5 axe in Firefox. Writes audit.json + PNGs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { serve } from './serve.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: audit.mjs <out dir>');
mkdirSync(out, { recursive: true });
const report = {};

// 1. Contrast (WCAG 2.x relative luminance).
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const C = {
  paper: '#fcf5ec',
  indigo: '#2b2684',
  pink: '#ff4f9f',
  'pink tint': '#ffb3d2',
  plum: '#2b0c52',
  violet: '#a13187',
  'indigo tint': '#a19dd9',
};
const pairs = [
  ['indigo', 'paper', 'body text, headings, links, trace lines', 4.5],
  ['violet', 'paper', 'source lines, "not run" in the trace', 4.5],
  ['plum', 'paper', 'call counts (×N) in the trace', 4.5],
  ['plum', 'pink', 'Get started and Copy buttons', 4.5],
  ['paper', 'indigo', 'command boxes, trace header, footer, tab, tooltips, local-only card', 4.5],
  ['pink tint', 'indigo', 'source line on the local-only card', 4.5],
  ['indigo', 'pink tint', 'selected text', 4.5],
  ['violet', 'paper', 'halftone count bars (graphics carrying information)', 3],
  ['pink', 'paper', 'list ticks (decorative; each has a 2px indigo shadow)', null],
  ['pink tint', 'indigo', 'focus ring on indigo surfaces', 3],
  ['plum', 'paper', 'focus ring on paper', 3],
  ['indigo tint', 'paper', 'halftone tint in art (graphics, not text)', null],
];
report.contrast = pairs.map(([fg, bg, use, need]) => {
  const r = ratio(C[fg], C[bg]);
  return {
    fg: `${fg} ${C[fg]}`,
    bg: `${bg} ${C[bg]}`,
    use,
    ratio: +r.toFixed(2),
    need,
    pass: need ? r >= need : 'n/a',
  };
});

const site = await serve();
const chrome = await chromium.launch({ channel: 'chrome' });
try {
  // 2. Keyboard only: Tab through the page, record each stop and whether a focus ring shows.
  {
    const page = await chrome.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(site.url, { waitUntil: 'networkidle' });
    const stops = [];
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const st = getComputedStyle(el);
        const label = (el.getAttribute('aria-label') || el.textContent || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 50);
        return {
          tag: el.tagName.toLowerCase(),
          label,
          ring: st.outlineStyle !== 'none' && Number.parseFloat(st.outlineWidth) >= 2,
          visible: el.getBoundingClientRect().height > 0,
        };
      });
      if (!s) break;
      stops.push(s);
      if (stops.length > 2 && s.label === stops[0].label && s.tag === stops[0].tag) break;
    }
    // The skip link moves focus to main; tabs answer the arrow keys; the trace answers ArrowDown.
    await page.goto(site.url, { waitUntil: 'networkidle' });
    await page.keyboard.press('Tab');
    const skip = await page.evaluate(() => document.activeElement?.textContent?.trim());
    await page.keyboard.press('Enter');
    const afterSkip = await page.evaluate(() => location.hash);
    await page.focus('#tab-claude-code');
    await page.keyboard.press('ArrowRight');
    const tab = await page.evaluate(() => ({
      focused: document.activeElement?.id,
      cursorPanelShown: !document.getElementById('panel-cursor').hidden,
    }));
    await page.focus('.trace-lines');
    await page.keyboard.press('ArrowDown');
    const tip = await page.evaluate(() => document.querySelector('.t-fn.is-active')?.dataset.tip);
    await page.focus('#faster summary');
    await page.keyboard.press('Enter');
    const faqOpen = await page.evaluate(() => document.getElementById('faster').open);
    await page.focus('.fx-toggle');
    const fxBefore = await page.evaluate(() => document.documentElement.classList.contains('fx'));
    await page.keyboard.press('Space');
    const fxAfter = await page.evaluate(() => document.documentElement.classList.contains('fx'));
    await page.focus('.motion-toggle');
    await page.keyboard.press('Enter');
    const paused = await page.evaluate(() => ({
      pressed: document.querySelector('.motion-toggle').getAttribute('aria-pressed'),
      clipAnimation: getComputedStyle(document.querySelector('.hero-clip')).animationName,
    }));
    report.keyboard = {
      pauseAnimation: paused,
      tabStops: stops.length,
      stopsWithoutRing: stops.filter((s) => !s.ring).map((s) => `${s.tag} ${s.label}`),
      stops: stops.map((s) => `${s.tag}: ${s.label}`),
      skipLink: { first: skip, after: afterSkip },
      tabsArrowRight: tab,
      traceArrowDown: tip,
      faqEnterOpens: faqOpen,
      effectsSpaceToggles: fxBefore !== fxAfter,
    };
    await page.close();
  }

  // 3. Emulated mid-range phone: 390x844, CPU throttled 4x through CDP. Scroll the page while
  // measuring frame gaps (rAF) and long tasks, effects on and off.
  report.phonePerf = {
    emulated: '390x844 viewport, DPR 3, Chrome CPU throttling 4x (CDP), no network throttling',
  };
  for (const fx of ['on', 'off']) {
    const ctx = await chrome.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await ctx.addInitScript((v) => {
      localStorage.setItem('lp-fx', v);
      window.__long = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    }, fx);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // rAF gaps in headless Chrome are not tied to a display, so also trace the rendering work
    // itself: main-thread style, layout and paint, and raster (where SVG filters are drawn).
    await chrome.startTracing(page, {
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
    });
    const t0 = Date.now();
    await page.goto(site.url, { waitUntil: 'load' });
    const loadMs = Date.now() - t0;
    const lcp = await page.evaluate(
      () =>
        new Promise((ok) => {
          new PerformanceObserver((l) => ok(l.getEntries().at(-1)?.startTime ?? null)).observe({
            type: 'largest-contentful-paint',
            buffered: true,
          });
          setTimeout(() => ok(null), 3000);
        }),
    );
    const frames = await page.evaluate(async () => {
      const gaps = [];
      let last = performance.now();
      let run = true;
      const tick = (t) => {
        gaps.push(t - last);
        last = t;
        if (run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const H = document.documentElement.scrollHeight;
      for (let y = 0; y < H; y += 120) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 16));
      }
      await new Promise((r) => setTimeout(r, 1000));
      run = false;
      gaps.sort((a, b) => a - b);
      const q = (p) => +gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))].toFixed(1);
      return {
        frames: gaps.length,
        p50: q(0.5),
        p95: q(0.95),
        max: q(1),
        over50ms: gaps.filter((g) => g > 50).length,
      };
    });
    const long = await page.evaluate(() => window.__long);
    const trace = JSON.parse((await chrome.stopTracing()).toString());
    const sum = (names) => {
      const ev = trace.traceEvents.filter((e) => names.includes(e.name) && e.ph === 'X');
      return {
        count: ev.length,
        ms: +(ev.reduce((a, e) => a + (e.dur ?? 0), 0) / 1000).toFixed(1),
        maxMs: +(Math.max(0, ...ev.map((e) => e.dur ?? 0)) / 1000).toFixed(1),
      };
    };
    report.phonePerf[`effects ${fx}`] = {
      renderMainThread: sum(['UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Layerize']),
      raster: sum(['RasterTask']),
      loadMs,
      lcpMs: lcp && +lcp.toFixed(0),
      frameMs: frames,
      longTasks: long.length,
      longestTaskMs: long.length ? +Math.max(...long).toFixed(0) : 0,
      longTaskTotalMs: +long.reduce((a, b) => a + b, 0).toFixed(0),
    };
    await ctx.close();
  }

  // 4. Social image at 500 px wide, on white and on dark, as a link card would show it.
  {
    const png = readFileSync(new URL('../dist/og.png', import.meta.url)).toString('base64');
    const page = await chrome.newPage({ viewport: { width: 1160, height: 344 } });
    await page.setContent(
      `<body style="margin:0;display:flex;gap:20px;padding:20px;background:#fff"><div style="background:#fff;padding:20px"><img width="500" src="data:image/png;base64,${png}"></div><div style="background:#16181d;padding:20px"><img width="500" src="data:image/png;base64,${png}"></div></body>`,
    );
    await page.screenshot({ path: join(out, 'og-500-white-dark.png') });
    await page.close();
    report.og500 = join(out, 'og-500-white-dark.png');
  }
} finally {
  await chrome.close();
}

// 5. axe in Firefox (Playwright's Firefox build), effects on.
{
  const ff = await firefox.launch();
  try {
    const page = await ff.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(site.url, { waitUntil: 'networkidle' });
    await page.addScriptTag({
      content: readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8'),
    });
    const res = await page.evaluate(() =>
      window.axe.run(document, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      }),
    );
    report.firefox = {
      version: ff.version(),
      axeViolations: res.violations.map((v) => `${v.id} (${v.nodes.length})`),
      fx: await page.evaluate(() => document.documentElement.classList.contains('fx')),
    };
  } finally {
    await ff.close();
  }
}
site.close();
if (site.misses.length) report.misses = site.misses;
writeFileSync(join(out, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
