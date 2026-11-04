// v02 hidden check: in a new custom report (data table, demo budget), uncheck "Food" and turn on
// "Show empty rows": Food is not listed, and an empty checked category (Savings) is.
export default async function check(kit) {
  const page = await kit.demoPage();
  await page.getByText('Reports', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Add new widget' }).click();
  await page
    .getByText(/new custom report/i)
    .last()
    .click();
  await page.waitForURL(/reports\/custom/);
  await page.getByRole('button', { name: 'Data Table' }).click();
  await page.getByText('Totals', { exact: true }).first().waitFor();
  const box = page
    .locator('label', { hasText: /^Food$/ })
    .locator('xpath=..')
    .locator('input[type=checkbox]');
  await box.first().uncheck();
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByText('Show empty rows', { exact: true }).click();
  await page.keyboard.press('Escape');
  await kit.sleep(2500);
  const body = await page.locator('body').innerText();
  const table = body.slice(body.lastIndexOf('Unsaved report'));
  const rows = table.split('\n').map((l) => l.trim());
  kit.expect(
    rows.includes('Savings'),
    `with "Show empty rows" on, the empty category Savings is not listed: ${JSON.stringify(rows.slice(0, 30))}`,
  );
  kit.expect(!rows.includes('Food'), 'the unchecked category Food is still listed in the report');
  return 'Food hidden, Savings shown';
}
