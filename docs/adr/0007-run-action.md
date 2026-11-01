# ADR 0007: Agents act through Lightpath's own browser, via a `POST /v1/action` endpoint on the daemon

- Status: accepted (design; not built yet)
- Date: 2026-11-01
- Decisions: D-114 (the action), D-115 (the endpoint). Design: [docs/design/agent-loop.md](../design/agent-loop.md).

## Context

A coding agent can't click today. Lightpath records a trace only when a person presses something in the browser that `lightpath dev` opened. The owner's target (a) is "the agent triggers an action and gets its trace in one tool call", and the Phase 3 acceptance is "an agent answers 'which code handles Checkout?' with no human click".

Three facts shape the answer:

- **Who owns the browser.** `lightpath dev` launches Chromium over a pipe and keeps the only Playwright `Page` and CDP session in its own process (`packages/browser/src/collector.ts`, `start()`). The daemon runs in the same process and gets the collector's messages through `ingestLocal` (`packages/cli/src/dev.ts`). `lightpath mcp` is a separate process started by the coding agent; it finds the daemon through `.lightpath/daemon.json` and talks to it over the client WebSocket (`packages/mcp/src/server.ts`, `connect()`).
- **How a press must be sent.** The click boundary is a `debugger;` pause in the hook's first `pointerdown` listener (ADR 0003). Chrome drops a release that arrives during that pause. Measured on the shop, 20 Add to cart and 20 Checkout per method ([browser-control.md](../research/browser-control.md)): a synced press (mouse down, wait until the collector has taken the boundary and resumed, mouse up) matched the reference trace 20 of 20 on both actions, headless and headed. `locator.click()` matched 2 of 20, `page.mouse.click()` 0 of 20, Chrome DevTools MCP `click` 11 of 20, Playwright MCP `browser_click` 0 of 20. `locator.press('Enter')` matched 20 of 20 (label + " (Enter)").
- **When the trace is done.** The collector's settle window (no requests in flight for 300 ms, 5 s cap) ends the browser side. Backend deltas come from the Node agent over HTTP with a 50 ms flush delay (`packages/node-agent/src/transport.ts`), so they can land after `traceEnd`.

## Options

| Option                                                                                      | For                                                                                      | Against                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. MCP tool → new daemon endpoint → the collector's own page (synced press)**             | 20 of 20 traces right; no new port; the daemon already has a token and an `Origin` check | A wire-protocol change; the daemon needs a hook into the collector                                                                                 |
| B. Open a CDP port on 127.0.0.1 and let the agent use Chrome DevTools MCP or Playwright MCP | No Lightpath click code                                                                  | 11 of 20 and 0 of 20 traces right; a CDP port lets any local process drive the browser with no token (Tier 3); the trace still needs a second call |
| C. MCP server drives the browser itself over CDP                                            | No daemon change                                                                         | Needs that same CDP port; two CDP clients on one page race the collector's pause handling                                                          |
| D. Agent clicks with its own browser tool, then calls `find_code_for_action`                | Nothing to build                                                                         | The agent's browser is a second Chrome that Lightpath can't see, so the frontend half is lost ([competitors.md](../research/competitors.md))       |

## Decision

Option A.

- `lightpath mcp` gets a tool, `run_action`. It sends one `POST /v1/action` to the daemon named in the discovery file, with `Authorization: Bearer <token>`.
- The daemon listens on 127.0.0.1 only, as today. The new route uses the same `authorize()` as `/v1/ingest`: a request with an `Origin` header gets 403, a wrong or missing token 401 (`packages/daemon/src/auth.ts`). No CORS headers. No new port, no CDP port.
- `lightpath dev` registers the collector with the daemon (`daemon.setActionRunner(...)`) once the browser is open. With no browser (`--no-browser`, not open yet, or `browser: false`), the endpoint answers the outcome `no_browser`.
- The collector runs the action on its own page with the synced press, or `locator.press` for Enter and Space, one action at a time. Optional `fill` entries are typed first with `locator.fill`, which opens no trace; their values are never echoed (D-114, D-123). The daemon then waits up to 1.5 s for the backend lines of each request the collector tagged, and replies with the trace.
- Message shapes and the full wait rule: D-115 and [the design doc, section 4](../design/agent-loop.md#4-run_action).

## Consequences

- An agent gets an action's trace in one call, and Lightpath's traces stay as right as a human press.
- The daemon process can now act on the page, not just record it. Anyone with the token can click in the app under `lightpath dev`. The token already gives full read access to every trace and source; it is written with user-only permissions (ARCHITECTURE 7.2). This adds no new reader of the token.
- Other browser MCPs still give wrong traces on Lightpath's page if attached through a port. The docs say so, and Lightpath opens no port.
- Press code (`pointerdown`, `mousedown`) is missing from Enter traces and from clicks once the boundary has moved to the release (D-082), as for a person.
- Only one page is driven: the one the collector opened. Popups, new tabs and iframes are out of scope until measured.
- Revert: remove the tool, the route and `setActionRunner`. The endpoint is additive, so `protocolVersion` stays 1 and older clients are unaffected.
