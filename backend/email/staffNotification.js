import {
  formatMoney,
  formatPickupDateTime,
  formatAddressLines,
  wrapEmailHtml,
  paragraphsHtml,
  buildOrderTableHtml,
  buildOrderTableText,
  escapeHtml,
} from './format.js';

// Staff's copy of what a customer just ordered — same underlying order data
// as the customer receipt, but framed for staff (who placed it, how to
// reach them) rather than as a thank-you. Unlike the customer receipt, this
// one is allowed to reference the customer's own submitted fulfillment
// details (their requested pickup time, or their shipping address) — that's
// different from PICKUP_ADDRESS (the shop's own address), which stays
// scoped to the customer receipt only.
export function buildStaffNewOrderEmail({ contact, fulfillment, orders }) {
  const intro = `New order from ${contact.firstName} ${contact.lastName} (${contact.email}).`;

  const textLines = [intro];
  const headerHtml = [escapeHtml(intro)];

  if (fulfillment.method === 'pickup') {
    const line = `Requested pickup: ${formatPickupDateTime(fulfillment.pickupDate, fulfillment.pickupTime)}`;
    textLines.push(line);
    headerHtml.push(escapeHtml(line));
  } else {
    textLines.push('Shipping to:', ...formatAddressLines(fulfillment.shippingAddress));
    headerHtml.push(`Shipping to:<br>${formatAddressLines(fulfillment.shippingAddress).map(escapeHtml).join('<br>')}`);
  }

  // Built as one ordered HTML string (not a separate paragraphs array plus a
  // separate tables string) so a multi-order checkout's "Order i of N" label
  // lands directly above its own table instead of every label bunching
  // above every table.
  let bodyHtml = paragraphsHtml(headerHtml);
  let grandTotal = 0;
  orders.forEach((order, i) => {
    if (orders.length > 1) {
      const label = `Order ${i + 1} of ${orders.length}`;
      textLines.push(label);
      bodyHtml += paragraphsHtml([`<strong>${label}</strong>`]);
    }
    textLines.push(...buildOrderTableText(order));
    bodyHtml += buildOrderTableHtml(order);
    grandTotal += order.total;
  });

  if (orders.length > 1) {
    const grandTotalLine = `Grand total: ${formatMoney(grandTotal)}`;
    textLines.push(grandTotalLine);
    bodyHtml += paragraphsHtml([`<strong>${escapeHtml(grandTotalLine)}</strong>`]);
  }

  return {
    subject: `New order — ${fulfillment.method === 'pickup' ? 'Pickup' : 'Shipping'}`,
    text: textLines.join('\n\n'),
    html: wrapEmailHtml(bodyHtml),
  };
}
