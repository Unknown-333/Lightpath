import type { Invoice } from './api.ts';
import { initials, money, shortDate } from './format.ts';

const STATUS_LABEL = { draft: 'Draft', open: 'Open', overdue: 'Overdue', paid: 'Paid' } as const;
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#6366f1';
}

type Props = {
  invoices: Invoice[];
  busyId: string | null;
  onPay: (id: string) => void;
};

export function InvoiceTable({ invoices, busyId, onPay }: Props) {
  return (
    <table className="invoices">
      <thead>
        <tr>
          <th>Client</th>
          <th>Invoice</th>
          <th>Due</th>
          <th className="num">Amount</th>
          <th>Status</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {invoices.map((inv) => (
          <tr key={inv.id}>
            <td>
              <div className="client">
                <span className="avatar" style={{ background: avatarColor(inv.client) }} aria-hidden>
                  {initials(inv.client)}
                </span>
                <span>
                  <span className="client-name">{inv.client}</span>
                  <span className="client-contact">{inv.contact}</span>
                </span>
              </div>
            </td>
            <td className="mono">{inv.id}</td>
            <td className={inv.status === 'overdue' ? 'late' : undefined}>{shortDate(inv.due)}</td>
            <td className="num">{money(inv.amountCents)}</td>
            <td>
              <span className={`pill ${inv.status}`}>{STATUS_LABEL[inv.status]}</span>
            </td>
            <td className="actions">
              {inv.status === 'open' || inv.status === 'overdue' ? (
                <button type="button" disabled={busyId === inv.id} onClick={() => onPay(inv.id)}>
                  Mark as paid
                </button>
              ) : inv.paidAt ? (
                <span className="muted">Paid {shortDate(inv.paidAt)}</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
