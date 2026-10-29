// TypeScript run with Node's type stripping. Types become spaces, so no offset moves.
interface Line {
  sku: string;
  qty: number;
}

type Prices = Record<string, number>;

export function priceLines(lines: readonly Line[], prices: Prices): number {
  let total = 0;
  for (const line of lines) {
    const price: number | undefined = prices[line.sku];
    if (price === undefined) {
      continue;
    }
    total += price * line.qty;
  }
  return total;
}

export function applyCoupon(totalCents: number, code?: string): number {
  if (!code) return totalCents;
  const percent = code === 'WELCOME10' ? 10 : 0;
  return Math.round(totalCents * (1 - percent / 100));
}

export async function run(): Promise<number> {
  const lines: Line[] = [
    { sku: 'mug', qty: 2 },
    { sku: 'gone', qty: 1 },
    { sku: 'tea', qty: 3 },
  ];
  const total = priceLines(lines, { mug: 1200, tea: 800 } satisfies Prices);
  return applyCoupon(total, 'WELCOME10');
}
