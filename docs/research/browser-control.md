# Agent-driven clicks that keep the click-boundary trace

Phase 1 research, item "Agent-driven browser control (CDP directly vs Playwright) that keeps the click-boundary trace intact". Measured 2026-11-01 on the example shop, Chrome 156.0.8078.74, Windows, `agent-loop` at 2973c43.

> **Debug port: not needed.** The recommended method drives the page through the Playwright connection Lightpath already has (a pipe, no TCP port). Only the "attach another browser MCP" test opened a CDP port, on 127.0.0.1, in a prototype. If that is ever shipped, it must listen on 127.0.0.1 only and the owner must OK it first.

## Answer

| Question                                   | Answer (measured)                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which control method?                      | Lightpath's own Playwright page, with a **synced press**: mouse down, wait until the collector has taken the boundary and resumed the page, then mouse up. 20 of 20 Add to cart and 20 of 20 Checkout traces matched the human-style press exactly, headless and headed.                                                                          |
| Which methods break the trace?             | Any press whose release reaches Chrome during the boundary pause: Playwright `locator.click()` (2 of 20 Checkout traces right), `page.mouse.click()` (0 of 20), CDP press and release sent together (5 of 20), Chrome DevTools MCP `click` (11 of 20), Playwright MCP `browser_click` (0 of 20). `element.click()` opens no browser trace at all. |
| Headless vs headed?                        | Same traces. Headed runs matched 20 of 20 for each method tried.                                                                                                                                                                                                                                                                                  |
| How should the agent name the target?      | Role and name, scoped by a nearby text when the name repeats (`button "Add to cart"` in the `Coffee mug` row). Snapshot refs work too but die on a reload.                                                                                                                                                                                        |
| How does the tool know the action is done? | Lightpath's own settle window (no requests in flight for 300 ms, 5 s cap), then wait for the backend lines of each tagged request. DOM quiet returns too early.                                                                                                                                                                                   |
| Tool shape                                 | One MCP tool, `run_action`: clicks or presses Enter, waits for the trace, returns it. Details below.                                                                                                                                                                                                                                              |

Raw output: `C:\Users\user\lightpath-trials\goal\browser-raw\`. The table numbers come from `summary.json` / `summary.md` there (made by `compare.mjs`). Prototype code: `bench/prototypes/browser-control/`.

## What was measured

Each run starts a fresh daemon, the shop under the Node agent, and a `BrowserCollector`, the way `scripts/e2e-shop.mjs` does (`harness.mjs`). It then does Add to cart (Coffee mug) and Checkout 20 times with one control method (`run.mjs`). Coffee mug has stock 20, so 20 orders fit one fresh shop. Desk lamp, which the e2e uses, has stock 5.

Every trace is compared with the human-style press from `scripts/e2e-shop.mjs` (move, down, hold 80 ms, up), run the same way: `pw-mouse-hold`. Its Checkout trace has the same files and lines as the e2e's own Checkout trace (`e2e-shop.txt`, E2E PASSED). A trace "matches" when it has the same label, the same files with the same lit lines, and a boundary at the press. For Checkout, the run also checks for `POST /api/orders 201` in the trace and `src/Cart.tsx` line 26 lit (the success message, which runs after the response). "Ready" is the time from the start of the trigger call to the trace having ended and, for Checkout, holding a Node file. The settle window (300 ms of quiet) is most of it.

Pointer-press code: the shop has no `pointerdown` or `mousedown` handler, so `inputs.mjs` adds a probe page on the shop's origin (`probe/`, served by request interception). It has named handlers for `pointerdown`, `mousedown`, `click` and the response, plus a no-request button, a link to a second page, and a form. It checks which handlers ran inside each trace from the raw coverage deltas (`inputs-summary.txt`).

## Results on the shop (20 Add to cart + 20 Checkout per row)

"Right" = same label, files, lines and press boundary as the reference. Ready times are p50 / p95 in ms, over traces that completed.

| Method                                                    | Add right               | Checkout right          | Checkout has request / response line | Add ready         | Checkout ready          |
| --------------------------------------------------------- | ----------------------- | ----------------------- | ------------------------------------ | ----------------- | ----------------------- |
| Reference: Playwright mouse, hold 80 ms (`pw-mouse-hold`) | 20                      | 20                      | 20 / 20                              | 315.5 / 329.8     | 408.8 / 424             |
| **Playwright mouse, synced press (`pw-mouse-synced`)**    | **20**                  | **20**                  | **20 / 20**                          | **326.6 / 329.9** | **329.6 / 345**         |
| Playwright `locator.click()`                              | 2                       | 2                       | 2 / 2                                | 327.8 / 331.2     | 332.8 / 349.1           |
| Playwright `page.mouse.click()`, no hold                  | 0                       | 0                       | 0 / 0                                | 328.2 / 332.9     | 347.8 / 347.8 (1 trace) |
| Playwright `locator.press('Enter')`                       | 20 (label + " (Enter)") | 20 (label + " (Enter)") | 20 / 20                              | 312.9 / 326.5     | 329.5 / 331.2           |
| CDP `Input.dispatchMouseEvent`, hold 80 ms                | 20                      | 20                      | 20 / 20                              | 310.9 / 313       | 419.4 / 435.5           |
| CDP, press awaited, then release at once                  | 20                      | 20                      | 20 / 20                              | 312.1 / 322.8     | 331.5 / 347.2           |
| CDP, press and release sent together                      | 5                       | 5                       | 5 / 5                                | 313.5 / 328.9     | 332 / 350.1             |
| CDP `Input.dispatchKeyEvent` Enter                        | 20 (label + " (Enter)") | 20 (label + " (Enter)") | 20 / 20                              | 312.2 / 314.5     | 329.7 / 331.9           |
| `element.click()` via `Runtime.evaluate`                  | 0 (no trace)            | 0 (backend-only trace)  | 20 / 0                               | none              | 76.8 / 78.9             |
| Chrome DevTools MCP 1.12.0 `click`, attached over CDP     | 11                      | 11                      | 11 / 11                              | 328.2 / 341.6     | 343.6 / 362.5           |
| Playwright MCP 0.0.84 `browser_click`, attached over CDP  | 0                       | 0                       | 0 / 0                                | 326.5 / 341.8     | none                    |

Headed (same comparison with the headless reference):

| Method, headed                           | Add right | Checkout right | Add ready     | Checkout ready |
| ---------------------------------------- | --------- | -------------- | ------------- | -------------- |
| Playwright mouse, hold 80 ms             | 20        | 20             | 327.1 / 329.3 | 409.2 / 423.5  |
| Playwright mouse, synced press           | 20        | 20             | 314.5 / 327   | 330.4 / 342    |
| CDP, press awaited, then release at once | 20        | 20             | 313.2 / 314.8 | 329.2 / 331.7  |

What the failures look like:

- **Lost click.** The trace opens at the press, but the `click` event never fires. Add to cart traces come back with no files: 17 of 20 for `locator.click()`, 20 of 20 for `page.mouse.click()`, 20 of 20 for Playwright MCP, 5 of 20 for Chrome DevTools MCP. The app then does nothing, so the next Checkout posts an empty cart or never fires. This is the drop ADR 0003 describes: Chrome drops a release that arrives while the page is paused at the press. The probe confirms it. With `page.mouse.click()`, each press trace held `pointerdown` and `mousedown` code but no `click` handler.
- **No browser trace.** `element.click()` sends no pointer or key event, so the hook never pauses. Add to cart gives no trace. Checkout gives only the backend's request trace, labelled `POST /api/orders`, with Node files and no frontend code.
- **Keyboard misses press code.** Enter traces match the mouse traces on the shop. On the probe they hold `click` and the response but not `pointerdown` or `mousedown`, as expected. The label gets " (Enter)" (D-079).
- The 80 ms hold costs about 80 ms on Checkout (408.8 vs 329.6 ms p50), because the click handler, and so the request, waits for the release. The synced press releases as soon as the page resumes.

Why CDP "press awaited, then release" worked 20 of 20 while Playwright's `page.mouse.click()` got 0: not established. One guess is that Chrome replies to `mousePressed` only after the page resumes, while Playwright's down returns sooner. The synced press doesn't depend on that, so the recommendation doesn't either.

CPU: runs that started or ended over 20% are marked in their raw `start` / `end` lines: `eval-click` and `cdp-mouse-instant-headed` were still busy after the 60 s wait (48.4% and 62.3%), and `pw-mouse-hold-headed` and `pw-mouse-synced-headed` started at 25.3% and 22.8%. Ready times are mostly the fixed 300 ms settle window, and the busy runs' times sit within the clean runs' range.

## Nearby inputs (probe page, 3 tries each unless noted)

From `inputs-summary.txt`. "Good" methods = synced press, hold 80 ms (Playwright or CDP), CDP press-then-release.

| Input                                                   | Good methods                                                                                                                           | Others                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Press with `pointerdown`, `mousedown`, `click`, request | All four handlers and `GET /api/products 200` in one trace, 3 of 3                                                                     | `locator.click()` lost the click 1 of 3; `page.mouse.click()` and CDP send-together 3 of 3; keys: no press handlers |
| Click with no request                                   | Handler in trace, 3 of 3; ready in 309.7 to 327.3 ms (settle only)                                                                     | `page.mouse.click()` 0 of 3; CDP send-together 1 of 3; `element.click()` no trace                                   |
| Form: button, or Enter in the field                     | Submit handler, its response and the request, 3 of 3                                                                                   | `page.mouse.click()` 0 of 3; CDP send-together 2 of 3                                                               |
| Link to another page (1 try)                            | Old page's handler and new page's startup in one trace                                                                                 | `locator.click()`, `page.mouse.click()`, CDP send-together: trace with no handlers; `element.click()`: no trace     |
| Target that isn't there (1 try)                         | Playwright: timeout error after about 2,000 ms; CDP: error in under 1 ms (own `querySelector`)                                         | No trace opened by any method                                                                                       |
| Two presses in quick succession                         | Two traces. The first closes when the second press starts, so the first click's response handler lands in the **second** trace, 3 of 3 | Same split for the Enter methods; the lossy methods also lost clicks here                                           |

The two-press split is how the collector works today (a new press ends the open window, `#onPaused`). A tool that waits for each trace before the next action never hits it.

## Another browser MCP on Lightpath's Chrome

Lightpath launches Chrome over a pipe, so nothing can attach to it. The prototype (`attach-mcp.mjs`) added `--remote-debugging-port=9334` for its own process only. Both MCP servers then attached on the first try. Chrome DevTools MCP listed the shop page (`list_pages`: one page, `isolatedContext=isolated-context-1`). Playwright MCP listed it as tab 0. The Lightpath trace kept working: no pause conflicts, press boundaries as usual.

The clicks are the problem. Both servers press and release with no hold, so the release lands in the pause:

- Chrome DevTools MCP: 11 of 20 Add to cart traces right, 11 of 20 Checkout. Its `click` call returned in 231.2 ms p50 (`mcp-call-times.txt`), before the trace was ready. It waits up to 100 ms for a navigation, then for 100 ms of DOM quiet, 3 s at most (`WaitForHelper.js`, read 2026-11-01, `mcp-wait-rules.txt`). That doesn't wait for a request to finish.
- Playwright MCP: 0 of 20. Its `browser_click` took 532.3 ms p50. It waits 500 ms, then for the requests the action started (5 s cap), then 500 ms more (`waitForCompletion`, same file).
- The first Playwright MCP run passed `ref` and every call failed with "invalid arguments": 0.0.84 names it `target` (`mcp-playwright-attempt1-wrong-arg.jsonl`). The second run, with `target`, is the one in the table.

Side effects to know about: Chrome DevTools MCP sends usage statistics and CrUX lookups by default. The prototype turned both off with `--no-usage-statistics --no-performance-crux` (its `--help`, `chrome-devtools-mcp-1.12.0-help.txt`). Playwright MCP wrote 42 snapshot and console files to `C:\Users\user\.kiro\crew\playwright-snapshots` during the run.

So pairing Lightpath with these servers today gives wrong traces about half the time or always. A CDP port also lets any local process drive the browser. Neither is needed if Lightpath clicks itself.

## Naming the target

From `targets.json` on the shop:

| Way to name it                                     | Add to cart (Coffee mug) | Checkout  | Notes                                                                                                    |
| -------------------------------------------------- | ------------------------ | --------- | -------------------------------------------------------------------------------------------------------- |
| Visible text `Add to cart`                         | 2 matches                | 1         | Repeats across rows                                                                                      |
| Role and name `button "Add to cart"`               | 2 matches                | 1         | Same problem                                                                                             |
| Role and name inside a row with text `Coffee mug`  | 1                        | n/a       | Unique                                                                                                   |
| CSS `li:nth-child(2) button`, `button.primary`     | 1                        | 1         | Agents must read the DOM to write these, and they break on layout changes                                |
| Snapshot ref (`page.ariaSnapshot({ mode: 'ai' })`) | 1 (`e12`)                | 1 (`e20`) | Survived a re-render (`e20` still Checkout). After a reload, `e20` timed out and the new ref was `f1e20` |

The whole shop snapshot is 740 characters. Recommendation: accept role and name, with an optional `within` text to pick the row. When a name matches more than one element, fail with the candidates, never click the first. Also accept a ref from a snapshot the tool returns, and CSS as a fallback.

## Recommendation

### Method

Click through the Playwright page the collector already owns, with the synced press. It was the only method that matched 20 of 20 on both actions, headless and headed, without a fixed hold. It's also 80 ms faster on Checkout than the 80 ms hold. Press Enter with `locator.press('Enter')` for keyboard actions (20 of 20, label gets " (Enter)").

Close second: raw CDP, press awaited then release (also 20 of 20, same speed). It's not the pick because it depends on an unexplained Chrome reply order, and it needs its own element lookup. Playwright locators give role and name lookup for free.

On the release boundary (big apps, D-082) the press doesn't pause. The synced press then releases after its cap (200 ms in the prototype). In the product the collector knows its mode and can release at once.

### Tool: `run_action`

- **Where it runs.** The browser lives in the `lightpath dev` process (the collector feeds the in-process daemon through `ingestLocal`). `lightpath mcp` is a separate process that finds the daemon through the discovery file. So the tool is an MCP tool that calls a new daemon endpoint, and the daemon hands the action to its collector. That endpoint is a wire-protocol change (`docs/PROTOCOL.md`, "Client → daemon"): Tier 2, D-entry first.
- **Inputs.** `target` (required): `button "Checkout"` (role and name), plain text, a snapshot ref, or `css=...`. `within` (optional): text of an enclosing element, like `Coffee mug`. `action`: `click` (default) or `press` with `key` `Enter` or `Space`. Typing into fields stays a separate step; it opens no trace (D-079). `timeoutMs` (optional): the settle cap, default 5000.
- **Wait rule.** Run the action, then wait for the trace's end (the collector's settle: no requests for 300 ms, 5 s cap). Then wait up to 1.5 s for the backend file of each tagged request. One action at a time: a second call waits for the first trace to end, so a response is never split into the next trace.
- **Returns.** The trace in the same compact form as `find_code_for_action`: id, label, boundary, how it settled (quiet or timeout), requests with status, files with lit lines. Also the page URL after the action, and a warning when something looks off (below).
- **Errors.** `not_found` (with the closest role and name candidates). `ambiguous` (match count and candidates). `not_actionable` (disabled, hidden or covered). `no_trace` (input sent, but no boundary). `click_lost` (a boundary but the target got no `click`; this needs a small capture `click` flag in the hook, not built). `timeout` (settle cap reached; the partial trace is returned and marked). `no_browser` (`lightpath dev` isn't running).
- **Snapshot.** An optional `page_snapshot` tool returning the aria snapshot with refs (740 characters for the shop) lets the agent see what it can click. It's optional; role and name work without it.

### What breaks or stays open

- `element.click()`, `dispatchEvent` and any agent tool that uses them give no browser trace. Lightpath should not offer them.
- Other browser MCPs on the same Chrome give wrong traces until they hold the press. Say so in the docs instead of telling users to pair them.
- Press code (`pointerdown`, `mousedown`) isn't in Enter traces, nor in mouse traces once the boundary has moved to the release (D-082).
- Two quick human clicks still split a response into the next trace. The tool avoids it by running actions one at a time.
- Not measured: Actual Budget or another large app (the shop gave a clear answer), iframes, shadow DOM, drag, hover menus, file uploads, dialogs.

## Proposed decisions

1. **Agents act through Lightpath's own browser, not an external one.**
   - What: the click tool drives the collector's Playwright page in `lightpath dev`. No CDP port is opened.
   - Why: only held or synced presses keep the trace right. The two browser MCPs got 11 of 20 and 0 of 20. A port is extra attack surface.
   - Alternatives: open a 127.0.0.1 CDP port and let users pair Chrome DevTools MCP or Playwright MCP (rejected on the numbers above, and Tier 3); CDP-only clicks (works, but no role and name lookup).
   - Evidence: `summary.json`, `runs/mcp-*.jsonl`.
   - Revert: remove the tool; nothing else depends on it.
2. **Synced press as the click.**
   - What: mouse down, wait for the collector's "boundary taken, page resumed" signal, then mouse up. Release at once when the boundary is at the release.
   - Why: 20 of 20 on both actions, headless and headed. 329.6 ms p50 Checkout vs 408.8 ms for the 80 ms hold.
   - Alternatives: fixed 80 ms hold (works, slower, and a slow press read could outlast it); CDP press-then-release (works, cause unexplained).
   - Evidence: `runs/pw-mouse-synced-*.jsonl`.
   - Revert: switch back to the 80 ms hold the e2e uses.
3. **New MCP tool `run_action`, plus a daemon endpoint for it.**
   - What: the inputs, wait rule, return value and errors above. The daemon endpoint is a `docs/PROTOCOL.md` change and needs its own D-entry before it's built (Tier 2).
   - Why: the owner's target (a): one call to trigger and get the trace. This also meets "which code handles Checkout?" with no human click.
   - Alternatives: let the agent click with another tool, then call `find_code_for_action` (two tools, and wrong traces as measured).
   - Revert: remove the tool and the endpoint; the protocol version stays compatible if the endpoint is additive.
4. **Targets by role and name, with `within`; ambiguity is an error.**
   - Why: text and role-and-name alone matched 2 elements for Add to cart. Refs die on a reload.
   - Revert: change the input parsing; nothing stored depends on it.
5. **Headless stays the default for agent runs.**
   - Why: headed and headless traces matched 20 of 20. Headless doesn't open windows on the user's desktop.
   - Revert: flip the default.

## Reproduce

```
pnpm build
node bench/prototypes/browser-control/run.mjs pw-mouse-synced --out <raw>
node bench/prototypes/browser-control/compare.mjs --out <raw>
```

Other methods are listed in `bench/prototypes/browser-control/methods.mjs`. The shop's ports are fixed at 3001 and 5173; the runs here used 3101 and 5273, changed locally and not committed. On a fresh worktree, the first e2e run timed out waiting for the product list while Vite built its cache (`e2e-first-attempt.txt`). The second passed.
