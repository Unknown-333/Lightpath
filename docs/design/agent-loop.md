# Phase 2 design: the agent loop

Written 2026-11-01 for work item it_e04ab842. Status: design, nothing built. Builds start only after the real-app suite is committed (D-110).

The owner's ask: "Change how traces are requested, shaped and delivered, so the agent runs the loop itself: trigger an action, get the trace, investigate, verify a fix." This doc turns the Phase 2 targets (a) to (f) and the lead's rulings of 2026-11-01 into requirements, a design, and a build plan. Decisions are D-113 to D-124 in [decisions.md](../../decisions.md); the two architectural ones are [ADR 0007](../adr/0007-run-action.md) (run_action endpoint) and [ADR 0008](../adr/0008-trace-output.md) (trace output).

Evidence comes from the five Phase 1 docs in [docs/research/](../research/) and from reading the code at `agent-loop` 723a5e9. Numbers are quoted from those docs; this item ran nothing timed.

## 0.1.0 scope and cuts

The owner set what "finished" means for 0.1.0 (2026-11-01, 05:15 UTC), verbatim:

> 1. run_action: the agent clicks by itself and gets the trace in one call.
> 2. Compact output by default (under 4,000 tokens), with a deeper look on request.
> 3. lightpath init: one command each for Claude Code, Cursor, VS Code and Kiro, tested in CI.
> 4. Errors and failed requests shown in traces, the MCP server starts Lightpath by itself, and secrets are hidden.
> 5. An MCP tool for API-only backends: the agent sends an HTTP request and gets the backend lines it ran, no browser needed. Size it; if it's small, it ships in 0.1.0.
> 6. No existing test, e2e, bench or VS Code test breaks.
>
> Cut anything that doesn't serve these or the launch. Tell me what you cut. Shipping a working product now comes before more research.

### Builds mapped to the six items

| Build                                        | 0.1.0 item | Section  | Size   | In 0.1.0 |
| -------------------------------------------- | ---------- | -------- | ------ | -------- |
| 1. run_action                                | 1          | 4        | medium | yes      |
| 2. Output: summary, drill-down, diff         | 2          | 6, 7     | large  | yes      |
| 5. run_request                               | 5          | 4A       | small  | yes      |
| 4. Errors, auto-start, redaction             | 4          | 8, 9, 11 | medium | yes      |
| 3. init, doctor, CI `setup` job              | 3          | 10       | medium | yes      |
| Every build: the full test suite stays green | 6          | 14       | n/a    | yes      |

Sizes are this doc's estimate from the files each build touches (section 14), not a measurement. Order: 1 → 2 → 5 → 4 in series, 3 beside them.

### Cut from 0.1.0

| Cut                                                     | Why                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `page_snapshot` tool                                    | Role and name named every shop target; revisit only if runs show agents can't name targets |
| "sent by" initiator line                                | Needs a model field and async stacks; no evidence agents need it yet                       |
| Call order inside a phase                               | Sampling misses most functions; breakpoints cost 82.7 ms per click (call-order.md)         |
| The 60-90 s demo video                                  | Not one of the six items; the 15 s GIF covers the README                                   |
| Launch post drafts                                      | The owner writes them; we prepare facts, numbers and the GIF                               |
| The Chrome DevTools MCP benchmark condition (`browser`) | Not one of the six items; credits go to `without` and `with`                               |
| More research                                           | The owner: shipping a working product comes first                                          |
| Everything in section 15                                | Each is listed there with its reason                                                       |

After 0.1.0, in this order: Next.js, WebSocket (socket.io), Python (FastAPI).

## Contents

1. [Requirements](#1-requirements)
2. [Tools](#2-tools)
3. [Server instructions and tool descriptions](#3-server-instructions-and-tool-descriptions)
4. [run_action](#4-run_action)
   4A. [run_request](#4a-run_request)
5. [Wire protocol and trace model changes](#5-wire-protocol-and-trace-model-changes)
6. [Output: summary, drill-down, diff](#6-output-summary-drill-down-diff)
7. [Fix verification](#7-fix-verification)
8. [Errors and failed requests](#8-errors-and-failed-requests)
9. [Redaction](#9-redaction)
10. [Setup: init, doctor, CI](#10-setup-init-doctor-ci)
11. [Auto-start from lightpath mcp](#11-auto-start-from-lightpath-mcp)
12. [Local-only](#12-local-only)
13. [Measures in this phase](#13-measures-in-this-phase)
14. [Build plan](#14-build-plan)
15. [What we cut](#15-what-we-cut)
16. [Risks](#16-risks)
17. [Open questions](#17-open-questions)
18. [Decision index](#18-decision-index)

## 1. Requirements

Each requirement names the owner's target it serves, the success metric it can move, and the ruling it comes from. "R" numbers are used in the build plan.

| R   | Requirement                                                                                                                                                   | Target | Metric it can move                                    | Ruling       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- | ------------ |
| R1  | One tool call clicks or presses a key in the app and returns that action's trace, frontend and backend. No human click, no CDP port.                          | a      | Product proof; Phase 3 "Checkout with no human click" | 2            |
| R2  | Every tool result is at most 16,000 characters. A cut result ends with one line naming the call that shows the rest.                                          | b      | Token budget N                                        | 3            |
| R3  | The default trace text is a function summary grouped by phase: before the first request, each request's backend, after the response (D-128).                  | b      | Product proof (fewer steps)                           | 3            |
| R4  | A drill-down by file or function returns the executed lines with not-run lines and untaken blocks marked, paged under 16,000 characters.                      | b      | Product proof                                         | 3            |
| R5  | `diff_traces` compares two traces at function level. Fix verification is run_action, fix, run_action, diff_traces. No new tool.                               | c      | Product proof (correct-fix rate)                      | 5            |
| R6  | `lightpath init --agent <claude-code\|cursor\|vscode\|kiro>` writes that agent's MCP config and the marked `AGENTS.md` block, and `CLAUDE.md` when it exists. | d      | Setup success; time to first wow                      | 6            |
| R7  | `lightpath doctor` checks what init wrote, including how `npx` starts on Windows. CI tests each agent's setup with no agent installed.                        | d      | Setup success                                         | 6            |
| R8  | The MCP server sends `instructions` under 1,000 characters; each tool description is under 300 characters with trigger words first.                           | d      | Product proof (agent picks the tool)                  | 4            |
| R9  | A trace lists browser console errors, uncaught exceptions, failed requests (400 and up, or network errors), Node uncaught errors and 5xx responses.           | e      | Product proof                                         | 7            |
| R10 | When a tool needs the daemon and none runs, `lightpath mcp` starts `lightpath dev` in the background from the dev command in `lightpath.config.json`.         | e      | Time to first wow                                     | 8            |
| R11 | Tool output never holds request or response bodies or headers; secret-looking query values and message parts become `[redacted]`.                             | f      | Hard line (local-only, redaction)                     | 9            |
| R12 | Everything stays on 127.0.0.1 with the token. Nothing leaves the machine.                                                                                     | f      | Hard line                                             | 10           |
| R13 | No existing test, e2e, bench or VS Code test regresses. Node 22.12+.                                                                                          | all    | No regressions                                        | owner        |
| R14 | One tool call sends an HTTP request to the app's own loopback origin and returns the backend code it ran. No browser needed.                                  | a      | Product proof on API-only apps; time to first wow     | 0.1.0 item 5 |

Non-goals (owner): production monitoring, new language backends, any hosted service.

## 2. Tools

Ruling 1, D-113, and 0.1.0 item 5 (D-125). After Phase 3 the MCP server has six tools: the lead's five, plus `run_request` from the owner's 0.1.0 scope.

| Tool                   | Status  | Job                                                                    |
| ---------------------- | ------- | ---------------------------------------------------------------------- |
| `run_action`           | new     | Do one click or key press in the app; return its trace                 |
| `run_request`          | new     | Send one HTTP request to the app on loopback; return its backend trace |
| `find_code_for_action` | changed | Latest recorded trace whose label matches; summary output              |
| `get_trace`            | changed | One trace: summary, or drill-down by file or function, paged           |
| `list_traces`          | changed | Recent traces with ids, file counts and error counts                   |
| `diff_traces`          | changed | Two traces compared at function level                                  |

No `page_snapshot` tool for now. Revisit only if benchmark runs show agents can't name targets (D-113).

Size: today's `tools/list` is 4 tools in 1,769 characters ([competitors.md](../research/competitors.md), measured against Playwright MCP's 21,060 and Chrome DevTools MCP's 29,661). The new list must stay at most **4,000 characters**, checked by a test in build 2 and again in build 5. This number is a budget, not a measurement: six descriptions under 300 characters plus the input schemas. If six tools don't fit, build 5 shortens descriptions, not the cap.

## 3. Server instructions and tool descriptions

Ruling 4, D-119. With tool search on (Claude Code, Kiro IDE 1.3+ and CLI V3, Cursor: from docs, [agent-mcp-behavior.md](../research/agent-mcp-behavior.md)), the model may see only tool names and the server's `instructions` before it decides. Lightpath sets no `instructions` today.

The texts below are the build's starting point. Character counts were measured on these exact strings (raw: `goal/design-raw/text-lengths.txt`).

**Server `instructions`** (730 characters with build 5's run_request clause, cap 1,000):

> Lightpath records which source lines actually ran, in the browser and on the Node server, for each action in the user's running app. It uses real runtime coverage, not static analysis. Use it when asked which code handles a button, page or request, why an action fails, or whether a fix changed what runs. run_action clicks or presses a key in the app and returns that action's trace in one call; run_request does the same for one HTTP request, with no browser; find_code_for_action returns the latest trace for a label without acting. Every result is capped at about 4,000 tokens: follow its 'not shown' line to drill down with get_trace. To check a fix, call run_action before and after it, then diff_traces with both trace ids.

**Tool descriptions** (cap 300 each; shortened in build 5 so six tools fit in 4,000 characters, D-129):

| Tool                   | Chars | Description                                                                                                                                                                                                                          |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run_action`           | 227   | Click a button or link, or press Enter or Space, in the user's running app, and return the code that ran, frontend and backend. Can fill fields first. Use it to see which code handles a UI action, or to rerun a bug after a fix.  |
| `find_code_for_action` | 193   | Find the files, functions and lines that ran, frontend and backend, the last time an action was done in the app. Use it before searching files when asked which code handles a button or feature.                                    |
| `get_trace`            | 185   | Show the executed code of one recorded action, one file or function at a time, with lines that did not run marked, paged. Use it after a 'not shown' line, or to read which branches ran.                                            |
| `list_traces`          | 124   | List recent recorded actions, newest first, with trace ids and file counts. Use it to find ids for get_trace or diff_traces.                                                                                                         |
| `diff_traces`          | 183   | Compare two traces of the same action, before and after a code change, at function level: functions and branches that ran in only one, and changed call counts. Use it to verify a fix.                                              |
| `run_request`          | 228   | Send one HTTP request to the user's running app on localhost and return the backend files, functions and lines it ran, with its status. No browser needed: use it for APIs and backend-only apps, or to rerun a request after a fix. |

The server instructions gain one clause in build 5, "run_request does the same for one HTTP request, with no browser", and must stay under 1,000 characters (665 today).

Tests (build 2): `instructions.length < 1000`, every description `< 300`, and the `tools/list` JSON at most 4,000 characters. The run_action text above includes "Can fill fields first" (the lead's decision on typing, section 4.1); the `css=` form is left to the input schema's own description to stay under 300.

## 4. run_action

Ruling 2, D-114, D-115, [ADR 0007](../adr/0007-run-action.md). Method from [browser-control.md](../research/browser-control.md).

### 4.1 Inputs

| Input       | Type                                                                   | Default  | Meaning                                                                               |
| ----------- | ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `target`    | string, 1 to 500 chars                                                 | required | What to act on. Forms below.                                                          |
| `within`    | string, 1 to 200 chars                                                 | none     | Text of an enclosing element, to pick one row: `Coffee mug`                           |
| `action`    | `click` \| `press`                                                     | `click`  | Mouse click, or a key press on the target                                             |
| `key`       | `Enter` \| `Space`                                                     | `Enter`  | Only with `press`                                                                     |
| `timeoutMs` | integer, 500 to 30,000                                                 | 5,000    | Settle cap for this action's trace (the collector's `maxSettleMs`)                    |
| `fill`      | array of `{ target, value }`, at most 20; `value` at most 10,000 chars | none     | Fields to fill, in order, before the action. Same target forms and errors as `target` |

**Typing (the lead's decision, 2026-11-01).** run_action takes an optional `fill` list. Each entry is filled in order with Playwright `locator.fill()` before the press or key. Typing opens no trace (D-079), so the trace is still the action's alone and the boundary stays at the press. There is no separate typing tool: one call stays one action. The reason is the general need: a login form (tududi, one of the tested apps, needs a login before anything else), a search box, any form with fields. Fill values are treated as secrets: they never appear in tool output, traces, labels or logs (section 9, rule 6).

Target forms, tried in this order:

1. `css=<selector>`: a CSS selector (Playwright `page.locator`).
2. `<role> "<name>"`, where role is an ARIA role (`button`, `link`, `checkbox`, `tab`, `menuitem`, `option`, `radio`, `switch`, `combobox`, `textbox`, …): Playwright `getByRole(role, { name })`. The name match is Playwright's default (case-insensitive substring). When more than one element matches and exactly one matches the name exactly, that one is used.
3. Anything else is visible text: `getByText(text)`.

`within` narrows the search to the smallest element whose text contains `within` and that holds a match. On the shop, `button "Add to cart"` matches 2 elements; with `within: "Coffee mug"` it matches 1 (browser-control.md, "Naming the target").

### 4.2 How the action is sent

- **Fill first.** For each `fill` entry, find the field with the same rules as `target`, then `locator.fill(value)`. A field that isn't found, is ambiguous or isn't editable stops the call with that outcome and the entry's index, before any press. Filling happens outside any trace: `locator.fill` sets the value and fires `input` events but sends no key events, so the hook's `keydown` listener never pauses for it.
- **Click: the synced press.** Scroll the target into view and check it with no input (D-127): visible, enabled, its box unchanged over two animation frames, and `elementFromPoint` at its center inside the target. Not `locator.click({ trial: true })`: in Playwright 1.64 a trial run still sends a real press, which the hook sees, so every action opened two traces (measured in build 1). Move the mouse to the target's center. Mouse down. Wait until the collector has taken the boundary and resumed the page (a promise `#click()` resolves right after `#resume()`), capped at 2 s. Mouse up. On the release boundary (D-082) the press doesn't pause, so the mouse goes up at once and the pause happens at `pointerup`. Measured: 20 of 20 Add to cart and 20 of 20 Checkout traces matched the 80 ms human-style press, headless and headed; Checkout ready in 329.6 ms p50 against 408.8 ms for the hold.
- **Key: `locator.press`.** `Enter` or `Space` on the target. Key events aren't dropped during a pause (ADR 0003). Measured 20 of 20; the label gets " (Enter)" (D-079).
- **One action at a time.** Calls queue in the collector. A call also waits for any open trace (a person's click) to end first, so a response never lands in the next action's trace (the two-press split in browser-control.md).
- **Headless.** The browser `lightpath mcp` auto-starts is headless (browser-control.md recommendation 5). A `lightpath dev` the user started keeps its own setting.

### 4.3 When it is done

1. The collector's settle window ends the browser side: no requests in flight for 300 ms, or `timeoutMs`.
2. Then one wait of at most 1.5 s after `traceEnd`, which ends as soon as every request the collector tagged for this trace has its backend delta in the trace (matched by method and path). This is one wait for all requests, not 1.5 s each.
3. The daemon replies with the trace as stored.

A tagged request with no backend delta after 1.5 s (a remote API, a server not under `lightpath dev`) gives `backend: partial` and a warning naming the request.

### 4.4 Outcomes

HTTP status is for the transport only (section 5.1). The action's outcome is in the body.

| Code             | `ok`  | When                                                                              | What the agent sees                                         |
| ---------------- | ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| (none)           | true  | Trace recorded                                                                    | The summary (section 6)                                     |
| `timeout`        | true  | Settle cap reached                                                                | The partial trace, marked "timed out after N ms"            |
| `not_found`      | false | No element matches                                                                | Up to 10 closest role-and-name candidates                   |
| `ambiguous`      | false | More than one matches and no exact name match                                     | Match count and up to 10 candidates; never clicks the first |
| `not_actionable` | false | Disabled, hidden, or covered by another element; for a `fill` entry, not editable | Which of these, from Playwright's check                     |

`not_found`, `ambiguous` and `not_actionable` for a `fill` entry say which entry (`fill[1]`), never its value.
| `no_trace` | false | Input sent, but no boundary within 2 s | "No trace opened"; usually an element with no pointer or key handling |
| `click_lost` | true | A boundary, but the target got no `click` event | The trace, with a warning. Needs a capture `click` flag in the hook (build 1) |
| `no_browser` | false | `lightpath dev` runs without a browser, or it isn't open yet | How to start it |

Plus the MCP-side outcome when no daemon runs at all: auto-start (section 11) or today's "isn't running" message with the exact command.

### 4.5 Output

Same summary as every trace (section 6), with two header lines: `action: click button "Checkout" (boundary press, settled quiet)` and `page: <URL after the action, redacted>`. Warnings go on their own lines after the header.

## 4A. run_request

0.1.0 item 5, D-125. **Size: small. In 0.1.0: yes.** **No protocol change.**

The owner's ask: "An MCP tool for API-only backends: the agent sends an HTTP request and gets the backend lines it ran, no browser needed."

### How it works

1. The MCP server makes a trace id (`t_` + 12 random base36 characters, the `TraceId` format in `packages/protocol/src/model.ts`).
2. It sends one HTTP request with `fetch` from its own process, with `x-lightpath-trace: <id>`.
3. The Node agent's existing request bracket (ADR 0004, `packages/node-agent/src/agent.ts`) reads the header, takes coverage at request start and at response finish, and sends a `delta` with that trace id and the request's method, path and status. The daemon already turns a delta with an unknown trace id into a backend trace labelled `POST /api/orders` (`Correlator.#pendingFor`). Nothing new on the wire.
4. After the response arrives, the MCP server waits up to 1.5 s for that trace on the client WebSocket (`DaemonClient.onTrace`, pushed today), until it holds a backend request. Then it prints the trace in the compact output (section 6): the header, the request line, the backend phase, problems.

A request through Vite's proxy also works: the header passes through to the API server, as for a browser click today.

### Inputs

| Input         | Type                                                 | Default                               | Meaning                                                                           |
| ------------- | ---------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `method`      | `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS` | `GET`                                 |                                                                                   |
| `url`         | string, 1 to 2,000 chars                             | required                              | A path (`/api/orders`), resolved against the app's origin, or a full loopback URL |
| `body`        | string, at most 100,000 chars                        | none                                  | Sent as is                                                                        |
| `contentType` | string                                               | `application/json` when `body` is set |                                                                                   |
| `timeoutMs`   | integer, 500 to 30,000                               | 10,000                                | For the response                                                                  |

A path is resolved against `url` in `lightpath.config.json` (`lightpath init` doesn't write it; the user or agent can). Without one, the tool asks for a full loopback URL. No custom headers in 0.1.0: auth headers would be secrets the tool has to handle. Cut, listed in section 15.

### Loopback only

Sending to another host would send data off the machine (Tier 3). Rules, each with a test:

- The URL's scheme is `http` or `https` and its host is `localhost`, `127.0.0.1` or `[::1]`. Anything else is refused before any network call, with `not_loopback`.
- `localhost` is resolved first, and the request is refused unless every address is loopback.
- Redirects are not followed (`redirect: 'manual'`). A 3xx is reported with its status and the `Location` host only when that host is loopback.
- No proxy: the request ignores `HTTP_PROXY` and `HTTPS_PROXY`.

### What comes back

- Status, response size in bytes, duration, and the backend trace summary.
- Never the request body, request headers, response body or response headers (section 9, rule 1). The URL goes through the redactor (rule 2).
- Outcomes: `not_loopback`, `no_response` (connection refused or timeout: "is your server running under lightpath dev?"), `no_trace` (a response came, but no backend delta in 1.5 s: the server isn't under `lightpath dev`, or it skips this process), and success.
- `diff_traces` works on two run_request traces the same way (section 6.4), so the fix loop is run_request → fix → run_request → diff_traces.

### Why it is small

- MCP server only: one tool, a loopback check, and a wait on the existing trace feed. No daemon, protocol, browser or agent change.
- It reuses build 2's formatter and build 1's result header.
- Tests: the loopback rules (refuse `example.com`, `10.0.0.1`, a redirect to another host, a `localhost` that resolves elsewhere, using a fake resolver); `pnpm e2e:api` gains a run_request call through `lightpath mcp` for `POST /api/orders` that checks the trace has the route file and is at most 16,000 characters; the redaction test sends a body and a token in the query and checks neither appears.

### Where it sits in the build order

After build 2 and before build 4: 1 → 2 → 5 → 4. It shares `packages/mcp/src/server.ts` and `format.ts` with builds 1 and 2, and needs build 2's summary. Build 4 then adds problems and redaction to all tools, run_request included, so the "never echoed" and query tests run in build 4's redaction suite as well as build 5's own.

## 5. Wire protocol and trace model changes

All of this section is **Tier 2**: it changes `docs/PROTOCOL.md`. Each change has its D-entry, written before any code. All changes are additive and optional, so `protocolVersion` stays 1 ("Adding an optional field is not a version bump", PROTOCOL.md). Each build updates PROTOCOL.md and `packages/protocol` together, in the same commit.

### 5.1 New endpoint: `POST /v1/action` (build 1, D-115)

Added to the Transport table:

| Endpoint                                 | Transport                                                        | Who connects |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------ |
| `POST http://127.0.0.1:<port>/v1/action` | HTTP, JSON `ActionRequest` body, `Authorization: Bearer <token>` | MCP server   |

Same rules as `/v1/ingest`: 127.0.0.1 only; `Origin` header → 403; bad token → 401; body over 256 KB → 413 (room for 20 `fill` values of 10,000 characters); schema error → 400; other `protocolVersion` → 426. The reply comes when the action is done (section 4.3), so a call can take `timeoutMs` + 1.5 s + the press wait.

```ts
interface ActionRequest {
  protocolVersion: 1;
  target: string; // 1..500 chars: 'button "Checkout"', 'Checkout', 'css=button.primary'
  within?: string; // 1..200 chars
  action?: 'click' | 'press'; // default 'click'
  key?: 'Enter' | 'Space'; // only with 'press'; default 'Enter'
  timeoutMs?: number; // integer 500..30000; default 5000
  fill?: { target: string; within?: string; value: string }[]; // at most 20; value at most 10,000 chars; never echoed or logged
}

type ActionErrorCode = 'not_found' | 'ambiguous' | 'not_actionable' | 'no_trace' | 'no_browser';
type ActionWarningCode = 'timeout' | 'click_lost' | 'backend_partial';

type ActionResult =
  | {
      ok: true;
      trace: Trace; // as stored, after the backend wait
      boundary: 'press' | 'release' | 'key';
      settled: 'quiet' | 'timeout';
      backend: 'complete' | 'partial';
      pageUrl: string; // after the action
      warnings: { code: ActionWarningCode; message: string }[];
    }
  | {
      ok: false;
      error: {
        code: ActionErrorCode;
        message: string;
        candidates?: string[];
        count?: number;
        fillIndex?: number;
      };
    };
```

HTTP 200 carries both `ok: true` and `ok: false`. The daemon answers `no_browser` when no runner is registered (`daemon.setActionRunner()` not called yet).

### 5.2 Delta gains `beforeRequest` (build 2, D-116)

```ts
interface DeltaMessage {
  // ...existing fields
  beforeRequest?: { method: string; path: string }; // browser only: this delta ends when that request left the page
}
```

The browser collector sends one such delta per action, for its first tagged fetch or XHR only, from a coverage read in its `page.route` handler before `route.continue()` (D-128: on Actual a read took 27.98 ms p50, so later requests don't wait for one). Not for navigation requests: a read inside a held navigation deadlocks (ADR 0003, measured), and the `beforeunload` read already splits a page load. `path` has no query string, like the Node agent's request path (`packages/node-agent/src/agent.ts`).

### 5.3 Trace model gains `phases` and `functions` (build 2, D-116)

`FileHits` doesn't change, so the VS Code extension and the CLI printer keep working.

```ts
interface TracePhase {
  kind: 'before-request' | 'backend' | 'after-response' | 'browser'; // 'browser': a browser action with no tagged request
  request?: number; // index into Trace.requests, for 'before-request' and 'backend'
}

interface FunctionHit {
  path: string; // workspace-relative, like FileHits.path
  collector: CollectorKind;
  name: string; // '' when V8 has no name; printed "(anonymous)"
  startLine: number; // original, 1-based
  endLine: number;
  count: number; // calls in this phase; 0 means the function resumed (after an await) without a new call
  notRun?: number[]; // lines inside the function known not to have run (count 0), sorted
  notRunSpans?: { line: number; startColumn: number; endColumn: number; text: string }[]; // untaken blocks inside a line that ran; text at most 40 chars
  phase: number; // index into Trace.phases
}

interface Trace {
  // ...existing fields
  phases?: TracePhase[];
  functions?: FunctionHit[]; // outermost and nested; a function that runs in two phases appears twice
}
```

How the daemon fills them:

- Phases in time order: for each browser action delta with `beforeRequest` (one per action at most, D-128), a `before-request` phase; each backend delta (Node or Python) is a `backend` phase for its request; the browser's other reads (closing, leaving) merge into one last phase, `after-response`. With no `beforeRequest` delta, the browser side is one `browser` phase.
- A `before-request` phase is tied to the backend request with the same method and path, first unmatched in time order.
- Functions come from the V8 function list in each delta. A new core function maps each function's first range (its whole body) through the same line index and source map as `mapScript`, then takes `notRun` from the zero-count lines inside it. `mapScript` already returns those zeros (`packages/core/src/lines.ts`); `Correlator.#publish` drops them today.
- Python `lines` messages have no functions: Python files appear in `files` only, and the summary lists them by line range as today.

### 5.4 New ingest message `problem`, trace model gains `problems` (build 4, D-121)

```ts
interface ProblemMessage {
  type: 'problem';
  traceId?: TraceId;
  at: number; // ms since epoch
  kind: 'exception' | 'console-error' | 'request-failed' | 'uncaught';
  message: string; // at most 1,000 chars, cut by the sender
  location?: { url: string; line: number; column: number }; // generated position of the first app frame, if known
  request?: { method: string; path: string; status?: number; failure?: string }; // for 'request-failed'
}

interface TraceProblem {
  collector: CollectorKind;
  kind: ProblemMessage['kind'];
  message: string; // stored as received; redacted when printed (section 9)
  at: number;
  path?: string; // workspace-relative, when the location maps into the workspace
  line?: number;
  request?: ProblemMessage['request'];
}

interface Trace {
  // ...
  problems?: TraceProblem[]; // at most 50 per trace; more are counted in problemsDropped
  problemsDropped?: number;
}
```

`TraceSummary` gains `problemCount?: number` for `list_traces`.

### 5.5 What doesn't change

`/v1/ingest`, `/v1/client`, `/v1/health`, the token, the `Origin` check, the 8 MB cap and the discovery file stay as they are. Request and response bodies and headers are never collected (R11).

## 6. Output: summary, drill-down, diff

Ruling 3, D-109, D-116, D-117, D-118, [ADR 0008](../adr/0008-trace-output.md). Method from [call-order.md](../research/call-order.md) recommendations 1, 2, 3 and 5.

### 6.1 The default: a function summary by phase

Used by `run_action`, `find_code_for_action` and `get_trace` with no file or function. The output below is the shop's Checkout as build 2 prints it (`pnpm e2e`, 2026-11-01): 1,023 characters, against 574 for the old `describeTrace()` text. Since D-128 the browser is read once before the action's first request, so "before" holds the browser code up to the first request, and "after the response" everything after it.

```text
Trace t_dmy3l7cssiv8: button: Checkout
request: POST /api/orders → 201 (node, 21 ms)

before POST /api/orders [browser]
  src/api.ts
    placeOrder 25-36 ×1 not run: 31-35
  src/Cart.tsx
    Cart 11-50 ×2 not run: 26-32
    (anonymous) 16-19 ×2
    (anonymous) 17 ×2
    checkout 21-33 ×1 not run: 26-32
  src/money.ts
    formatCents 3-5 ×2
POST /api/orders → 201 [node, 21 ms]
  server/db.ts
    findProduct 26-28 ×3
    (anonymous) 27 ×3
    saveOrder 30-38 ×1
  server/routes/orders.ts
    createOrder 11-40 ×1 not run: 15-17, 22-24, 26-28, 34-36
  server/services/payment.ts
    charge 6-12 ×1 not run: 8-9
  server/services/pricing.ts
    priceCart 12-33 ×1 not run: 23-24
after the response [browser]
  src/App.tsx
    App 6-43 ×2 not run: 11, 14-22
    (anonymous) 29-37 ×6
    onCheckedOut 40 ×1
  src/api.ts
    placeOrder 25-36 resumed not run: 25-30, 33-34, 36
  src/Cart.tsx
    Cart 11-50 ×2 not run: 17-18, 21-25, 29, 33
    checkout 21-33 resumed not run: 21-25, 29, 33
  src/money.ts
    formatCents 3-5 ×7
```

Not-run lines are per phase: in "before", `checkout` hasn't reached its `await` result yet (26-32); in "after", it resumed and ran those lines. `run_action` adds its action, page and warning lines after the first line. The problem lines (section 8) join in build 4.
Rules:

- Header lines always print: trace id and label, action line (run_action only), page URL (run_action only), up to 20 request lines (then "+N more requests"), and the problem lines (section 8).
- Inside a phase: files, then functions in line order, each with its line range, call count (`×N`, or `resumed` when 0), and not-run lines. No order inside a phase (call-order recommendation 3).
- Files whose lit lines are all background (FileHits `background`) print last in their phase with "(background)".
- The old "not shown: N reason" line for dropped files is renamed "hidden:", so "not shown" means one thing: output cut for size.

### 6.2 Ranking and the cut

The budget is 16,000 characters per tool result (D-109). Every tool's text goes through one `fit()` function in `packages/mcp/src/budget.ts`, so no path can go over.

1. Build the full text. If it fits, return it.
2. Otherwise keep the header lines, then drop whole files, lowest rank first, until the text plus the cut line fits. Rank: non-background before background, then by total hits in the file, high first. A file dropped in one phase is dropped in all phases.
3. End with: `not shown: 37 files, 412 functions (31,800 chars). Call get_trace with traceId "t_…" and file "<highest-ranked dropped file>" to see one.`
4. As a last guard, `fit()` cuts at a line boundary under 16,000 and adds the cut line, whatever the tool.

On the shop's Checkout the summary was 775 characters before phase headers (call-order.md), so it fits with room.

### 6.3 Drill-down: `get_trace` with `file` or `function`

Inputs: `traceId` (required), `file` (a path or a unique part of one), `function` (a name), `page` (1-based, default 1). A `file` or `function` that matches more than one entry returns the candidates instead.

Output is the executed-code slice of each outermost function that ran in that file (or of that one function), merged over all phases:

```text
server/routes/orders.ts (trace t_p6szzi2njx9d, phase POST /api/orders)
  11  export function createOrder(req: Request, res: Response): void {
  12    const body = req.body as OrderBody;
  13    const lines = body.lines ?? [];  // not run: ?? []
  14    if (lines.length === 0) {
      // not run: lines 15-17
  19    for (const line of lines) {
```

(Excerpt from call-order.md section 3, measured.)

- Lines that ran print with their numbers. Each run of not-run lines folds into one `// not run: lines A-B` marker. Untaken blocks inside a line that ran get `// not run: <text>` from `notRunSpans`. Lines with no coverage (blank, comments) are left out.
- **Source text is read from disk by the MCP server**, from the workspace roots in the daemon's `welcome`. Only paths in the trace are read, and only when their real path is inside a root. When the file's modification time is later than the trace's start, the first line says: `warning: <path> changed after this trace; line numbers may not match. Rerun the action for a fresh trace.`
- Lines longer than 200 characters are cut with "…" (minified code).
- **Paging**: pages break between functions. One function longer than a page breaks between lines. Each page ends with `page 1 of 3. Call get_trace with traceId "t_…", file "<path>", page 2 for the next.` On the shop the largest file's slice was 1,580 characters, so each shop file is one page.
- Source lines go through `redactSource` (D-145, section 9), which keeps line numbers. Since D-145 the trace answers also end with these executed lines for each file, most-used first, inside the 16,000 cap.

### 6.4 `diff_traces` at function level

Functions are matched by file, name, and order among same-named functions in that file. Line numbers aren't used to match, because a fix moves them. Output, in this order, cut by `fit()`:

1. Problems: counts in A and B, and the first message that appeared or went away.
2. Requests whose status changed: `POST /api/orders 500 → 201`.
3. Functions that ran in only one trace.
4. Functions in both whose not-run lines changed: "now runs 26-28; no longer runs 22-24", each side in its own trace's line numbers.
5. Functions whose call count changed.

When nothing differs: `none: both traces ran the same functions and branches`.

### 6.5 Existing tests whose assertions change (Tier 2)

The summary no longer prints `<path> [<collector>] lines <ranges>`. These assertions change, each to one at least as strict (D-116):

| Test                                                               | Asserts today                                                                 | Asserts after build 2                                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/e2e-shop.mjs`, M5 exit check                              | `find_code_for_action("Checkout")` holds each file with its exact line ranges | The summary names every file of the trace; `get_trace` with `file` prints every lit line number of that file; the text is at most 16,000 chars |
| `packages/mcp/test/format.test.ts` (`describeTrace`, `diffTraces`) | Exact old text                                                                | `describeTrace` stays and keeps its test; new tests cover the summary, slices, cut line and function diff                                      |
| `packages/cli/test/mcp.integration.test.ts`                        | Tool names = 4; text holds `src/Cart.tsx [browser] lines 21-22`               | Tool names = 5 (6 after build 5); the summary names `src/Cart.tsx`; `get_trace` with `file` prints lines 21 and 22                             |

## 7. Fix verification

Ruling 5, D-118. No new tool. The loop the instructions and `AGENTS.md` describe:

1. `run_action` → trace A. Read it; drill down if needed.
2. The agent edits the code. Vite's hot reload or the dev server's restart picks it up, as for a person.
3. `run_action` with the same inputs → trace B.
4. `diff_traces` with A and B: did the error go away, did the status change, did the intended branch run.

A risk: if the server restarts slowly after an edit, step 3 can race it. The run_action result then shows a failed request (section 8), and the agent can call it again.

## 8. Errors and failed requests

Ruling 7, D-121. Attached to the trace that was open when they happened. Outside an open trace they are dropped.

| Source  | What                                                                | Captured by                                                                                                                                 |
| ------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser | Uncaught exceptions and unhandled rejections                        | Playwright `page.on('pageerror')`                                                                                                           |
| Browser | `console.error` calls                                               | `page.on('console')` with type `error`                                                                                                      |
| Browser | Responses with status 400 and up (fetch, XHR, document)             | `page.on('response')`                                                                                                                       |
| Browser | Network errors                                                      | `page.on('requestfailed')`; `net::ERR_ABORTED` from a navigation of the page is skipped                                                     |
| Node    | Uncaught exceptions and unhandled rejections that reach the process | `process.on('uncaughtExceptionMonitor')`, which watches without changing whether the process exits. The message is sent before exit (below) |
| Node    | 5xx responses                                                       | Already in the request's `status`; no new capture                                                                                           |
- Node delivery: the agent sends batches with an async `fetch`, which can't finish once an uncaught exception ends the process. The build sends the one `problem` message synchronously before exit: a child `node` process doing the POST with `execFileSync`, `NODE_OPTIONS` cleared so the child doesn't load the agent, 2 s timeout. The test: a server that throws in a timer during a tagged request; the trace shows the `uncaught` problem.
- A Node problem joins a trace only when exactly one tagged request is in flight; otherwise it is dropped (counted in the agent's debug log).
- Errors that Express catches and turns into a 500 show only as the 5xx status. Their message goes to the server's stderr, which Lightpath doesn't read (cut, section 15).
- The default output prints counts plus the first message, redacted, at most 200 characters:

```text
errors: 2 (first: TypeError: Cannot read properties of undefined (reading 'qty') at src/Cart.tsx:26)
failed requests: 1 (first: POST /api/orders → 500)
```

"failed requests" counts requests with status 400 and up from the browser or the backend, plus network errors, once each by method, path and status.

## 9. Redaction

Ruling 9, D-123. One module, `packages/mcp/src/redact.ts`, applied to every field that comes from the app at runtime: problem messages, request paths and URLs, the page URL, and trace labels. Source code a tool returns gets `redactSource`, a variant for code (D-145, below the table). Rule 6 ships with build 1, since `fill` does; rules 2 to 5 with build 4.

| Rule | What                                                                                                                                                                                                                                                             | Example in → out                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1    | Bodies and headers are never collected or printed. A test sends a request with a secret body and an `Authorization` header and checks neither reaches any tool output.                                                                                           | n/a                                                                                     |
| 2    | URL query values whose parameter name contains `token`, `key`, `secret`, `pass`, `auth`, `session` or `sig` (any case)                                                                                                                                           | `/cb?code=1&session_id=abc` → `/cb?code=1&session_id=[redacted]`                        |
| 3    | Bearer tokens                                                                                                                                                                                                                                                    | `Bearer eyAbc.def` → `Bearer [redacted]`                                                |
| 4    | JWT-like strings: three base64url parts joined by dots, the first starting `eyJ`                                                                                                                                                                                 | `eyJhbGciOi.eyJzdWIiOi.SflKxw` → `[redacted]`                                           |
| 5    | `key=value` and `key: value` pairs whose key contains one of the words in rule 2                                                                                                                                                                                 | `password=hunter2` → `password=[redacted]`; `"apiKey": "x1"` → `"apiKey": "[redacted]"` |
| 6    | run_action `fill` values (lead's decision): never in tool output, traces, labels or logs. The MCP server replaces every occurrence of a value it sent in this call (4 characters or longer) in the result text; the collector and daemon never log or store them | App echoes `hunter2` into a console error → `[redacted]`                                |
- Each rule gets its own test, plus one test that runs a trace with all of them through every tool.
- Rules 2 and 5 over-redact on purpose (`monkey=1` matches `key`). A missed secret is worse than a hidden harmless value.
- Source code (D-145): rules 3 and 4 as above, rule 2 inside URLs, rule 5 for string literals only (so `const session = await getSession()` stays readable), plus well-known key formats and PEM private keys. Rule 6 runs over the code too.
- Redaction happens at the MCP output, not at capture: the daemon keeps raw text in memory on the user's own machine, as it keeps source code today. Loosening this rule later is Tier 3.

## 10. Setup: init, doctor, CI

Ruling 6, D-120. Per-agent files from [agent-mcp-behavior.md](../research/agent-mcp-behavior.md) (all from docs).

### 10.1 `lightpath init --agent <claude-code|cursor|vscode|kiro>`

One command per agent. Run in the project folder (must hold a `package.json`). It writes:

| Agent         | MCP config file           | Shape                                                                      |
| ------------- | ------------------------- | -------------------------------------------------------------------------- |
| `claude-code` | `.mcp.json`               | `{"mcpServers": {"lightpath": {"command": …, "args": […]}}}`               |
| `cursor`      | `.cursor/mcp.json`        | same `mcpServers` shape                                                    |
| `vscode`      | `.vscode/mcp.json`        | `{"servers": {"lightpath": {"type": "stdio", "command": …, "args": […]}}}` |
| `kiro`        | `.kiro/settings/mcp.json` | same `mcpServers` shape                                                    |
- Command: `npx` with `["-y", "@lightpath-dev/cli@<this CLI's version>", "mcp"]` on macOS and Linux. On Windows: `cmd` with `["/c", "npx", "-y", "@lightpath-dev/cli@<version>", "mcp"]`. Windows needs the wrapper because `npx` is a `.cmd` shim, and a client that starts it without a shell can't run it; the owner's own Kiro config uses `cmd /c npx`. CI on windows-latest checks both forms (10.3). The version is pinned so `lightpath mcp` and `lightpath dev` speak the same protocol.
- Existing files are merged: other servers and keys stay. A file that isn't plain JSON (VS Code allows comments) is left alone, and init prints the block to paste by hand. No new runtime dependency for a JSONC parser.
- `lightpath.config.json`: created when missing, with `$schema`, `command` and `autoStart: true` (section 11). `command` comes from `package.json`'s `dev` script, run with the package manager its lockfile names (`pnpm-lock.yaml` → `pnpm run dev`, `yarn.lock` → `yarn dev`, `bun.lock` or `bun.lockb` → `bun run dev`, otherwise `npm run dev`). An existing file gains only the keys it lacks. With no `dev` script, init writes no `command`, says so, and auto-start stays off.
- The marked block, created or replaced between its markers in `AGENTS.md`, and in `CLAUDE.md` when that file exists (Claude Code skips `AGENTS.md` when `CLAUDE.md` exists, from docs). Tool names are generated from the server's tool list so they can't drift:

```markdown
<!-- lightpath:start -->
## Lightpath: what code actually ran

This app runs under `lightpath dev`, which records the source files, functions and lines that ran, frontend and backend, for each click, key press or request.

- Asked which code handles a button, page or request, or why an action fails? Call the Lightpath MCP tool `run_action` with the target, like `button "Checkout"`, before searching files. To read the last recorded action instead, call `find_code_for_action`.
- Output is capped. To see more, follow its "not shown" line.
- After a fix, call `run_action` again with the same target and compare the two traces with `diff_traces`.
- If Lightpath says it isn't running, start `lightpath dev` in the project folder, or ask the user to.
<!-- lightpath:end -->
```

- Running init twice gives the same files (test).
- Kiro custom agents need `"resources": ["file://AGENTS.md"]` to see the block (from docs). Init prints that note for `--agent kiro`; it doesn't edit agent files.

### 10.2 `lightpath doctor` checks what init wrote

New checks, after the existing five:

- For each of the four config files that exists and has a `lightpath` entry: it parses; its command has the right form for this OS (on Windows, a bare `npx` fails with the fix); the command starts and answers MCP `initialize` and `tools/list` within 20 s, with the tool count this CLI version ships.
- **Doctor starts the command offline** (`npm_config_offline=true`), so `npx` can't download anything. Downloading would be a new network call from Lightpath (Tier 3). If the package isn't installed locally, doctor says "npx would download @lightpath-dev/cli@<version> on first start; not checked offline" instead of failing.
- `AGENTS.md` has the block and its tool names match `tools/list`; same for `CLAUDE.md` when it exists.
- `lightpath.config.json` has `command`, and `autoStart` is on or off (shown, not judged).

### 10.3 CI: each agent's setup, no agent installed

A new CI job, `setup`, on ubuntu-latest and windows-latest:

1. `pnpm build`, then `pnpm pack` each package into a temp folder.
2. For each of the four agents, a fresh temp project (a `package.json` with a `dev` script and a lockfile), the tarballs installed into it.
3. `lightpath init --agent <agent>`. Check the written file against the expected JSON, the `AGENTS.md` block, and `lightpath.config.json`.
4. Start the configured command exactly as written (no shell) with `npm_config_offline=true`; send `initialize` and `tools/list`; expect the tool names this CLI version ships.
5. `lightpath doctor` exits 0.
6. On Windows only: also start a bare `npx` without a shell and record whether it fails, so the `cmd /c` choice rests on a CI log, not a guess.

## 11. Auto-start from lightpath mcp

Ruling 8, D-122. **Tier 2: config schema change.**

- `lightpath.config.json` gains one key: `autoStart` (boolean, default false). `command` already exists (D-094). The schema file `packages/cli/lightpath.config.schema.json` is regenerated, and its test keeps it equal to the zod schema.
- Why a new key, when the ruling only needs `command`: with auto-start, a tool call by the agent runs a shell command from a file in the repo. A cloned repo's config could name any command, and some users auto-approve MCP tools. `autoStart: true` is written by the user's own `lightpath init`, so the user opts in for this project. A malicious repo could still commit `autoStart: true`, so the result text always shows the command it ran.
- When a tool needs the daemon and finds no discovery file (or a stale one), and the config in the MCP server's root folder has `command` and `autoStart: true`: the server starts `node <cli>/dist/bin.js dev --headless` in that folder, with stdout and stderr appended to `.lightpath/dev.log`. It waits up to 60 s for the discovery file and `GET /v1/health`, then for run_action up to the same 60 s for the browser (`no_browser` retried). The tool's result starts with `started lightpath dev ("npm run dev") in the background; log: .lightpath/dev.log`.
- The background `lightpath dev` is a child of the MCP server and stops when the MCP server exits (its tree is killed on Windows). If the MCP server is killed hard, the orphan's discovery file lets the next MCP server reuse it.
- Otherwise the tool returns today's message with the exact command: `Lightpath isn't running in <root>. Start it with: lightpath dev -- <your dev command>`; with a config `command` but no `autoStart`, the message names that command and how to turn auto-start on.
- `lightpath mcp` reads the config the way `lightpath dev` does: only the folder it starts in, or `--root`. VS Code starts a stdio server in the workspace folder by default ([VS Code MCP configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration), `cwd`, from docs, read 2026-11-01). For Claude Code, Cursor and Kiro the start folder isn't stated on the pages read for agent-mcp-behavior.md. If a client starts the server elsewhere, auto-start finds no config and falls back to the message. The discovery walk up the folders (D-096) helps only when it starts in a subfolder of the project. The "isn't running" message names the folder the server looked in, as it does today.

## 12. Local-only

Ruling 10. Unchanged rules, now also covering the new endpoint:

- The daemon binds 127.0.0.1 only. `/v1/action` uses the same token and `Origin` check as the other routes.
- No CDP or debug port. The browser stays on a pipe.
- No telemetry, no hosted service, no new network call. Doctor starts `npx` offline (10.2). `npx` downloads by the user's own agent client are the client's, as today.
- The background `lightpath dev` binds the same way.
- `run_request` sends only to `localhost`, `127.0.0.1` or `[::1]`, follows no redirect and uses no proxy (section 4A).

## 13. Measures in this phase

Ruling 11. Another worker is building the measuring scripts now: `bench/first-wow` (time from `npx` to the agent's first useful answer on a fresh clone of a real app, target under 2 minutes) and `bench/readme-test` (what 3 to 5 fresh agents or people say after 10 seconds of the README top section).

| Measure               | Where the numbers go                                                              | When it is run                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Time to first wow     | `bench/first-wow/results/<date>.md` plus `results.jsonl` (layout from PR #26)     | First baseline as that item defines it; again after build 1 merges; once more after builds 3 and 4, which change the steps it times |
| README 10-second test | `bench/readme-test/results/<date>.md` plus `results.jsonl`, every answer verbatim | After build 1 merges, once the README's first screen can say the agent clicks; again whenever the top section changes               |
| Shop trace size       | `pnpm e2e` output (the 16,000-character check)                                    | Every CI run from build 2                                                                                                           |
| Agent suite, `with`   | `bench/agent-suite/results/` (D-108 rules, unchanged)                             | After builds 1 and 2, within the credit cap; held-out bugs only at the end                                                          |

README claims cite these files, never this doc.

## 14. Build plan

Ruling 12, plus build 5 (run_request) from the owner's 0.1.0 scope. Order: **build 1 → build 2 → build 5 → build 4**, one after another, because they share `packages/mcp/src/server.ts`, `packages/mcp/src/format.ts`, `packages/browser/src/collector.ts` and `packages/protocol`. Build 5 touches only the MCP server, but needs build 2's summary. **Build 3** runs beside them: it touches only `packages/cli` (init, doctor) and CI. None starts before the real-app suite is committed (D-110).

Every build: its D-entries are already written (this item); it updates `docs/PROTOCOL.md` and `docs/ARCHITECTURE.md` where it changes them; `pnpm check`, `pnpm e2e`, `pnpm e2e:api`, browser tests and `pnpm test:vscode` pass; CI is green; one PR into `agent-loop`.

### Build 1: run_action

| Files                                                | Change                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/protocol/src/messages.ts`, `index.ts`      | `ActionRequest`, `ActionResult` schemas; `postAction(port, token, req)` helper          |
| `packages/daemon/src/server.ts`, new `actions.ts`    | `POST /v1/action`, `setActionRunner()`, the backend wait                                |
| `packages/browser/src/collector.ts`, new `target.ts` | `runAction()`: target lookup, `fill`, synced press, key press, queue; hook `click` flag |
| `packages/mcp/src/` new `redact.ts`                  | Rule 6 (fill values); build 4 adds rules 2 to 5                                         |
| `packages/cli/src/dev.ts`                            | Registers the collector as the runner once the browser is open                          |
| `packages/mcp/src/server.ts`, `format.ts`            | `run_action` tool; result header lines; today's `describeTrace` body until build 2      |
| `docs/PROTOCOL.md`, `docs/ARCHITECTURE.md` 9.3       | Endpoint and messages                                                                   |
| `scripts/e2e-shop.mjs`                               | MCP run_action checks                                                                   |

Tests:
- Unit: target parsing (each form, `within`), outcome mapping.
- Daemon: `/v1/action` without token → 401, with `Origin` → 403, oversized → 413, no runner → `no_browser`; the backend wait ends early when the backend delta arrives and at 1.5 s when it doesn't.
- Real browser (`LIGHTPATH_BROWSER_TESTS=1`): synced press gives the same files and lines as an 80 ms held press, at the press and at the release boundary; Enter; `ambiguous` and `not_found` with candidates; `not_actionable` on a disabled button; `no_trace` on a Space press on a plain `div` (a click on a plain `div` does open a trace, with "no workspace code ran": the hook pauses on every primary press; the lead's ruling, 2026-11-01, during build 1); two calls in a row give two whole traces; `fill` then click gives a trace with no extra boundary from the typing; a `fill` entry that isn't found stops before any press and names its index.
- Fill secrecy (rule 6): the test page echoes the filled value into a `console.error`, the page URL and a label; no tool output holds it, and the collector's debug log doesn't either.
- e2e: after the existing human-press checks, an MCP client calls `run_action` for Add to cart (`within` the product row) and then Checkout (a second Checkout run fills the coupon field with `fill` first and checks the order's discount line ran). The Checkout trace has the same files and lines as the human-press Checkout, and `POST /api/orders 201`. No Playwright press in that part of the script.

D-entries: D-113, D-114, D-115. Done when: the e2e step above passes in CI with no human or script press, and every test above passes.

### Build 2: output

| Files                                                          | Change                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/protocol/src/model.ts`, `messages.ts`                | `phases`, `functions`, `beforeRequest`                          |
| `packages/core/src/` new `functions.ts`                        | Function mapping (range, count, not-run lines and spans)        |
| `packages/daemon/src/correlator.ts`                            | Phases and functions per trace                                  |
| `packages/browser/src/collector.ts`                            | The read before a tagged fetch or XHR continues                 |
| `packages/mcp/src/format.ts`, new `budget.ts`, new `slices.ts` | Summary, ranking and cut, slices and paging, function diff      |
| `packages/mcp/src/server.ts`                                   | `get_trace` inputs; instructions; the descriptions in section 3 |
| `scripts/e2e-shop.mjs`, the tests in 6.5                       | New assertions                                                  |

Tests:
- Core: function ranges and not-run lines on the existing fixtures (`ts-strip`, `tsx-transform`), including an untaken block inside one line.
- Daemon: phase order with one and two tagged requests; a browser-only action gives one `browser` phase; a Python request still lists by line range.
- MCP: a generated trace of 2,000 files gives at most 16,000 characters and a cut line naming the top dropped file; paging of a long file; the `changed after this trace` warning; function diff after a line shift.
- Size: instructions under 1,000, each description under 300, `tools/list` at most 4,000 characters.
- e2e: **the shop's Checkout trace is at most 16,000 characters** for `find_code_for_action`, `run_action` and `get_trace` with `file`; the 6.5 assertions.
- Bench: `bench/actual.mjs` on Actual Budget reports the added read per tagged request (p50, p99).

D-entries: D-116, D-117, D-118, D-119. Done when: every test above passes, and the Actual bench line for the request read is in `bench/README.md`.

### Build 5: run_request (small)

| Files                                          | Change                                                     |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `packages/mcp/src/server.ts`, new `request.ts` | `run_request` tool; loopback check; wait on the trace feed |
| `packages/mcp/src/format.ts`                   | Request result header (status, size, duration)             |
| `scripts/e2e-api.mjs`                          | A run_request call through `lightpath mcp`                 |
| `docs/ARCHITECTURE.md` 9.3                     | The tool                                                   |

Tests: the loopback rules in section 4A, each refused before any network call; `no_response` against a closed port; `no_trace` against a plain server not under `lightpath dev`; `pnpm e2e:api`: `POST /api/orders` through run_request gives a trace with the route file, at most 16,000 characters; a body and a `?token=` in the URL never appear in the output; `tools/list` still at most 4,000 characters and the instructions under 1,000.

D-entry: D-125. Done when: every test above passes in CI, on the backend-only apps `pnpm e2e:api` already runs.

### Build 4: errors, auto-start, redaction

| Files                                                                             | Change                                                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/protocol/src/messages.ts`, `model.ts`                                   | `problem` message; `problems`, `problemsDropped`, `problemCount` |
| `packages/browser/src/collector.ts`                                               | Page error, console, response and request-failed listeners       |
| `packages/node-agent/src/agent.ts`, `start.ts`                                    | `uncaughtExceptionMonitor` and the synchronous send              |
| `packages/daemon/src/correlator.ts`                                               | Problems to traces, locations to workspace paths                 |
| `packages/mcp/src/` new `redact.ts`, new `autostart.ts`, `format.ts`, `server.ts` | Redaction; auto-start; problem lines                             |
| `packages/cli/src/config.ts`, `lightpath.config.schema.json`, `main.ts`           | `autoStart`; passes config to `runMcpServer`                     |

Tests:
- Real browser: a thrown error in a click handler, a `console.error`, a fetch that gets 404, and one to a closed port each appear once in that click's trace.
- Node agent: a server that throws in a timer during a tagged request; the trace has the `uncaught` problem.
- Redaction: one test per rule in section 9, plus the all-tools test.
- Auto-start: in a temp project whose config has a tiny server as `command` and `autoStart: true`, a `list_traces` call starts it, writes `.lightpath/dev.log`, and the server stops when the MCP client closes. Without `autoStart`, the result is the message with the exact command.
- Config: the schema test passes with the new key; unknown keys still fail.

D-entries: D-121, D-122, D-123. Done when: every test above passes and the shop's Checkout output is still at most 16,000 characters.

### Build 3: init and doctor (beside builds 1, 2, 5 and 4)

| Files                                                     | Change                    |
| --------------------------------------------------------- | ------------------------- |
| `packages/cli/src/` new `init.ts`, `main.ts`              | `init --agent`            |
| `packages/cli/src/doctor.ts`                              | The checks in 10.2        |
| `.github/workflows/ci.yml`, new `scripts/setup-check.mjs` | The `setup` job           |
| `README.md` quick start                                   | Only after the job passes |

Tests: init per agent (fresh, merge into an existing file, a file with comments, run twice); lockfile detection; doctor's new checks with a fake config; the CI job in 10.3.

D-entry: D-120. Done when: the `setup` job passes for all four agents on ubuntu-latest and windows-latest. It compares `tools/list` with the tool names the packed CLI ships, so it passes before and after builds 1 and 5 add tools.

## 15. What we cut

Each cut is something that could not move a success metric enough to be worth its cost now.

| Cut                                                                                     | Why                                                                                                                                 | Revisit when                                       |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `page_snapshot` tool                                                                    | Role and name worked on the shop; one more tool is more for the agent to choose from                                                | Benchmark runs show agents can't name targets      |
| Snapshot refs as targets                                                                | They need the snapshot tool, and they die on a reload (browser-control.md)                                                          | With `page_snapshot`                               |
| "sent by" initiator line per request                                                    | Needs a model field and async stacks in the page                                                                                    | The benchmark shows agents ask what sent a request |
| Call order inside a phase (sampling, breakpoints)                                       | Sampling placed 28.33% of page functions; breakpoints cost 82.7 ms per click                                                        | Not planned                                        |
| A read when the response arrives                                                        | Found 0 app functions in 20 of 20 runs                                                                                              | A real app runs code during the wait               |
| "not called: <name>" for nested functions that didn't run                               | Their lines already show as not run; naming them needs more work in the function mapper                                             | Agents misread the not-run lines                   |
| Hover, drag, select menus, file upload, dialogs, popups, iframes                        | Not measured. (Typing is in, as run_action `fill`.)                                                                                 | A benchmark run needs one                          |
| `structuredContent` / `outputSchema`                                                    | Every client sends text to the model                                                                                                | A client needs it                                  |
| `_meta["anthropic/maxResultSizeChars"]`                                                 | Helps Claude Code only; the 16,000 cap is under every client's wall                                                                 | Not planned                                        |
| Native instruction files (`.cursor/rules`, `copilot-instructions.md`, `.kiro/steering`) | `AGENTS.md` reaches all four agents; `CLAUDE.md` covers the one gap                                                                 | An agent stops reading `AGENTS.md`                 |
| `code --add-mcp` (VS Code user profile)                                                 | The workspace file is enough and is testable in CI                                                                                  | Users ask for a global setup                       |
| Messages of errors Express catches (500s)                                               | Needs reading the server's stderr or patching `console`; the status already shows                                                   | The benchmark shows agents need the message        |
| Errors outside an action                                                                | No trace to attach them to                                                                                                          | Users ask                                          |
| Custom headers in run_request (auth tokens, cookies)                                    | They are secrets the tool would have to accept and keep out of logs; an API that needs auth can't be traced by run_request in 0.1.0 | Users ask; needs its own redaction design          |
| Requests to any non-loopback host from run_request                                      | Data off the machine (Tier 3)                                                                                                       | Never without the owner                            |
| Response bodies in run_request output                                                   | Redaction rule 1: no bodies in tool output                                                                                          | Not planned                                        |
| Docs pairing Lightpath with Chrome DevTools MCP or Playwright MCP                       | Measured: 11 of 20 and 0 of 20 traces right on Lightpath's page                                                                     | Those tools hold the press                         |

## 16. Risks

1. **The shop suite can't show a fix-rate win.** The baseline without Lightpath fixed 21 of 21 trials, 5.00 steps mean (`bench/agent-suite/results/2026-11-01-baseline-without.md`). Only steps, credits and time are left on the shop. run_action plus a summary must cost fewer steps than search and read, or Lightpath loses there. The real-app suite (D-110) is where a fix-rate difference can show.
2. **Agents may not call Lightpath.** Tool search hides descriptions (from docs). Instructions and `AGENTS.md` help, but only the `with` runs measure it.
3. **The synced press is measured on the shop only.** Actual Budget, iframes and shadow DOM weren't run (browser-control.md, limits). A slow press read on a big page moves the boundary to the release, as for people.
4. **The phase read adds latency to every tagged request.** 4.29 ms per request on the shop; a page read costs 8 ms at 12,000 functions and 66 ms at 24,600 (bench/README.md). Build 2 measures it on Actual. If p50 is over 20 ms there, log it and decide (turn phases off past a size, or keep them).
5. **Function matching in `diff_traces` after edits.** Anonymous functions are matched by order in their file. A fix that adds a function before them shifts the order and shows false "only in" lines.
6. **Slices from disk can be stale.** The mtime warning covers the common case (the agent just edited the file). A file edited and saved back within the same millisecond as the trace isn't caught.
7. **Auto-start runs a command from a repo file.** Mitigated by `autoStart` being opt-in and the command being printed in every auto-start result, not removed.
8. **Windows `npx`.** `cmd /c` in a committed `.mcp.json` breaks teammates on macOS or Linux. Doctor flags the wrong form for the OS. Whether each client needs the wrapper is from docs and the owner's config, until the CI log in 10.3.
9. **Bigger traces in memory.** Functions per phase on a large app can be thousands per trace, 200 traces kept, and each `trace` WebSocket message is capped at 8 MB. Build 2 records the trace size on Actual.
10. **Node crash delivery.** A synchronous child-process POST at exit is unusual. If it proves flaky in CI, the fallback is to record only the failed request the browser sees.
11. **MCP client timeouts.** A run_action call can take up to about 8.5 s at the default settle cap (5 s + 1.5 s + 2 s press wait). Client tool timeouts weren't checked; from docs only.
12. **Time.** Four builds in short working windows. Build 3 can be cut to two agents (Claude Code and Kiro) first if needed.

## 17. Open questions

1. **Typing: answered.** Ruling 2's run_action couldn't type, so no form could be filled before an action. Reported as a question; the lead decided yes (2026-11-01): an optional `fill` list on run_action, no separate tool, values never shown (sections 4.1, 4.2, 9 rule 6; D-114).
2. **Navigation phases (no decision needed).** Ruling 3's read "when a tagged request leaves the page" can't run for a page navigation: the read deadlocks inside a held navigation (ADR 0003). The design uses the existing `beforeunload` read for that case (section 5.2), which gives the same split.

## 18. Decision index

| D     | Title                                                                 | Tier | Build |
| ----- | --------------------------------------------------------------------- | ---- | ----- |
| D-113 | The lead's five tools, no page_snapshot (sixth: D-125)                | 1    | 1, 2  |
| D-114 | run_action: synced press on the collector's own page                  | 1    | 1     |
| D-115 | `POST /v1/action` on the daemon                                       | 2    | 1     |
| D-116 | Function summary by phase; trace model `phases` and `functions`       | 2    | 2     |
| D-117 | Drill-down slices from disk, paged                                    | 1    | 2     |
| D-118 | Fix verification with run_action and a function-level diff_traces     | 1    | 2     |
| D-119 | Server instructions and trigger-first tool descriptions               | 1    | 2     |
| D-120 | `lightpath init --agent`, doctor checks, CI `setup` job               | 1    | 3     |
| D-121 | Errors and failed requests in traces; `problem` ingest message        | 2    | 4     |
| D-122 | Auto-start from `lightpath mcp`; config key `autoStart`               | 2    | 4     |
| D-123 | Redaction rules for tool output                                       | 1    | 4     |
| D-124 | Phase 2 build order, gate and measures                                | 1    | all   |
| D-125 | `run_request`: one HTTP request to the app on loopback, no browser    | 1    | 5     |
| D-127 | Actionability checked with no input, not a trial click (amends D-114) | 1    | 1     |

## Sources

- Phase 1 research, `docs/research/`: [browser-control.md](../research/browser-control.md), [call-order.md](../research/call-order.md), [agent-mcp-behavior.md](../research/agent-mcp-behavior.md), [competitors.md](../research/competitors.md), [growth-study.md](../research/growth-study.md). Claims there about Claude Code, Cursor and VS Code are from docs.
- [Node.js docs: TypeScript type stripping](https://nodejs.org/api/typescript.html), read 2026-11-01: type stripping replaces TypeScript syntax with whitespace.
- [VS Code: MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration), read 2026-11-01: a stdio server's `cwd` defaults to the workspace folder.
- Code read at `agent-loop` 723a5e9: `packages/mcp/src/server.ts`, `format.ts`; `packages/protocol/src/messages.ts`, `model.ts`, `client.ts`; `packages/daemon/src/server.ts`, `auth.ts`, `correlator.ts`; `packages/browser/src/collector.ts`, `settle.ts`, `rules.ts`; `packages/core/src/pipeline.ts`, `lines.ts`; `packages/node-agent/src/agent.ts`, `transport.ts`; `packages/cli/src/dev.ts`, `config.ts`, `doctor.ts`, `main.ts`; `scripts/e2e-shop.mjs`.
