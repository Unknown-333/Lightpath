# ADR 0008: Traces carry functions and phases; tools print a ranked function summary under 16,000 characters

- Status: accepted (design; not built yet)
- Date: 2026-11-01
- Decisions: D-109 (budget), D-116 (summary and phases), D-117 (drill-down), D-118 (diff). Design: [docs/design/agent-loop.md](../design/agent-loop.md).

## Context

Today a trace is a list of files with lit lines (`FileHits` in `packages/protocol/src/model.ts`), and every MCP tool prints it whole with `describeTrace()` (`packages/mcp/src/format.ts`). Two problems:

- **Size.** Nothing caps the output. Past 30,000 characters Kiro CLI hands the model only the first and last 500 characters (measured, not documented by Kiro), and the agent failed 9 of 9 runs. D-109 sets the cap: 16,000 characters per tool result.
- **Shape.** Line ranges don't say which function ran, how often, which branch didn't run, or what ran before and after the request. Measured on the shop's Checkout ([call-order.md](../research/call-order.md)): precise coverage alone gives each function's range, call count and untaken blocks (summary 775 characters, today's output 573). It can't give call order: two orders gave byte-identical coverage. One extra browser coverage read when a tagged request leaves the page split the frontend into before and after the request, and ordered every cross-phase pair right, for 4.29 ms per request.

The daemon already has what the summary needs: the V8 function list in each delta and the line counts with zeros (`mapScript` returns "known not run" lines as count 0; `Correlator.#publish` drops them today).

## Decision

- **The trace model grows, optionally.** `Trace` gains `phases` and `functions`, and later `problems` (D-121). `FileHits` stays as it is, so the VS Code extension and the CLI printer keep working unchanged. Each function hit records its file, name, original line range, call count, not-run lines, untaken blocks inside a line that ran, and its phase. All new fields are optional: no `protocolVersion` bump (PROTOCOL.md, "Versioning").
- **Phases come from one extra read.** The collector's `page.route` handler takes coverage before it continues a tagged fetch or XHR request, and sends that delta with a new optional `beforeRequest` field. Navigation requests are skipped: a read inside a held navigation deadlocks the renderer (ADR 0003, measured), and the existing `beforeunload` read already splits a page load.
- **The daemon computes functions; the MCP server formats.** `@lightpath-dev/core` gets a function mapper next to `mapScript`. The correlator fills `functions` per phase. The MCP server ranks, cuts to 16,000 characters, and ends a cut result with one "not shown … call X" line.
- **Slices are read from disk by the MCP server, not sent by the daemon.** The drill-down prints executed lines from the workspace file, warns when the file changed after the trace started, and never runs the redactor over code (D-123). The daemon still never reads files for clients (ARCHITECTURE 7.2).

## Options rejected

- Call order inside a phase: sampling at 100 µs placed 28.33% of page functions and added about 19 ms per request in Node; breakpoints placed 88.89% but added 82.7 ms per click.
- A second read when the response arrives: it found 0 app functions in 20 of 20 runs.
- A "sent by" line per request from the initiator stack: right 20 of 20 but it needs a model field and async stacks on in the page. Revisit if the benchmark shows agents ask what sent a request.
- Slices from the daemon's source cache: the Node side caches the text V8 ran, and Node's type stripping replaces TypeScript syntax with whitespace ([Node docs](https://nodejs.org/api/typescript.html), read 2026-11-01), so types would print as blanks; browser originals exist only when a map has `sourcesContent`. A new client message for it would also widen the wire protocol for a display concern.
- Sending everything and letting the client cut: every client moves long output to a file, and an agent with no file tool can't read it back (0 of 9).

## Consequences

- One tool result is never over 16,000 characters, and a cut result names the call that shows the rest.
- Each tagged fetch or XHR now waits for one coverage read before it leaves the page: 4.29 ms per request on the shop. On a large page a read costs more (8 ms at 12,000 functions, 66 ms at 24,600, bench/README.md). That cost lands on the request, not on the press pause, but it isn't measured on a large app yet. Build 2 measures it on Actual Budget.
- Traces get bigger in the daemon's memory (a function list per phase). The store keeps 200 traces.
- Existing tests that assert the old text change what they assert (Tier 2). D-116 lists them and keeps each assertion at least as strict.
- Revert: drop the new fields and switch the formatter back to `describeTrace()`. Old clients ignore the new fields.
