// Refunding an order AFTER it was picked up or delivered (staff only; the server
// endpoint is POST /api/orders/:id/refund). It is offered on Recent Orders only:
// the server refuses an order that has left that list (more than 7 days since it
// ended), and the Past Orders lookup has no refund button at all.

// Whether there is anything to give back on a completed order: money paid by card,
// or reward points the customer spent on it (a points-only order is "refunded" by
// returning its points). Guests have no points account. The Recent Orders list
// only ever holds orders from the last 7 days, so no time check is needed here;
// the server makes the same call plus the time check, and refuses otherwise.
export function canRefundRecentOrder(order) {
  if (order?.status !== 'completed') return false;
  const paid = Boolean(order.payment?.paymentIntentId) && order.total > 0;
  const pointsBack = Boolean(order.customerId) && order.pointsSpent > 0;
  return paid || pointsBack;
}

// A refunded order is stored as 'canceled' (so Sales and everything else that
// already leaves canceled orders out keeps working) with refundedAfterCompletion
// set; screens show it as "Refunded", not "Canceled", because the customer did
// have the order.
export function isRefundedAfterPickup(order) {
  return order?.status === 'canceled' && order.refundedAfterCompletion === true;
}

// Sends the refund request. Returns { data } on success or { error } with
// the message to show staff — the server refunds the card first and, if Stripe
// refuses, leaves the order as it was and says why.
export async function requestOrderRefund(getIdToken, orderId) {
  try {
    const token = await getIdToken();
    const res = await fetch(`/api/orders/${orderId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to refund order.' };
    return { data };
  } catch {
    return { error: 'Failed to refund order.' };
  }
}

// What the order record looks like after a successful refund (the server's
// response merged in), so the list can update in place without a reload.
export function applyRefundToOrder(order, data) {
  return {
    ...order,
    status: data.status,
    canceledAt: data.canceledAt,
    refundedAfterCompletion: true,
    ...(data.refund && { refund: data.refund }),
    ...(data.pointsAdjustment && { pointsAdjustment: data.pointsAdjustment }),
  };
}
