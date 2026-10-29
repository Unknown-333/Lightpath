// Plain checkout logic shared by the Fastify and NestJS apps, so Lightpath's backend test can check
// that both frameworks light the same lines here.
export interface OrderLine {
  sku: string;
  qty: number;
}

export interface Quote {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export type CheckoutResult = { ok: true; quote: Quote } | { ok: false; status: number; error: string };

const PRICES: Record<string, number> = { lamp: 3900, mug: 1200 };

export function checkout(lines: readonly OrderLine[] | undefined, coupon?: string): CheckoutResult {
  if (!lines || lines.length === 0) {
    return { ok: false, status: 400, error: 'Your cart is empty.' };
  }
  let subtotalCents = 0;
  for (const line of lines) {
    const price = PRICES[line.sku];
    if (price === undefined) {
      return { ok: false, status: 404, error: `Unknown product ${line.sku}` };
    }
    subtotalCents += price * line.qty;
  }
  const discountCents = coupon === 'WELCOME10' ? Math.round(subtotalCents / 10) : 0;
  return { ok: true, quote: { subtotalCents, discountCents, totalCents: subtotalCents - discountCents } };
}
