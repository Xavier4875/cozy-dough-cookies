import { PICKUP_ADDRESS } from '../constants.js';
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

// `orders` are the already-persisted order records from a single checkout
// (contact/fulfillment are shared across every order in one checkout call —
// see backend/index.js's /api/checkout handler — so they're listed once at
// the top rather than repeated per order).
export function buildReceiptEmail({ contact, fulfillment, orders }) {
  const textLines = [`Thanks for your order, ${contact.firstName}!`];
  const headerHtml = [`Thanks for your order, ${escapeHtml(contact.firstName)}!`];

  if (fulfillment.method === 'pickup') {
    const pickupLine = `Requested pickup: ${formatPickupDateTime(fulfillment.pickupDate, fulfillment.pickupTime)}`;
    const noteLine =
      "This time is a request, not a confirmation — please wait to hear from us that your order is ready before coming by.";
    const addressLine = `Pickup address: ${PICKUP_ADDRESS}`;
    textLines.push(pickupLine, noteLine, addressLine);
    headerHtml.push(escapeHtml(pickupLine), escapeHtml(noteLine), escapeHtml(addressLine));
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
    subject: 'Your Cozy Dough Cookies receipt',
    // Every line gets a blank line after it, not just section breaks.
    text: textLines.join('\n\n'),
    html: wrapEmailHtml(bodyHtml),
  };
}
