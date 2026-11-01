// Hidden check: fails on the bugged shop, passes on any correct fix. Tests behaviour, not code.
export default async function check(t) {
  const page = await t.page();
  await t.add(page, 'Desk lamp');
  await t.add(page, 'Coffee mug');
  const first = await t.findText(page, 'Subtotal: $51.00');
  t.expect(first, `after a lamp and a mug: ${await t.bodyText(page)}; want "Subtotal: $51.00"`);
  await t.add(page, 'Desk lamp');
  const second = await t.findText(page, 'Subtotal: $90.00');
  t.expect(second, `after 2 lamps and a mug: ${await t.bodyText(page)}; want "Subtotal: $90.00"`);
  return 'cart subtotal is $51.00 then $90.00';
}
