// How a checkout's reward points are divided among its orders, and how many of
// them come back when one of those orders is canceled.
//
// Points move once per checkout (earned on the whole cart, spent on every
// redeemed reward in it), but staff cancel one order at a time — a checkout can
// hold several (e.g. separate pickup batches). So each order records its own
// share at checkout (`pointsEarned`, `pointsSpent` on the order), and canceling
// an order moves exactly that share back.

// Splits the points a checkout earns across its orders so the shares add up to
// exactly what the customer was awarded (Math.round of the whole cart), which
// rounding each order separately would not guarantee ($10.50 + $10.50 earns 21,
// not 11 + 11). Each order gets the difference between the rounded running
// total before and after it.
export function allocateEarnedPoints(orderTotals, grandTotal) {
  const target = Math.round(grandTotal);
  let cumulative = 0;
  let allocated = 0;
  const shares = orderTotals.map((total) => {
    cumulative += total;
    const upTo = Math.round(cumulative);
    const share = upTo - allocated;
    allocated = upTo;
    return share;
  });
  // Float noise could in theory leave the running total a point off the
  // cart's own rounded total; the last order absorbs it so the sum is exact.
  if (shares.length > 0) shares[shares.length - 1] += target - allocated;
  return shares;
}

// Points spent on each order: the cost of the rewards redeemed inside it.
// `resolvedRedemptions` is [{ orderIndex, entry: { points } }] from checkout.
export function allocateSpentPoints(resolvedRedemptions, orderCount) {
  const spent = new Array(orderCount).fill(0);
  for (const { orderIndex, entry } of resolvedRedemptions) spent[orderIndex] += entry.points;
  return spent;
}

// What canceling this order should move: points it earned (to take back) and
// points it spent (to return). Nothing for guests (no points account), and
// nothing for orders from before points were recorded on them.
export function pointsToReverse(order) {
  if (!order?.customerId) return { earned: 0, spent: 0 };
  const whole = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
  return { earned: whole(order.pointsEarned), spent: whole(order.pointsSpent) };
}
