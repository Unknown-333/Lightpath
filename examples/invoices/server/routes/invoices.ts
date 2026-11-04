import type { Request, Response } from 'express';
import { invoices } from '../data.ts';
import { getSummary, LedgerError, markPaid } from '../services/ledger.ts';

export function listInvoices(_req: Request, res: Response) {
  res.json({ invoices, summary: getSummary() });
}

export function payInvoice(req: Request<{ id: string }>, res: Response) {
  try {
    const invoice = markPaid(req.params.id);
    res.json({ invoice, summary: getSummary() });
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
