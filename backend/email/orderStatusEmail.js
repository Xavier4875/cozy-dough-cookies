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
//
// Two things beyond the confirmation itself, because the 24-hour forfeiture
// window (see Policy.jsx and the pickup notice) starts from this time:
//  - When the time was CHANGED, an explicit note says so and shows both times,
//    so the customer can't mistake the new time for the one they asked for.
//    `order.fulfillment` is still the pre-update one here, so it holds the old
//    time. While the order is still 'placed' that old time is what the customer
//    requested; after that it is a time we had already confirmed.
//  - Every version carries the reminder that an order not picked up (and not
//    discussed with the shop) within 24 hours of the scheduled time is forfeited.
//    Replies reach the shop: SES sends with a Reply-To (see email/ses.js).
export function buildPickupTimeEmail({ contact, pickupDate, pickupTime, changed, note, order }) {
  const newTime = formatPickupDateTime(pickupDate, pickupTime);
  const oldTime = formatPickupDateTime(order.fulfillment.pickupDate, order.fulfillment.pickupTime);
  const firstConfirmation = order.status === 'placed';
  const addressLine = pickupAddressLine();

  let headline;
  // Only when the time changed: the two times side by side, then the note.
  let oldLabel = null;
  let newLabel = null;
  let changeNote = null;
  if (!changed) {
    headline = `Your order has been confirmed for your requested pickup time: ${newTime}.`;
  } else if (firstConfirmation) {
    headline = 'Your order has been confirmed, but we had to change your pickup time.';
    oldLabel = 'You requested';
    newLabel = 'Your confirmed pickup time';
    changeNote =
      "your confirmed pickup time is different from the time you requested. Please come at your confirmed time. If it doesn't work for you, just reply to this email and let us know.";
  } else {
    headline = 'Your order is still confirmed, but we had to change your pickup time.';
    oldLabel = 'Previous pickup time';
    newLabel = 'Your new pickup time';
    changeNote =
      "your pickup time has changed. Please come at your new time; the previous time no longer applies. If the new time doesn't work for you, just reply to this email and let us know.";
  }
  const reminder =
    "Please pick up your order at your scheduled pickup time. If it hasn't been picked up and we haven't heard from you within 24 hours of that time, the order will be forfeited with no refund. If your plans change, just reply to this email and let us know!";

  const textLines = [`Hi ${contact.firstName},`, headline];
  const htmlParagraphs = [`Hi ${contact.firstName},`, escapeHtml(headline)];
  if (changed) {
    textLines.push(`${oldLabel}: ${oldTime}\n${newLabel}: ${newTime}`, `Please note: ${changeNote}`);
    htmlParagraphs.push(
      `${escapeHtml(oldLabel)}: ${escapeHtml(oldTime)}<br><strong>${escapeHtml(newLabel)}: ${escapeHtml(newTime)}</strong>`,
      `<strong>Please note:</strong> ${escapeHtml(changeNote)}`
    );
  }
  textLines.push(addressLine);
  htmlParagraphs.push(escapeHtml(addressLine));
  if (note) {
    textLines.push(`Note from us: ${note}`);
    htmlParagraphs.push(`Note from us: ${escapeHtml(note)}`);
  }
  textLines.push(reminder, ...buildOrderTableText(order));
  htmlParagraphs.push(escapeHtml(reminder));

  return {
    subject: changed ? 'Your Cozy Dough Cookies pickup time has changed' : 'Your Cozy Dough Cookies pickup time',
    // Every line gets a blank line after it, same as the receipt.
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

// The two lines a refund adds to an email: how much went back to the card (and
// how long it takes to show), and the reward points returned. Either is null
// when it doesn't apply. Shared by the cancellation email and the refund email.
function refundAndPointsLines(refund, pointsReturned) {
  const refundLine = refund
    ? `A refund of ${formatMoney(refund.amount / 100)} has been issued to your original payment method. It can take 5-10 business days to appear on your statement.`
    : null;
  const pointsLine =
    pointsReturned > 0
      ? `The ${pointsReturned} reward point${pointsReturned === 1 ? '' : 's'} you used on this order ${pointsReturned === 1 ? 'has' : 'have'} been returned to your account.`
      : null;
  return { refundLine, pointsLine };
}

// Fired by POST /api/orders/:id/refund — staff refunding an order that was
// already picked up or delivered. It isn't a cancellation (the customer had the
// order), so it says "refunded" rather than "canceled", and carries only what
// matters: what went back to the card and any reward points returned, plus the
// order for reference. No pickup address or time: that part is over.
export function buildRefundEmail({ contact, order, refund, pointsReturned = 0 }) {
  const { refundLine, pointsLine } = refundAndPointsLines(refund, pointsReturned);
  const lines = ['Your order has been refunded.', ...(refundLine ? [refundLine] : []), ...(pointsLine ? [pointsLine] : [])];
  return {
    subject: 'Your Cozy Dough Cookies refund',
    text: [`Hi ${contact.firstName},`, ...lines, ...buildOrderTableText(order)].join('\n\n'),
    html: wrapEmailHtml(
      paragraphsHtml([`Hi ${contact.firstName},`, ...lines.map((l) => escapeHtml(l))]) + buildOrderTableHtml(order)
    ),
  };
}

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
  const { refundLine, pointsLine } = refundAndPointsLines(refund, pointsReturned);

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
