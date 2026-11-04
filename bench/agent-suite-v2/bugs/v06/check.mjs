// v06 hidden check: on the Open tab, mark one invoice as paid, then go back to All: all 7
// invoices are still listed, and the one just paid shows as Paid.
export default async function check(kit) {
  const page = await kit.page();
  const rows = page.locator('table.invoices tbody tr');
  await rows.first().waitFor();
  const all = await rows.count();
  kit.expect(all === 7, `the All tab lists ${all} invoices before anything is done, expected 7`);
  await page.getByRole('tab', { name: 'Open', exact: true }).click();
  const row = rows.filter({ hasText: 'INV-2042' });
  await row.getByRole('button', { name: 'Mark as paid' }).click();
  await page.getByRole('status').filter({ hasText: 'INV-2042 marked as paid' }).waitFor();
  await page.getByRole('tab', { name: 'All', exact: true }).click();
  await kit.sleep(300);
  const after = await rows.count();
  const ids = await page.locator('table.invoices tbody td.mono').allInnerTexts();
  kit.expect(
    after === 7,
    `after paying on the Open tab, the All tab lists ${after} invoices (${ids.join(', ')}), expected 7`,
  );
  const paid = await rows.filter({ hasText: 'INV-2042' }).locator('.pill').innerText();
  kit.expect(paid.trim() === 'Paid', `INV-2042 shows as ${paid} after it was paid`);
  return `All lists ${after}; INV-2042 ${paid}`;
}
