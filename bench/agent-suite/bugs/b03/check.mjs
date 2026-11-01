// Hidden check: fails on the bugged shop, passes on any correct fix. Tests behaviour, not code.
export default async function check(t) {
  const page = await t.page();
  await t.add(page, 'Desk lamp', 6);
  await t.checkout(page);
  const msg = await t.findText(page, /out of stock/i);
  t.expect(msg, `no out-of-stock message after checking out 6 lamps; page shows: ${await t.bodyText(page)}`);
  const ok = await t.page();
  await t.add(ok, 'Desk lamp');
  await t.checkout(ok);
  const placed = await t.findText(ok, /Order #\d+ placed/);
  t.expect(placed, `a valid order no longer shows its confirmation; page shows: ${await t.bodyText(ok)}`);
  return `failed order shows "${msg}"; valid order shows "${placed}"`;
}
