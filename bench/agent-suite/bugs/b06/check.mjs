// Hidden check: fails on the bugged shop, passes on any correct fix. Tests behaviour, not code.
const mugs = (qty) => [{ productId: 'mug', qty }];
const lamps = (qty) => [{ productId: 'lamp', qty }];

export default async function check(t) {
  const tooMany = await t.order(mugs(21));
  t.expect(tooMany.status === 409, `21 mugs (20 in stock): HTTP ${tooMany.status}; want 409`);
  const allMugs = await t.order(mugs(20));
  t.expect(
    allMugs.status === 201,
    `all 20 mugs: HTTP ${allMugs.status} ${JSON.stringify(allMugs.body)}; want 201`,
  );
  const allLamps = await t.order(lamps(5));
  t.expect(
    allLamps.status === 201,
    `all 5 lamps: HTTP ${allLamps.status} ${JSON.stringify(allLamps.body)}; want 201`,
  );
  const after = await t.order(lamps(1));
  t.expect(after.status === 409, `a lamp after all 5 were sold: HTTP ${after.status}; want 409`);
  return 'the last items in stock can be bought; more than the stock is still refused';
}
