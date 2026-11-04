// v05 hidden check: after ticking "One item per line" in the settings, two lines typed in the
// Inbox's capture box (same page load, no reload) become two inbox items.
export default async function check(kit) {
  const page = await kit.page();
  await page.goto(`${kit.webUrl}/profile`);
  await page.getByText('Shortcuts', { exact: true }).click();
  const box = page.locator('label', { hasText: 'One item per line' }).locator('input[type=checkbox]');
  await box.waitFor();
  kit.expect(!(await box.isChecked()), '"One item per line" was already on');
  await box.click();
  await kit.sleep(300);
  await page.getByTestId('sidebar-nav-inbox').click();
  await page.waitForURL(/\/inbox/);
  await page.getByTestId('quick-capture-input').fill('Buy milk\nBuy bread');
  await page.getByTestId('capture-add').click();
  let items = [];
  for (let i = 0; i < 20; i++) {
    await kit.sleep(250);
    items = (await kit.api('GET', '/api/inbox?limit=50')).body?.items ?? [];
    if (items.length >= 2) break;
  }
  await kit.sleep(500);
  items = (await kit.api('GET', '/api/inbox?limit=50')).body?.items ?? [];
  const contents = items.map((i) => String(i.content ?? '').trim());
  kit.expect(
    contents.length === 2 && contents.includes('Buy milk') && contents.includes('Buy bread'),
    `with "One item per line" on, two lines made ${contents.length} item(s): ${JSON.stringify(contents)}`,
  );
  return `items ${JSON.stringify(contents)}`;
}
