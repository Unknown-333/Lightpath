# Call order and function-level summaries from V8 coverage

Phase 1 research, work item it_ebbd00d1. Written 2026-11-01. Owner's ask served: "Call order and function-level summaries from V8 coverage: prototype, measure, recommend", answered by experiment ("can call order and function-level summaries come from V8 coverage alone, or need another technique?"), and Phase 2 target b: "Compact, token-budgeted output by default; drill-down on request; executed-code slices with untaken branches marked."

Budget N is 4,000 tokens, enforced as at most 16,000 characters per tool result ([agent-mcp-behavior.md](agent-mcp-behavior.md)).

## Result

| Question                                           | Answer                                                                                                                      | Key number                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Function-level summary from coverage alone?        | **Yes.** Precise coverage gives every function's range, call count and untaken blocks.                                      | 775 chars for the Checkout trace (describeTrace today: 573)                      |
| Call order from coverage alone?                    | **No.** Two different call orders give byte-identical coverage.                                                             | `identical coverage for both orders: true`                                       |
| Coarse order (phases) from more coverage reads?    | **Yes, exact on the shop.** One read when the request leaves the page splits the frontend into before and after.            | 100% of pairs it orders are right; 68.57% of pairs ordered; +4.29 ms per request |
| Full order inside a phase?                         | **Not worth it.** Sampling misses most functions; breakpoints cost about 9 times the click's own work (82.7 ms on 9.60 ms). | sampling sees 28.33% (browser), breakpoints add 82.7 ms per click                |
| Executed-code slices with untaken branches marked? | **Yes**, from coverage alone, all 12 untaken blocks marked.                                                                 | 5,471 chars for the whole trace                                                  |
| Does each fit 16,000 chars?                        | Yes, all of them, on the shop.                                                                                              | largest is 5,471 (34% of the cap)                                                |

Every size is the same in all 20 runs (sd 0), because the shop runs the same code each time. Timings are p50 over 20 runs unless a row says otherwise.

## Method

- **App**: `examples/shop` (React + Vite, Express in type-stripped TypeScript), API on port 3201 and Vite on 5373 in this worktree only. Each run clicks "Add to cart" (Coffee mug), then "Checkout", through the real pipeline: daemon, Node agent, `BrowserCollector` in headless Chromium. Presses are Playwright mouse down, 80 ms, up, as in `scripts/e2e-shop.mjs`.
- **Runs**: 1 warm-up plus 20 timed runs per condition, each condition in a fresh daemon, shop and browser. CPU load (`Get-Counter`) at the start and end of each batch: all under 20% except the end of G0 (20.7%, marked BUSY in `harness-G0.log`).
- **Ground truth**: `make-gt.mjs` copies the shop and puts a log call on the first line of each of its 25 functions, so line numbers stay the same. Each call logs `file:line` and `performance.timeOrigin + performance.now()`, in the page and in Node. A Checkout click makes 43 calls to 15 distinct functions (9 in the page, 6 in Node). The page's app code spans 9.60 ms; Node's spans 0.06 ms. In run 1 the coverage function list and the logged list matched exactly (no function missing on either side).
- **Scoring**: ground-truth order is the order of each function's first call, both sides merged by timestamp. For each technique: _placed_ is the share of executed functions it gives a position; _pairs ordered_ is the share of all function pairs it puts in some order (ties don't count); _correct_ is the share of ordered pairs in the true order.
- **Conditions** (all on the ground-truth copy except P):

| Condition | What is added                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P         | nothing, plain `examples/shop` (sizes)                                                                                                                          |
| G0        | nothing (cost baseline for the techniques)                                                                                                                      |
| A         | coverage reads when `/api/orders` leaves the page and when its response arrives (a Playwright route that reads, fetches, reads, fulfills)                       |
| B         | CDP `Network.requestWillBeSent` initiator stacks, async stack depth 32                                                                                          |
| C         | sampling CPU profiler at 100 µs in the page (whole click) and in Node (per request, in-process `Profiler.start`/`stop` on the agent's own diagnostics channels) |
| E         | a CDP breakpoint at every app function V8 had reported in the page, logging each hit (set once after the first "Add to cart")                                   |

Scripts: [`bench/prototypes/call-order/`](../../bench/prototypes/call-order/README.md). Raw output: `C:\Users\user\lightpath-trials\goal\callorder-raw\` (`analysis-P-G0-A-B-C-E.txt` holds every number below; `runs-*.jsonl` the raw traces and coverage; `sample-*` the printed outputs).

## 1. Function-level summary

Built from the coverage deltas the pipeline already collects, with `@lightpath-dev/core`'s own `mapScript` for lines: for each function with a count above 0, its name, file, first and last line, call count, and the lines inside it that are known not to have run (count 0).

```text
Trace t_p6szzi2njx9d: button: Checkout
  request: POST /api/orders → 201 (node, 3 ms)
  server/routes/orders.ts [node]
    createOrder 11-40 ×1 not run: 15-17, 22-24, 26-28, 34-36
  server/db.ts [node]
    findProduct 26-28 ×3
    (anonymous) 27-27 ×6
    saveOrder 30-38 ×1
  server/services/payment.ts [node]
    charge 6-12 ×1 not run: 8-9
  server/services/pricing.ts [node]
    priceCart 12-33 ×1 not run: 23-24
  src/App.tsx [browser]
    App 6-43 ×2 not run: 11, 14-22
    (anonymous) 29-37 ×6
    onCheckedOut 40-40 ×1
  src/api.ts [browser]
    placeOrder 25-36 ×1 not run: 33-34
  src/Cart.tsx [browser]
    Cart 11-50 ×4 not run: 29
    (anonymous) 16-19 ×2
    (anonymous) 17-17 ×4
    checkout 21-33 ×1 not run: 29
  src/money.ts [browser]
    formatCents 3-5 ×9
```

| Output for the same Checkout trace (P, 20 runs)      | Chars | Chars/4 | Fits 16,000 |
| ---------------------------------------------------- | ----- | ------- | ----------- |
| `describeTrace` today (`packages/mcp/src/format.ts`) | 573   | 143.25  | yes         |
| Function summary                                     | 775   | 193.75  | yes         |
- The summary costs 202 more chars than today's output and says which function ran, how often, and which branches didn't run. `describeTrace` gives only line ranges.
- "not run" includes nested functions that weren't called (App's `addToCart`, lines 14-22, and the `useEffect` callback, line 11). A real format should name those as "not called: addToCart" instead of line numbers.
- Arrow functions have no name in coverage. The summary shows `(anonymous)`; the slice (section 3) shows the line.
- No extra runtime cost: the data is already in each delta.

## 2. Call order

### Coverage alone can't give order

`order-blind.mjs` runs `a(1); b(2); c(3)` and then `c(3); b(2); a(1)` between coverage reads. Both reads are identical (`identical coverage for both orders: true`). A read holds per function only `functionName`, `ranges` and `isBlockCoverage`, and per range only offsets and a count. It has no time and no caller: `a` shows count 2 but not that `b` called it once.

### Techniques measured against the ground truth

| Technique                                                                             | Side    | Placed                       | Pairs ordered | Correct          | Extra cost (p50, vs G0)                                                                          |
| ------------------------------------------------------------------------------------- | ------- | ---------------------------- | ------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| Today: one browser delta + one Node delta                                             | both    | 100%                         | 0%            | n/a              | none                                                                                             |
| (a) phases: + read when the request leaves the page, + read when the response arrives | both    | 100%                         | 68.57%        | 100% (1440/1440) | reads 4.29 ms + 2.23 ms, held on the request; click +5.0 ms (122.23 vs 117.23); app span +7.7 ms |
| (b) initiator stack of the fetch                                                      | browser | 22.22%                       | 2.78%         | 100% (20/20)     | click +0.16 ms (117.39); app span +0.9 ms (10.50 vs 9.60)                                        |
| (c) sampling profiler, 100 µs                                                         | browser | 28.33% (at least one run 0%) | 7.64%         | 96.36% (53/55)   | click +9.45 ms (126.68); app span +19.7 ms (29.30)                                               |
| (c) sampling profiler, 100 µs                                                         | Node    | 8.33% (at least one run 0%)  | 0%            | n/a              | request 22 ms vs 3 ms (+19 ms)                                                                   |
| (d) stack captured at the route handler                                               | Node    | 1 of 6                       | 0%            | n/a              | 0.04 ms                                                                                          |
| (e) breakpoint at every app function                                                  | browser | 88.89%                       | 77.78%        | 100% (560/560)   | click +84.5 ms (201.71); app span +82.7 ms (92.30); 29 pauses per click                          |

Press pause stayed at 3.00 to 3.10 ms p50 in every condition, and the boundary stayed at the press in all runs.

What each technique sees:

- **(a) Phases.** The read when the request left the page held all 6 functions that ran before the request in 20 of 20 runs. The read when the response arrived held 0 app functions in 20 of 20 runs: nothing ran while the request was out. So on the shop one extra read gives the same phases as two. Phases order every cross-phase pair right; pairs inside a phase stay unordered (31.43%). The read happens while the page runs, not while it is paused, so on an app that keeps running code during a request the split is less clean. Not measured here.
- **(b) Initiator stack.** 10 frames per fetch, 2 of them app functions: `checkout` (Cart.tsx) then `placeOrder` (api.ts). It is exactly the chain that sent the request, nothing else. It can't see code that ran before or after the fetch, such as renders.
- **(c) Sampling.** Shop functions run for microseconds, so a 100 µs sampler mostly misses them. The page profile took 983 samples per click and still placed only 51 of 180 function slots over 20 runs. In Node, 8 samples per request placed 10 of 120. Starting and stopping the profiler per request costs about 19 ms per request (stop alone 2.89 ms). It sees every run of a function it happens to hit, not only the first.
- **(d) Node stack at the handler.** 10 frames, 1 app frame (`createOrder`). Express sits under it, so a stack shows how a request reached the handler, not what the handler then called. The request bracket the agent already has (one delta per request) gives the backend phase for free.
- **(e) Breakpoints.** Each hit costs about 2.9 ms (82.7 ms / 29 hits). Breakpoints see every call, not only the first. They can only go on functions V8 has already reported: `placeOrder` had never run when they were set, so it was missed in all 20 runs (15 breakpoints were set, none in api.ts). A Node version would need the inspector on another thread, because an in-process session can't pause its own thread; not built.

### The cost grows with page size

The shop page is small. A coverage read in the page costs 8 ms at 12,000 functions and 66 ms at 24,600 ([bench/README.md](../../bench/README.md), browser click pause), and in Node about 0.45 ms per 1,000 compiled functions. One more read per request in the page therefore costs what one press read costs, but while the request waits, not while the page is paused, so it doesn't count against the 20 ms press budget. Not measured on a large app here.

## 3. Executed-code slices

For each function that ran (outermost only), print the lines that ran with their numbers, and fold each run of not-run lines into one marker. Lines with no coverage (blank lines, comments, JSX text) are left out. Untaken blocks that sit inside a line that ran (`?? []`, a ternary arm) get a short marker with their text. An excerpt:

```text
server/routes/orders.ts
  11  export function createOrder(req: Request, res: Response): void {
  12    const body = req.body as OrderBody;
  13    const lines = body.lines ?? [];  // not run: ?? []
  14    if (lines.length === 0) {
      // not run: lines 15-17
  19    for (const line of lines) {
  20      const product = findProduct(line.productId);
  21      if (!product) {
      // not run: lines 22-24
  25      if (product.stock < line.qty) {
      // not run: lines 26-28
  29    }
  31    const quote = priceCart(lines, body.coupon);
  32    const payment = charge(quote.totalCents);
  33    if (!payment.ok) {
      // not run: lines 34-36
  38    const order = saveOrder({ lines, totalCents: quote.totalCents, paymentId: payment.id });
  39    res.status(201).json({ orderId: order.id, ...quote });
  40  }
```

| Slices for the whole Checkout trace (P, 20 runs) | Chars | Chars/4  | Fits 16,000 |
| ------------------------------------------------ | ----- | -------- | ----------- |
| Line markers only                                | 5,398 | 1,349.5  | yes         |
| Line markers + within-line markers               | 5,471 | 1,367.75 | yes         |

By file (with within-line markers): src/Cart.tsx 1,580, src/App.tsx 1,002, server/routes/orders.ts 825, server/services/pricing.ts 755, server/db.ts 493, src/api.ts 434, server/services/payment.ts 251, src/money.ts 133.

- The executed functions held 12 untaken blocks. Line markers caught 8. The other 4 sit inside one line that ran: `orders.ts:13` (`?? []`), `pricing.ts:26` (`? 0`), `Cart.tsx:18` (`: 0`) and `Cart.tsx:47` (`'error'`). The within-line marker names all 4.
- In Node the marker text is exact (no source map). Through Vite's source maps the start column needed the upper-bound lookup. Even then `Cart.tsx:18` prints `0)`, one character too many.
- The whole trace's slices are about 7 times the size of the summary. On the shop they still fit the cap, but a real app's trace won't. Slices belong in the drill-down, one file or one function per call, paged under 16,000 chars.

## Recommendation

1. **Default output for one action: the function summary, grouped by phase.** Header and requests, then "before the request" (browser), one block per request (Node), "after the response" (browser). Inside each block, files and functions as in section 1, each function with its line range, call count and not-run lines. Rank and cut to 16,000 chars with a "not shown ... call X" line, as agent-mcp-behavior.md proposes. On the shop it is 775 chars plus phase headers.
2. **Phases: add one browser coverage read when an action's tagged request leaves the page.** The collector's `page.route` handler already holds each tagged request, so the read goes there. It placed every function and ordered every cross-phase pair right, for 4.29 ms per request on the shop. Skip the read at response arrival: it found 0 app functions in 20 of 20 runs. Revisit if a real app shows code running during the wait.
3. **No call order inside a phase.** Sampling sees 28.33% of page functions and 8.33% of Node ones and adds about 19 ms per request in Node. Breakpoints see 88.89% but add 82.7 ms to a click, and miss functions not yet compiled. Neither is worth its cost for the default output.
4. **Optional: one "sent by" line per request** from the initiator stack (`checkout` → `placeOrder`). It is always right and costs nothing measurable, but it needs a new field in the trace model (Tier 2) and async stacks on in the page. Only if the agent benchmark shows agents need it.
5. **Drill-down returns slices** for one file (or one function) of one trace, with line and within-line not-run markers, paged under 16,000 chars. All 8 shop files fit in one page each (largest 1,580 chars).

## Limits of this study

- One small app. Read costs on large pages come from bench/README.md, not from this study.
- One sampling interval (100 µs). A shorter interval would see more and cost more; not measured.
- The ground truth merges page and Node by wall-clock timestamps from two processes. Phases are milliseconds apart (the request alone takes 3 ms), so this doesn't change any pair here.
- The ground-truth copy runs 43 extra log calls per click and a stack capture at `createOrder` (0.04 ms). Its clicks were 12.1 ms slower than the plain shop (117.23 vs 105.13 ms p50 visible time), which is more than those calls explain. I didn't find the cause. All technique costs above are compared with G0, the same copy, so this offset cancels out.
- Condition A's prototype route took over the request from the collector's own route handler. So that condition's normal trace lost the frontend code that the extra read had already taken (73.33% placed for "today" in A). A real implementation would merge the extra read into the trace.
- `visibleMs` is from the press to the success message, so it includes the 80 ms hold.

## Proposed decisions

Not written to `decisions.md` (owned by another item). Each one: what, why, alternatives, evidence, how to revert.

1. **Function summary as the default trace text.**
   - What: `find_code_for_action` and friends return the function summary (name, lines, calls, not-run lines) instead of only file line ranges.
   - Why: it fits N on the shop (775 chars) and answers "which function, which branch" without a second call.
   - Alternatives: keep `describeTrace` (573 chars, no function names or branches); or send slices by default (5,471 chars, too big for real apps).
   - Evidence: section 1, `analysis-P-G0-A-B-C-E.txt` lines `[P] chars ...`.
   - Revert: switch the formatter back; the trace data doesn't change.
2. **Phases from one extra browser read per tagged request.**
   - What: in the collector's route handler, read coverage before continuing a tagged request, and file that delta as "before request N". The closing read stays as is.
   - Why: it gives correct cross-side order for 4.29 ms per request on the shop. The read happens while the request waits, outside the press pause.
   - Alternatives: two reads, adding one at response arrival (+2.23 ms; found nothing on the shop); no phases (0% of pairs ordered).
   - Evidence: section 2, rows (a).
   - Revert: drop the read; the deltas merge back into one.
   - Tier: if the phase travels to the daemon as a new delta field, that is a wire-protocol change (Tier 2, D-entry first).
3. **No intra-phase call order; no sampling profiler and no breakpoints.**
   - What: don't build them.
   - Why: low coverage of functions (28.33%, 8.33%) or a high cost per click (+82.7 ms).
   - Alternatives: sampling at a shorter interval (not measured); breakpoints only on demand for one function (not measured).
   - Evidence: section 2, rows (c) and (e).
   - Revert: nothing to revert.
4. **Request initiator chain: defer.**
   - What: don't add it now; reconsider if benchmark runs show agents asking "what sent this request".
   - Why: exact but narrow (2 functions per request), and it needs a trace-model field (Tier 2).
   - Evidence: section 2, row (b).
5. **Slices in the drill-down, with line and within-line markers.**
   - What: a drill-down call (by trace and file, or function) returns the executed lines with not-run markers, paged under 16,000 chars.
   - Why: it marks all 12 untaken blocks on the shop, and one file is at most 1,580 chars.
   - Alternatives: line markers only (miss 4 of 12 blocks).
   - Evidence: section 3.
   - Revert: remove the tool or option.
