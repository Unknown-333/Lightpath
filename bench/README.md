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
