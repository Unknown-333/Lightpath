# Facts sheet for the launch posts

For the owner's Show HN, Reddit and X posts. The owner writes the posts; this sheet only lists what is true and where it's measured. Every row names its source in this repo. A row marked **pending** has no number yet: don't use it until it's filled in.

Last updated 2026-11-04 at `agent-loop` faf29f0 (all 0.1.0 features, the full benchmark and the new README merged). 0.1.0 is not on npm yet.

## The pitch

The owner's words (2026-11-01): **"see the exact lines one click ran, browser and server, for your agent."**

The benchmark did not show Lightpath raising the fix rate (see below). So the pitch stays this one, and the posts say plainly what the benchmark showed.

README headline (2026-11-04): "Show your coding agent the exact lines one click ran."

## Links

| What               | Link                                                                         | Status                                 |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------- |
| Repo               | https://github.com/Unknown-333/Lightpath                                     | live                                   |
| npm                | https://www.npmjs.com/package/@lightpath-dev/cli                             | 0.0.2 live; **pending: 0.1.0**         |
| Setup per agent    | `docs/agents/claude-code.md`, `cursor.md`, `vscode.md`, `kiro.md`            | merged                                 |
| Benchmark write-up | `bench/agent-suite/results/2026-11-03-full-benchmark.md`                     | merged                                 |
| Demo GIF           | `docs/media/agent-demo.gif` (18.9 s, 0.33 MB); run in `docs/media/demo-run/` | merged                                 |
| Changelog          | `CHANGELOG.md`                                                               | 0.1.0 entry written; **pending: date** |

## What it does

| Fact                                                                                                                      | Source                                                                                                                                                  | Status           |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| The agent clicks a button in your running app and gets that click's trace in one tool call (`run_action`), no human click | `scripts/e2e-shop.mjs` (`pnpm e2e`, CI job "end-to-end"): Add to cart and Checkout clicked through MCP with no press from the script                    | tested           |
| One trace holds the browser files and lines and the Node server files and lines the click ran                             | `pnpm e2e` checks `src/Cart.tsx`, `server/routes/orders.ts` and `POST /api/orders 201` in the answer; `scripts/e2e-invoices.mjs` on `examples/invoices` | tested           |
| It reads V8's own coverage, so the lines are what ran, not a guess from the code                                          | `docs/adr/0001-v8-coverage-deltas.md`, `docs/ARCHITECTURE.md`                                                                                           | documented       |
| No code changes to your app, no SDK, no account                                                                           | README "Quick start"; 4 real apps run with their own dev setup (`docs/tested-apps.md`). tududi needed webpack source maps turned on with a flag         | tested on 4 apps |
| Local only: the daemon listens on 127.0.0.1 and needs a token                                                             | `packages/daemon/src/server.ts`; `packages/daemon/test/server.test.ts` and `actions.test.ts` (wrong token 401, any `Origin` 403)                        | tested           |
| One setup command per agent: `lightpath init --agent claude-code\|cursor\|vscode\|kiro`                                   | `scripts/setup-check.mjs`, CI job "agent setup" on Linux, macOS and Windows, no agent installed                                                         | tested           |
| Each tool result is at most 16,000 characters (about 4,000 tokens); long files come in pages                              | D-109; `packages/mcp/test/output.test.ts` ("cuts a 2,000-file trace to 16,000 characters", "pages a long file under 16,000 characters")                 | tested           |
| Errors and failed requests are in the trace                                                                               | D-121; `scripts/e2e-shop.mjs`: a thrown error and the 409 and 400 requests show in the Checkout trace                                                   | tested           |
| The MCP server starts `lightpath dev` by itself and stops it on close                                                     | D-122; `packages/cli/test/autostart.integration.test.ts`; `pnpm e2e` auto-start step                                                                    | tested           |
| Secrets hidden in tool output; no bodies or headers returned                                                              | D-123; `packages/mcp/test/redact.test.ts`; `pnpm e2e`: no seeded header, body, query or error secret in any tool output                                 | tested           |
| `run_request`: the backend lines for one HTTP request, no browser, loopback only                                          | D-125; `packages/mcp/test/request.test.ts` (18 cases, incl. non-loopback, redirect and proxy refusals); `scripts/e2e-api.mjs` on 7 backend apps         | tested           |
| The agent calls Lightpath by itself on a plain bug report                                                                 | D-134; benchmark: 31 of 53 valid with-Lightpath runs called it (`2026-11-03-full-benchmark.md`, "Where the agent used Lightpath")                       | measured         |

## Numbers

| Fact                                                    | Number                                                                                                      | Source                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Cost per backend request, Express/Fastify/Nest examples | 4 to 6 ms                                                                                                   | `bench/README.md` (Windows 11, Ryzen 7 9700X, 2026-10-29) |
| Cost per request, backend with about 50,000 functions   | about 50 ms (51.8 ms p50 with Lightpath, 1.9 ms without)                                                    | `bench/README.md`                                         |
| Click pause, 100 / 3,000 React components               | 2.4 / 7.9 ms p50                                                                                            | `bench/README.md`, README "Performance"                   |
| Click pause, Actual Budget (about 35,000 functions)     | 15.00 / 17.73 ms p50 / p99 after D-105 (103 presses); a later run on a busy machine: 15.9 / 19.8 ms         | `bench/README.md`                                         |
| Checkout trace size (shop)                              | 1,023 characters; 1,170 with errors shown                                                                   | `pnpm e2e` SIZE lines (`scripts/e2e-shop.mjs`)            |
| Real apps run                                           | 4 (stepful, tududi, Actual, Uptime Kuma); the first two found 7 Lightpath bugs, all fixed (D-085 to D-091)  | `docs/tested-apps.md`                                     |
| Biggest click traced                                    | Actual's "Start budgeting": 263 frontend files and 13 server files                                          | `docs/tested-apps.md`                                     |
| Result size an agent reads whole (Kiro CLI)             | 16,014 characters: 3 of 3 right; 40,062 characters and more: 0 of 9                                         | `docs/research/agent-mcp-behavior.md`                     |
| Tool list size, 0.0.2                                   | Lightpath 4 tools, 1,769 characters; Playwright MCP 25 tools, 21,060; Chrome DevTools MCP 32 tools, 29,661  | `docs/research/competitors.md` (measured 2026-11-01)      |
| Tool list size, 0.1.0                                   | 6 tools, at most 4,000 characters                                                                           | `packages/mcp/test/output.test.ts` (D-119, D-129, D-134)  |
| Time to first wow, 0.0.2                                | App open 20.0 s after `npx`; agent's answer at 34.1 s, but it was "please click": **no first wow** in 0.0.2 | `bench/first-wow/results/2026-11-01.md`                   |
| Time to first wow, 0.1.0                                | **pending: not measured on 0.1.0** (target under 2 minutes)                                                 | `bench/first-wow/`                                        |
| README 10-second test, new README                       | 5 of 5 fresh agents described it right (`claude-haiku-5.5`). Agents, not people                             | `docs/launch/readme-test/2026-11-04.md`                   |

## Benchmark: does it help an agent fix bugs?

**No measured win.** Lightpath did not raise the fix rate on either suite, and with Lightpath the agent used more steps, tokens and credits in every set. Say this plainly if the benchmark comes up.

Agent: Kiro CLI 2.37.0, `claude-sonnet-5.5`, effort `medium`. Scoring: `bench/agent-suite/SCORING.md`, committed before any run and not changed. Source for every row: `bench/agent-suite/results/2026-11-03-full-benchmark.md` (the without rows for visible bugs: `2026-11-01-baseline-without.jsonl` and `2026-11-01-realapp-baseline-without.jsonl`).

| Set                     | Runs per condition | Fixed without | Fixed with                     | Steps mean without → with | Credits per run without → with | Tokens est. mean without → with |
| ----------------------- | ------------------ | ------------- | ------------------------------ | ------------------------- | ------------------------------ | ------------------------------- |
| Shop, 7 visible bugs    | 21                 | 21 of 21      | 20 of 21 (21 without the flaw) | 5.00 → 7.10               | 0.317 → 0.493                  | 1,371 → 2,311                   |
| tududi, 3 visible bugs  | 15                 | 15 of 15      | 15 of 15                       | 9.87 → 13.47              | 0.980 → 1.329                  | 7,743 → 9,135                   |
| Shop, 3 held-out bugs   | 9                  | 9 of 9        | 9 of 9                         | 5.67 → 6.56               | 0.339 → 0.434                  | 1,424 → 1,967                   |
| tududi, 2 held-out bugs | 10                 | 9 of 10       | 6 of 10 (7 without the flaw)   | 12.50 → 13.44             | 1.116 → 1.333                  | 8,716 → 9,481                   |
- **Spread** (SD, steps, with): shop visible 3.11, tududi visible 5.45, shop held-out 3.32, tududi held-out 5.32. Per-bug and per-run tables are in the write-up.
- **The flaw**: the void check wrongly flagged 5 runs (paths like `/c:/...` inside the trial, and `require('../utils')` text in an edit). By the rules, 2 of them count as not fixed. The rules weren't changed; both numbers are given.
- **One bug drives the tududi held-out drop**: h01, 2 of 5 with Lightpath against 4 of 5 without. 5 runs per side can't say why.

## Fair comparison

From `docs/research/competitors.md` (read 2026-11-01). Say "we found no other", with the date, never "the only".

| Fact                                                                                                                                                                              | Source                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| As of November 2026 we found no other MCP tool that returns the lines one click ran in both the browser and the backend                                                           | competitors.md, "The re-check"          |
| Closest: Replay MCP shows frontend statements that ran in a recording (its Node runtime is Node 16 only); mypry joins a click to the backend handler with breakpoints             | competitors.md                          |
| Chrome DevTools MCP and Playwright MCP are better at console, network bodies, screenshots and performance; Playwright MCP runs Firefox and WebKit too; Lightpath is Chromium only | competitors.md                          |
| Replay is better at values at any moment and time travel; Sentry and Datadog work in production; React Grab is the quickest way to point at one element                           | competitors.md                          |
| Chrome DevTools MCP collects usage statistics by default, with an opt-out flag (its own docs); Lightpath sends nothing off the machine                                            | competitors.md [19]; README "Why"       |
| Lightpath is a development tool, not production monitoring                                                                                                                        | README "Performance"; owner's non-goals |

## Caveats to say plainly

- **No fix-rate win was measured**, and with Lightpath each run cost more (table above).
- **The shop is small and easy.** Without Lightpath the agent fixed 21 of 21 shop runs, so there was no room for a fix-rate win there.
- **tududi has only 3 visible bugs**, plus 2 held out. That is a small sample (`bench/agent-suite/realapp/README.md`).
- **All 5 tududi fixes are public** (commits, pull requests and user issues on GitHub), so the model may know them from training. The trial copies have no `.git` folder, so the agent can't read the fix from history (`bench/agent-suite/realapp/SELECTION.md`).
- **Only Kiro CLI with one model was run.** Claims about Claude Code, Cursor and VS Code come from their docs (`docs/research/agent-mcp-behavior.md`).
- **Token counts are estimates**: characters / 4 of each transcript, a lower bound (D-111). Kiro reports credits, not tokens.
- **The README test used fresh agents, not people** (`docs/launch/readme-test/2026-11-04.md`).
- **The demo GIF's bug was planted** in `examples/invoices` for the demo. The run is real, and its transcript is in `docs/media/demo-run/`. Time in the GIF is shortened; the run took 24 s.
- **What isn't traced yet**: WebSocket messages (socket.io), Web Workers, Next.js server components. Chromium browsers and Node backends only; Python is a preview (README "Known limits").
- **run_action does** click, Enter and Space, with fields filled first. Not hover, drag, upload, dialogs, popups or iframes (`docs/design/agent-loop.md` section 15).

## Don't claim

- Any fix-rate, step, token or time win. The benchmark measured none.
- "Agents fix bugs faster with Lightpath." The numbers show the opposite on cost.
- "The only tool that …". Use the dated "we found no other".
- Stars, user counts or quotes from anyone.
- Anything about Claude Code, Cursor or VS Code behaviour as if we ran it.
- A time to first wow for 0.1.0 until it is measured.
