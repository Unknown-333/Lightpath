import { useState } from 'react';
import { type CartLine, type Product, placeOrder } from './api.ts';
import { formatCents } from './money.ts';

interface CartProps {
  lines: CartLine[];
  products: Product[];
  onCheckedOut: () => void;
}

export function Cart({ lines, products, onCheckedOut }: CartProps) {
  const [coupon, setCoupon] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const subtotal = lines.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    return sum + (product ? product.priceCents * line.qty : 0);
  }, 0);

  async function checkout() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await placeOrder(lines, coupon || undefined);
      setStatus({ kind: 'ok', text: `Order #${result.orderId} placed: ${formatCents(result.totalCents)}` });
      onCheckedOut();
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Cart</h2>
      {lines.length === 0 ? <p>Your cart is empty.</p> : <p>Subtotal: {formatCents(subtotal)}</p>}
      <input
        placeholder="Coupon (try WELCOME10)"
        value={coupon}
        onChange={(e) => setCoupon(e.target.value)}
      />{' '}
      <button type="button" className="primary" disabled={busy} onClick={checkout}>
        Checkout
      </button>
      {status && <p className={`notice ${status.kind === 'error' ? 'error' : ''}`}>{status.text}</p>}
    </section>
  );
}
