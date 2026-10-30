# Lightpath

[![npm](https://img.shields.io/npm/v/@lightpath-dev/cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@lightpath-dev/cli)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lightpath-dev.lightpath-vscode?label=VS%20Code&color=007acc)](https://marketplace.visualstudio.com/items?itemName=lightpath-dev.lightpath-vscode)
[![CI](https://github.com/Unknown-333/Lightpath/actions/workflows/ci.yml/badge.svg)](https://github.com/Unknown-333/Lightpath/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Click anything in your running app and see the exact code it ran, frontend and backend, line by line.**

No code changes, no test suite, no tracing setup. Lightpath runs your dev server, opens your app, and turns each click into a trace you can read in your terminal, see lit up in VS Code, or hand to your coding agent.

![Clicking Add to cart and Checkout in the example shop lights up Cart.tsx and the order route in VS Code, then Replay walks through every file the click ran](docs/media/demo.gif)

## Why

You open an unfamiliar or AI-written codebase and spend an hour working out which of 400 files handle one button. Coverage tools only show what your tests ran. Tracing tools show whole requests, not lines, and need setup in your code. Lightpath answers one question: **what ran when I clicked this?**

- **Both sides of the app in one trace.** React in the browser and the Node route it called, joined by a header on the request.
- **Lines, not just files.** Branches that didn't run stay dark. Code that ran more often glows brighter.
- **Made for coding agents.** An MCP server lets Claude Code, Cursor, VS Code or Kiro ask "which code handles Checkout?" and get the real answer.
- **Local only.** The daemon listens on `127.0.0.1` with a token. Nothing leaves your machine.

## Quick start

Requires Node.js 22.12+ and Chrome or Edge.

```sh
npx @lightpath-dev/cli dev -- npm run dev
```

Lightpath starts your dev command, finds your app's URL in its output, and opens the app in a browser. Click something. The code path prints in your terminal.

To see it in your editor, install the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=lightpath-dev.lightpath-vscode):

```sh
code --install-extension lightpath-dev.lightpath-vscode
```

It turns on by itself in any folder where `lightpath dev` is running.

If something doesn't work, `npx @lightpath-dev/cli doctor` checks Node, the browser, the agent and your config file, and says what to fix.

### Try it on the example shop

```sh
git clone https://github.com/Unknown-333/Lightpath.git
cd Lightpath
corepack pnpm install
corepack pnpm build
corepack pnpm --filter shop lightpath
```

## What a click looks like

This is real output from the example shop (React + Vite + Express), after Add to cart and Checkout:

```
◆ button: Checkout 335 ms
  → POST /api/orders 201
  ├─ src/api.ts :25-32, 35-36
  ├─ src/App.tsx :6-8, 10, 12, 24-41, 43 ×6
  ├─ src/Cart.tsx :11-14, 16-19, 21-28, 30-33, 35-44, 46-48, 50 ×4
  ├─ src/money.ts :3-5 ×9
  ├─ server/db.ts :26-28, 30-38 ×3
  ├─ server/routes/orders.ts :11-14, 19-21, 25, 29, 31-33, 38-40
  ├─ server/services/payment.ts :6-7, 10-12
  └─ server/services/pricing.ts :12-19, 21-22, 26-33
```

Each line is a file and the lines in it that ran. `×N` is the most times any of those lines ran. The empty-cart branch in `orders.ts` didn't run, so it isn't listed, and in VS Code it stays dark.

## Ask your coding agent

`lightpath mcp` is an [MCP](https://modelcontextprotocol.io) server. Your agent can ask which code ran for something you just did, instead of guessing from file names.

| Tool                   | Answers                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `find_code_for_action` | "Which code handles Checkout?" from the last matching click |
| `list_traces`          | What you clicked recently                                   |
| `get_trace`            | Every file and line one action ran, frontend and backend    |
| `diff_traces`          | Lines that ran in only one of two actions                   |

Add it once:

| Agent       | Setup                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `claude mcp add lightpath -- npx -y @lightpath-dev/cli mcp`                                                                              |
| Cursor      | `.cursor/mcp.json`: `{ "mcpServers": { "lightpath": { "command": "npx", "args": ["-y", "@lightpath-dev/cli", "mcp"] } } }`               |
| VS Code     | `.vscode/mcp.json`: `{ "servers": { "lightpath": { "type": "stdio", "command": "npx", "args": ["-y", "@lightpath-dev/cli", "mcp"] } } }` |
| Kiro        | `.kiro/settings/mcp.json`: `{ "mcpServers": { "lightpath": { "command": "npx", "args": ["-y", "@lightpath-dev/cli", "mcp"] } } }`        |

The server looks for `.lightpath/daemon.json` in its folder and then each parent, so it finds the `lightpath dev` running in your project. Pass `--root <folder>` if your agent starts it somewhere else.

This is what an agent gets for "which code handles Checkout?" in the example shop, from a real click (`pnpm e2e` checks it):

```
Trace t_0oq7762nndnu: button: Checkout
  request: POST /api/orders → 201 (node, 12 ms)
  src/api.ts [browser] lines 25-32, 35-36
  src/Cart.tsx [browser] lines 11-14, 16-19, 21-28, 30-33, 35-44, 46-48, 50 (max 4 hits)
  server/routes/orders.ts [node] lines 11-14, 19-21, 25, 29, 31-33, 38-40
  server/services/pricing.ts [node] lines 12-19, 21-22, 26-33
  server/services/payment.ts [node] lines 6-7, 10-12
  ...
```

From that, the agent can answer exactly: `checkout()` in `Cart.tsx` calls `placeOrder()` in `api.ts`, which posts to `createOrder` in `orders.ts`, which prices the cart in `pricing.ts` and charges it in `payment.ts`.

## In VS Code

| Feature              | What it does                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| Heat highlights      | Lines that ran for the last action light up in 8 levels, brighter for more hits    |
| `× N` counts         | Lines that ran more than once show how many times                                  |
| Actions view         | Recent clicks and requests, each with the files it touched                         |
| Replay Last Action   | Steps through an action's files in the order they ran, browser first, then backend |
| Keep Highlights      | Highlights fade after 10 seconds (`lightpath.fadeSeconds`); this keeps them        |
| Clear Highlights     | Removes them                                                                       |
| Pause or Resume Live | Stops following new clicks while you read one                                      |

## Config file

Flags are enough for most apps. To save them, or to hide generated code, put a `lightpath.config.json` next to your `package.json`. Then `npx @lightpath-dev/cli dev` needs no arguments.

```json
{
  "$schema": "./node_modules/@lightpath-dev/cli/lightpath.config.schema.json",
  "command": "npm run dev",
  "backend": ["https://api.staging.example.com"],
  "ignore": ["src/generated/**", "*.gen.ts"]
}
```

| Key                       | What it does                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `command`                 | Your dev command. A string runs in a shell; a list runs as is                                                                      |
| `url`                     | Your app's URL, if Lightpath can't find it in the command's output                                                                 |
| `webRoot`                 | The folder your dev server serves from, if it isn't this one                                                                       |
| `backend`                 | Remote API origins to link to clicks. Local ones on any port are linked already                                                    |
| `roots`                   | Folders whose files show in traces (default: this one)                                                                             |
| `ignore`                  | Globs for files to leave out of traces. `*` stays in one folder, `**` crosses folders, and a name with no `/` matches at any depth |
| `settleMs`, `maxSettleMs` | How long a click waits for quiet (300 ms) and at most (5,000 ms)                                                                   |
| `browser`, `headless`     | `browser: false` traces backend requests only; `headless: true` hides the window                                                   |

A flag on the command line wins over the file. Unknown keys are errors, so typos don't pass silently.

## How it works

```
 your browser ──(V8 coverage over DevTools)──┐
       │ click → request + x-lightpath-trace │
       ▼                                     ▼
 your Node server ──(in-process agent)──► lightpath daemon ──► terminal, VS Code, MCP
```

| Part           | Technique                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser        | V8 precise coverage over the Chrome DevTools Protocol. Reading coverage resets V8's counters, so a read just before a click and one after it give exactly that click's code                       |
| Click boundary | A capture `pointerdown` listener pauses the page for the read, before your handlers run: about 2 ms on a small app, about 16 ms on a very large one ([ADR 0003](docs/adr/0003-click-boundary.md)) |
| Node backend   | An in-process agent preloaded with `--require` brackets each HTTP request with coverage reads, using `diagnostics_channel`                                                                        |
| Correlation    | Requests from the click carry an `x-lightpath-trace` header                                                                                                                                       |
| Mapping        | Byte offsets → lines → source maps → your files, in a pure, tested pipeline                                                                                                                       |
| Python backend | Preview: `sys.monitoring` with per-line `DISABLE` and `restart_events()`, one callback per line per request ([agents/python](agents/python)). Joining it into click traces is M6                  |

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design, [docs/PROTOCOL.md](docs/PROTOCOL.md) for the wire format, and [docs/adr](docs/adr) for the decisions and what was measured.

## Performance

Lightpath is for development, not production or load tests. Measured on Windows 11 with a Ryzen 7 9700X ([bench/README.md](bench/README.md)):

| What                                                | Cost                     |
| --------------------------------------------------- | ------------------------ |
| Backend request, Express/Fastify/Nest examples      | 4 to 6 ms extra          |
| Backend request, about 50,000 functions             | about 50 ms extra        |
| Click pause, 100 React components                   | 2.4 ms p50, 3.0 ms p99   |
| Click pause, 3,000 React components                 | 7.9 ms p50, 11.3 ms p99  |
| Click pause, Actual Budget (about 35,000 functions) | 15.9 ms p50, 19.8 ms p99 |

Chrome drops a mouse release that arrives while the page is paused, so the click pause has a 20 ms budget. On pages where reading takes longer, Lightpath moves the boundary to the mouse release, where a pause loses nothing.

## Tested on real apps

| App                                                                               | Stack                                 | Result                                              |
| --------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| [stepful/fullstack_boilerplate](https://github.com/stepful/fullstack_boilerplate) | React + Vite, Fastify under `ts-node` | Works with no flags                                 |
| [chrisvel/tududi](https://github.com/chrisvel/tududi)                             | React + webpack, Express              | Works once webpack has source maps                  |
| [actualbudget/actual](https://github.com/actualbudget/actual)                     | React 19 + Vite, bundled Express 5    | Works, 263 frontend files on one click              |
| [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma)                   | Vue + Vite, Express + socket.io       | Works for HTTP requests; socket.io messages not yet |

The first two apps found 7 bugs (D-085 to D-091), all fixed. The details are in [docs/tested-apps.md](docs/tested-apps.md).

## Known limits

- Chromium-based browsers only (precise coverage is a DevTools Protocol feature).
- Overlapping requests in one process can't be separated; their traces are marked "overlapped".
- In very large apps (over about 3,000 React components in dev mode), clicks are traced from the mouse release, so `pointerdown` and `mousedown` handlers aren't included.
- Next.js server components and worker threads aren't supported yet.
- webpack apps need source maps in development. webpack's default dev setting (`devtool: 'eval'`) has none, so frontend files can't be shown; Lightpath says so and suggests `devtool: 'eval-cheap-module-source-map'`. Vite needs nothing.
- Service workers are turned off in the browser Lightpath opens, so requests stay visible to it. Offline mode and push notifications won't work there.
- Code running in Web Workers isn't traced yet.
- Backend code is traced per HTTP request. Messages over WebSockets (socket.io and similar) don't open a backend trace yet.

Found something else? [Open an issue](https://github.com/Unknown-333/Lightpath/issues) with your stack and what you clicked.

## Packages

| Package                                            | What it does                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [`@lightpath-dev/cli`](packages/cli)               | `lightpath dev`, `lightpath mcp`, `lightpath doctor`              |
| [`@lightpath-dev/core`](packages/core)             | Coverage ranges to source lines; pure and fully tested            |
| [`@lightpath-dev/daemon`](packages/daemon)         | Receives coverage, builds traces, serves clients                  |
| [`@lightpath-dev/browser`](packages/browser)       | Chrome launcher, click boundary, frontend coverage                |
| [`@lightpath-dev/node-agent`](packages/node-agent) | Runs inside your Node process; no dependencies                    |
| [`@lightpath-dev/mcp`](packages/mcp)               | MCP tools so coding agents can ask "which code handles Checkout?" |
| [`@lightpath-dev/protocol`](packages/protocol)     | Message schemas and the daemon client                             |
| [`lightpath-vscode`](extensions/vscode)            | Heat highlights, hit counts, action list, replay                  |
| [`lightpath-agent`](agents/python) (PyPI)          | Python agent with WSGI and ASGI middleware (preview)              |

## Roadmap

0.0.1 covers milestones M1 to M5: browser and Node traces, VS Code, MCP, config and benchmarks. Next is M6: a Python backend in the same trace as the React frontend (React + FastAPI). See [docs/ROADMAP.md](docs/ROADMAP.md) and the [changelog](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `corepack pnpm check` runs everything CI runs.

## License

[MIT](LICENSE)
