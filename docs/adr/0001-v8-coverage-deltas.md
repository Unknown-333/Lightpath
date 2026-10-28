# ADR 0001: Use V8 precise coverage deltas, not tracing or instrumentation

- Status: accepted
- Date: 2026-10-28

## Context

Lightpath needs the set of lines that ran for one action, in the browser and in Node, without changing the user's code.

## Options

| Option                                               | Line-level                   | Code changes               | Overhead                                                         | Notes                                                      |
| ---------------------------------------------------- | ---------------------------- | -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| **V8 precise coverage, taken at action boundaries**  | Yes (block coverage)         | None                       | Disables optimized code; take cost grows with compiled functions | Counts reset on every take, so two takes bracket an action |
| Istanbul-style source instrumentation (Babel plugin) | Yes                          | Build plugin per framework | Large: every statement increments a counter                      | Needs a plugin for Vite, webpack, tsx, and so on           |
| Debugger stepping or breakpoints on every line       | Yes                          | None                       | Extremely slow                                                   | Unusable for real apps                                     |
| OpenTelemetry spans                                  | No (span level)              | SDK setup                  | Low                                                              | Shows requests, not lines                                  |
| CPU profiler sampling                                | No (samples miss short code) | None                       | Low                                                              | Statistical; misses most of a fast click                   |

## Decision

Use `Profiler.startPreciseCoverage({ callCount: true, detailed: true })` once, then `Profiler.takePreciseCoverage` at the start and end of each action. The docs say the take "resets execution counters", so the second take's result is exactly what ran in between.

Spike results on Node 24.13 support it:

- Deltas list only functions that ran, plus their nested functions and blocks that didn't run with `count: 0`, so innermost-range flattening gives correct per-line results.
- In-process `Session.post` is synchronous, so a take is a plain function call.
- A take costs about 0.75 ms with 1,000 compiled functions and 28 ms with 50,000.

## Consequences

- Chromium only in the browser. Firefox and Safari are out.
- The app runs slower while Lightpath is on, because optimized code is disabled. Documented in the README.
- Coverage is per isolate, so overlapping requests in one process can't be separated (ARCHITECTURE section 6.3).
- Takes must happen only at boundaries. Polling would cost tens of milliseconds each time on a large app.
