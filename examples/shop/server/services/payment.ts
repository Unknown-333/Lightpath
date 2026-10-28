export type PaymentResult = { ok: true; id: string } | { ok: false; reason: string };

let nextPayment = 1000;

/** Fake card processor. Totals above $500 are declined, so the demo has a failure path. */
export function charge(totalCents: number): PaymentResult {
  if (totalCents > 50_000) {
    return { ok: false, reason: 'Card declined: amount over the demo limit.' };
  }
  nextPayment += 1;
  return { ok: true, id: `pay_${nextPayment}` };
}
