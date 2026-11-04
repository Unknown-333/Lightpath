# b04: Adding the same item again does not update the cart

- Category: React state (mutating state in place)
- Layer: Frontend only
- Set: visible

## What bug.patch does

`addToCart()` in `App.tsx` changes the existing line's `qty` in place and returns the same array, so React sees no change and skips the render. Under StrictMode the updater also runs twice, so the hidden count grows by 2 per click.

## Prediction, written before any run: does knowing what code ran help?

No. The code that runs is the same with or without the bug, and every line of `addToCart()` runs. The problem is that the state object is mutated, which a trace of which lines ran does not show. Reading the function is enough.

## Hidden check (check.mjs)

Browser: lamp twice gives "Subtotal: $78.00", three times "$117.00", plus a mug "$129.00".
