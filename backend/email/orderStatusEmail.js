import {
  formatPickupDateTime,
  formatAddressLines,
  wrapEmailHtml,
  paragraphsHtml,
  buildOrderTableHtml,
  buildOrderTableText,
  escapeHtml,
} from './format.js';

// Fulfillment info line(s) for an order-status email — same shape whether
// it's a text array-of-lines or an HTML paragraph string, so both builders
// below can share it instead of duplicating the pickup/shipping branch.
// `status` only affects the shipping label: once an order is actually
// 'completed' it's been delivered, not still "shipping".
function fulfillmentLinesText(fulfillment, status) {
  if (fulfillment.method === 'pickup') {
    return [`Pickup time: ${formatPickupDateTime(fulfillment.pickupDate, fulfillment.pickupTime)}`];
  }
  const label = status === 'completed' ? 'Delivered to:' : 'Shipping to:';
  return [label, ...formatAddressLines(fulfillment.shippingAddress)];
}

function fulfillmentParagraphHtml(fulfillment, status) {
  if (fulfillment.method === 'pickup') {
    return `Pickup time: ${escapeHtml(formatPickupDateTime(fulfillment.pickupDate, fulfillment.pickupTime))}`;
  }
  const label = status === 'completed' ? 'Delivered to:' : 'Shipping to:';
  const addressHtml = formatAddressLines(fulfillment.shippingAddress).map(escapeHtml).join('<br>');
  return `${label}<br>${addressHtml}`;
}

// Fired by POST /api/orders/:id/confirm-pickup — a pure fulfillment-record
// update, decoupled from order.status (see the comment on that endpoint in
// index.js), so the headline message is entirely about the pickup time,
// never about the order's stage. `changed` is whether the saved date/time
// actually differs from what the order had before this call; `note` is the
// optional staff note that endpoint already supports; `order` supplies the
// item/total breakdown (its fulfillment is the pre-update one — pickupDate/
// pickupTime are passed separately as the new values). Deliberately never
// mentions PICKUP_ADDRESS — that stays scoped to the receipt email only.
export function buildPickupTimeEmail({ contact, pickupDate, pickupTime, changed, note, order }) {
  const headline = changed
    ? `Your order has been confirmed, but we had to adjust your pickup time. Your new pickup time is ${formatPickupDateTime(pickupDate, pickupTime)}.`
    : `Your order has been confirmed for your requested pickup time: ${formatPickupDateTime(pickupDate, pickupTime)}.`;

  const textLines = [`Hi ${contact.firstName},`, headline];
  if (note) textLines.push(`Note from us: ${note}`);
  textLines.push(...buildOrderTableText(order));

  const htmlParagraphs = [`Hi ${contact.firstName},`, escapeHtml(headline)];
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
// `order` supplies the fulfillment details and item/total breakdown.
export function buildStatusChangeEmail({ contact, method, status, order }) {
  const message = STATUS_MESSAGES[method]?.[status];
  if (!message) return null;

  const textLines = [
    `Hi ${contact.firstName},`,
    message,
    ...fulfillmentLinesText(order.fulfillment, status),
    ...buildOrderTableText(order),
  ];

  const htmlParagraphs = [
    `Hi ${contact.firstName},`,
    escapeHtml(message),
    fulfillmentParagraphHtml(order.fulfillment, status),
  ];

  return {
    subject: 'Your Cozy Dough Cookies order update',
    text: textLines.join('\n\n'),
    html: wrapEmailHtml(paragraphsHtml(htmlParagraphs) + buildOrderTableHtml(order)),
  };
}
