# Facts sheet for the launch posts

For the owner's Show HN, Reddit and X posts. The owner writes the posts; this sheet only lists what is true and where it's measured. Every row names its source in this repo. A row marked **pending** has no number yet: don't use it until it's filled in.

Last updated 2026-11-01 at `agent-loop` e1ed568. The release item checks every row against the 0.1.0 code and results before launch.

## The pitch

The owner's words (2026-11-01): **"see the exact lines one click ran, browser and server, for your agent."**

If Lightpath doesn't raise the fix rate in the benchmark, the pitch stays this one, and the posts say what the benchmark showed.

## Links

| What               | Link                                                              | Status                           |
| ------------------ | ----------------------------------------------------------------- | -------------------------------- |
| Repo               | https://github.com/Unknown-333/Lightpath                          | live                             |
| npm                | https://www.npmjs.com/package/@lightpath-dev/cli                  | 0.0.2 live; **pending: 0.1.0**   |
| Setup per agent    | `docs/agents/claude-code.md`, `cursor.md`, `vscode.md`, `kiro.md` | in this PR                       |
| Benchmark write-up | `bench/agent-suite/results/`                                      | **pending: with-Lightpath runs** |
| Changelog          | `CHANGELOG.md`                                                    | **pending: 0.1.0 entry**         |

## What it does

| Fact                                                                                                                      | Source                                                                                                                                          | Status                    |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| The agent clicks a button in your running app and gets that click's trace in one tool call (`run_action`), no human click | `scripts/e2e-shop.mjs` (`pnpm e2e`, CI job "end-to-end"): Add to cart and Checkout clicked through MCP with no press from the script            | tested                    |
| One trace holds the browser files and lines and the Node server files and lines the click ran                             | README "What a click looks like"; `pnpm e2e` checks `src/Cart.tsx`, `server/routes/orders.ts` and `POST /api/orders 201` in the answer          | tested                    |
| It reads V8's own coverage, so the lines are what ran, not a guess from the code                                          | `docs/adr/0001-v8-coverage-deltas.md`, `docs/ARCHITECTURE.md`                                                                                   | documented                |
| No code changes to your app, no SDK, no account                                                                           | README "Quick start"; 4 real apps run with their own dev setup (`docs/tested-apps.md`). tududi needed webpack source maps turned on with a flag | tested on 4 apps          |
| Local only: the daemon listens on 127.0.0.1 and needs a token                                                             | `packages/daemon/src/server.ts`; `packages/daemon/test/server.test.ts` and `actions.test.ts` (wrong token 401, any `Origin` 403)                | tested                    |
| One setup command per agent: `lightpath init --agent claude-code\|cursor\|vscode\|kiro`                                   | `scripts/setup-check.mjs`, CI job "agent setup" on Linux, macOS and Windows, no agent installed                                                 | tested                    |
| Each tool result is at most 16,000 characters (about 4,000 tokens)                                                        | D-109; the test lands with build 2                                                                                                              | **pending: build 2 test** |
| Errors and failed requests in the trace                                                                                   | D-121, build 4                                                                                                                                  | **pending: build 4**      |
| The MCP server starts `lightpath dev` by itself, opt-in                                                                   | D-122, build 4                                                                                                                                  | **pending: build 4**      |
| Secrets hidden in tool output; no bodies or headers                                                                       | D-123, build 4 (fill values: build 1, `packages/mcp/src/redact.ts`)                                                                             | **pending: build 4**      |
| `run_request`: the backend lines for one HTTP request, no browser                                                         | D-125, build 5                                                                                                                                  | **pending: build 5**      |

## Numbers

| Fact                                                    | Number                                                                                                      | Source                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Cost per backend request, Express/Fastify/Nest examples | 4 to 6 ms                                                                                                   | `bench/README.md` (Windows 11, Ryzen 7 9700X, 2026-10-29) |
| Cost per request, backend with about 50,000 functions   | about 50 ms (51.8 ms p50 with Lightpath, 1.9 ms without)                                                    | `bench/README.md`                                         |
| Click pause, 100 / 3,000 React components               | 2.4 / 7.9 ms p50                                                                                            | `bench/README.md`, README "Performance"                   |
| Click pause, Actual Budget (about 35,000 functions)     | 15.9 ms p50, 19.8 ms p99                                                                                    | `bench/README.md`                                         |
| Real apps run                                           | 4 (stepful, tududi, Actual, Uptime Kuma); the first two found 7 Lightpath bugs, all fixed (D-085 to D-091)  | `docs/tested-apps.md`                                     |
| Biggest click traced                                    | Actual's "Start budgeting": 263 frontend files and 13 server files                                          | `docs/tested-apps.md`                                     |
| Result size an agent reads whole (Kiro CLI)             | 16,014 characters: 3 of 3 right; 40,062 characters and more: 0 of 9                                         | `docs/research/agent-mcp-behavior.md`                     |
| Tool list size, 0.0.2                                   | Lightpath 4 tools, 1,769 characters; Playwright MCP 25 tools, 21,060; Chrome DevTools MCP 32 tools, 29,661  | `docs/research/competitors.md` (measured 2026-11-01)      |
| Tool list size, 0.1.0                                   | **pending: build 2 test** (budget: at most 4,000 characters)                                                | `docs/design/agent-loop.md` section 2                     |
| Time to first wow, 0.0.2                                | App open 20.0 s after `npx`; agent's answer at 34.1 s, but it was "please click": **no first wow** in 0.0.2 | `bench/first-wow/results/2026-11-01.md`                   |
| Time to first wow, 0.1.0                                | **pending: bench/first-wow on 0.1.0** (target under 2 minutes)                                              | `bench/first-wow/`                                        |
| README 10-second test                                   | 15 of 15 fresh agents described it right (3 pitch lines, 5 each). Agents, not people                        | `bench/readme-test/results/2026-11-01.md`                 |

## Benchmark: does it help an agent fix bugs?

Agent: Kiro CLI 2.37.0, `claude-sonnet-5.5`. Scoring: `bench/agent-suite/SCORING.md`, committed before any run.

| Suite                   | Condition     | Runs                                                                  | Fixed    | Steps mean | Credits mean | Tokens est. mean | Source                                                     |
| ----------------------- | ------------- | --------------------------------------------------------------------- | -------- | ---------- | ------------ | ---------------- | ---------------------------------------------------------- |
| Shop, 7 visible bugs    | without       | 21                                                                    | 21 of 21 | 5.00       | 0.317        | 1,371            | `bench/agent-suite/results/2026-11-01-baseline-without.md` |
| Shop, 7 visible bugs    | with          | **pending: bench/agent-suite results**                                |          |            |              |                  |                                                            |
| Shop, 3 held-out bugs   | both          | **pending: bench/agent-suite results** (run once, at the end)         |          |            |              |                  |                                                            |
| tududi, 3 visible bugs  | without       | 1 trial (r01 only)                                                    | 1 of 1   | 14         | 1.274        | 9,164            | `bench/agent-suite/results/2026-11-01-realapp-trial.md`    |
| tududi, 3 visible bugs  | without, with | **pending: bench/agent-suite results** (5 runs per bug per condition) |          |            |              |                  |                                                            |
| tududi, 2 held-out bugs | both          | **pending: bench/agent-suite results** (run once, at the end)         |          |            |              |                  |                                                            |

Report variance with each pending row, not the best run (owner's anti-gaming rules).

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

- **The shop can't show a fix-rate win.** Without Lightpath the agent fixed 21 of 21 shop runs, so only steps, credits, tokens and time are left to compare there (`2026-11-01-baseline-without.md`).
- **tududi has only 3 visible bugs**, plus 2 held out. That is a small sample (`bench/agent-suite/realapp/README.md`).
- **All 5 tududi fixes are public** (commits, pull requests and user issues on GitHub), so the model may know them from training. The trial copies have no `.git` folder, so the agent can't read the fix from history (`bench/agent-suite/realapp/SELECTION.md`).
- **Only Kiro CLI with one model was run.** Claims about Claude Code, Cursor and VS Code come from their docs (`docs/research/agent-mcp-behavior.md`).
- **Token counts are estimates**: characters / 4 of each transcript, a lower bound (D-111). Kiro reports credits, not tokens.
- **The README test used fresh agents, not people**, and every variant passed, so it can't tell the pitch lines apart (`bench/readme-test/results/2026-11-01.md`).
- **What isn't traced yet**: WebSocket messages (socket.io), Web Workers, Next.js server components. Chromium browsers and Node backends only; Python is a preview (README "Known limits").
- **run_action does** click, Enter and Space, with fields filled first. Not hover, drag, upload, dialogs, popups or iframes (`docs/design/agent-loop.md` section 15).

## Don't claim

- Any fix-rate, step or token win before the pending rows have numbers, and then only what they show.
- "The only tool that …". Use the dated "we found no other".
- Stars, user counts or quotes from anyone.
- Anything about Claude Code, Cursor or VS Code behaviour as if we ran it.
