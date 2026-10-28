import { useEffect, useState } from 'react';
import { type CartLine, fetchProducts, type Product } from './api.ts';
import { Cart } from './Cart.tsx';
import { formatCents } from './money.ts';

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);

  useEffect(() => {
    fetchProducts().then(setProducts);
  }, []);

  function addToCart(product: Product) {
    setCart((lines) => {
      const existing = lines.find((l) => l.productId === product.id);
      if (existing) {
        return lines.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...lines, { productId: product.id, qty: 1 }];
    });
  }

  return (
    <main>
      <h1>Lightpath demo shop</h1>
      <p>Click anything, then look at your editor.</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {products.map((p) => (
          <li key={p.id}>
            <span>
              {p.name} · {formatCents(p.priceCents)}
            </span>
            <button type="button" disabled={p.stock === 0} onClick={() => addToCart(p)}>
              {p.stock === 0 ? 'Sold out' : 'Add to cart'}
            </button>
          </li>
        ))}
      </ul>
      <Cart lines={cart} products={products} onCheckedOut={() => setCart([])} />
    </main>
  );
}
