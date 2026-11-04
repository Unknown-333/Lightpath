// v09 hidden check (the control, static layout): at 1280x800 the dark side menu is a narrow
// column (under 300 px) and the invoices area takes the rest of the width (over 800 px).
export default async function check(kit) {
  const page = await kit.page();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('table.invoices').waitFor();
  const side = await page.locator('aside.sidebar').boundingBox();
  const main = await page.locator('main').boundingBox();
  kit.expect(side && main, 'the side menu or the main area is missing');
  kit.expect(
    side.width < 300 && main.width > 800 && main.x >= side.x + side.width - 1,
    `side menu ${Math.round(side.width)} px wide at x=${Math.round(side.x)}, invoices area ${Math.round(main.width)} px at x=${Math.round(main.x)}`,
  );
  return `side menu ${Math.round(side.width)} px, invoices area ${Math.round(main.width)} px`;
}
