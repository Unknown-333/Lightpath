// Plain JavaScript, run by Node as-is. V8's offsets match this file exactly.
const RATES = { standard: 500, express: 1500 };

export function shippingCents(method, subtotalCents) {
  if (subtotalCents >= 5000) {
    return 0;
  }
  const rate = RATES[method];
  if (rate === undefined) throw new Error(`unknown method ${method}`);
  return rate;
}

export class Cart {
  #lines = [];

  add(sku, qty = 1) {
    const existing = this.#lines.find((l) => l.sku === sku);
    if (existing) existing.qty += qty;
    else this.#lines.push({ sku, qty });
    return this;
  }

  total(prices) {
    let sum = 0;
    for (const line of this.#lines) {
      sum += prices[line.sku] * line.qty;
    }
    return sum;
  }

  clear() {
    this.#lines = [];
  }
}

export async function run() {
  const cart = new Cart().add('mug').add('tea', 2).add('mug');
  const subtotal = cart.total({ mug: 1200, tea: 800 });
  const shipping = shippingCents('standard', subtotal);
  try {
    shippingCents('drone', 0);
  } catch {
    // Expected: drone delivery doesn't exist.
  }
  await Promise.resolve();
  return subtotal + shipping;
}
