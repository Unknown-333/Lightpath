# Lightpath roadmap

Each milestone ends with something you can run and a post you can publish. Don't start a milestone until the previous one's exit check passes.

**Status (October 29, 2026):** M1 is done (see below). The skeleton already passes the M2 and M3 exit checks on the example shop. `node scripts/e2e-shop.mjs` clicks "Checkout" in a real Chrome and gets one trace with `src/Cart.tsx`, `src/api.ts`, `server/routes/orders.ts`, and both services, with untaken branches dark. What's left in M2 and M3 is hardening: more real apps, `tsx` and external source maps in the Node agent, keyboard boundaries, and benchmarks. M4 (the extension) is scaffolded but hasn't been run in VS Code yet.

| Milestone                     | Goal                                                                                                         | Exit check                                                                                                                                                    | Post                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **M0** Skeleton (this commit) | Monorepo builds, lints, and tests; packages have their final shape with stubs                                | `pnpm check` passes; `lightpath --help` runs                                                                                                                  | "Day 1: the architecture" (link to ARCHITECTURE.md)                              |
| **M1** Core pipeline          | `flattenRanges`, `rangesToLines`, `mapToOriginal`, `resolveFile` complete, with fixtures from real V8 deltas | `pnpm --filter @lightpath-dev/core test` with fixtures for plain JS, type-stripped TS, a tsx-compiled file, a Vite-transformed JSX file, and a non-ASCII file | "V8 resets its coverage counters when you read them, and that's the whole trick" |
| **M2** Node end to end        | Agent + daemon: one HTTP request prints its `file:line` ranges                                               | `lightpath dev -- node examples/shop/server/index.ts`, curl `/api/orders`, see `routes/orders.ts` lines in the terminal                                       | Terminal screenshot: "test A passes"                                             |
| **M3** Browser end to end     | Click boundary spike (ADR 0003), then frontend coverage mapped through Vite's source maps                    | Click "Checkout" in the example shop and see `Cart.tsx` and the backend files in one trace                                                                    | The first GIF                                                                    |
| **M4** VS Code extension      | Heat decorations, gutter counts, trace list, replay                                                          | The demo video, recorded on the example shop                                                                                                                  | The launch-quality GIF                                                           |
| **M5** MCP + polish           | MCP tools, `lightpath doctor`, config file, README, benchmarks in `bench/`                                   | An agent answers "which code handles Checkout?" from a real trace                                                                                             | "Giving coding agents runtime eyes"                                              |
| **M6** Python                 | `lightpath-agent` with WSGI/ASGI middleware; React + FastAPI example                                         | Same trace shows `.tsx` and `.py` files                                                                                                                       | r/Python launch                                                                  |
| **Launch**                    | Show HN, Reddit, VS Code Marketplace                                                                         |                                                                                                                                                               |                                                                                  |

## M1 (done, October 29, 2026)

`pnpm --filter @lightpath-dev/core test` maps five real V8 captures through `mapScript()` and compares each against lines checked by hand: plain JS, type-stripped TS, TS compiled by `tsx`, non-ASCII text, and the shop's `Cart.tsx` as Vite served it to Chrome. The capture script is `packages/core/scripts/capture-fixtures.mjs` (see [flow.md](../flow.md)); decisions D-067 to D-070.

What M1 found:

- tsx on Windows writes source map `sources` as `C:\...` paths, which trace-mapping resolved to a path that doesn't exist. Every tsx-loaded file was lost. Fixed in `mapToOriginal` (D-068). The Node agent already forwards inline `data:` maps like tsx's, but no app has run under `tsx` with the agent yet; that's an M2 check.
- Vite's React transform puts the absolute file path into the served code, so the capture redacts it with a same-length placeholder.
- Line granularity has two visible effects, both now pinned by the fixture: a line like `} catch (err) {` is lit when the `try` block ran, and `onChange={(e) => …}` is lit when the element rendered even if the handler never ran.

## M2 in detail

1. Agent: wire `register.ts` startup steps 1 to 7 (ARCHITECTURE section 5.2).
2. Daemon: `POST /v1/ingest` with token check and schema validation, source cache by hash, pipeline, `MemoryStore`.
3. CLI: `lightpath dev` spawns the child with `NODE_OPTIONS` extended and prints traces.
4. Integration test in `packages/node-agent/test/` against a fake daemon.

## Open questions to answer during the build

| Question                                                                                              | Answer in                                                                   |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| ~~Does `takePreciseCoverage` work while the page is paused at the boundary?~~                         | **Answered: yes.** Paused 4.7 to 7.1 ms per click; see ADR 0003             |
| How long is the boundary pause on a large React app, and does it ever exceed a human press?           | M3 benchmark                                                                |
| Does Vite 8 serve inline source maps for every transformed module, including CSS-in-JS and JSX?       | **Answered for JSX/TSX: yes** (golden test). CSS-in-JS still to check in M3 |
| How many compiled functions does a real Express or Fastify app have, and what does a take cost there? | M2 benchmark                                                                |
| ~~Do non-ASCII sources map correctly (UTF-16 offsets)?~~                                              | **Answered: yes** (core fixture with emoji and CJK text)                    |
| How much does `sys.monitoring` with `DISABLE` slow a real Django request?                             | M6 benchmark                                                                |

## Later

Compare two traces, SQL capture (from `diagnostics_channel` database events where drivers publish them), Next.js adapter, worker threads, JetBrains plugin, `SqliteStore`, a hosted team mode (only if users ask).
