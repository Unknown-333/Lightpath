import { findInvoice, type Invoice, invoices } from '../data.ts';

export type Summary = {
  outstandingCents: number;
  overdueCents: number;
  paidCents: number;
  openCount: number;
};

// Summing every invoice on each page view is wasteful on a big ledger, so the totals are kept
// until something changes them.
let summaryCache: Summary | null = null;

export function getSummary(): Summary {
  if (summaryCache) return summaryCache;
  const summary: Summary = { outstandingCents: 0, overdueCents: 0, paidCents: 0, openCount: 0 };
  for (const inv of invoices) {
    if (inv.status === 'paid') {
      summary.paidCents += inv.amountCents;
    } else if (inv.status === 'open' || inv.status === 'overdue') {
      summary.outstandingCents += inv.amountCents;
      summary.openCount += 1;
      if (inv.status === 'overdue') summary.overdueCents += inv.amountCents;
    }
  }
  summaryCache = summary;
  return summary;
}

export class LedgerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function markPaid(id: string, today = new Date()): Invoice {
  const invoice = findInvoice(id);
  if (!invoice) throw new LedgerError(404, `No invoice ${id}.`);
  if (invoice.status === 'paid') throw new LedgerError(409, `${id} is already paid.`);
  if (invoice.status === 'draft') throw new LedgerError(409, `${id} is a draft. Send it first.`);
  invoice.status = 'paid';
  invoice.paidAt = today.toISOString().slice(0, 10);
  summaryCache = null; // the totals changed
  return invoice;
}
