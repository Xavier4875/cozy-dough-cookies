import { sendEmail, staffRecipients } from './ses.js';
import { enqueue as enqueueEmailRetry } from './emailRetryQueue.js';
import { wrapEmailHtml, paragraphsHtml, escapeHtml } from './format.js';

// An email for staff about something that needs a human — a customer charged
// with no order, a chargeback, a refund that didn't go through. `lines` are
// plain text paragraphs; they're escaped here for the HTML version.
export function buildStaffAlertEmail({ subject, lines }) {
  return {
    subject: `[Cozy Dough Cookies] ${subject}`,
    text: lines.join('\n\n'),
    html: wrapEmailHtml(paragraphsHtml(lines.map(escapeHtml))),
  };
}

// Sends the alert to everyone in STAFF_NOTIFICATION_EMAIL (the same addresses
// new-order notifications go to). It is also always written to the server log at
// error level, so it isn't lost when that variable isn't set or SES is down —
// the email is the nicer channel, not the only one. Never throws: an alert about
// a problem must not become a second problem for whoever triggered it. A failed
// send is retried like every other background email.
export async function notifyStaff({ subject, lines }) {
  console.error(`STAFF ALERT: ${subject}\n${lines.join('\n')}`);
  const to = staffRecipients();
  if (to.length === 0) return;
  const email = buildStaffAlertEmail({ subject, lines });
  try {
    await sendEmail(to, email.subject, email.text, email.html);
  } catch (err) {
    console.error('Failed to send staff alert email:', err);
    enqueueEmailRetry(to, email.subject, email.text, email.html);
  }
}
