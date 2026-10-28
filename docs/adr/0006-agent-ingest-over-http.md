# ADR 0006: Agents push batches over HTTP; they hold no connection

- Status: accepted (supersedes the WebSocket agent channel in the first draft of PROTOCOL.md)
- Date: 2026-10-28

## Context

The first protocol draft had agents keep a WebSocket open to the daemon, and the daemon asked agents for script sources on demand (`getSource`).

That breaks two things:

- An open socket is a live handle on the user's event loop. Scripts, CLIs, and test runners started under `lightpath dev` would never exit on their own.
- The agent runs inside the user's process. Every listener it keeps open is more surface that can fail there.

## Decision

- Agents queue messages and send them as `IngestBatch` bodies with `POST /v1/ingest`, using the global `fetch`. The flush timer is `unref()`ed. Before the process exits, a final synchronous-safe flush is attempted on `beforeExit`.
- Agents push each script's source the first time it appears in a delta, once per hash, and only for workspace files. The daemon caches sources by hash and never calls the agent.
- Agents read their configuration (`LIGHTPATH_URL`, `LIGHTPATH_TOKEN`, `LIGHTPATH_ROOTS`, `LIGHTPATH_SKIP`, `LIGHTPATH_DEBUG`) from environment variables the CLI sets, instead of a `welcome` message.
- The browser collector, which runs inside the CLI process, uses the same ingest API so the daemon has one input path.
- Clients (VS Code, CLI output, MCP) still use a WebSocket, because they need pushed updates.

## Consequences

- Node, browser, and Python agents share one endpoint and one schema.
- Sources for scripts that never run are never sent, which keeps traffic down.
- If the daemon restarts, it loses its source cache and can't map deltas for scripts whose sources were already sent. The agent resends sources when a POST fails or the daemon's `startedAt` (returned in a response header) changes. **(To implement in M2.)**
