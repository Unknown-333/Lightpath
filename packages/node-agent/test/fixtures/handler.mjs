export function handleOrder(body) {
  if (body.items.length === 0) {
    return { status: 400, error: 'empty cart' };
  }
  const total = body.items.reduce((sum, item) => sum + item.price, 0);
  return { status: 201, total };
}
