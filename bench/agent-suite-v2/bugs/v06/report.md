# Paying an invoice from the Open tab hides other invoices

On the Invoices page I click the Open tab and mark an invoice as paid. When I go back to All, only some invoices are listed: the paid, overdue and draft ones are missing until I reload.

To see it: open the app, click Open, click "Mark as paid" on INV-2042, then click All.

The app runs with `node dev.mjs` (API on port 3612, web on http://localhost:5612).
