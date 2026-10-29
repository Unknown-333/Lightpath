// Records the M4 demo: the example shop in Chrome on the left, VS Code with the extension on the
// right, clicking "Add to cart" and "Checkout" and then replaying the trace (docs/ROADMAP.md, M4).
//
// Nothing is captured from the screen. Chrome runs headless, and VS Code (its own copy from
// .vscode-test, with a throwaway profile) is filmed through its DevTools screencast, so other
// windows never end up in the video. The VS Code window does appear on screen while it runs.
//
// Usage: pnpm build && pnpm bundle && node extensions/vscode/scripts/record-demo.mjs [--out <dir>]
// Needs ffmpeg on PATH, or FFMPEG=<path to ffmpeg>. Writes demo.mp4 and demo.gif to --out
// (default: extensions/vscode/.demo, gitignored).
import { execFileSync, execSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..');
const repo = join(extension, '..', '..');
const shop = join(repo, 'examples', 'shop');
const dist = (pkg) => pathToFileURL(join(repo, 'packages', pkg, 'dist', 'index.js')).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv, UrlWatcher } = await import(dist('cli'));
const requireBrowser = createRequire(join(repo, 'packages', 'browser', 'package.json'));
const { chromium } = requireBrowser('playwright-core');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = resolve(arg('out', join(extension, '.demo')));
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const FPS = 12;
const HEIGHT = 720;
const BROWSER_WIDTH = 480;
const EDITOR_WIDTH = 1120;
const DEBUG_PORT = Number(process.env.LIGHTPATH_DEMO_PORT ?? 9339);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });
} catch {
  console.error('ffmpeg not found. Put it on PATH or set FFMPEG=<path to ffmpeg>.');
  process.exit(1);
}

// A visible pointer for the headless page: screencasts don't draw the mouse. Injected with
// evaluate, so it has no script URL and the collector drops it like any non-app script.
const CURSOR = `(() => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
    'background:rgba(255,184,0,.55);border:2px solid #b37400;pointer-events:none;z-index:2147483647;' +
    'transition:transform .12s;transform:translate(-100px,-100px)';
  let x = -100, y = -100, s = 1;
  const draw = () => { c.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; };
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
  addEventListener('mousedown', () => { s = 0.7; draw(); }, true);
  addEventListener('mouseup', () => { s = 1; draw(); }, true);
  document.body.appendChild(c);
})()`;

/** Collects screencast frames from one page into `dir`, stamped with the time they arrived. */
async function screencast(page, dir, size) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    const file = join(dir, `raw${frames.length}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ at: Date.now(), file });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: size.width,
    maxHeight: size.height,
  });
  return { frames, stop: () => cdp.send('Page.stopScreencast').catch(() => {}) };
}

/** Turns frames that arrived whenever the page changed into a steady FPS sequence. */
function resample(frames, dir, from, to) {
  let k = 0;
  let n = 0;
  for (let t = from; t <= to; t += 1000 / FPS) {
    while (k + 1 < frames.length && frames[k + 1].at <= t) k++;
    const frame = frames[k];
    if (frame) copyFileSync(frame.file, join(dir, `${String(n++).padStart(5, '0')}.jpg`));
  }
  return n;
}

const daemon = await startDaemon({ workspaceRoots: [shop] }); // writes .lightpath/daemon.json
const child = spawn(process.execPath, ['dev.mjs'], {
  cwd: shop,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: agentEnv(process.env, { daemonUrl: daemon.url, token: daemon.token, roots: [shop], registerUrl }),
});
let childErr = '';
child.stderr.on('data', (c) => {
  childErr += c;
});

const work = mkdtempSync(join(tmpdir(), 'lightpath-demo-'));
let collector;
let code;
let editorBrowser;
let failed = false;
try {
  const url = await new Promise((res, rej) => {
    const watcher = new UrlWatcher();
    const timer = setTimeout(() => rej(new Error(`dev server didn't start:\n${childErr}`)), 30_000);
    child.stdout.on('data', (c) => {
      const found = watcher.push(String(c));
      if (found) {
        clearTimeout(timer);
        res(found);
      }
    });
  });
  daemon.correlator.addDevServer(new URL(url).origin, shop);

  // VS Code: the same build the in-editor test uses, with a profile made for filming.
  const exe = await downloadAndUnzipVSCode({
    version: process.env.LIGHTPATH_VSCODE_VERSION ?? 'stable',
    cachePath: join(extension, '.vscode-test'),
  });
  const userDir = join(work, 'user');
  mkdirSync(join(userDir, 'User'), { recursive: true });
  writeFileSync(
    join(userDir, 'User', 'settings.json'),
    JSON.stringify({
      'workbench.colorTheme': 'Default Dark Modern',
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'workbench.layoutControl.enabled': false,
      'window.commandCenter': false,
      'chat.disableAIFeatures': true,
      'editor.fontSize': 13,
      'editor.minimap.enabled': false,
      'editor.renderLineHighlight': 'none',
      'editor.stickyScroll.enabled': false,
      'breadcrumbs.enabled': false,
      'git.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.ignoreRecommendations': true,
      'lightpath.fadeSeconds': 0,
    }),
  );
  code = spawn(
    exe,
    [
      shop,
      `--extensionDevelopmentPath=${extension}`,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${userDir}`,
      `--extensions-dir=${join(work, 'extensions')}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
    ],
    { stdio: 'ignore' },
  );
  editorBrowser = await (async () => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await sleep(500);
      }
    }
  })();
  const editor = await (async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const page = editorBrowser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes('workbench'));
      if (page) return page;
      await sleep(250);
    }
    throw new Error('no VS Code window');
  })();
  await editor.setViewportSize({ width: EDITOR_WIDTH, height: HEIGHT });
  await editor.waitForSelector('.monaco-workbench', { timeout: 60_000 });
  await editor.waitForSelector('[aria-label="Lightpath"]', { timeout: 60_000 }); // activity bar icon
  await sleep(1500);

  const palette = async (prefix, text) => {
    await editor.keyboard.press(prefix === '>' ? 'Control+Shift+P' : 'Control+P');
    await editor.waitForSelector('.quick-input-widget input', { state: 'visible' });
    await editor.keyboard.type(text, { delay: 35 });
    await sleep(500);
  };
  await palette('>', 'Lightpath: Focus on Actions View');
  await editor.keyboard.press('Enter');
  await palette('', 'Cart.tsx');
  await editor.keyboard.press('Enter');
  await palette('', 'routes/orders.ts');
  await editor.keyboard.press('Control+Enter'); // open to the side
  await sleep(1000);
  // Start both editors at their first line, with focus out of the quick open box.
  await editor.keyboard.press('Escape');

  // Chrome: the shop, headless, at the size it has in the video.
  collector = new BrowserCollector({
    url,
    headless: true,
    send: (m) => daemon.correlator.ingest('browser', m),
  });
  await collector.start();
  const page = collector.page;
  await page.setViewportSize({ width: BROWSER_WIDTH, height: HEIGHT });
  await page.waitForSelector('li:has-text("Desk lamp") button');
  await page.evaluate(CURSOR);
  await page.mouse.move(BROWSER_WIDTH / 2, HEIGHT - 60);
  await sleep(2500); // the page load's trace arrives, so the Actions view isn't empty on frame 1

  const glide = async (selector) => {
    const box = await page.locator(selector).first().boundingBox();
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(to.x, to.y, { steps: 18 });
    await sleep(250);
    return to;
  };
  // Same human-like press as scripts/e2e-shop.mjs: Chrome needs the release after the pause.
  const press = async () => {
    await page.mouse.down();
    await sleep(110);
    await page.mouse.up();
  };

  const browserCast = await screencast(page, join(work, 'raw-browser'), {
    width: BROWSER_WIDTH,
    height: HEIGHT,
  });
  const editorCast = await screencast(editor, join(work, 'raw-editor'), {
    width: EDITOR_WIDTH,
    height: HEIGHT,
  });
  const from = Date.now();
  await sleep(1500);
  await glide('li:has-text("Desk lamp") button');
  await press();
  await sleep(2800);
  await glide('li:has-text("Coffee mug") button');
  await press();
  await sleep(2500);
  await glide('button:has-text("Checkout")');
  await press();
  await page.waitForSelector('text=/Order #\\d+ placed/', { timeout: 10_000 });
  await sleep(4500);
  await page.mouse.move(BROWSER_WIDTH / 2, HEIGHT - 60, { steps: 12 });
  await palette('>', 'Lightpath: Replay Last Action');
  await editor.keyboard.press('Enter');
  await sleep(8000);
  const to = Date.now();
  await browserCast.stop();
  await editorCast.stop();

  // Same timeline for both sides, then side by side at one height.
  mkdirSync(join(work, 'browser'));
  mkdirSync(join(work, 'editor'));
  const nb = resample(browserCast.frames, join(work, 'browser'), from, to);
  const ne = resample(editorCast.frames, join(work, 'editor'), from, to);
  console.log(`${nb} browser frames, ${ne} editor frames over ${((to - from) / 1000).toFixed(1)} s`);
  mkdirSync(out, { recursive: true });
  const inputs = [
    '-framerate',
    String(FPS),
    '-i',
    join(work, 'browser', '%05d.jpg'),
    '-framerate',
    String(FPS),
    '-i',
    join(work, 'editor', '%05d.jpg'),
  ];
  const stack = `[0]scale=-2:${HEIGHT}[b];[1]scale=-2:${HEIGHT}[e];[b][e]hstack=inputs=2,pad=ceil(iw/2)*2:ceil(ih/2)*2`;
  const mp4 = join(out, 'demo.mp4');
  const gif = join(out, 'demo.gif');
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-loglevel',
      'error',
      ...inputs,
      '-filter_complex',
      stack,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      mp4,
    ],
    { stdio: 'inherit' },
  );
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      mp4,
      '-filter_complex',
      `fps=10,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      gif,
    ],
    { stdio: 'inherit' },
  );
  for (const f of [mp4, gif]) console.log(`${f} (${(statSync(f).size / 1e6).toFixed(1)} MB)`);
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await collector?.stop().catch(() => {});
  await editorBrowser?.close().catch(() => {});
  for (const p of [child, code]) {
    if (!p?.pid) continue;
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
      else p.kill('SIGTERM');
    } catch {}
  }
  await daemon.close();
  await sleep(500);
  // VS Code can hold its profile for a moment after exit; a leftover temp folder isn't a failure.
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (err) {
    console.warn(`couldn't remove ${work}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
