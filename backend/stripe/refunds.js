import { getStripeClient } from './client.js';

// The few refund fields worth keeping on an order, so staff (and the customer
// email) can see what was refunded without a trip to the Stripe Dashboard.
// `amount` is in cents, as Stripe reports it.
export function toRefundRecord(refund) {
  return {
    id: refund.id,
    amount: refund.amount,
    status: refund.status,
    createdAt: new Date(refund.created * 1000).toISOString(),
  };
}

export function orderRefundCents(order) {
  return Math.round((order.total ?? 0) * 100);
}

// Refunds the share of a checkout's payment that belongs to one order: its own
// total, shipping included. A checkout can hold several orders paid with one
// charge, so this is a partial refund of that payment, never the whole thing.
//
// Safe to call twice for the same order. The idempotency key makes Stripe hand
// back the original refund (within 24 hours) instead of issuing a second one,
// so a retry after a failure partway through — refund went through, saving the
// result didn't — can't pay the customer twice. An order that already has a
// refund recorded is returned as is without calling Stripe at all.
//
// Returns { refunded: true, refund } or { refunded: false, reason } when
// there's nothing to give back (no payment on file, or a $0 order — e.g. one
// paid entirely with reward points). Stripe errors (card closed, already
// refunded in the Dashboard, ...) are thrown for the caller to report.
export async function refundOrderPayment(order, stripe = getStripeClient()) {
  const paymentIntentId = order.payment?.paymentIntentId;
  if (!paymentIntentId) return { refunded: false, reason: 'no_payment' };
  if (order.refund?.id) return { refunded: true, refund: order.refund };
  const amount = orderRefundCents(order);
  if (amount <= 0) return { refunded: false, reason: 'nothing_to_refund' };

  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      amount,
      reason: 'requested_by_customer',
      metadata: { orderId: order.orderId },
    },
    { idempotencyKey: `order-cancel-refund-${order.orderId}` }
  );
  return { refunded: true, refund: toRefundRecord(refund) };
}

// Gives back an entire payment — for a checkout that was charged but then
// couldn't be completed (order wouldn't save, USPS rejected the address).
// Idempotent per payment for the same reason as above.
export async function refundWholePayment(paymentIntentId, stripe = getStripeClient()) {
  const refund = await stripe.refunds.create(
    { payment_intent: paymentIntentId, reason: 'requested_by_customer' },
    { idempotencyKey: `checkout-failed-refund-${paymentIntentId}` }
  );
  return toRefundRecord(refund);
}
