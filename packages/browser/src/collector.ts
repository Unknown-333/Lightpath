import { newTraceId } from '@lightpath-dev/core';
import { type IngestMessage, type ScriptCoverage, TRACE_HEADER, type TraceId } from '@lightpath-dev/protocol';
import type { Browser, BrowserContext, CDPSession, Page, Request, Route } from 'playwright-core';
import { launchBrowser } from './launch.js';
import { countsTowardSettle, isNoiseScript, labelFor, shouldTag, type TargetInfo } from './rules.js';
import { SettleTracker } from './settle.js';

export interface CollectorOptions {
  /** App URL to open, e.g. http://localhost:5173 */
  url: string;
  /** Origins whose fetch/XHR requests get the trace header. Defaults to the app origin. */
  backendOrigins?: string[];
  settleMs?: number;
  maxSettleMs?: number;
  headless?: boolean;
  channel?: string;
  /** Where ingest messages go; the CLI wires this to the daemon. */
  send: (message: IngestMessage) => void;
  log?: (msg: string) => void;
}

interface ScriptMeta {
  url: string;
  hash: string;
  length: number;
  sourceMapURL: string;
}

/** Script URL of the init script, so pauses inside it can be told apart from app pauses. */
export const HOOK_URL = 'lightpath://hook.js';
const LAST = '__lightpathLast';
/** Function names of the hook's listeners, so the collector can tell which one paused. */
const HOOK_ACTION = 'lightpathAction';
const HOOK_LEAVE = 'lightpathLeave';

/**
 * Runs in every page before any app script (an init script):
 * - registers the first capture `pointerdown` and `keydown` listeners on window, so they run before
 *   app handlers;
 * - records a description of the target, then pauses with `debugger;` so the collector can take
 *   coverage before any app code for this action runs (ADR 0003).
 *
 * Keys: Enter on anything but a multi-line text field, and Space on buttons, links, checkboxes,
 * radios, and ARIA widgets, which is what activates them. Space or Enter while typing is text, not
 * an action. Held keys (`repeat`) and IME composition are ignored.
 *
 * One pause per action, in our own frame only. The pause must stay short: Chrome drops the
 * pointerup, mouseup, and click events that arrive while the page is paused (measured). Key events
 * aren't dropped: Enter and Space still activate every element after a 70 ms pause (measured).
 */
const HOOK_SOURCE = `(() => {
  const describe = (el) => {
    const t = (el && el.closest && el.closest('button, a, [role], input, select, textarea, label, summary, [data-testid]')) || el;
    if (!t || !t.tagName) return {};
    const text = (t.textContent || '').trim().slice(0, 80);
    return {
      tag: t.tagName.toLowerCase(),
      role: t.getAttribute('role') || undefined,
      name: t.getAttribute('aria-label') || t.getAttribute('name') || t.getAttribute('placeholder') || undefined,
      testId: t.getAttribute('data-testid') || undefined,
      text: text || undefined,
    };
  };
  const TEXT_INPUTS = /^(text|search|email|url|tel|password|number|date|datetime-local|month|week|time|)$/;
  const isTyping = (el) =>
    !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUTS.test(el.type)));
  const isAction = (event) => {
    if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;
    const el = event.target;
    if (event.key === 'Enter') return !(el && (el.isContentEditable || el.tagName === 'TEXTAREA'));
    if (event.key === ' ') return !isTyping(el) && !!(el && el.closest && el.closest('button, a, input, summary, [role]'));
    return false;
  };
  window.addEventListener('pointerdown', function ${HOOK_ACTION}(event) {
    if (!event.isPrimary) return;
    window.${LAST} = describe(event.target);
    debugger;
  }, { capture: true });
  window.addEventListener('keydown', function ${HOOK_ACTION}(event) {
    if (!isAction(event)) return;
    window.${LAST} = { ...describe(event.target), key: event.key === ' ' ? 'Space' : event.key };
    debugger;
  }, { capture: true });
  // A full page load is about to replace this document: pause once more so its coverage can be
  // read while it still exists. Never sets returnValue, so no "leave site?" prompt appears.
  window.addEventListener('beforeunload', function ${HOOK_LEAVE}() {
    debugger;
  }, { capture: true });
})();
//# sourceURL=${HOOK_URL}`;

/**
 * Collects per-click frontend coverage from one Chromium page (docs/ARCHITECTURE.md section 5.1).
 *
 * While the page is paused in the hook: take coverage (background), open the trace, resume.
 * After the settle window: take again; that delta is the click's frontend code.
 */
export class BrowserCollector {
  readonly #opts: CollectorOptions;
  readonly #log: (msg: string) => void;
  readonly #settle: SettleTracker;
  readonly #scripts = new Map<string, ScriptMeta>();
  readonly #sentHashes = new Set<string>();
  readonly #backendOrigins: string[];
  #browser: Browser | undefined;
  #context: BrowserContext | undefined;
  #page: Page | undefined;
  #cdp: CDPSession | undefined;
  #active: TraceId | undefined;
  #clickChain: Promise<void> = Promise.resolve();

  constructor(opts: CollectorOptions) {
    this.#opts = opts;
    this.#log = opts.log ?? (() => {});
    this.#settle = new SettleTracker({
      settleMs: opts.settleMs ?? 300,
      maxSettleMs: opts.maxSettleMs ?? 5000,
    });
    this.#backendOrigins = opts.backendOrigins ?? [new URL(opts.url).origin];
  }

  get page(): Page | undefined {
    return this.#page;
  }

  async start(): Promise<void> {
    this.#browser = await launchBrowser({
      ...(this.#opts.headless !== undefined ? { headless: this.#opts.headless } : {}),
      ...(this.#opts.channel ? { channel: this.#opts.channel } : {}),
    });
    this.#context = await this.#browser.newContext({ viewport: null });
    const page = await this.#context.newPage();
    this.#page = page;

    const cdp = await this.#context.newCDPSession(page);
    this.#cdp = cdp;
    cdp.on('Debugger.scriptParsed', (s) => {
      this.#scripts.set(s.scriptId, {
        url: s.url,
        hash: s.hash,
        length: s.length ?? 0,
        sourceMapURL: s.sourceMapURL ?? '',
      });
    });
    cdp.on('Debugger.paused', (e) => {
      // CallFrame.url is empty for init scripts (measured); resolve the URL via scriptParsed.
      const frame = e.callFrames[0];
      const url = frame ? (this.#scripts.get(frame.location.scriptId)?.url ?? frame.url) : undefined;
      this.#onPaused(url, frame?.functionName);
    });
    await cdp.send('Debugger.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

    this.#opts.send({
      type: 'hello',
      protocolVersion: 1,
      kind: 'browser',
      pid: process.pid,
      processTitle: `browser ${this.#opts.url}`,
      cwd: process.cwd(),
      runtime: { name: 'chromium', version: this.#browser.version() },
    });

    await page.addInitScript({ content: HOOK_SOURCE });
    await page.route('**/*', (route, request) => this.#onRoute(route, request));
    page.on('request', (r) => countsTowardSettle(r.resourceType()) && this.#settle.requestStarted());
    page.on('requestfinished', (r) => countsTowardSettle(r.resourceType()) && this.#settle.requestEnded());
    page.on('requestfailed', (r) => countsTowardSettle(r.resourceType()) && this.#settle.requestEnded());

    await page.goto(this.#opts.url);
    this.#log(`browser open at ${this.#opts.url}`);
  }

  async stop(): Promise<void> {
    this.#settle.cancel();
    await this.#clickChain;
    await this.#browser?.close();
  }

  #onPaused(url: string | undefined, functionName: string | undefined): void {
    if (url !== HOOK_URL) {
      // A `debugger;` statement in app code. Lightpath isn't a debugger; keep the app running.
      void this.#resume();
      return;
    }
    if (functionName === HOOK_LEAVE) {
      void this.#onLeave();
      return;
    }
    // A new click ends the previous window early. The previous click's closing take still runs
    // before this click's code, because the page stays paused until #click resumes it.
    if (this.#active) this.#settle.cancel();
    this.#clickChain = this.#clickChain
      .then(() => this.#click())
      .catch(async (err: unknown) => {
        this.#log(`click handling failed: ${(err as Error).stack ?? err}`);
        await this.#resume();
      });
  }

  /** Runs while the page is paused in the hook. Does as little as possible before resuming. */
  async #click(): Promise<void> {
    const pausedAt = performance.now();
    const [before, target] = await Promise.all([this.#take(), this.#lastTarget()]);
    const traceId = newTraceId();
    const at = Date.now();
    this.#active = traceId; // before resuming, so the click's own requests are tagged
    const settled = this.#settle.begin();
    await this.#resume();
    this.#log(
      `click on ${labelFor(target)}: paused ${(performance.now() - pausedAt).toFixed(1)}ms, trace ${traceId}`,
    );

    void this.#emit('background', before, at);
    this.#opts.send({
      type: 'traceStart',
      traceId,
      label: labelFor(target),
      target: {
        ...(target.role ? { role: target.role } : {}),
        ...(target.name ? { name: target.name } : {}),
        ...(target.testId ? { testId: target.testId } : {}),
        ...(target.text ? { text: target.text } : {}),
      },
      at,
    });

    const reason = await settled;
    const coverage = await this.#take();
    await this.#emit('action', coverage, at, traceId);
    this.#opts.send({ type: 'traceEnd', traceId, at: Date.now(), settled: reason });
    if (this.#active === traceId) this.#active = undefined;
  }

  async #lastTarget(): Promise<TargetInfo> {
    if (!this.#cdp) return {};
    const { result } = await this.#cdp.send('Runtime.evaluate', {
      expression: `window.${LAST}`,
      returnByValue: true,
      silent: true,
    });
    return (result.value as TargetInfo | undefined) ?? {};
  }

  async #resume(): Promise<void> {
    try {
      await this.#cdp?.send('Debugger.resume');
    } catch {
      // Not paused (already resumed, or the page navigated).
    }
  }

  async #onRoute(route: Route, request: Request): Promise<void> {
    const traceId = this.#active;
    // A main-frame page load started by this action (a link, a form post) is backend work for it.
    const type =
      request.isNavigationRequest() && request.frame() === this.#page?.mainFrame()
        ? 'navigation'
        : request.resourceType();
    if (traceId && shouldTag(request.url(), type, this.#backendOrigins)) {
      await route.continue({ headers: { ...request.headers(), [TRACE_HEADER]: traceId } });
      return;
    }
    await route.continue();
  }

  /**
   * Runs while the page is paused in the hook's `beforeunload` listener: the current document is
   * about to go, and its coverage and sources go with it. Taking coverage from a route handler
   * instead deadlocks, because the renderer waits for the request the handler holds (measured).
   */
  async #onLeave(): Promise<void> {
    const traceId = this.#active;
    try {
      const coverage = await this.#take();
      if (traceId) {
        await this.#emit('action', coverage, Date.now(), traceId);
        this.#log(`page unloading during ${traceId}: kept its coverage`);
      } else {
        await this.#emit('background', coverage, Date.now());
      }
    } catch (err) {
      this.#log(`could not read coverage before unload: ${(err as Error).message}`);
    } finally {
      await this.#resume();
    }
  }

  async #take(): Promise<ScriptCoverage[]> {
    if (!this.#cdp) return [];
    const { result } = await this.#cdp.send('Profiler.takePreciseCoverage');
    return result as ScriptCoverage[];
  }

  async #emit(
    phase: 'background' | 'action',
    raw: ScriptCoverage[],
    startedAt: number,
    traceId?: TraceId,
  ): Promise<void> {
    const coverage = raw.filter((s) => !isNoiseScript(s.url));
    if (coverage.length === 0 && phase === 'background') return;
    // Sources go first: the daemon can't map a delta for a script it has no source for.
    await this.#pushSources(coverage);
    this.#opts.send({
      type: 'delta',
      phase,
      startedAt,
      endedAt: Date.now(),
      coverage,
      ...(traceId ? { traceId } : {}),
    });
  }

  /** Sends script info and source once per hash, before the delta that needs it. */
  async #pushSources(coverage: ScriptCoverage[]): Promise<void> {
    for (const { scriptId } of coverage) {
      const meta = this.#scripts.get(scriptId);
      if (!meta || this.#sentHashes.has(meta.hash) || !this.#cdp) continue;
      this.#sentHashes.add(meta.hash);
      try {
        const { scriptSource } = await this.#cdp.send('Debugger.getScriptSource', { scriptId });
        this.#opts.send({
          type: 'scripts',
          scripts: [
            {
              scriptId,
              url: meta.url,
              hash: meta.hash,
              length: meta.length,
              // Vite inlines maps as data: URLs (unverified, M3). External maps are not fetched yet.
              ...(meta.sourceMapURL.startsWith('data:') ? { sourceMapURL: meta.sourceMapURL } : {}),
            },
          ],
        });
        this.#opts.send({ type: 'source', scriptId, hash: meta.hash, url: meta.url, source: scriptSource });
      } catch (err) {
        this.#log(`could not read source of ${meta.url}: ${(err as Error).message}`);
      }
    }
  }
}
