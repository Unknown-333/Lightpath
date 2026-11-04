# b05: Checkout reloads the page and empties the cart

- Category: Event wiring
- Layer: Frontend only
- Set: visible

## What bug.patch does

The coupon box and the Checkout button are wrapped in a `<form onSubmit={checkout}>` (so Enter in the coupon box checks out), the button becomes `type="submit"`, and `checkout()` never calls `preventDefault()`. The browser submits the form and reloads the page.

## Prediction, written before any run: does knowing what code ran help?

Unsure. The trace shows `checkout()` ran and the request started, then a page load. That can point at the form submit, but the reload may also cut the trace short.

## Hidden check (check.mjs)

Browser: add a lamp, press Checkout, "Order #N placed" appears.
