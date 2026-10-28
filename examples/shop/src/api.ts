export interface Product {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
}

export interface CartLine {
  productId: string;
  qty: number;
}

export interface OrderResult {
  orderId: number;
  totalCents: number;
  shippingCents: number;
  discountCents: number;
}

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch('/api/products');
  return res.json();
}

export async function placeOrder(lines: CartLine[], coupon?: string): Promise<OrderResult> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines, coupon }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Order failed (${res.status})`);
  }
  return body;
}
