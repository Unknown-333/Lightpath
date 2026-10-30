# @lightpath-dev/node-agent

Runs inside your Node.js process and reports which code ran for each HTTP request. You don't use this package directly: `lightpath dev` loads it with `NODE_OPTIONS=--require=<path>`.

- No runtime dependencies. It uses `node:inspector`, `node:diagnostics_channel`, and the global `fetch`.
- Does nothing unless `LIGHTPATH_URL` and `LIGHTPATH_TOKEN` are set.
- Never keeps your process alive and never throws into your app.
- Sends source code only for files inside your workspace roots, and only to a daemon on localhost.

Set `LIGHTPATH_DEBUG=1` to see what it's doing on stderr.

Design: [ADR 0002](https://github.com/Unknown-333/Lightpath/blob/main/docs/adr/0002-node-agent-in-process.md), [ADR 0006](https://github.com/Unknown-333/Lightpath/blob/main/docs/adr/0006-agent-ingest-over-http.md), [ARCHITECTURE.md section 5.2](https://github.com/Unknown-333/Lightpath/blob/main/docs/ARCHITECTURE.md).
