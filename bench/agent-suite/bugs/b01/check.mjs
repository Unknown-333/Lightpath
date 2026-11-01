// Hidden check: fails on the bugged shop, passes on any correct fix. Tests behaviour, not code.
export default async function check(t) {
  const one = await t.order([{ productId: 'lamp', qty: 1 }], 'WELCOME10');
  t.expect(one.status === 201, `1 lamp + WELCOME10: HTTP ${one.status}`);
  t.expect(
    one.body.discountCents === 390 && one.body.totalCents === 4009,
    `1 lamp + WELCOME10: discount ${one.body.discountCents}, total ${one.body.totalCents}; want 390 and 4009`,
  );
  const big = await t.order(
    [
      { productId: 'lamp', qty: 2 },
      { productId: 'mug', qty: 1 },
    ],
    'WELCOME10',
  );
  t.expect(
    big.status === 201 && big.body.discountCents === 900 && big.body.totalCents === 8100,
    `2 lamps + 1 mug + WELCOME10: HTTP ${big.status}, discount ${big.body.discountCents}, total ${big.body.totalCents}; want 900 and 8100`,
  );
  const plain = await t.order([{ productId: 'mug', qty: 1 }]);
  t.expect(
    plain.status === 201 && plain.body.discountCents === 0 && plain.body.totalCents === 1699,
    `1 mug, no coupon: discount ${plain.body.discountCents}, total ${plain.body.totalCents}; want 0 and 1699`,
  );
  return 'WELCOME10 takes 10% off; orders without a coupon are unchanged';
}
