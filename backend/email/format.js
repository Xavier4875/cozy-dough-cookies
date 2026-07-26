export function formatMoney(n) {
  return `$${n.toFixed(2)}`;
}

// pickupDate is 'YYYY-MM-DD', pickupTime is 24h 'HH:MM' — parsed as local
// components (not `new Date(pickupDate)`, which Date interprets as UTC
// midnight and can roll the displayed day back by one depending on the
// server's local timezone).
export function formatPickupDateTime(pickupDate, pickupTime) {
  const [year, month, day] = pickupDate.split('-').map(Number);
  const [hour, minute] = pickupTime.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Returned as separate lines (not one '\n'-joined string) so each address
// line can get the same blank-line-after treatment as every other line when
// the caller's lines array is later joined with '\n\n' — a single
// multi-line entry would collapse back together under that join.
export function formatAddressLines(addr) {
  const lines = [addr.line1];
  if (addr.line2) lines.push(addr.line2);
  lines.push(`${addr.city}, ${addr.state} ${addr.zip}`);
  return lines;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Every HTML email shares this shell — SES sends raw HTML with no access to
// an external stylesheet, so styling has to be inline on each element
// anyway, but a shared outer wrapper at least keeps font/color consistent
// without repeating it in every builder.
export function wrapEmailHtml(bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#3d2b1f;line-height:1.5;">${bodyHtml}</div>`;
}

export function paragraphsHtml(lines) {
  return lines.map((line) => `<p style="margin:0 0 12px;">${line}</p>`).join('');
}

// One order's line items as an HTML table, plus a subtotal/shipping/total
// footer — the one place this markup lives, shared by every email that
// shows order contents (receipt, order-status updates, staff notification)
// so they render identically instead of drifting apart.
export function buildOrderTableHtml(order) {
  const cell = 'padding:6px 10px;border-bottom:1px solid #e8ddd0;';
  const rows = order.items
    .map(
      (item) => `
    <tr>
      <td style="${cell}">${escapeHtml(item.flavor)} (${escapeHtml(item.sizeLabel)})</td>
      <td style="${cell}text-align:center;">${item.qty}</td>
      <td style="${cell}text-align:right;">${formatMoney(item.price * item.qty)}</td>
    </tr>`
    )
    .join('');

  const footerLines = [['Subtotal', order.subtotal]];
  if (order.shippingFee) footerLines.push(['Shipping', order.shippingFee]);
  footerLines.push(['Total', order.total]);

  const footerRows = footerLines
    .map(([label, amount], i) => {
      const isTotal = i === footerLines.length - 1;
      const weight = isTotal ? 'font-weight:bold;' : '';
      return `
    <tr>
      <td colspan="2" style="padding:6px 10px;text-align:right;${weight}">${label}</td>
      <td style="padding:6px 10px;text-align:right;${weight}">${formatMoney(amount)}</td>
    </tr>`;
    })
    .join('');

  return `
  <table style="width:100%;max-width:480px;border-collapse:collapse;font-size:14px;margin:0 0 12px;">
    <thead>
      <tr>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #3d2b1f;">Item</th>
        <th style="text-align:center;padding:6px 10px;border-bottom:2px solid #3d2b1f;">Qty</th>
        <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #3d2b1f;">Price</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>${footerRows}</tfoot>
  </table>`;
}

// Plain-text fallback for the same table — every HTML email still carries a
// Text body alongside the Html one, for text-only clients.
export function buildOrderTableText(order) {
  const lines = order.items.map(
    (item) => `  ${item.qty} x ${item.flavor} (${item.sizeLabel}) - ${formatMoney(item.price * item.qty)}`
  );
  lines.push(`  Subtotal: ${formatMoney(order.subtotal)}`);
  if (order.shippingFee) lines.push(`  Shipping: ${formatMoney(order.shippingFee)}`);
  lines.push(`  Total: ${formatMoney(order.total)}`);
  return lines;
}
