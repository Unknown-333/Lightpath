// v03 hidden check: skip a schedule's next date, then edit its amount and save. The next date
// stays where the skip moved it.
export default async function check(kit) {
  const page = await kit.demoPage();
  await page.getByText('Schedules', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Add new schedule' }).waitFor();
  await kit.sleep(1500);
  const rows = page.locator('[data-testid="row"]');
  const nextDate = async (row) => (/\d{2}\/\d{2}\/\d{4}/.exec(await row.innerText()) ?? [''])[0];
  let row = null;
  let before = '';
  let skipped = '';
  const count = await rows.count();
  for (let i = 1; i < count && !row; i++) {
    const candidate = rows.nth(i);
    const text = await candidate.innerText();
    if (!/Upcoming|Due/.test(text)) continue;
    const name = text.split('\n')[0];
    before = await nextDate(candidate);
    await candidate.getByRole('button', { name: 'Menu' }).click();
    await page.getByText('Skip next scheduled date').first().click();
    const fixed = rows.filter({ hasText: name }).first();
    for (let t = 0; t < 10; t++) {
      await kit.sleep(300);
      skipped = await nextDate(fixed);
      if (skipped && skipped !== before) break;
    }
    if (skipped && skipped !== before) row = { name, el: fixed };
  }
  kit.expect(row, 'no schedule whose next date moves when skipped');
  await row.el.getByText(row.name, { exact: true }).click();
  const amount = page
    .locator('input:visible')
    .filter({ hasNot: page.locator('xpath=self::*[@type="checkbox"]') })
    .nth(4);
  const value = Number((await amount.inputValue()).replace(/,/g, ''));
  await amount.fill((value + 1).toFixed(2));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await kit.sleep(2000);
  const after = await nextDate(rows.filter({ hasText: row.name }).first());
  kit.expect(
    after === skipped,
    `"${row.name}": next date ${before}, skipped to ${skipped}, then after editing the amount it shows ${after}`,
  );
  return `"${row.name}" stays on ${skipped} after the edit`;
}
