import {
  formatPickupDateTime,
  formatAddressLines,
  pickupAddressLine,
  wrapEmailHtml,
  paragraphsHtml,
  buildOrderTableHtml,
  buildOrderTableText,
  escapeHtml,
  formatMoney,
} from './format.js';

// Fulfillment info line(s) for an order-status email — same shape whether
// it's a text array-of-lines or an HTML paragraph string, so both builders
// below can share it instead of duplicating the pickup/shipping branch.
// `status` only affects the shipping label: once an order is actually
// 'completed' it's been delivered, not still "shipping". A pickup order's
// emails always carry the shop's pickup address next to the pickup time.
function fulfillmentLinesText(fulfillment, status) {
  if (fulfillment.method === 'pickup') {
    return [
      `Pickup time: ${formatPickupDateTime(fulfillment.pickupDate, fulfillment.pickupTime)}`,
      pickupAddressLine(),
    ];
  }
  const label = status === 'completed' ? 'Delivered to:' : 'Shipping to:';
  return [label, ...formatAddressLines(fulfillment.shippingAddress)];
}

function fulfillmentParagraphHtml(fulfillment, status) {
  if (fulfillment.method === 'pickup') {
    const timeHtml = `Pickup time: ${escapeHtml(formatPickupDateTime(fulfillment.pickupDate, fulfillment.pickupTime))}`;
    return `${timeHtml}<br>${escapeHtml(pickupAddressLine())}`;
  }
  const label = status === 'completed' ? 'Delivered to:' : 'Shipping to:';
  const addressHtml = formatAddressLines(fulfillment.shippingAddress).map(escapeHtml).join('<br>');
  return `${label}<br>${addressHtml}`;
}

// Fired by POST /api/orders/:id/confirm-pickup. That endpoint also moves an
// order still at 'placed' to 'confirmed' (see the comment on it in index.js),
// but this is the only email sent for the call — so the headline is about the
// pickup time, and always says the order is confirmed. No separate
// stage-change email goes out. `changed` is whether the saved date/time
// actually differs from what the order had before this call; `note` is the
// optional staff note that endpoint already supports; `order` supplies the
// item/total breakdown (its fulfillment is the pre-update one — pickupDate/
// pickupTime are passed separately as the new values). Always carries the
// shop's pickup address, since this is the email that tells them when to come.
export function buildPickupTimeEmail({ contact, pickupDate, pickupTime, changed, note, order }) {
  const headline = changed
    ? `Your order has been confirmed, but we had to adjust your pickup time. Your new pickup time is ${formatPickupDateTime(pickupDate, pickupTime)}.`
    : `Your order has been confirmed for your requested pickup time: ${formatPickupDateTime(pickupDate, pickupTime)}.`;
  const addressLine = pickupAddressLine();

  const textLines = [`Hi ${contact.firstName},`, headline, addressLine];
  if (note) textLines.push(`Note from us: ${note}`);
  textLines.push(...buildOrderTableText(order));

  const htmlParagraphs = [`Hi ${contact.firstName},`, escapeHtml(headline), escapeHtml(addressLine)];
  if (note) htmlParagraphs.push(`Note from us: ${escapeHtml(note)}`);

  return {
    subject: 'Your Cozy Dough Cookies pickup time',
    text: textLines.join('\n\n'),
    html: wrapEmailHtml(paragraphsHtml(htmlParagraphs) + buildOrderTableHtml(order)),
  };
}

// Fired by set-status/complete/cancel — the order's overall stage, worded
// per fulfillment method to match the labels staff see in Order Tracking
// (STAGE_LABELS in frontend/src/pages/OrderTracking.jsx). 'placed' has no
// entry on purpose: a fresh order's receipt already covers that, and
// set-status can only reach 'placed' as a staff correction (e.g. undoing an
// accidental confirm), which isn't a customer-facing milestone worth an email.
const STATUS_MESSAGES = {
  pickup: {
    confirmed: 'Your order has been confirmed!',
    ready: 'Your order is ready for pickup!',
    completed: 'Your order has been picked up. Thanks for stopping by!',
    canceled: 'Your order has been canceled.',
  },
  shipping: {
    confirmed: 'Your order has been confirmed!',
    ready: 'Your order has shipped!',
    completed: 'Your order has been delivered!',
    canceled: 'Your order has been canceled.',
  },
};

// Returns null for a transition with no customer-facing message (see above)
// — callers should skip sending entirely rather than mail an empty body.
// `order` supplies the fulfillment details and item/total breakdown. `refund`
// (a canceled order whose payment was refunded) adds a line saying so, with
// the amount and when to expect it. `pointsReturned` (reward points the order
// had spent, given back on cancel) adds a line saying so — only that side is
// worth telling the customer; points taken back are just the earnings of an
// order that no longer exists.
export function buildStatusChangeEmail({ contact, method, status, order, refund, pointsReturned = 0 }) {
  const message = STATUS_MESSAGES[method]?.[status];
  if (!message) return null;
  const refundLine = refund
    ? `A refund of ${formatMoney(refund.amount / 100)} has been issued to your original payment method. It can take 5-10 business days to appear on your statement.`
    : null;
  const pointsLine =
    pointsReturned > 0
      ? `The ${pointsReturned} reward point${pointsReturned === 1 ? '' : 's'} you used on this order ${pointsReturned === 1 ? 'has' : 'have'} been returned to your account.`
      : null;

  const textLines = [
    `Hi ${contact.firstName},`,
    message,
    ...(refundLine ? [refundLine] : []),
    ...(pointsLine ? [pointsLine] : []),
    ...fulfillmentLinesText(order.fulfillment, status),
    ...buildOrderTableText(order),
  ];

  const htmlParagraphs = [
    `Hi ${contact.firstName},`,
    escapeHtml(message),
    ...(refundLine ? [escapeHtml(refundLine)] : []),
    ...(pointsLine ? [escapeHtml(pointsLine)] : []),
    fulfillmentParagraphHtml(order.fulfillment, status),
  ];

  return {
    subject: 'Your Cozy Dough Cookies order update',
    text: textLines.join('\n\n'),
    html: wrapEmailHtml(paragraphsHtml(htmlParagraphs) + buildOrderTableHtml(order)),
  };
}
