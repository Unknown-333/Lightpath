# Trace accuracy audit

`pnpm accuracy` runs small apps through Lightpath and compares every trace with an expected result
written by hand. The expected results were committed before the comparison code existed, so they
were not fitted to Lightpath's output. Fixtures live in `fixtures/`; line numbers are part of the
test, so the fixture files are excluded from formatting.

## 1. How expected results are written

A fixture file is split into scenario blocks. A block starts at a `// @scenario <id>` line and ends
at the next `// @scenario` line or the end of the file. A scenario is one action: one HTTP request
(Node fixtures, `fixtures/node/server.ts` fixes the arguments) or one click (web fixtures, the
button named by `// @click <text>`). A scenario can have blocks in several files.

Every code line inside a block ends with a mark, as a `//!` comment:

| Mark | Meaning for the trace of that scenario's action |
| --- | --- |
| `N` (1, 2, ...) | The line ran exactly N times. |
| `0` | The line did not run: it must not be shown as run. When a function the trace lists encloses the line, the function must list it as not run. |
| `+` | The line ran; its count is not checked (a loop header holds code that runs once and code that runs every pass). |
| `?` | No claim (a line of only braces and keywords, like `} else {`). |
| `span:<text>` | After the mark: a part of this line did not run, and the trace must name it as not run (text containing `<text>`). A line marked `N` without `span:` must not have a not-run part. |

`// @fn <name> <count>` lines list every function of the block that runs in the action and how often
it is called (`(anonymous)` for unnamed ones). The trace's functions in that file, inside the
scenario's blocks, must be exactly this list.

Lines in a block of another scenario must not be shown as run in this scenario's trace.

Rules used when writing the marks:

- A line's count is the highest count of the code on it. `words.map((w) => w.toUpperCase())` called
  once on a list of 4 is `4`: the arrow on that line ran 4 times. This is Lightpath's documented line
  rule (`packages/core/src/lines.ts`), stated here before any comparison.
- A branch line (`if`, `else if`, `case`, `default`, `catch`, `finally`) counts as run only when its
  branch was taken or its test ran. A `case` line counts with its body: an untaken `case` is `0`.
- A statement after a call that threw did not run, even though no `throw` is written in that function.
- A line of a ternary or `&&`/`||` chain on its own line is `0` when that operand was not evaluated,
  even when a `;` or `)` of the whole statement sits at its end.
- React: a component's body runs on render, its handlers on events. The first render happens at page
  load, before any click, so it is in no click's trace.

## 2. Variants (bundlers and source maps)

Every Node scenario runs in each of these, against the same marks in `fixtures/node/src/*.ts`:

| Variant | How it runs | Expected |
| --- | --- | --- |
| `strip` | `node server.ts` (type stripping) | the marks |
| `tsx` | `node --import tsx server.ts` | the marks |
| `tsc` | `tsc -p fixtures/node`, then `node dist/server.js`, `.map` files next to each file | the marks, and no `dist/` path in any trace |
| `tsc-no-map` | as `tsc`, with `dist/src/branches.js.map` deleted | branches scenarios: no `src/branches.ts` lines, and the answer says `[unmapped source]` for `dist/src/branches.js`; the other files keep their marks |

Every web scenario runs in each of these, against the same marks in `fixtures/web/src/*`:

| Variant | How it runs | Expected |
| --- | --- | --- |
| `vite` | the Vite dev server with `@vitejs/plugin-react` | the marks |
| `webpack-eval-cheap-module` | webpack 5, `devtool: 'eval-cheap-module-source-map'`, Babel for JSX | the marks. Cheap maps have no columns, so `span:` checks pass when the not-run part is named correctly or not named at all; a named part must be the right text |
| `webpack-source-map` | webpack 5, `devtool: 'source-map'` (external `.map` files) | the marks, or no `src/` lines with `[unmapped source]` for the bundle. Never bundle lines under another path |
| `webpack-eval` | webpack 5, `devtool: 'eval'` (no maps) | no `src/` lines, and the answer says `[unmapped source]` |

A line range Lightpath can't map must never be guessed: it is either right, or left out and named
as unmapped.

## 3. Ground truth

The same flows also run with no Lightpath at all:

- Node: the `strip` app under `NODE_V8_COVERAGE`, the same requests one at a time, then exit. Node
  writes V8's precise block coverage for the whole process. Lines are counted from it with the same
  line rule. For lines inside scenario blocks, these counts must equal the Lightpath trace's counts.
  The whole-process file also holds start-up code (module top level), which no request trace holds.
- Chrome: the `vite` app in a separate Chrome, through the Chrome DevTools Protocol method the
  DevTools Coverage panel uses (`Profiler.startPreciseCoverage`, then `Profiler.takePreciseCoverage`),
  with call counts and block detail on. Read once after load (discarded), then once after each click:
  these per-click counts must equal Lightpath's. Without the read after load, the whole-session
  totals add the first render, which no click trace holds.

Ground truth shows that Lightpath reports what V8 measured. It doesn't show that V8 measured what
ran: the marks do. Where V8 itself counts a line that didn't run, the marks and V8 disagree, and the
report says so.

## 4. Limits stated in the trace

Some things Lightpath can't trace. Scenarios marked `// @limit <code>` hold the truth anyway. When
the trace differs from it, the action's answer (`run_action` or `run_request` text) must contain a
line starting `limit (<code>):` that says what is missing; then the difference is "stated", not a
mismatch. The line must be there whenever the limit applies, whether or not this run happened to
show a difference.

| Code | Scenario | What the line must say |
| --- | --- | --- |
| `worker` | `web-worker`: the click posts to a Web Worker | code inside Web Workers is not traced |
| `websocket` | `websocket`: the click sends a WebSocket message; the server answers | code run by WebSocket messages, on the server or by late replies, is not in the trace |
| `overlap` | `overlap-a`: two requests run at once | the trace can hold code from the other request |
| `release-boundary` | `press-release`: the press read is over budget (forced with a 0 ms budget; a 3,000-function page measured locally) | press-time handlers (`pointerdown`, `mousedown`) are not in the trace |
