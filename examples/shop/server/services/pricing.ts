import { findProduct } from '../db.ts';

export interface Quote {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
}

const FREE_SHIPPING_CENTS = 5000;

export function priceCart(lines: { productId: string; qty: number }[], coupon?: string): Quote {
  let subtotalCents = 0;
  for (const line of lines) {
    const product = findProduct(line.productId);
    if (product) {
      subtotalCents += product.priceCents * line.qty;
    }
  }

  let discountCents = 0;
  if (coupon === 'WELCOME10') {
    discountCents = Math.round(subtotalCents * 0.1);
  }

  const shippingCents = subtotalCents - discountCents >= FREE_SHIPPING_CENTS ? 0 : 499;
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
  };
}
