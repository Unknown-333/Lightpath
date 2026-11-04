// Measures IBM Plex Sans against Arial in Chrome, to set the metric-matched fallback in
// styles.css ("Plex Fallback"), so text doesn't reflow when the web font arrives.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const site = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(site.url, { waitUntil: 'networkidle' });
  const r = await page.evaluate(async () => {
    await document.fonts.ready;
    const text = 'Lightpath MCP gives your coding agent the code behind a click: every line it ran.';
    const c = document.createElement('canvas').getContext('2d');
    const w = (font) => {
      c.font = font;
      return c.measureText(text).width;
    };
    return {
      plex400: w('400 100px "Plex Sans"'),
      arial400: w('400 100px Arial'),
      plex600: w('600 100px "Plex Sans"'),
      arial700: w('700 100px Arial'),
    };
  });
  console.log({ ...r, sizeAdjust400: r.plex400 / r.arial400, sizeAdjust600: r.plex600 / r.arial700 });
} finally {
  await browser.close();
  site.close();
}
