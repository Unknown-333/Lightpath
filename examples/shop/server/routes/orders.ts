import type { Request, Response } from 'express';
import { findProduct, saveOrder } from '../db.ts';
import { charge } from '../services/payment.ts';
import { priceCart } from '../services/pricing.ts';

interface OrderBody {
  lines?: { productId: string; qty: number }[];
  coupon?: string;
}

export function createOrder(req: Request, res: Response): void {
  const body = req.body as OrderBody;
  const lines = body.lines ?? [];
  if (lines.length === 0) {
    res.status(400).json({ error: 'Your cart is empty.' });
    return;
  }

  for (const line of lines) {
    const product = findProduct(line.productId);
    if (!product) {
      res.status(404).json({ error: `Unknown product ${line.productId}` });
      return;
    }
    if (product.stock < line.qty) {
      res.status(409).json({ error: `${product.name} is out of stock.` });
      return;
    }
  }

  const quote = priceCart(lines, body.coupon);
  const payment = charge(quote.totalCents);
  if (!payment.ok) {
    res.status(402).json({ error: payment.reason });
    return;
  }

  const order = saveOrder({ lines, totalCents: quote.totalCents, paymentId: payment.id });
  res.status(201).json({ orderId: order.id, ...quote });
}
