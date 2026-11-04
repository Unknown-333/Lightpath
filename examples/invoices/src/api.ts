export type Status = 'draft' | 'open' | 'overdue' | 'paid';

export type Invoice = {
  id: string;
  client: string;
  contact: string;
  issued: string;
  due: string;
  amountCents: number;
  status: Status;
  paidAt?: string;
};

export type Summary = {
  outstandingCents: number;
  overdueCents: number;
  paidCents: number;
  openCount: number;
};

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function fetchInvoices(): Promise<{ invoices: Invoice[]; summary: Summary }> {
  return readJson(await fetch('/api/invoices'));
}

export async function payInvoice(id: string): Promise<{ invoice: Invoice; summary: Summary }> {
  return readJson(await fetch(`/api/invoices/${encodeURIComponent(id)}/pay`, { method: 'POST' }));
}
