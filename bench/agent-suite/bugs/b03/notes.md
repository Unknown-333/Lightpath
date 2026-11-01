# b03: Checkout does nothing when an order fails

- Category: Swallowed error
- Layer: Frontend (src/api.ts and Cart), triggered by a backend 409
- Set: visible

## What bug.patch does

`placeOrder()` no longer throws on an error response; it logs a warning and returns an empty order with `orderId: 0`. `Cart.tsx` returns early when `orderId` is 0. "Return an empty value instead of throwing, so the UI doesn't crash" is a real pattern that hides errors.

## Prediction, written before any run: does knowing what code ran help?

Yes. The trace shows the 409 response with its message, then the early return in the Cart, which is where the message is lost.

## Hidden check (check.mjs)

Browser: 6 lamps then Checkout shows a message containing "out of stock"; on a fresh page, 1 lamp then Checkout still shows "Order #N placed".
