# Baseline, condition `without`, 2026-11-01

The agent without Lightpath fixed **21 of 21** trials: 7 visible bugs, 3 runs each. Mean 5.00 steps, 0.317 credits and 16.7 s per run. No run was void. On this suite the baseline is at the ceiling, so Lightpath can't beat it on correct-fix rate here; only steps, credits or time are left to compare.

- Setup: kiro-cli 2.37.0 (V3 engine), model `claude-sonnet-5.5`, effort `medium`, 15-minute limit, rules from `SCORING.md`. Every JSON line records the kiro-cli version, model ID, engine and effort.
- Suite: the lines say `suiteCommit` 94ded33 (the `agent-loop` merge of PR #19). `git diff 1b20813 94ded33 -- bench/agent-suite` is empty, so this is the suite exactly as committed in 1b20813.
- Data: `2026-11-01-baseline-without.jsonl`, one line per trial. Transcripts, tool calls, diffs and check logs stay outside the repo; each line has its `transcript` path.
- Ran 04:30 to 04:48 UTC, one trial at a time, shop ports 3001 and 5173.

## Per bug

| Bug | Correct | Steps mean (min-max) | Steps SD | Credits mean (min-max) | Credits SD | Wall time mean (min-max) |
| --- | --- | --- | --- | --- | --- | --- |
| b01 | 3 of 3 | 3.67 (3-5) | 1.15 | 0.285 (0.245-0.357) | 0.062 | 15.5 s (13.4-17.9) |
| b02 | 3 of 3 | 5.33 (5-6) | 0.58 | 0.309 (0.302-0.320) | 0.010 | 16.4 s (16.3-16.6) |
| b03 | 3 of 3 | 9.33 (9-10) | 0.58 | 0.518 (0.494-0.564) | 0.040 | 22.1 s (21.6-22.5) |
| b04 | 3 of 3 | 3.67 (3-4) | 0.58 | 0.260 (0.250-0.272) | 0.011 | 13.7 s (12.7-15.0) |
| b05 | 3 of 3 | 6.00 (6-6) | 0.00 | 0.355 (0.351-0.360) | 0.005 | 19.3 s (17.3-21.4) |
| b06 | 3 of 3 | 3.33 (3-4) | 0.58 | 0.237 (0.213-0.278) | 0.036 | 15.5 s (14.2-17.4) |
| b07 | 3 of 3 | 3.67 (3-4) | 0.58 | 0.258 (0.248-0.270) | 0.011 | 14.5 s (13.7-15.5) |

## Totals

| | |
| --- | --- |
| Correct | 21 of 21 |
| Void | 0 (no reruns) |
| Steps | 105 in total; mean 5.00, min 3, max 10, SD 2.12 |
| Credits | 6.666 in total; mean 0.317, min 0.213, max 0.564, SD 0.095 |
| Wall time | 351.1 s in total; mean 16.7 s, min 12.7 s, max 22.5 s |
| Blocked tool calls, flagged shell commands, outside reads | 0, 0, 0 |

No trial passed 1 credit. Test-run credits before this batch: 3.343. After it: **10.009** of the 25-credit cap.

## Credits per run and running total

| # | Trial | Correct | Steps | Credits | Running total | Wall | CPU start / end | Busy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | b01-without-1 | yes | 5 | 0.357 | 3.700 | 17.9 s | 15.8% / 26.9% | no |
| 2 | b02-without-1 | yes | 6 | 0.320 | 4.020 | 16.4 s | 17.9% / 9.9% | no |
| 3 | b03-without-1 | yes | 9 | 0.494 | 4.514 | 21.6 s | 8.6% / 10.2% | no |
| 4 | b04-without-1 | yes | 3 | 0.250 | 4.765 | 13.5 s | 9.7% / 14.1% | no |
| 5 | b05-without-1 | yes | 6 | 0.360 | 5.125 | 21.4 s | 8.2% / 15.8% | no |
| 6 | b06-without-1 | yes | 3 | 0.220 | 5.345 | 14.2 s | 25.2 -> 11.8% / 7.2% | no |
| 7 | b07-without-1 | yes | 3 | 0.257 | 5.602 | 13.7 s | 31.5 -> 23.5% / 23.8% | yes |
| 8 | b01-without-2 | yes | 3 | 0.253 | 5.855 | 13.4 s | 22.3 -> 8.2% / 12.1% | no |
| 9 | b02-without-2 | yes | 5 | 0.305 | 6.160 | 16.6 s | 20.1 -> 30.4% / 24.9% | yes |
| 10 | b03-without-2 | yes | 9 | 0.495 | 6.656 | 22.5 s | 19.4% / 35.3% | no |
| 11 | b04-without-2 | yes | 4 | 0.257 | 6.913 | 12.7 s | 13.1% / 12.6% | no |
| 12 | b05-without-2 | yes | 6 | 0.351 | 7.264 | 17.3 s | 8.9% / 12.5% | no |
| 13 | b06-without-2 | yes | 3 | 0.213 | 7.477 | 14.8 s | 16.1% / 8.7% | no |
| 14 | b07-without-2 | yes | 4 | 0.248 | 7.725 | 15.5 s | 11.6% / 20.1% | no |
| 15 | b01-without-3 | yes | 3 | 0.245 | 7.970 | 15.2 s | 12.3% / 8.2% | no |
| 16 | b02-without-3 | yes | 5 | 0.302 | 8.272 | 16.3 s | 5.5% / 5.7% | no |
| 17 | b03-without-3 | yes | 10 | 0.564 | 8.836 | 22.2 s | 5.4% / 14.1% | no |
| 18 | b04-without-3 | yes | 4 | 0.272 | 9.108 | 15.0 s | 11.1% / 3.9% | no |
| 19 | b05-without-3 | yes | 6 | 0.353 | 9.461 | 19.2 s | 9.3% / 15.8% | no |
| 20 | b06-without-3 | yes | 4 | 0.278 | 9.738 | 17.4 s | 11.3% / 6.9% | no |
| 21 | b07-without-3 | yes | 4 | 0.270 | 10.009 | 14.2 s | 6.5% / 8.1% | no |

"A -> B" means the load was over 20% at the start, the harness waited 60 s and read B. Busy = still over 20% after the wait; trials 7 and 9 started in busy periods. Other workers were running at the same time.

## What the agent did (from the transcripts)

No agent started the shop, opened the page or ran the check's steps. Every fix came from text search and reading files.

- b01: searched for `WELCOME10` (runs 2 and 3: `WELCOME10|coupon`), read `quote.ts` (run 1 also read `pricing.ts` and searched for `quoteOrder|priceCart`), and changed `/ 1000` to `/ 100` in `quote.ts`. The dead `pricing.ts` didn't mislead it.
- b02: searched for the error text "cart is empty", read `orders.ts`, `Cart.tsx` and `api.ts`, and sent `lines` instead of `items` in `api.ts`.
- b03: listed folders, searched for "checkout", read `Cart.tsx`, `api.ts` and `orders.ts`, made `placeOrder()` throw again in `api.ts` and removed the early return in `Cart.tsx`.
- b04: searched for "cart"/"subtotal", read `App.tsx` (runs 2 and 3 also `Cart.tsx`), and made `addToCart()` return a new array.
- b05: searched for "checkout", read `Cart.tsx`, and made the form's submit call `preventDefault()` (run 1 then ran `tsc`; runs 2 and 3 read `api.ts`).
- b06: searched for "out of stock", read `orders.ts`, and changed `<=` to `<`.
- b07: searched for "subtotal" and for the product `id` field, and changed the lookup in `Cart.tsx` from `name` to `id`.

## Notes

- The predictions in each `notes.md` were yes for b01, b02 and b03. The baseline fixed all three in every run, in 3 to 10 steps. Each report quotes an error message or a visible label, and text search finds the file from it.
- The smoke run from the suite PR (b02, run 1, 0.344 credits) isn't part of this baseline. Its trial and run folders were renamed to `smoke-b02-without-1` before this batch, because `run.mjs` won't reuse an existing trial folder. So the transcript path in that smoke result is out of date.
