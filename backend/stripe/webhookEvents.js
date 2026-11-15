import { getStripeClient } from './client.js';
import { notifyStaff } from '../email/staffAlert.js';
import { getOrderById, deterministicOrderId } from '../db/ordersRepo.js';

// What the webhook does with each Stripe event once its signature has been
// verified (see /api/stripe/webhook in index.js). To receive these, the
// endpoint in the Stripe Dashboard must be subscribed to:
//   payment_intent.succeeded, payment_intent.payment_failed,
//   charge.dispute.created, charge.dispute.closed, refund.failed
// (charge.refunded is also accepted, for the log). Anything else is ignored.

// A payment that succeeded but never became an order is checked for after
// this long. The webhook usually arrives *before* the browser's own follow-up
// /api/checkout call has finished creating the orders, so checking right away
// would flag every normal purchase.
export const UNFINALIZED_CHECK_DELAY_MS = 15 * 60 * 1000;

// Stripe delivers an event again if it didn't see a 2xx, and sometimes twice
// anyway. Remembering recent ids keeps one dispute from emailing staff twice.
// In-memory and bounded — a restart forgets, at worst repeating an alert.
const RECENT_EVENT_LIMIT = 500;
const recentEventIds = new Set();

function alreadySeen(eventId) {
  if (recentEventIds.has(eventId)) return true;
  recentEventIds.add(eventId);
  if (recentEventIds.size > RECENT_EVENT_LIMIT) recentEventIds.delete(recentEventIds.values().next().value);
  return false;
}

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Where staff can look the object up. Test and live payments live at
// different Dashboard addresses.
function dashboardUrl(livemode, path) {
  return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}${path}`;
}

// After the grace period, if a succeeded payment still has no order, tell
// staff — a customer has been charged and nothing was created for them. "No
// order" is read straight from the database (order ids are derived from the
// payment id, see deterministicOrderId), not from a flag that might itself be
// the thing that failed to save. A payment that was refunded is fine: the
// checkout failed cleanly and the customer got their money back.
export async function checkPaymentBecameOrder(paymentIntentId, deps = {}) {
  const stripe = deps.stripe ?? getStripeClient();
  const lookup = deps.getOrderById ?? getOrderById;
  const alert = deps.notifyStaff ?? notifyStaff;

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  if (paymentIntent.status !== 'succeeded') return { alerted: false, reason: 'not_succeeded' };
  if (paymentIntent.latest_charge?.refunded) return { alerted: false, reason: 'refunded' };
  if (await lookup(deterministicOrderId(paymentIntentId, 0))) return { alerted: false, reason: 'order_exists' };

  await alert({
    subject: 'A customer was charged but no order was created',
    lines: [
      `Payment ${paymentIntentId} for ${dollars(paymentIntent.amount)} succeeded, but no order has been created for it.`,
      paymentIntent.metadata?.contactEmail ? `Customer email: ${paymentIntent.metadata.contactEmail}` : 'Customer email: not recorded.',
      'This usually means the customer closed the page right after paying, or checkout failed after the charge and the automatic refund also failed.',
      `Contact the customer to take the order, or refund the payment: ${dashboardUrl(paymentIntent.livemode, `payments/${paymentIntentId}`)}`,
    ],
  });
  return { alerted: true };
}

// Handles one verified event. Throws only for something unexpected, in which
// case the webhook answers 500 and Stripe retries it later.
export async function handleStripeEvent(event, deps = {}) {
  if (alreadySeen(event.id)) return { handled: false, reason: 'duplicate' };
  const alert = deps.notifyStaff ?? notifyStaff;
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms).unref());
  const object = event.data.object;

  switch (event.type) {
    case 'payment_intent.succeeded': {
      schedule(() => {
        checkPaymentBecameOrder(object.id, deps).catch((err) =>
          console.error(`Couldn't check whether payment ${object.id} became an order:`, err)
        );
      }, UNFINALIZED_CHECK_DELAY_MS);
      return { handled: true, scheduledCheck: true };
    }

    case 'payment_intent.payment_failed': {
      // A declined card is routine and the customer sees the reason on the
      // spot — logged for the record, no alert.
      const error = object.last_payment_error;
      console.info(`Payment ${object.id} failed: ${error?.code ?? 'unknown'} ${error?.decline_code ?? ''}`.trim());
      return { handled: true };
    }

    case 'charge.dispute.created': {
      const due = object.evidence_details?.due_by ? new Date(object.evidence_details.due_by * 1000).toDateString() : 'see the Dashboard';
      await alert({
        subject: `Chargeback opened for ${dollars(object.amount)}`,
        lines: [
          `A customer disputed a payment of ${dollars(object.amount)}. Reason given: ${object.reason}.`,
          `Payment: ${object.payment_intent ?? object.charge}`,
          `You have until ${due} to respond with evidence; if you don't, the dispute is lost and the money is taken back.`,
          `Respond here: ${dashboardUrl(event.livemode, `disputes/${object.id}`)}`,
        ],
      });
      return { handled: true, alerted: true };
    }

    case 'charge.dispute.closed': {
      await alert({
        subject: `Chargeback ${object.status === 'won' ? 'won' : object.status === 'lost' ? 'lost' : 'closed'} (${dollars(object.amount)})`,
        lines: [
          `The dispute for ${dollars(object.amount)} was closed with the outcome: ${object.status}.`,
          dashboardUrl(event.livemode, `disputes/${object.id}`),
        ],
      });
      return { handled: true, alerted: true };
    }

    case 'refund.failed': {
      // Usually the customer's card was closed or replaced after paying. Money
      // the customer is owed hasn't reached them, so staff need to sort it out.
      await alert({
        subject: `A refund of ${dollars(object.amount)} failed`,
        lines: [
          `The refund ${object.id} for ${dollars(object.amount)} did not go through${object.failure_reason ? ` (${object.failure_reason})` : ''}.`,
          `Payment: ${object.payment_intent}${object.metadata?.orderId ? ` — order ${object.metadata.orderId}` : ''}`,
          `The customer has not been paid back. Arrange another way to return the money: ${dashboardUrl(event.livemode, `payments/${object.payment_intent}`)}`,
        ],
      });
      return { handled: true, alerted: true };
    }

    case 'charge.refunded': {
      console.info(`Charge ${object.id} refunded (${dollars(object.amount_refunded)} of ${dollars(object.amount)}).`);
      return { handled: true };
    }

    default:
      return { handled: false, reason: 'ignored_type' };
  }
}
