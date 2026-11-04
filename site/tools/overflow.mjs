// Lists elements wider than the viewport at a given width: node site/tools/overflow.mjs [360]
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const width = Number(process.argv[2] ?? 360);
const site = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto(site.url, { waitUntil: 'networkidle' });
  const out = await page.evaluate((w) => {
    const rows = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && r.width > 0) {
        let p = el.parentElement;
        let clipped = false;
        while (p) {
          const s = getComputedStyle(p);
          if (s.overflowX !== 'visible') {
            clipped = true;
            break;
          }
          p = p.parentElement;
        }
        if (!clipped)
          rows.push(
            `${el.tagName.toLowerCase()}.${el.className?.baseVal ?? el.className} right=${Math.round(r.right)}`,
          );
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, rows: rows.slice(0, 15) };
  }, width);
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
  site.close();
}
