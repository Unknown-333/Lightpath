# Competitors and complements

Phase 1 research, written 2026-11-01. Everything external was read on 2026-11-01 between 03:55 and 04:20 UTC. Stars and release dates were read through the GitHub and npm APIs at 04:02 to 04:07 UTC. A claim that a vendor makes about its own product is marked **(vendor claim)**. Numbered references like [12] point to [Sources](#sources).

Raw evidence (tool lists, help output, READMEs, API reads, notes) is kept outside the repo in `lightpath-trials/goal/competitors-raw/`, as the brief asks.

## Result

1. **Nothing else found traces one click through frontend and backend to line level over MCP.** The closest tools each miss one half. Replay MCP shows which frontend statements ran in a recording, but its Node runtime is stuck on Node 16 and is a separate recording [3][4]. mypry follows a click into the backend over MCP, but with breakpoints the agent must place, not a record of what ran [27]. Datadog joins browser actions to backend spans and has line logpoints in Preview, but it gives spans, not executed lines, and needs a paid cloud account [15][16][17].
2. **Lightpath's real gap is that the agent can't click.** Every browser MCP (Chrome DevTools MCP, Playwright MCP, Browser MCP, BrowserTools) lets the agent drive the page. Lightpath needs a human to click [L1]. That is Phase 2 target (a), and this research says it matters most.
3. **Today an agent can't click with Playwright MCP while Lightpath records the same page.** Lightpath starts its own Chrome over a pipe and opens no DevTools port, so Playwright MCP or Chrome DevTools MCP would start a second browser that Lightpath can't see. The backend part of such a click is still traced, but the frontend part is lost (code reading, not yet run; see [Working together](#can-an-agent-click-with-playwright-mcp-while-lightpath-records)).
4. **Lightpath's tool list is small, which is a strength to keep.** Measured `tools/list`: Lightpath 4 tools in 1,769 characters, Playwright MCP 25 tools in 21,060, Chrome DevTools MCP 32 tools in 29,661 [H].
5. **Competitors are better at several things, and the README should say so.** Browser MCPs give console, network bodies, screenshots and DOM. Replay gives variable values at any moment and React render causes. Sentry and Datadog work in production and across services. React Grab is the fastest way to point an agent at one UI element.

## The re-check: one click, frontend and backend, line level, over MCP

Searched on 2026-11-01 (search terms in the raw notes). Candidates and what each lacks:

| Tool | Frontend | Backend | Joined to one click | What it lacks for this job |
| --- | --- | --- | --- | --- |
| Replay MCP | Statements that ran, in a recording [3] | Replay Node only: Node 16, not under active development, separate recording [4] | No: the backend isn't in the browser recording | Modern Node backends; local-only use (recordings upload to Replay's cloud) [2] |
| mypry | Live browser through Playwright: eval, snapshot, click [27] | Breakpoints, logpoints, eval through the Node inspector [27] | Yes, in one MCP session [27] | A record of what ran: the agent must already know where to set breakpoints. 0 stars [G] |
| Datadog MCP | RUM events, session replay [15] | APM spans, profiles, Live Debugger logpoints (Preview) [15] | Yes, RUM requests link to APM traces [17] | Executed lines; local dev use; needs SDKs, a tracer and a paid account [16][17] |
| Sentry MCP / Spotlight | Spans, errors with file:line stacks [11][13] | Same [11][13] | Yes, at span level, through trace propagation [12] | Executed lines: spans and stack frames only |
| OpenTelemetry MCP servers | Only if the frontend is instrumented | Spans [6][7][8][9] | Yes, if both sides propagate trace context | Executed lines; needs OpenTelemetry in the app |

**Closest: Replay MCP** for line-level detail (frontend only), and **mypry** for joining a click to the backend handler (breakpoints only). Neither returns "these lines ran on both sides for this click". Our search may have missed a small project; the claim to make is "we found no other", with the date, not "the only".

## Hands-on: tools each MCP server exposes

Each server was started locally with `npx`, sent `initialize` and `tools/list` over stdio, then stopped by its own PID. No accounts or logins. Chrome DevTools MCP collects usage statistics and sends performance-trace URLs to Google's CrUX API by default [19]; both were turned off with `--no-usage-statistics --no-performance-crux` and `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1`. Playwright MCP's `--help` shows no telemetry flag.

| Server | Version | Flags | Tools | `tools` JSON size (characters) |
| --- | --- | --- | --- | --- |
| Chrome DevTools MCP | 1.12.0 | `--headless --isolated`, telemetry off | 32 | 29,661 |
| Chrome DevTools MCP | 1.12.0 | plus `--memoryDebugging --experimentalVision` | 46 | 45,540 |
| Playwright MCP | 0.0.84 (Playwright 1.65.0-alpha-2026-10-30) | `--headless --isolated` | 25 | 21,060 |
| Playwright MCP | 0.0.84 | plus `--caps vision,pdf,devtools` | 45 | 32,822 |
| Lightpath | cli 0.0.2 (mcp package 0.0.1) | `mcp` | 4 | 1,769 |

Characters are not tokens; the token-budget item measures tokens. Default tool names:

- **Chrome DevTools MCP:** click, close_page, drag, emulate, evaluate_script, fill, fill_form, get_console_message, get_css_styles, get_network_request, handle_dialog, hover, lighthouse_audit, list_console_messages, list_network_requests, list_pages, navigate_page, new_page, performance_analyze_insight, performance_start_trace, performance_stop_trace, press_key, resize_page, screencast_start, screencast_stop, select_page, take_heapsnapshot, take_screenshot, take_snapshot, type_text, upload_file, wait_for.
- **Playwright MCP:** browser_close, browser_resize, browser_console_messages, browser_handle_dialog, browser_emulate_media, browser_evaluate, browser_file_upload, browser_drop, browser_find, browser_fill_form, browser_press_key, browser_type, browser_navigate, browser_navigate_back, browser_network_requests, browser_network_request, browser_run_code_unsafe, browser_take_screenshot, browser_snapshot, browser_click, browser_drag, browser_hover, browser_select_option, browser_tabs, browser_wait_for.

Neither has a coverage tool. Playwright MCP's `browser_run_code_unsafe` runs any Playwright code (its own description calls it RCE-equivalent), so an agent could in theory call Playwright's coverage API through it. That was not tried.

## Tool by tool

Stars and releases are from the GitHub API at 04:02 UTC [G] and npm at 04:03 UTC [N] on 2026-11-01.

### Browser control

**Chrome DevTools MCP** (Google). 54,571 stars, v1.12.0 on 2026-10-22.
- Evidence: DOM snapshot, screenshots, console messages with source-mapped stack traces, network requests with headers, performance traces with insights, Lighthouse, heap snapshots, live JS eval [19][H].
- Setup: one `npx` line, local, free. Usage statistics on by default [19].
- Agents: setup guides for 27 clients including Claude Code, Cursor, Copilot/VS Code and Kiro [20].
- Better than Lightpath: the agent drives the page itself; console, network, performance and memory tools; Google maintains it.
- Lightpath better: which lines ran, in your own files, frontend and backend, for one action. Chrome DevTools MCP has no coverage or backend tool [H].

**Playwright MCP** (Microsoft). 38,919 stars, v0.0.84 on 2026-10-31.
- Evidence: accessibility snapshot, screenshots, console, network list and bodies, tracing and video with `--caps`, live eval [H][21].
- Setup: one `npx` line, local, free. Can attach to a running browser with `--cdp-endpoint` or a browser extension [21].
- Agents: guides for 20 clients including Claude Code, Cursor, VS Code and Kiro [21].
- Better than Lightpath: drives the page; runs Chrome, Firefox, WebKit or Edge (`--browser` in its help) while Lightpath is Chromium only [H][L1]. Its README says coding agents may do better with Playwright CLI plus skills because MCP schemas and snapshots cost tokens **(vendor claim)** [21].
- Lightpath better: executed lines and the backend half.

**Others in this group.** BrowserTools MCP (7,340 stars, v2.0.4 on 2026-10-27) and Browser MCP (7,262 stars, npm 2.3.0 on 2026-10-30) use an extension to reach the user's own logged-in Chrome [22][23]. agent-browser (45,046 stars, v0.41.0 on 2026-10-29) is a browser CLI for agents, which Next.js DevTools MCP points agents to [24]. They give console, network and screenshots; none gives executed lines.

### Recording and time travel

**Replay MCP** (Replay.io). Hosted server, no public server repo; the `replayio` CLI is 1.9.1 from 2026-09-01 [N]; replay-cli repo has 36 stars [G].
- Evidence: for a browser recording: source annotated with which statements ran, a function's executed and not-executed lines, values at any execution point, logpoints over past hits, call stacks, console, network, screenshots, React render causes, Redux/Zustand/TanStack Query state, Playwright test steps [3].
- Setup: install skills, add the hosted MCP URL, record with Replay Browser (a Chromium fork), reproduce by hand, upload, then ask [2]. A free account is needed for its setup guide [5]; team recordings need an API key [2]. First overview of a new recording can take 3 to 4 minutes [3]. Free plan has 25 credits a month; Starter is $20 a month **(vendor pricing page)** [5].
- Agents: any MCP client; docs name Claude Code, Cursor and Codex [2].
- Better than Lightpath: values at any moment, time travel, React render analysis, deterministic replay of races. Frontend line detail is comparable.
- Lightpath better: modern Node backend in the same trace; local only; no recording upload; the trace is ready once the click settles (300 ms of quiet by default, 5 s at most [L1]) instead of after an upload and a first analysis that can take minutes [3].

### Observability over MCP

**OpenTelemetry MCP servers.**
- traceloop/opentelemetry-mcp-server: 204 stars, 0.2.2 on 2026-02-08. Queries Jaeger, Tempo or Traceloop; focused on LLM traces [6].
- tobert/otlp-mcp: 13 stars, v0.4.4 on 2026-03-01. A local OTLP receiver plus MCP in one Go binary, 14 tools, before/after snapshots, localhost only [7].
- moondef/otel-mcp: 2 stars, no release. Local OTLP receiver with span trees [8].
- grafana/mcp-grafana: 3,630 stars, v2.1.1 on 2026-10-20. Tempo tools include search, get and diff of traces [9].
- Evidence: spans (name, timing, attributes, errors). Setup: OpenTelemetry SDK in the app plus a backend or local receiver. All four are open source under Apache-2.0 or MIT [G]. otlp-mcp gives setup lines for Claude Code and Gemini CLI [7]; the others take a standard MCP config.
- Better than Lightpath: any language with OpenTelemetry; works in production; otlp-mcp's before/after snapshots match Lightpath's fix-verification goal.
- Lightpath better: no code changes; lines, not spans; the frontend click.

**Sentry MCP.** Server lives in getsentry/toolkit (952 stars), npm `@sentry/mcp-server` 0.42.0 on 2026-09-25.
- Evidence: issues, errors with stack traces, traces and spans, logs, replays, profiles [10][11].
- Setup: hosted at mcp.sentry.dev with OAuth, or stdio with a user token; AI search tools need an LLM key [10]. Setup steps are given for Claude Code, Cursor and VS Code [11]. Needs Sentry SDKs in the app. Free Developer plan exists **(vendor pricing page)** [14].
- Better than Lightpath: production errors, history, many languages, frontend-to-backend span traces [12].
- Lightpath better: no SDK, local, executed lines.

**Spotlight** (Sentry for development). 629 stars, 4.12.1 on 2026-10-26.
- Evidence: 4 MCP tools: search_errors, search_logs, search_traces, get_traces. Errors carry file:line:column stacks; traces are span trees [13].
- Setup: `npx @spotlightjs/spotlight`, local sidecar, no Sentry account; needs Sentry SDKs in the app [13].
- Better than Lightpath: errors and logs, which Lightpath doesn't attach yet.
- Lightpath better: no SDK; lines that ran instead of spans.
- This is the closest **local** observability peer and a natural complement.

**Datadog MCP.** Hosted; MCP generally available 2026-03-09 (search index date) [18]; the datadog-labs/mcp-server examples repo has 47 stars [G].
- Evidence: logs, metrics, spans and traces, RUM events, session replay, error tracking, profiler flame graphs, CI code coverage summaries, Live Debugger logpoints (Preview, ask support) [15].
- Setup: paid Datadog account, RUM SDK and APM tracer; linking RUM to traces uses paid APM data **(vendor docs)** [16][17]. Works with any standard MCP client; the README shows Claude Code [16].
- Better than Lightpath: production, scale, the widest data; joins browser requests to backend traces [17].
- Lightpath better: local, free, no SDKs, executed lines for one dev click.

### Dev overlays and framework runtimes

**React Grab.** 7,693 stars, npm 0.2.0 on 2026-08-16.
- Evidence: the selected element's HTML and its component stack with file:line:column [25]. No runtime trace.
- Setup: `npx grab@latest init` or one import in the entry file [25]. Agents: any; the user pastes the copied text. npm still has `@react-grab/mcp` 0.1.37 (2026-05-18), but no MCP package is in the current repo [N].
- Benchmark: 331 tasks, React Grab 96% accuracy at 20.7 s versus 30.7 s for the next accurate tool **(vendor claim)** [26].
- Better than Lightpath: pointing at a UI element; any React app; tiny setup.
- Lightpath better: what the element's handler ran, including the backend. The two answer different questions and fit together.

**Tidewave JS.** 38 stars, npm 0.10.0 on 2026-10-23. Vite (React/Vue) and TanStack Start: run code inside the app, read logs, find source locations [28]. Next.js support was dropped on 2026-06-22 [29].

**Next.js DevTools MCP.** 834 stars, 0.4.0 on 2026-06-24. Proxies Next.js 16's built-in MCP endpoint for runtime errors, routes and logs [24].

**stagewise.** 6,833 stars. Now an agentic IDE and browser with its own agent, not an MCP add-on [30].

### Debuggers

**mypry.** 0 stars, npm 0.2.1 on 2026-07-01. Breakpoints, logpoints and eval on the Node inspector and a Playwright browser in one MCP session. Calls itself the only debugger that follows one request from the browser click into the backend handler **(vendor claim)** [27].
- Better than Lightpath: live values on both sides; the agent clicks.
- Lightpath better: no breakpoints to guess; one call returns everything that ran.

**mcp-debugger** (184 stars, npm 0.26.0 on 2026-10-31) and **Microsoft DebugMCP** (579 stars) give agents DAP debuggers [31][32]. **Lightrun MCP** lets agents add logs and snapshots to live production services without redeploying, and names Claude Code, Codex and Cursor **(vendor claim)** [33]. It targets production services, a Lightpath non-goal.

### Coverage MCPs

**Coco is Qt Group's Coco**, a commercial code coverage tool for C/C++, C#, QML and Tcl [35]. Its MCP Server Preview (blog dated 2026-08-21 by the search index) reads coverage from test runs: overall and per-file numbers, file:line lists of run and unrun code, and which tests cover a diff [34]. The blog says it works with any MCP host and names GitHub Copilot in VS Code and Claude Code [34]. No public price was found. It is about test coverage, not one user action, and its manual doesn't list web JavaScript or Node [35].

Other coverage MCPs found (Codecov wrappers, Datadog's CI coverage tools [15]) read coverage reports from CI. None records coverage for a single click.

Better than Lightpath: test-gap analysis and "which tests cover this diff". Lightpath better: coverage of one live action, no tests needed. Coco's progressive disclosure (small summary first, detail on request) is the same shape Phase 2 target (b) asks for.

## Can an agent click with Playwright MCP while Lightpath records?

**Not in one browser today.** This comes from reading the code, not from a run:

- Lightpath starts Chrome with Playwright's `chromium.launch` and opens no DevTools port (`packages/browser/src/launch.ts`; no `remote-debugging` anywhere in `packages/browser/src`). So Playwright MCP's `--cdp-endpoint` and Chrome DevTools MCP's `--browserUrl` have nothing to attach to [21][19].
- If Playwright MCP starts its own browser and clicks there, Lightpath's click boundary never runs, so no frontend lines are recorded. The app's requests reach the Node agent untagged and become backend-only traces (`docs/ARCHITECTURE.md` section 6.1).

Ways to make it work, for the browser-control item to test:

| Option | Gain | Cost or risk |
| --- | --- | --- |
| Lightpath adds its own small action tool (click by role and name, then return the trace) | One call, boundary kept, small tool list | Lightpath now does some browser driving |
| Lightpath opens a DevTools port on 127.0.0.1 so Playwright MCP or Chrome DevTools MCP can attach | Reuses tools with 38,919 and 54,571 stars | A DevTools port has no token, so any local process could drive the browser. That loosens local-only security, which is **Tier 3** |
| Lightpath connects to a Chrome the user or Chrome DevTools MCP started | No new Lightpath browser | Lightpath's per-page hooks and request tagging must work on a context it didn't create; untested |

## Recommendations

### Positioning

**Lightpath tells your coding agent which lines ran, in the browser and on the server, for one action in your running app.**

### Who Lightpath competes with, and who it should work with

- **Competes with:** Replay MCP (the closest on "what ran", frontend only, cloud) and mypry (closest on joining frontend and backend, breakpoints only). For a developer who already runs Sentry or Datadog, those tools are the "good enough" alternative for request-level questions.
- **Works with:** Chrome DevTools MCP and Playwright MCP for console, network bodies, screenshots and performance; React Grab for "which component is this" before "what did it run"; Spotlight for errors and logs. These answer different questions, so docs should present them as partners, not rivals.
- **Not a competitor:** Coco and Codecov MCPs (test coverage), Datadog and Lightrun in production (non-goal for Lightpath).

### Comparison table for the README

Every cell links to its source. "No" means the source shows no such feature.

| | Lightpath | Chrome DevTools MCP | Playwright MCP | Replay MCP | Sentry MCP | Datadog MCP | React Grab |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Agent drives the browser | No, a person clicks [L1] | Yes [H] | Yes [H] | No, a person reproduces in Replay Browser [2] | No [11] | No [15] | No, a person selects [25] |
| Frontend lines that ran | Yes, per action [L1] | No [H] | No [H] | Yes, per recording [3] | No, spans [11] | No, RUM events [15] | No, source location of the element [25] |
| Backend lines that ran | Yes, Node [L1] | No [H] | No [H] | Node 16 only, separate recording [4] | No, spans [11] | No; logpoints in Preview [15] | No [25] |
| Joins a click to its backend request | Yes [L1] | No [H] | No [H] | No [4] | Yes, spans [12] | Yes, spans [17] | No [25] |
| Values at a moment in time | No [L1] | Live eval [H] | Live eval [H] | Yes, any point [3] | No [11] | Logpoints in Preview [15] | No [25] |
| Console, network, screenshots | Request and status only [L1] | Yes [H] | Yes [H] | Yes [3] | Errors, logs, replays [11] | Logs, RUM, replays [15] | No [25] |
| Runs locally, no account | Yes [L1] | Yes; usage stats on by default [19] | Yes [21] | No [2] | No [10] | No [16] | Yes [25] |
| Changes to your app | None [L1] | None [19] | None [21] | None; use Replay Browser [2] | Sentry SDKs [12] | RUM SDK and APM tracer [17] | One import or `grab init` [25] |
| Stars, 2026-11-01 | 0 [G] | 54,571 [G] | 38,919 [G] | hosted [2] | 952 [G] | hosted [16] | 7,693 [G] |

When the table goes into the README, the "[n]" marks become links, the stars row is dropped (it is here for context), and the first row changes once Lightpath has an action tool.

### Proposed decisions

These are for the decision-log owner. None is recorded in `decisions.md`.

**P1. Use "we found no other" wording, dated, not "the only".**
- What: the README and launch posts say "As of November 2026 we found no other MCP tool that returns the lines one click ran in both frontend and backend", linking this doc.
- Why: the hard line on fair comparisons; mypry claims a related "only" [27], and a small project could exist that we missed.
- Alternatives: "the only tool" (unprovable); no claim (loses the clearest pitch).
- Evidence: the re-check table above.
- Revert: edit the sentence.

**P2. Build a small Lightpath action tool before relying on Playwright MCP to click.**
- What: one tool that clicks by role and name in Lightpath's own browser and returns the trace (Phase 2 target a).
- Why: every browser competitor lets the agent click and Lightpath doesn't. An outside browser MCP can't reach Lightpath's browser today, and a second browser loses the frontend half.
- Alternatives: open a DevTools port for Playwright MCP or Chrome DevTools MCP (Tier 3: a tokenless local port); attach Lightpath to a Chrome someone else started (untested).
- Evidence: `packages/browser/src/launch.ts`, `docs/ARCHITECTURE.md` 6.1, Playwright MCP and Chrome DevTools MCP connect flags [21][19].
- Revert: remove the tool; the existing four tools stay.

**P3. Keep Lightpath's tool list small.**
- What: after Phase 2, keep `tools/list` well under the browser MCPs, with a target set by the token-budget item. Today it is 1,769 characters against 21,060 and 29,661.
- Why: Playwright's own README warns that tool schemas cost agents tokens [21]; a small list is a real difference.
- Alternatives: copy the browser MCPs' breadth (console, network, screenshots). That duplicates tools agents can already add.
- Evidence: hands-on table.
- Revert: none needed; it's a limit to check in CI if adopted.

**P4. Attach errors and failed requests to traces (Phase 2 target e).**
- What: include uncaught errors (with file:line) and failed requests in a trace.
- Why: most tools here give errors (Chrome DevTools MCP and Playwright MCP through the console, Replay, Sentry, Spotlight, Datadog). Without them an agent needs a second tool for the most common bug signal.
- Alternatives: tell users to pair Lightpath with Spotlight or Chrome DevTools MCP.
- Evidence: tool sections above.
- Revert: drop the fields; pre-1.0 output formats are Tier 1.

**P5. Write "works with" docs only after measuring the pairing.**
- What: docs pages for Lightpath plus Chrome DevTools MCP, Playwright MCP, React Grab and Spotlight, each written after a run shows what the pair gives.
- Why: "don't claim what isn't measured"; point 3 of the result shows a pairing can quietly lose half the trace.
- Alternatives: write them now from reading.
- Evidence: the "Can an agent click" section.
- Revert: delete the pages.

**P6. Put the comparison table in the README with a "where others are better" line.**
- What: use the table above, plus one sentence naming what the others do better (live control, console and network, time travel, production).
- Why: fairness is a hard line, and a technical audience trusts a table that admits gaps.
- Alternatives: no table; a table without the gaps line.
- Evidence: this doc.
- Revert: remove the table.

**P7. Don't chase values, time travel or production.**
- What: leave variable values to debuggers and Replay, and production to Sentry, Datadog and Lightrun.
- Why: production is a stated non-goal; mypry, mcp-debugger, DebugMCP and Replay already do values well.
- Alternatives: add a Lightpath logpoint tool later if the benchmark shows agents need values.
- Evidence: Debuggers and Replay sections.
- Revert: reopen in the roadmap.

## Sources

Read 2026-11-01, 03:55 to 04:20 UTC.

- [H] Hands-on `tools/list` runs and `--help` output, 2026-11-01 04:00 UTC (raw notes).
- [G] GitHub API, `gh api repos/<owner>/<repo>` and `/releases/latest`, 2026-11-01 04:02 to 04:07 UTC.
- [N] npm registry, `npm view <pkg> version time`, 2026-11-01 04:03 UTC.
- [L1] Lightpath [README.md](../../README.md), [docs/ARCHITECTURE.md](../ARCHITECTURE.md), `packages/browser/src/launch.ts`.
- [2] Replay MCP overview: <https://docs.replay.io/basics/replay-mcp/overview>
- [3] Replay MCP tools reference: <https://docs.replay.io/reference/replay-mcp/tools>
- [4] Replay Node: <https://docs.replay.io/reference/replay-runtimes/replay-node>
- [5] Replay pricing: <https://replay.io/pricing>; setup guide naming a free account: <https://replay.io/blog/how-to-set-up-replay-mcp-with-claude-code-in-under-10-minutes>
- [6] <https://github.com/traceloop/opentelemetry-mcp-server>
- [7] <https://github.com/tobert/otlp-mcp>
- [8] <https://github.com/moondef/otel-mcp>
- [9] <https://github.com/grafana/mcp-grafana>
- [10] Sentry MCP README: <https://github.com/getsentry/toolkit>
- [11] Sentry MCP service: <https://mcp.sentry.dev>; tool files in `packages/mcp-core/src/tools/catalog` of getsentry/toolkit
- [12] Sentry distributed tracing: <https://docs.sentry.io/platforms/javascript/tracing/distributed-tracing/custom-instrumentation>
- [13] Spotlight MCP tools: <https://spotlightjs.com/docs/mcp/tools/>; <https://github.com/getsentry/spotlight>
- [14] Sentry pricing: <https://sentry.io/pricing>
- [15] Datadog MCP tools: <https://docs.datadoghq.com/mcp_server/tools/>
- [16] Datadog MCP setup: <https://github.com/datadog-labs/mcp-server>; <https://docs.datadoghq.com/mcp_server/>; pricing <https://www.datadoghq.com/pricing/>
- [17] Datadog, Connect RUM and Traces: <https://docs.datadoghq.com/real_user_monitoring/correlate_with_other_telemetry/apm/>
- [18] Datadog MCP GA press release: <https://www.datadoghq.com/about/latest-news/press-releases/datadog-launches-mcp-server/>
- [19] <https://github.com/ChromeDevTools/chrome-devtools-mcp>
- [20] <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/client-configurations.md>
- [21] <https://github.com/microsoft/playwright-mcp>
- [22] <https://github.com/AgentDeskAI/browser-tools-mcp>
- [23] <https://github.com/BrowserMCP/mcp>
- [24] <https://github.com/vercel/next-devtools-mcp>; <https://github.com/vercel-labs/agent-browser>
- [25] <https://github.com/aidenybai/react-grab>
- [26] <https://www.react-grab.com/benchmarks>
- [27] mypry: <https://github.com/bernatch22/mypry> (was pinecall/mypry)
- [28] <https://github.com/tidewave-ai/tidewave_js>
- [29] <https://tidewave.ai/blog/nextjs-react-vite>
- [30] <https://github.com/stagewise-io/stagewise>
- [31] <https://github.com/debugmcp/mcp-debugger>
- [32] <https://github.com/microsoft/DebugMCP>
- [33] <https://lightrun.com/blog/get-lightrun-ai-skills/>; <https://github.com/lightrun-platform/lightrun-ai>
- [34] Coco MCP Server Preview: <https://www.qt.io/blog/introducing-the-coco-mcp-server-preview>
- [35] Coco manual: <https://doc.qt.io/coco/>

Research note: Firecrawl refused requests from this network without an API key, and getting one needs a sign-up, so this study used plain web search, page fetches and the GitHub and npm APIs.
