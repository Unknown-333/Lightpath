import { newTraceId, webpackModulePath } from '@lightpath-dev/core';
import {
  type ActionError,
  type ActionRequest,
  type ActionRunOutcome,
  type ActionWarning,
  type IngestMessage,
  type ScriptCoverage,
  TRACE_HEADER,
  type TraceId,
} from '@lightpath-dev/protocol';
import type { Browser, BrowserContext, CDPSession, Locator, Page, Request, Route } from 'playwright-core';
import { launchBrowser } from './launch.js';
import { countsTowardSettle, isNoiseScript, labelFor, shouldTag, type TargetInfo } from './rules.js';
import { type SettleReason, SettleTracker } from './settle.js';
import { actionabilityProblem, describeTarget, resolveTarget } from './target.js';

export interface CollectorOptions {
  /** App URL to open, e.g. http://localhost:5173 */
  url: string;
  /** Origins whose fetch/XHR requests get the trace header. Defaults to the app origin. */
  backendOrigins?: string[];
  settleMs?: number;
  maxSettleMs?: number;
  headless?: boolean;
  channel?: string;
  /**
   * Coverage reads slower than this move the click boundary from pointer press to release
   * (default 20 ms). Tests set 0 to force the release boundary.
   */
  pressBudgetMs?: number;
  /** Where ingest messages go; the CLI wires this to the daemon. */
  send: (message: IngestMessage) => void;
  log?: (msg: string) => void;
  /** Messages the user should see even without --debug, like a boundary change. */
  notice?: (msg: string) => void;
}

/** What run_action learns when the collector has taken its boundary and resumed the page. */
interface BoundaryTaken {
  traceId: TraceId;
  boundary: 'press' | 'release' | 'key';
  /** Resolves with the settle reason once the trace's traceEnd has been sent. */
  done: Promise<SettleReason>;
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
/** Set on window when the boundary moves to pointer release; read by the hook at event time. */
const RELEASE = '__lightpathRelease';
const PRESSED = '__lightpathPressed';
/** Holds the element run_action presses; the hook's `click` listener looks for it (click_lost). */
const EXPECT = '__lightpathExpect';
/** True once a `click` event reached the element marked with EXPECT. */
const CLICK_HIT = '__lightpathClickHit';
/** How long run_action waits for the boundary after its input, before answering `no_trace`. */
const BOUNDARY_WAIT_MS = 2000;
/**
 * Longest coverage read the press boundary may cost. Chrome drops a mouse release that arrives
 * while the page is paused at the press, so above this the boundary moves to the release, where a
 * pause loses nothing (measured up to 200 ms). See bench/README.md.
 */
const PRESS_BUDGET_MS = 20;

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
    // The nearest control names the click; a data-testid only when no control encloses it. A
    // test id inside a link (a balance span in Actual's sidebar) must not win over the link (D-098).
    const hit = el && el.closest &&
      (el.closest('button, a, [role], input, select, textarea, label, summary') || el.closest('[data-testid]'));
    const t = hit || el;
    if (!t || !t.tagName) return {};
    // Outside any control, only a leaf element's own text is a fair label: a container's
    // textContent includes every descendant, inline scripts too (seen on a real app, D-090).
    const leaf = hit || (t.childElementCount === 0 && !/^(HTML|BODY|SCRIPT|STYLE)$/.test(t.tagName));
    const text = leaf ? (t.textContent || '').trim().slice(0, 80) : '';
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
    // Release boundary (large apps): note the press, pause at pointerup instead.
    if (window.${RELEASE}) { window.${PRESSED} = true; return; }
    debugger;
  }, { capture: true });
  window.addEventListener('pointerup', function ${HOOK_ACTION}(event) {
    if (!event.isPrimary || !window.${RELEASE} || !window.${PRESSED}) return;
    window.${PRESSED} = false;
    debugger;
  }, { capture: true });
  window.addEventListener('keydown', function ${HOOK_ACTION}(event) {
    if (!isAction(event)) return;
    window.${LAST} = { ...describe(event.target), key: event.key === ' ' ? 'Space' : event.key };
    debugger;
  }, { capture: true });
  // run_action's check that its press became a click on the element it aimed at (click_lost).
  // Never pauses, and does nothing unless run_action marked an element.
  window.addEventListener('click', function lightpathClick(event) {
    const want = window.${EXPECT};
    if (want && event.composedPath().includes(want)) window.${CLICK_HIT} = true;
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
  /** Script ids the daemon has been told about (one per parse; a reload makes new ones). */
  readonly #sentScripts = new Set<string>();
  readonly #backendOrigins: string[];
  #browser: Browser | undefined;
  #context: BrowserContext | undefined;
  #page: Page | undefined;
  #cdp: CDPSession | undefined;
  #active: TraceId | undefined;
  #warnedNoWebpackMaps = false;
  /** True from a `beforeunload` during an action until the next document's `load` (D-091). */
  #navigating = false;

  /** Logs a message and shows it to the user once (the CLI prints notices in yellow). */
  #notify(message: string): void {
    this.#log(message);
    this.#opts.notice?.(this.#scrub(message));
  }

  /** Replaces the current run_action's fill values with `[redacted]`. */
  #scrub(text: string): string {
    let out = text;
    for (const s of this.#secrets) out = out.split(s).join('[redacted]');
    return out;
  }

  /** Each fill value, and its percent-encoded form for URLs, longest first. */
  static #secretForms(values: readonly string[]): string[] {
    const forms = values.filter((v) => v.length >= 4).flatMap((v) => [v, encodeURIComponent(v)]);
    return [...new Set(forms)].sort((a, b) => b.length - a.length);
  }
  #clickChain: Promise<void> = Promise.resolve();
  /** True once the boundary has moved to pointer release (see PRESS_BUDGET_MS). */
  #release = false;

  /** run_action calls, one at a time (design section 4.2). */
  #actionChain: Promise<unknown> = Promise.resolve();
  /** Set while run_action waits for the boundary of its own input. */
  #armed: { maxSettleMs: number; resolve: (b: BoundaryTaken) => void } | undefined;
  /** Resolves when the open trace (#active) has sent its traceEnd. */
  #activeDone: Promise<void> = Promise.resolve();
  /** Requests tagged with each open trace's header, for the daemon's backend wait. */
  readonly #tagged = new Map<TraceId, { method: string; path: string }[]>();
  /** The current run_action's `fill` values (4+ characters): scrubbed from labels and logs (D-123 rule 6). */
  #secrets: string[] = [];

  constructor(opts: CollectorOptions) {
    this.#opts = opts;
    const log = opts.log ?? (() => {});
    this.#log = (msg) => log(this.#scrub(msg));
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
    // Service workers are blocked (D-089): a worker that answers the app's fetches sends them from
    // its own context, where page.route never sees them, so no API call would join the click.
    this.#context = await this.#browser.newContext({ viewport: null, serviceWorkers: 'block' });
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
      if (
        !this.#warnedNoWebpackMaps &&
        !s.sourceMapURL &&
        !isNoiseScript(s.url) &&
        webpackModulePath(s.url)
      ) {
        this.#warnedNoWebpackMaps = true;
        this.#notify(
          "webpack is serving your code without source maps (devtool 'eval'), so browser files can't be shown. " +
            "Set devtool: 'eval-cheap-module-source-map' in your webpack config for development.",
        );
      }
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
    // Page load compiles and runs most of the app. Reading that now keeps the first action's
    // pause as short as later ones (bench/README.md: 40 ms vs 8 ms at 12,000 functions).
    page.on('load', () => {
      if (this.#navigating) {
        this.#navigating = false;
        this.#settle.requestEnded();
      }
      this.#afterLoad();
    });

    await page.goto(this.#opts.url);
    this.#log(`browser open at ${this.#opts.url}`);
  }

  async stop(): Promise<void> {
    this.#settle.cancel();
    await this.#clickChain;
    await this.#browser?.close();
  }

  /**
   * Runs one run_action call on this page (design section 4, D-114): fills fields, then a synced
   * press or a key press on the target, and resolves once the action's trace has ended. Calls
   * queue, and each waits for a person's open trace to end first, so one trace never holds another
   * action's requests. The daemon does the backend wait.
   */
  runAction(request: ActionRequest): Promise<ActionRunOutcome> {
    const run = this.#actionChain.then(() => this.#runAction(request));
    this.#actionChain = run.catch(() => {});
    return run;
  }

  async #runAction(request: ActionRequest): Promise<ActionRunOutcome> {
    const page = this.#page;
    const closed: ActionRunOutcome = {
      ok: false,
      error: {
        code: 'no_browser',
        message: 'The browser Lightpath opened is closed. Restart lightpath dev.',
      },
    };
    if (!page || page.isClosed()) return closed;
    await this.#activeDone;
    this.#secrets = BrowserCollector.#secretForms((request.fill ?? []).map((f) => f.value));
    try {
      const outcome = await this.#act(page, request);
      if (outcome.ok) return { ...outcome, pageUrl: this.#scrub(outcome.pageUrl) };
      const { error } = outcome;
      return {
        ok: false,
        error: {
          ...error,
          message: this.#scrub(error.message),
          ...(error.candidates ? { candidates: error.candidates.map((c) => this.#scrub(c)) } : {}),
        },
      };
    } catch (err) {
      if (page.isClosed()) return closed;
      throw new Error(this.#scrub(String((err as Error)?.message ?? err)));
    } finally {
      this.#armed = undefined;
      this.#secrets = [];
    }
  }

  async #act(page: Page, request: ActionRequest): Promise<ActionRunOutcome> {
    const fail = (error: ActionError): ActionRunOutcome => ({ ok: false, error });
    // Fill first, outside any trace: locator.fill fires input events but no key events (D-079).
    for (const [i, entry] of (request.fill ?? []).entries()) {
      const field = await resolveTarget(page, entry.target, entry.within);
      if (!field.ok)
        return fail({ ...field.error, fillIndex: i, message: `fill[${i}]: ${field.error.message}` });
      const where = `fill[${i}]: ${describeTarget(entry.target, entry.within)}`;
      if (!(await isEditable(field.locator))) {
        return fail({ code: 'not_actionable', fillIndex: i, message: `${where} is not an editable field.` });
      }
      try {
        await field.locator.fill(entry.value, { timeout: 2000 });
      } catch (err) {
        const why = actionabilityProblem(String((err as Error)?.message)) ?? 'not editable';
        return fail({
          code: 'not_actionable',
          fillIndex: i,
          message: `${where} could not be filled: ${why}.`,
        });
      }
    }

    const found = await resolveTarget(page, request.target, request.within);
    if (!found.ok) return fail(found.error);
    const action = request.action ?? 'click';
    const what = describeTarget(request.target, request.within);
    const problem = await checkActionable(found.locator, action);
    if (problem)
      return fail({ code: 'not_actionable', message: `${what} is ${problem}; nothing was pressed.` });

    const maxSettleMs = request.timeoutMs ?? this.#opts.maxSettleMs ?? 5000;
    const warnings: ActionWarning[] = [];
    let taken: BoundaryTaken | undefined;
    if (action === 'press') {
      const boundary = this.#armBoundary(maxSettleMs);
      try {
        await found.locator.press(request.key ?? 'Enter', { timeout: 2000 });
      } catch (err) {
        const why = actionabilityProblem(String((err as Error)?.message)) ?? 'not focusable';
        return fail({ code: 'not_actionable', message: `${what} could not take a key press: ${why}.` });
      }
      taken = await boundary;
    } else {
      const pressed = await this.#syncedPress(page, found.locator, maxSettleMs);
      if ('error' in pressed)
        return fail({ code: 'not_actionable', message: `${what} is ${pressed.error}.` });
      taken = pressed.taken;
      if (pressed.lost) {
        warnings.push({
          code: 'click_lost',
          message: `The press opened a trace, but ${what} got no click event (the page moved or re-rendered under the mouse).`,
        });
      }
    }
    if (!taken) {
      return fail({
        code: 'no_trace',
        message: `No trace opened within ${BOUNDARY_WAIT_MS} ms of the ${action === 'press' ? `${request.key ?? 'Enter'} key` : 'press'} on ${what}. This usually means the element doesn't handle pointer or key input.`,
      });
    }
    const settled = await taken.done;
    if (settled === 'timeout') {
      warnings.push({
        code: 'timeout',
        message: `timed out after ${maxSettleMs} ms: requests were still running, so the trace may be partial.`,
      });
    }
    const tagged = this.#tagged.get(taken.traceId) ?? [];
    this.#tagged.delete(taken.traceId);
    return {
      ok: true,
      traceId: taken.traceId,
      boundary: taken.boundary,
      settled,
      pageUrl: page.url(),
      tagged,
      warnings,
    };
  }

  /**
   * Waits for the next boundary this collector takes, for at most BOUNDARY_WAIT_MS after the call
   * starts waiting. Resolves undefined when none came.
   */
  #armBoundary(maxSettleMs: number): Promise<BoundaryTaken | undefined> {
    let resolve: (b: BoundaryTaken | undefined) => void = () => {};
    const promise = new Promise<BoundaryTaken | undefined>((r) => {
      resolve = r;
    });
    const armed = { maxSettleMs, resolve: (b: BoundaryTaken) => resolve(b) };
    this.#armed = armed;
    const timer = setTimeout(() => {
      if (this.#armed === armed) this.#armed = undefined;
      resolve(undefined);
    }, BOUNDARY_WAIT_MS);
    return promise.finally(() => clearTimeout(timer));
  }

  /**
   * The synced press (D-114): mouse to the target's center, down, wait until the collector has
   * taken the boundary and resumed the page, up. Chrome drops a release that lands inside the
   * pause (ADR 0003); this one can't. On the release boundary (D-082) the press doesn't pause, so
   * the mouse goes up at once and the boundary comes at pointerup.
   */
  async #syncedPress(
    page: Page,
    locator: Locator,
    maxSettleMs: number,
  ): Promise<{ taken: BoundaryTaken | undefined; lost: boolean } | { error: string }> {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
    const box = await locator.boundingBox({ timeout: 2000 });
    if (!box) return { error: 'hidden' };
    // Mark the element so the hook can tell whether the click event reached it (click_lost).
    const origin = await locator.evaluate(
      (el, [expect, hit]) => {
        const w = window as unknown as Record<string, unknown>;
        w[expect] = el;
        w[hit] = false;
        return performance.timeOrigin;
      },
      [EXPECT, CLICK_HIT] as const,
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const boundary = this.#armBoundary(maxSettleMs);
    let taken: BoundaryTaken | undefined;
    if (this.#release) {
      await page.mouse.down();
      await page.mouse.up();
      taken = await boundary;
    } else {
      await page.mouse.down();
      taken = await boundary;
      await page.mouse.up();
    }
    const after = await page
      .evaluate(
        ([expect, hit]) => {
          const w = window as unknown as Record<string, unknown>;
          const clicked = w[hit] === true;
          w[expect] = undefined;
          return { origin: performance.timeOrigin, clicked };
        },
        [EXPECT, CLICK_HIT] as const,
      )
      .catch(() => undefined);
    // A new document (the click navigated) can't say; only a click missing on the same page counts.
    const lost = Boolean(taken && after && after.origin === origin && !after.clicked);
    return { taken, lost };
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
    let readMs = 0;
    const [before, raw] = await Promise.all([
      this.#take().then((r) => {
        readMs = performance.now() - pausedAt;
        return r;
      }),
      this.#lastTarget(),
    ]);
    // A label or name can echo a value run_action just filled; it never leaves the collector.
    const target: TargetInfo = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? this.#scrub(v) : v]),
    );
    const traceId = newTraceId();
    const at = Date.now();
    let endTrace: (reason: SettleReason) => void = () => {};
    const done = new Promise<SettleReason>((resolve) => {
      endTrace = resolve;
    });
    this.#active = traceId; // before resuming, so the click's own requests are tagged
    this.#activeDone = done.then(() => {});
    this.#tagged.set(traceId, []);
    const armed = this.#armed;
    this.#armed = undefined;
    let reason: SettleReason = 'quiet';
    try {
      const settled = this.#settle.begin(armed?.maxSettleMs);
      await this.#resume();
      const boundary = this.#release ? 'release' : 'press';
      armed?.resolve({ traceId, boundary: target.key ? 'key' : boundary, done });
      this.#log(
        `click on ${labelFor(target)}: paused ${(performance.now() - pausedAt).toFixed(1)}ms, boundary ${boundary}, trace ${traceId}`,
      );
      // Key presses never lose events to a pause, so only pointer presses count toward the budget.
      if (!target.key && boundary === 'press') await this.#checkBudget(readMs);

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

      reason = await settled;
      // A navigation that never loaded (a download, a cancelled leave) mustn't hold later windows open.
      if (this.#navigating) {
        this.#navigating = false;
        this.#settle.requestEnded();
      }
      const coverage = await this.#take();
      await this.#emit('action', coverage, at, traceId);
      this.#opts.send({ type: 'traceEnd', traceId, at: Date.now(), settled: reason });
    } finally {
      if (this.#active === traceId) this.#active = undefined;
      // Only run_action reads the tagged list (and then drops it); a person's click doesn't need it.
      if (!armed) this.#tagged.delete(traceId);
      endTrace(reason);
    }
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
      this.#tagged.get(traceId)?.push({ method: request.method(), path: new URL(request.url()).pathname });
      await route.continue({ headers: { ...request.headers(), [TRACE_HEADER]: traceId } });
      return;
    }
    await route.continue();
  }

  /**
   * Files everything since the page started loading as background. Queued on the click chain so it
   * never runs during an action's reads; skipped if an action is open (a navigation's new page
   * belongs to that action's trace).
   */
  #afterLoad(): void {
    this.#clickChain = this.#clickChain
      .then(async () => {
        if (this.#active) return;
        await this.#emit('background', await this.#take(), Date.now());
        // A second read files what the page ran right after load, background too. It isn't timed
        // against the press budget: the page can still be busy here, so this read can cost more than
        // any click's (Actual: 20.8 ms, while 103 press reads stayed under 18.9 ms). Only a read at a
        // pointer press moves the boundary (D-082, D-105).
        await this.#emit('background', await this.#take(), Date.now());
      })
      .catch((err: unknown) => this.#log(`load-time coverage read failed: ${(err as Error).message}`));
  }

  /** Called only with the read taken while the page is paused at a pointer press (D-105). */
  async #checkBudget(readMs: number): Promise<void> {
    const budget = this.#opts.pressBudgetMs ?? PRESS_BUDGET_MS;
    if (this.#release || readMs <= budget) return;
    this.#release = true;
    await this.#setReleaseFlag();
    const message =
      `a coverage read took ${readMs.toFixed(1)} ms (budget ${budget} ms), so clicks now start at the mouse ` +
      'release instead of the press: Chrome drops a release that arrives during a long pause. ' +
      "Code that runs on press (pointerdown and mousedown handlers) won't appear in click traces.";
    this.#log(message);
    this.#opts.notice?.(message);
  }

  /** Turns on the release boundary now, and from the first moment of every later document. */
  async #setReleaseFlag(): Promise<void> {
    const expression = `window.${RELEASE} = true`;
    await this.#cdp?.send('Runtime.evaluate', { expression, silent: true });
    await this.#page?.addInitScript({ content: expression });
  }

  /**
   * Runs while the page is paused in the hook's `beforeunload` listener: the current document is
   * about to go, and its coverage and sources go with it. Taking coverage from a route handler
   * instead deadlocks, because the renderer waits for the request the handler holds (measured).
   */
  async #onLeave(): Promise<void> {
    const traceId = this.#active;
    // The page is leaving during an action: count the navigation as in flight until the next
    // document's `load`, so a slow read here can't end the window before the new page runs (D-091).
    if (traceId && !this.#navigating) {
      this.#navigating = true;
      this.#settle.requestStarted();
    }
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

  /**
   * Sends script info once per script id and the source once per hash, before the delta that needs
   * them. A reload parses the same files again under new ids with the same hash; the daemon looks a
   * delta up by id, so each new id must be announced even when its source was sent before (D-101).
   */
  async #pushSources(coverage: ScriptCoverage[]): Promise<void> {
    for (const { scriptId } of coverage) {
      const meta = this.#scripts.get(scriptId);
      if (!meta || this.#sentScripts.has(scriptId) || !this.#cdp) continue;
      this.#sentScripts.add(scriptId);
      const needSource = !this.#sentHashes.has(meta.hash);
      try {
        const scriptSource = needSource
          ? (await this.#cdp.send('Debugger.getScriptSource', { scriptId })).scriptSource
          : undefined;
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
        if (scriptSource !== undefined) {
          this.#sentHashes.add(meta.hash);
          this.#opts.send({ type: 'source', scriptId, hash: meta.hash, url: meta.url, source: scriptSource });
        }
      } catch (err) {
        this.#log(`could not read source of ${meta.url}: ${(err as Error).message}`);
      }
    }
  }
}

/**
 * Why a target can't take the action, or undefined: hidden, disabled, and for a click also still
 * moving or covered by another element at its center.
 *
 * Not `locator.click({ trial: true })`: Playwright 1.64's trial run still sends a real mouse click
 * and only stops it with its own window listener, which runs after the hook's, so it opens a trace
 * (measured, build1-raw/debug-double.mjs). These checks send no input at all.
 */
async function checkActionable(locator: Locator, action: 'click' | 'press'): Promise<string | undefined> {
  try {
    if (!(await locator.isVisible())) return 'hidden';
    if (!(await locator.isEnabled({ timeout: 1000 }))) return 'disabled';
    if (action !== 'click') return undefined;
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
    const problem = await locator.evaluate(
      async (el) => {
        // Two animation frames apart, the box must not move (a frame may not come in a hidden tab).
        const frame = () =>
          Promise.race([
            new Promise<void>((r) => requestAnimationFrame(() => r())),
            new Promise<void>((r) => setTimeout(r, 100)),
          ]);
        const a = el.getBoundingClientRect();
        await frame();
        await frame();
        const b = el.getBoundingClientRect();
        if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return 'still moving';
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        let top = document.elementFromPoint(x, y);
        while (top?.shadowRoot) {
          const inner = top.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === top) break;
          top = inner;
        }
        if (!top) return 'outside the page';
        const host = (top.getRootNode() as ShadowRoot).host;
        if (el === top || el.contains(top) || (host && el.contains(host))) return '';
        return 'covered by another element';
      },
      undefined,
      { timeout: 2000 },
    );
    return problem || undefined;
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    return actionabilityProblem(message) ?? `not actionable (${message.split('\n')[0]})`;
  }
}

async function isEditable(locator: Locator): Promise<boolean> {
  try {
    return (await locator.isVisible()) && (await locator.isEditable({ timeout: 1000 }));
  } catch {
    return false; // not an input, textarea, select or contenteditable element
  }
}
