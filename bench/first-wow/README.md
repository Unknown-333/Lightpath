# Time to first wow

The owner's metric: "from npx to the agent's first useful answer on a fresh clone of a real app, in under 2 minutes, measured by a script." `run.mjs` is that script.

## What one run does

1. **Setup, timed but not scored.** Clones the app fresh at a pinned commit into `%TEMP%\lp-first-wow\<app>-<time>\app` (outside this repo), writes the config files the app's README asks for (with our ports), and installs dependencies with the app's own commands. Writes the pinned agent config to `.kiro/agents/bench.json` in the clone (git-excluded), as `lightpath init` would.
2. Reads CPU load (waits 60 s once if it is over 20%).
3. **The clock starts.** Runs `npx -y --package=@lightpath-dev/cli@0.0.2 lightpath dev --headless <app flags> -- <the app's dev command>`. `--lightpath <file.tgz>` swaps in a local tarball for branch builds. Waits for Lightpath's `watching <url>` line: the app is open in Lightpath's browser.
4. Runs the pinned agent once with one question: "Which code handles <action> in this app? Name the files and lines."
5. **The clock stops** when the agent's answer names the right files (`check.mjs`, against the expected files in `apps/<app>.mjs`, both written before the first run). An answer that doesn't name them is a fail; its time is still recorded as `totalMs`.
6. Stops everything it started by PID (the `npx` process tree: Lightpath, the app's servers, Chrome), checks the app's ports are free, reads CPU load again, and appends one JSON line to `results/results.jsonl`: each phase's time, the answer word for word, the check, credits, steps, tool calls, the kiro-cli version and the model ID.

The pinned agent: `kiro-cli chat --no-interactive --trust-all-tools --trust-workspace --require-mcp-startup --agent bench --model claude-sonnet-5.5 --effort medium`, with an agent config that has only the Lightpath MCP server (`npx -y --package=<same Lightpath> lightpath mcp --root <clone>`) and its tools, no built-in tools, `includeMcpJson: false` (the owner's global MCP servers never load) and no steering. With no file tools, a right answer can only come from a Lightpath trace, not from reading the source. The agent's time limit is 5 minutes.

```sh
node bench/first-wow/run.mjs --app stepful
node bench/first-wow/run.mjs --app stepful --lightpath path/to/lightpath-dev-cli-0.0.3.tgz
```

## Which app, and why

Rule: a real app from `docs/tested-apps.md` that runs under Lightpath 0.0.2 without changing the app's code (installing or upgrading dependencies is allowed), with one HTTP-backed click whose frontend and backend files are known, that another worker isn't using today. Of the four apps: tududi is in use by another worker; Actual's budget engine runs in a Web Worker (not traced) and its install is the slowest; Uptime Kuma's actions go over socket.io (no backend in the trace). That leaves **stepful/fullstack_boilerplate** at `072a62a`.

| Setting         | Value                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Commit          | `072a62ab96e0458b66b17c64f6967ac19ee99721`                                                         |
| Ports           | web 3310, API 3311 (the shop uses 3001 and 5173), set in `.env` files, not in code                 |
| Setup           | `npm install better-sqlite3@12.11.1 --workspace backend`, `npm run db:migrate --workspace backend` |
| Dev command     | `npm run dev` (the app's README)                                                                   |
| Lightpath flags | `--web-root frontend` (run 1 also had `--url http://localhost:3310`)                               |
| Action          | "Take quiz"                                                                                        |
| Right answer    | `frontend/src/pages/quiz.tsx` or `frontend/src/components/quiz.tsx`, and `backend/server.ts`       |
- better-sqlite3 11.6.0 (the app's lockfile) has no prebuilt binary for Node 24, so setup moves it to 12.11.1, as the October trial did. That changes `backend/package.json` and the lockfile, not app code.
- `--web-root frontend` is needed because Vite serves from `frontend/`. A first-time user would have to know this; it counts against the first wow. Lightpath takes the first local URL the dev command prints; here Vite's line came before the API's in every run, but that is a race between two servers.
- The expected files come from the October trial's trace of "Take quiz": the click ran `pages/quiz.tsx` (and `card.tsx`, `utils.ts`, `paths.ts`) in the frontend and the `GET /quizzes/:id` route at `backend/server.ts:27-31`. The link itself is in `components/quiz.tsx`, so either frontend file counts.

## Limits

- Lightpath 0.0.2 records a trace only when someone clicks in its browser. The agent can't click (there is no `run_action` yet), so today's run is expected to fail: the agent can only say no action was recorded and ask for a click. Run it 3 more times once `run_action` exists.
- `npx` downloads the package on a cold cache; the first run's `appOpenMs` includes that, later runs on the same machine may not. Each result records which spec ran.
- One app, one action, one machine (Windows 11, Node 24.13). Other workers run at the same time; CPU load at start and end is in each result.

## Results

See `results/2026-11-01.md`. Today: fail, as expected. The agent's "please click" answer came 34.1 s after `npx` started.

## Changes after results

The check (`check.mjs`) and the expected files didn't change. Two setup changes, each after one failed run, both kept in `results/results.jsonl`:

1. After run 1: dropped `--url http://localhost:3310`. With it, Lightpath 0.0.2 opened the page before Vite was up, got `ERR_CONNECTION_REFUSED` and didn't retry, so the app never opened.
2. After run 2: added `--trust-workspace` and `--require-mcp-startup` to kiro-cli. Without them kiro-cli didn't load the MCP server from the clone's agent config, and the agent had no tools.

## Proposed decisions

`decisions.md` is not edited by this item. These are proposals for the lead.

1. **First-wow agent has only Lightpath's MCP tools, no file tools.**
   - Why: with `read`/`grep`, the agent can answer "which code handles Take quiz" by searching the source, and the metric would measure grep, not Lightpath.
   - Alternative: give it the suite's base tools and require the answer to cite a trace ID. Closer to real use, but the check gets harder to make fair.
   - Evidence: `apps/stepful.mjs` (the link text "Take quiz" is a plain string in `components/quiz.tsx`, so grep finds it at once).
   - Revert: add the base tools to `agentConfig()` in `run.mjs`.
2. **stepful/fullstack_boilerplate at `072a62a` is the first-wow app**, by the rule above.
   - Alternative: Actual (bigger, more impressive, slower install, Web Worker gap).
   - Revert: add `apps/<other>.mjs` and pass `--app`.
3. **README 10-second test pass line: 3 of 4 points with "shows the code that ran" required** (`../readme-test/README.md`).
   - Why: the owner's words are "can say what it does"; what it does is the code that ran, so that point can't be missing.
   - Alternative: all 4 points (stricter on "for coding agents").
   - Revert: change `PASS_MIN_POINTS` in `../readme-test/score.mjs`, and report old and new numbers.
