// Hidden check: fails on the bugged shop, passes on any correct fix. Tests behaviour, not code.
export default async function check(t) {
  const page = await t.page();
  await t.add(page, 'Desk lamp');
  await t.checkout(page);
  const msg = await t.findText(page, /Order #\d+ placed/);
  t.expect(msg, `no order confirmation after Checkout; page shows: ${await t.bodyText(page)}`);
  return `checkout shows "${msg}"`;
}
