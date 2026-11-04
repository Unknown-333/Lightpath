// v08 hidden check: clearing an inbox item's text and pressing Enter must not be reported as
// saved: no "Item updated" message, and the item keeps its text.
export default async function check(kit) {
  const item = await kit.api('POST', '/api/inbox', { content: 'Renew the car insurance' });
  kit.expect(item.status === 201, `could not create the inbox item: HTTP ${item.status}`);
  const page = await kit.page();
  await page.goto(`${kit.webUrl}/inbox`);
  await page.getByTestId('quick-capture-input').first().waitFor();
  await kit.sleep(1000);
  const entry = page.getByText('Renew the car insurance').first();
  if (!(await entry.isVisible()))
    await page
      .getByText(/recently captured/i)
      .first()
      .click();
  await entry.click();
  await kit.sleep(800);
  const boxes = page.getByTestId('quick-capture-input');
  kit.expect((await boxes.count()) === 2, 'the inbox item did not open for editing');
  await boxes.last().fill('');
  await page.keyboard.press('Enter');
  await kit.sleep(2000);
  const body = await page.locator('body').innerText();
  const stored = await kit.api('GET', `/api/inbox/${item.body.uid}`);
  kit.expect(
    String(stored.body?.content ?? '') === 'Renew the car insurance',
    `the item's text changed to ${JSON.stringify(stored.body?.content)}`,
  );
  kit.expect(
    !/\bItem updated\b/.test(body),
    'the app says "Item updated" although the empty text was not saved',
  );
  return 'no "Item updated" message; the text is kept';
}
