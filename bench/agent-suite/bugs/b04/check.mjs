// Hidden check: fails on the bugged shop, passes on any correct fix. Tests behaviour, not code.
export default async function check(t) {
  const page = await t.page();
  await t.add(page, 'Desk lamp', 2);
  const two = await t.findText(page, 'Subtotal: $78.00');
  t.expect(two, `after adding the lamp twice: ${await t.bodyText(page)}; want "Subtotal: $78.00"`);
  await t.add(page, 'Desk lamp');
  const three = await t.findText(page, 'Subtotal: $117.00');
  t.expect(three, `after adding the lamp three times: ${await t.bodyText(page)}; want "Subtotal: $117.00"`);
  await t.add(page, 'Coffee mug');
  const mixed = await t.findText(page, 'Subtotal: $129.00');
  t.expect(mixed, `after 3 lamps and 1 mug: ${await t.bodyText(page)}; want "Subtotal: $129.00"`);
  return 'subtotal follows every click: $78.00, $117.00, $129.00';
}
