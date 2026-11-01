# b01: The WELCOME10 coupon barely changes the price

- Category: Duplicate or dead function: the obvious one is not the one that runs
- Layer: Backend only
- Set: visible

## What bug.patch does

Adds `server/services/quote.ts` with `quoteOrder()`, a rewrite of `priceCart()` with a coupon table, and switches `routes/orders.ts` to it. The rewrite divides the percent by 1000 instead of 100. The old `services/pricing.ts` stays in place, still exports a correct `priceCart()`, and still exports the `Quote` type that `quote.ts` imports, so it looks live.

Why the extra code is realistic: half-finished refactors that leave the old function next to the new one are common. An agent that searches for "coupon" or opens the file named "pricing" finds code that is correct.

## Prediction, written before any run: does knowing what code ran help?

Yes. Reading `pricing.ts` shows correct code. Knowing that `quoteOrder()` ran on Checkout, and `priceCart()` did not, points straight at the real line.

## Hidden check (check.mjs)

API: 1 lamp + WELCOME10 gives discount 390 and total 4009; 2 lamps + 1 mug + WELCOME10 gives 900 and 8100; 1 mug without a coupon gives 0 and 1699.
