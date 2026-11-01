# Call-order and function-summary prototypes

Scripts behind [`docs/research/call-order.md`](../../../docs/research/call-order.md). They run the example shop under the real pipeline (daemon, Node agent, `BrowserCollector`) and change nothing in `packages/`.

| Script            | What it does                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order-blind.mjs` | Calls three functions in two orders between coverage reads and checks whether the reads differ.                                                                                                                               |
| `make-gt.mjs`     | Writes `examples/.bench-app/shop-gt` (gitignored): the shop with a log call on the first line of each of its 25 functions, so line numbers match `examples/shop`. Also adds `GET /__lp` to the API to hand the Node log back. |
| `harness.mjs`     | Starts daemon, shop and headless Chromium, clicks "Add to cart" then "Checkout" 1 + N times, and saves each Checkout trace with its raw coverage deltas and the condition's extra signal to `runs-<condition>.jsonl`.         |
| `run.ps1`         | Runs one harness condition with the CPU load check (wait 60 s while load is over 20%, log load at start and end).                                                                                                             |
| `analyze.mjs`     | Builds the function summary, `describeTrace` text and executed-code slices, scores each order technique against the ground truth, and prints every number as one line.                                                        |

Conditions: `P` plain shop, `G0` ground-truth copy, `A` two more coverage reads (request sent, response arrived), `B` Network initiator stacks, `C` sampling CPU profiler at 100 µs (page and Node), `E` a CDP breakpoint at every app function in the page.

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
pnpm build
# The study used API port 3201 and Vite port 5373 (edit examples/shop locally; not committed).
foreach ($c in 'P','G0','A','B','C','E') { powershell -File bench/prototypes/call-order/run.ps1 -Condition $c -Runs 20 -Out <raw dir> }
node bench/prototypes/call-order/analyze.mjs --raw <raw dir>
```
