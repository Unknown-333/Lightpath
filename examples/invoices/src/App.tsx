import { useEffect, useState } from 'react';
import { fetchInvoices, type Invoice, payInvoice, type Status, type Summary } from './api.ts';
import { InvoiceTable } from './InvoiceTable.tsx';
import { SummaryCards } from './SummaryCards.tsx';

const FILTERS: { label: string; status: Status | null }[] = [
  { label: 'All', status: null },
  { label: 'Open', status: 'open' },
  { label: 'Overdue', status: 'overdue' },
  { label: 'Paid', status: 'paid' },
  { label: 'Draft', status: 'draft' },
];

export function App() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<Status | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    fetchInvoices().then(
      (data) => {
        setInvoices(data.invoices);
        setSummary(data.summary);
      },
      (err: Error) => setToast({ text: err.message, error: true }),
    );
  }, []);

  async function pay(id: string) {
    setBusyId(id);
    try {
      const { invoice, summary } = await payInvoice(id);
      setInvoices((list) => list.map((inv) => (inv.id === invoice.id ? invoice : inv)));
      setSummary(summary);
      setToast({ text: `${invoice.id} marked as paid` });
    } catch (err) {
      setToast({ text: (err as Error).message, error: true });
    } finally {
      setBusyId(null);
    }
  }

  const shown = filter ? invoices.filter((inv) => inv.status === filter) : invoices;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden>
            H
          </span>
          Harbor
        </div>
        <nav>
          <span className="nav-item">Overview</span>
          <span className="nav-item active">Invoices</span>
          <span className="nav-item">Clients</span>
          <span className="nav-item">Reports</span>
        </nav>
        <div className="workspace">
          <span className="avatar small">JL</span>
          <span>
            <span className="client-name">Jo Lindqvist</span>
            <span className="client-contact">Studio North</span>
          </span>
        </div>
      </aside>
      <main>
        <header className="page-head">
          <div>
            <h1>Invoices</h1>
            <p className="sub">November 2026</p>
          </div>
        </header>
        {summary && <SummaryCards summary={summary} />}
        <section className="panel">
          <div className="tabs" role="tablist" aria-label="Filter invoices">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                role="tab"
                aria-selected={filter === f.status}
                className={filter === f.status ? 'tab active' : 'tab'}
                onClick={() => setFilter(f.status)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <InvoiceTable invoices={shown} busyId={busyId} onPay={pay} />
        </section>
        {toast && (
          <div className={toast.error ? 'toast error' : 'toast'} role="status">
            {toast.text}
          </div>
        )}
      </main>
    </div>
  );
}
