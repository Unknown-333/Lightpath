# v06: paying an invoice from the Open tab hides other invoices

- **Seeded.** List slot S5, `examples/invoices`. Kind: **interaction order.** After a payment the list is rebuilt from the rows on screen instead of the full list, so paying from a filtered tab drops every invoice the tab hid. Paying from All works. One line in `src/App.tsx`.
- Check (browser): Open tab, mark INV-2042 paid, All tab; requires 7 invoices with INV-2042 Paid.
- fix.patch: update the full list. fix2.patch: reload the list from the API after a payment.
