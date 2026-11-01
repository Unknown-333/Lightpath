# b02: Checkout says my cart is empty when it is not

- Category: Wrong field between src/api.ts and the server
- Layer: Across the boundary (frontend request, backend validation)
- Set: visible

## What bug.patch does

`placeOrder()` in `src/api.ts` sends the cart lines as `items`; the server reads `lines`, finds none and answers 400 "Your cart is empty.". A field rename on one side only is a common mistake.

## Prediction, written before any run: does knowing what code ran help?

Yes. The message suggests a frontend cart problem, but the code that ran is the server's empty-cart branch, and the request body shows `items`. Either fix (send `lines`, or accept `items`) passes.

## Hidden check (check.mjs)

Browser: add a lamp, press Checkout, "Order #N placed" appears. API: an empty order is still refused with 400.
