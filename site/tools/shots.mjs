// Screenshots of the built page: node site/tools/shots.mjs <out dir> [widths] [--only hero,trace]
// Uses the system Chrome through playwright-core. Effects on and off, and reduced motion.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: shots.mjs <out dir> [360,390,768,1280,1920] [--sections]');
const widths = (
  process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '360,390,768,1280,1920'
)
  .split(',')
  .map(Number);
const sections = process.argv.includes('--sections');
mkdirSync(outDir, { recursive: true });

const site = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
const modes = [
  { name: 'fx-on', fx: 'on', motion: 'no-preference' },
  { name: 'fx-off', fx: 'off', motion: 'no-preference' },
  { name: 'reduced-motion', fx: null, motion: 'reduce' },
];
const files = [];
try {
  for (const w of widths) {
    for (const m of modes) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: w < 500 ? 800 : 900 },
        deviceScaleFactor: w < 500 ? 2 : 1,
        reducedMotion: m.motion,
      });
      if (m.fx) await ctx.addInitScript((v) => localStorage.setItem('lp-fx', v), m.fx);
      const page = await ctx.newPage();
      await page.goto(site.url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      // Freeze the hero loop on its fully lit frame so shots compare.
      await page.addStyleTag({
        content:
          '*{animation-play-state:paused!important;animation-delay:-7s!important}.bar{position:static!important}',
      });
      await page.evaluate(() => {
        for (const i of document.querySelectorAll('img[loading="lazy"]')) i.loading = 'eager';
      });
      await page.waitForLoadState('networkidle');
      const full = join(outDir, `page-${w}-${m.name}.png`);
      await page.screenshot({ path: full, fullPage: true });
      files.push(full);
      if (sections) {
        for (const id of ['top', 'trace']) {
          const f = join(outDir, `${id}-${w}-${m.name}.png`);
          await page.locator(`#${id}`).screenshot({ path: f });
          files.push(f);
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  site.close();
}
if (site.misses.length) console.log(`404s: ${[...new Set(site.misses)].join(', ')}`);
console.log(files.join('\n'));
