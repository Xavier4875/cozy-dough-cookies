import {
  deterministicOrderId,
  createOrdersSpendingPoints,
  DuplicateOrderError,
  InsufficientPointsError,
} from '../db/ordersRepo.js';
import { allocateSpentPoints } from '../rewards/points.js';

// A checkout whose every item is redeemed with reward points costs $0, so there
// is no Stripe payment behind it. Stripe's payment id is what normally makes a
// checkout happen exactly once (order ids are derived from it); here the browser
// supplies a one-time key for the attempt instead, and the ids are derived from
// that. A UUID is what it sends; the shape is just wide enough to accept one.
export const CHECKOUT_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

// The order records for a points-only checkout. Same fields a paid order has,
// minus `payment` (nothing was paid — the same shape staff already see on orders
// from before payments existed, and what the cancel flow treats as "no refund
// to make"). Earns nothing: nothing was spent in dollars.
export function buildFreeOrderRecords({
  user,
  contact,
  fulfillment,
  cart,
  resolvedRedemptions,
  checkoutKey,
  pickupNoticeVersion,
  now = new Date(),
}) {
  const spentShares = allocateSpentPoints(resolvedRedemptions, cart.orders.length);
  return cart.orders.map((order, index) => {
    const { items, total } = order.toJSON();
    return {
      // Includes the customer, so one customer's key can never collide with —
      // or be used to probe — another's.
      orderId: deterministicOrderId(`free:${user.customerId}:${checkoutKey}`, index),
      status: 'placed',
      items,
      subtotal: total,
      total,
      contact,
      email: contact.email,
      fulfillment,
      createdAt: now.toISOString(),
      // The agreement to the pickup notice (see pickup/notice.js), same as a paid order carries.
      ...(pickupNoticeVersion && { pickupNotice: { version: pickupNoticeVersion, acknowledgedAt: now.toISOString() } }),
      customerId: user.customerId,
      pointsEarned: 0,
      pointsSpent: spentShares[index],
    };
  });
}

// Places a checkout that costs $0 because it is paid for in points: the orders
// and the points deduction are saved together or not at all. Returns
// { orders } on success, or { error, status } for anything the customer should
// be told about. Never takes a payment, never touches Stripe.
export async function placeFreeOrders({
  user,
  contact,
  fulfillment,
  cart,
  resolvedRedemptions,
  totalPointsRequired,
  checkoutKey,
  pickupNoticeVersion,
}) {
  // $0 only ever comes from redeeming rewards, by a signed-in customer, for
  // pickup (a shipped order always carries a shipping fee). Anything else
  // reaching here is a malformed request, not something to give away.
  if (!user || totalPointsRequired <= 0 || fulfillment.method !== 'pickup') {
    return { error: 'Nothing to charge.', status: 400 };
  }
  if (typeof checkoutKey !== 'string' || !CHECKOUT_KEY_RE.test(checkoutKey)) {
    return { error: 'Checkout could not be completed. Please try again.', status: 400 };
  }
  const records = buildFreeOrderRecords({
    user,
    contact,
    fulfillment,
    cart,
    resolvedRedemptions,
    checkoutKey,
    pickupNoticeVersion,
  });
  try {
    const orders = await createOrdersSpendingPoints(records, user.customerId, totalPointsRequired);
    return { orders };
  } catch (err) {
    if (err instanceof DuplicateOrderError) {
      return { error: 'This order has already been placed.', status: 409 };
    }
    if (err instanceof InsufficientPointsError) {
      return { error: "You don't have enough reward points for this order.", status: 400 };
    }
    console.error('Failed to place a points-only order:', err);
    return { error: 'Failed to save your order. Please try again.', status: 500 };
  }
}
