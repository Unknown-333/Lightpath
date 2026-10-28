export interface Product {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
}

export interface Order {
  id: number;
  lines: { productId: string; qty: number }[];
  totalCents: number;
  paymentId: string;
}

const products: Product[] = [
  { id: 'lamp', name: 'Desk lamp', priceCents: 3900, stock: 5 },
  { id: 'mug', name: 'Coffee mug', priceCents: 1200, stock: 20 },
  { id: 'plant', name: 'Small plant', priceCents: 1800, stock: 0 },
];
const orders: Order[] = [];

export function allProducts(): Product[] {
  return products;
}

export function findProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function saveOrder(order: Omit<Order, 'id'>): Order {
  const saved = { ...order, id: orders.length + 1 };
  orders.push(saved);
  for (const line of order.lines) {
    const product = findProduct(line.productId);
    if (product) product.stock -= line.qty;
  }
  return saved;
}
