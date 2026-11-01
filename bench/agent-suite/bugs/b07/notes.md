# b07: Cart subtotal always shows $0.00

- Category: Wrong field lookup
- Layer: Frontend only
- Set: visible

## What bug.patch does

The subtotal in `Cart.tsx` looks products up by `name` instead of `id`, finds none, and adds 0 for each line.

## Prediction, written before any run: does knowing what code ran help?

No. "Subtotal" appears in one component and the lookup is two lines above it. A trace adds nothing a quick read doesn't.

## Hidden check (check.mjs)

Browser: lamp + mug gives "Subtotal: $51.00"; another lamp gives "$90.00".
