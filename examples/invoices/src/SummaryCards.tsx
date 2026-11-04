import type { Summary } from './api.ts';
import { money } from './format.ts';

export function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <section className="cards" aria-label="Totals">
      <article className="card">
        <h2>Outstanding</h2>
        <p className="figure" data-testid="outstanding">
          {money(summary.outstandingCents)}
        </p>
        <p className="hint">
          {summary.openCount} open {summary.openCount === 1 ? 'invoice' : 'invoices'}
        </p>
      </article>
      <article className="card">
        <h2>Overdue</h2>
        <p className="figure overdue">{money(summary.overdueCents)}</p>
        <p className="hint">Past the due date</p>
      </article>
      <article className="card">
        <h2>Paid</h2>
        <p className="figure paid">{money(summary.paidCents)}</p>
        <p className="hint">Last 30 days</p>
      </article>
    </section>
  );
}
