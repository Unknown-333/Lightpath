# b06: Can't buy the last items in stock

- Category: Wrong branch or condition (off by one)
- Layer: Backend only
- Set: visible

## What bug.patch does

The stock check in `routes/orders.ts` uses `<=` instead of `<`.

## Prediction, written before any run: does knowing what code ran help?

No. The error text "is out of stock" appears in exactly one place, and the wrong comparison is on the line above it. A text search finds it as fast as a trace.

## Hidden check (check.mjs)

API: 21 mugs gives 409; all 20 mugs gives 201; all 5 lamps gives 201; one more lamp gives 409.
