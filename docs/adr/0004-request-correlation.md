# ADR 0004: Correlate frontend and backend with an `x-lightpath-trace` header

- Status: accepted
- Date: 2026-10-28

## Context

The backend delta for a request has to attach to the click that caused it.

## Options

| Option                                                                            | Pros                                               | Cons                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Add `x-lightpath-trace` with Playwright `page.route` for backend origins only** | Exact; no app changes                              | Must not touch cross-origin requests (a custom header triggers a CORS preflight) |
| Match by time window (any request during the click)                               | No header                                          | Wrong when a background poll lands inside a click                                |
| W3C `traceparent`                                                                 | Standard; OpenTelemetry users already propagate it | Collides with the app's own tracing and may change its sampling                  |

## Decision

Tag requests to the dev server origin (which proxies `/api` in Vite setups), to any loopback origin (`localhost`, `127.0.0.1`, `[::1]` on any port; D-086), and to any origin listed in `backendOrigins`. Leave all other requests unchanged. Requests with no header fall back to a time-window match, and the trace marks them `matchedBy: 'time'`.

## Consequences

- Update (D-086): the header is added by request interception after Chrome has done its CORS checks, so it never triggers a preflight, even when the API's CORS policy allows no custom headers (measured, and covered by a real-browser test). An API on another local port (Vite on :5173, API on :3001) is therefore tagged with no setup. Only remote backends need `backendOrigins` (`--backend`).
- `page.route` adds a little latency to every tagged request. Measure in M2.
