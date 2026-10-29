# Benchmarks

What Lightpath costs the app it watches. Run `pnpm build` first.

## Node backend: `node-requests.mjs`

```sh
node bench/node-requests.mjs [--sizes 1000,10000,50000] [--requests 300]
```

The script generates an HTTP app with N functions (all called once at startup, so V8 has compiled them). It then sends 300 sequential requests after 30 warmup requests, once without Lightpath and once with the agent reporting to a real daemon. Each request calls 50 app functions and does about 1 ms of arithmetic. With `LIGHTPATH_DEBUG=1`, the agent logs the duration of every coverage read, and the script reads those lines.

Results (October 29, 2026; Node 24.13, Windows 11, AMD Ryzen 7 9700X):

| App functions | Functions in first read | First read | Read per request: p50 / p99 | Latency without Lightpath: p50 / p99 | Latency with Lightpath: p50 / p99 | Startup without / with |
| ------------- | ----------------------- | ---------- | --------------------------- | ------------------------------------ | --------------------------------- | ---------------------- |
| 1,000         | 4,213                   | 6.7 ms     | 1.9 / 2.7 ms                | 2.1 / 2.9 ms                         | 6.5 / 8.7 ms                      | 58 / 89 ms             |
| 10,000        | 13,585                  | 26.5 ms    | 5.3 / 7.2 ms                | 2.0 / 2.7 ms                         | 13.7 / 16.6 ms                    | 143 / 187 ms           |
| 50,000        | 54,418                  | 107.9 ms   | 24.1 / 34.3 ms              | 1.9 / 2.5 ms                         | 51.8 / 68.5 ms                    | 521 / 618 ms           |

The same measurement on the example apps (80 `POST /api/orders` requests through the agent):

| App                     | Functions in first read | Read per request (p50) | Request with Lightpath (p50) |
| ----------------------- | ----------------------- | ---------------------- | ---------------------------- |
| `examples/shop` Express | 4,447                   | 1.9 ms                 | 4.3 ms                       |
| Fastify 5               | 6,041                   | 2.3 ms                 | 4.8 ms                       |
| NestJS 12               | 8,553                   | 2.7 ms                 | 6.1 ms                       |

What the numbers say:

- **The cost is the two coverage reads per request**, one when the request starts and one when the response finishes. Running with precise coverage on adds little beyond that here (1,000 functions: 6.5 ms with Lightpath, of which 3.9 ms is the two reads).
- **A read costs about 0.45 ms per 1,000 compiled functions**, and the count includes `node_modules`. "Functions in first read" is roughly everything the process has compiled; a framework alone brings 4,000 to 9,000.
- **Typical APIs pay 4 to 6 ms per request.** A very large backend (50,000 functions) pays about 50 ms per request, which is noticeable but fine for clicking through an app in development. It isn't meant for load tests.
- Startup is slower by tens of milliseconds, up to about 100 ms for the largest app.

## Browser click pause: `browser-pause.mjs`

```sh
node bench/browser-pause.mjs [--sizes 100,1000,3000,4000,6000] [--clicks 40]
```

At each click the page is paused while the collector reads coverage (ADR 0003). Chrome drops a mouse release that arrives during a pause at the press, and a quick press lasts 10 to 100 ms, so that pause has a 20 ms budget. The script generates React apps with N components (each with a state hook, a handler, and two helpers), serves them with Vite in dev mode, and presses a button 40 times through the real `BrowserCollector`. The pause comes from the collector's log.

Results (October 29, 2026; Chrome 156 headless, Windows 11, Ryzen 7 9700X):

| Components | Functions in first read | Boundary | First pause | Pause p50 | Pause p99 |
| ---------- | ----------------------- | -------- | ----------- | --------- | --------- |
| 100        | 421                     | press    | 4.5 ms      | 2.4 ms    | 3.0 ms    |
| 1,000      | 4,111                   | press    | 2.9 ms      | 3.8 ms    | 4.8 ms    |
| 3,000      | 12,311                  | press    | 6.6 ms      | 7.9 ms    | 11.3 ms   |
| 4,000      | 16,411                  | release  | 16.1 ms     | 19.9 ms   | 22.7 ms   |
| 6,000      | 24,611                  | release  | 61.5 ms     | 66.2 ms   | 91.3 ms   |

What the numbers say:

- **Up to about 3,000 components (12,000 functions), the pause at the press stays under 12 ms p99**, inside the 20 ms budget.
- **Above that, the read costs grow faster than the function count**: 8 ms at 12,000 functions, 66 ms at 24,600. A plain script with 24,000 functions reads in 10 ms (measured), so the extra cost comes from React's dev build and Vite's modules, not the count alone.
- **When a read goes over 20 ms, the collector moves the boundary to the mouse release** (D-082) and says so in the terminal. A pause at the release loses nothing: mouseup and click still arrived after a 200 ms pause, and 10 ms presses all worked at 6,000 components (measured). The cost: code that runs on press, in `pointerdown` and `mousedown` handlers, isn't in the click's trace.
- The first click used to pay for reading the whole page load (40 ms at 12,000 functions). The collector now reads that right after `load`, so the first click is no slower than the rest.


## Real large app (Actual): `actual.mjs`

```sh
node bench/actual.mjs --actual <path to an actualbudget/actual clone> [--requests 600] [--rounds 50]
```

The script runs [Actual Budget](https://github.com/actualbudget/actual) the way docs/tested-apps.md describes: a clone outside this repo, installed with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 yarn install`, `yarn workspace @actual-app/sync-server build`, and both processes started with `concurrently` (the Express 5 sync server is one `vite build` bundle; the frontend is React 19 under Vite). The server runs with `NODE_ENV=development`, as Actual's own `start:server-dev` does; otherwise its rate limit (500 requests a minute) refuses requests partway through. Actual's demo budget sends the sync server no requests, so the server was measured with direct HTTP requests, like `node-requests.mjs`: 600 sequential requests (`GET /account/needs-bootstrap`, `/account/validate`, `/sync/list-user-files`) after 30 warmup, once without Lightpath and once with the agent and `LIGHTPATH_DEBUG=1`. For the frontend, the script opens the demo budget in the real `BrowserCollector` and presses the four sidebar links in turn (Reports, Schedules, All accounts, Budget), 50 rounds, each press held 80 ms. The first press on the budget page is left out. The press pause comes from the collector's log. The script also times every coverage read and counts what it returns, by wrapping Playwright's CDP session, with nothing in `packages/` changed. "Page size" is every function any read has returned so far, dependencies included: what V8 has compiled for the page, which every read goes through. That counts dependencies, so it isn't the same measure as "Functions in first read" in the table above.

Results (October 29, 2026; Actual at 53a6185; Node 24.13, Chrome headless, Windows 11, AMD Ryzen 7 9700X):

Sync server, direct HTTP requests:

| Functions in first read | First read | Read per request: p50 / p99 (1,200 reads) | Latency without Lightpath: p50 / p99 | Latency with Lightpath: p50 / p99 |
| ----------------------- | ---------- | ----------------------------------------- | ------------------------------------ | --------------------------------- |
| 13,175                  | 23.91 ms   | 7.09 / 9.56 ms                            | 0.67 / 1.52 ms                       | 16.18 / 21.72 ms                  |

Frontend, demo budget:

| Pressed                     | Clicks | Page size at the press (p50) | Press pause: p50 / p99 / max | Closing read: functions / app functions / browser files (p50) | Closing read time: p50 / p99 |
| --------------------------- | ------ | ---------------------------- | ---------------------------- | ------------------------------------------------------------- | ---------------------------- |
| All four sidebar links      | 199    | 35,362                       | 15.9 / 19.8 / 20.2 ms        | 2,366 / 652 / 133                                             | 25.4 / 36.2 ms               |
| Sidebar "Reports" link      | 49     | 35,362                       | 15.8 / 19.8 / 19.8 ms        | 3,082 / 599 / 112                                             | 28.0 / 37.2 ms               |
| Sidebar "Schedules" link    | 50     | 35,403                       | 15.9 / 19.5 / 19.5 ms        | 1,636 / 425 / 97                                              | 22.2 / 27.7 ms               |
| Sidebar "All accounts" link | 50     | 35,444                       | 15.6 / 20.2 / 20.2 ms        | 2,562 / 1,048 / 140                                           | 26.2 / 36.2 ms               |
| Sidebar "Budget" link       | 50     | 35,485                       | 16.1 / 19.0 / 19.0 ms        | 2,101 / 655 / 133                                             | 24.6 / 32.0 ms               |

The press read finds 0 app functions by design (191 of 199 presses; at most 1), because nothing in the app ran since the previous click's closing read; it still returns about 174 functions from dependencies, Vite and the test driver (p50), and its cost depends on page size, not on what it returns. The closing read runs after the settle window, and the page isn't paused during it: the collector resumes the page before the window opens and doesn't pause it again. The "All accounts" press is labelled `span: __global!accounts-balance`, not `a: All accounts`, because of a label bug fixed after this run (D-098): a balance cell inside the link has its own `data-testid`. Code in Web Workers isn't collected, and Actual runs its budget engine in one, so the engine's work costs no read and is in no trace.

What the numbers say:

- **A real bundled backend costs what `node-requests.mjs` predicts for its size.** A read of its 13,175 functions takes 7.09 ms (p50), between the 10,000- and 50,000-function rows above, and a request goes from 0.67 ms to 16.18 ms with Lightpath.
- **At about 35,000 functions on the page, the press pause is 15.9 ms p50 and 19.8 ms p99**, inside the 20 ms budget, so the boundary stayed at the press for the whole run. The slowest press paused 20.2 ms. Page size grew from 30,622 to 39,421 functions over the 199 clicks.
- **The closing read is the longer one (25.4 ms p50, 36.2 ms p99)**, and it holds the click's code: 133 browser files at the median, none empty. It doesn't cost a dropped mouse release, because the page isn't paused then.
- "Try the demo" on the start screen (page size 25,130) paused 17.9 ms. It changes the route without reloading the page; its closing read held the budget opening, 254 browser files.
