// Made-up clients and invoices, kept in memory. A restart puts them back as they were.
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

const seed: Invoice[] = [
  {
    id: 'INV-2041',
    client: 'Kestrel Labs',
    contact: 'ana@kestrel.dev',
    issued: '2026-10-02',
    due: '2026-11-01',
    amountCents: 1_240_000,
    status: 'overdue',
  },
  {
    id: 'INV-2042',
    client: 'Oakline Coffee',
    contact: 'billing@oakline.co',
    issued: '2026-10-06',
    due: '2026-11-05',
    amountCents: 386_050,
    status: 'open',
  },
  {
    id: 'INV-2043',
    client: 'Mira Health',
    contact: 'finance@mirahealth.io',
    issued: '2026-10-09',
    due: '2026-11-08',
    amountCents: 2_150_000,
    status: 'open',
  },
  {
    id: 'INV-2044',
    client: 'Atlas Freight',
    contact: 'ap@atlasfreight.com',
    issued: '2026-10-12',
    due: '2026-11-11',
    amountCents: 918_075,
    status: 'paid',
    paidAt: '2026-10-28',
  },
  {
    id: 'INV-2045',
    client: 'Sundial Media',
    contact: 'hello@sundial.media',
    issued: '2026-10-15',
    due: '2026-11-14',
    amountCents: 472_500,
    status: 'open',
  },
  {
    id: 'INV-2046',
    client: 'Pinecrest Legal',
    contact: 'accounts@pinecrest.law',
    issued: '2026-10-20',
    due: '2026-11-19',
    amountCents: 1_675_000,
    status: 'paid',
    paidAt: '2026-10-30',
  },
  {
    id: 'INV-2047',
    client: 'Fernway Apparel',
    contact: 'ops@fernway.shop',
    issued: '2026-10-27',
    due: '2026-11-26',
    amountCents: 264_900,
    status: 'draft',
  },
];

export const invoices: Invoice[] = seed.map((inv) => ({ ...inv }));

export function findInvoice(id: string): Invoice | undefined {
  return invoices.find((inv) => inv.id === id);
}
