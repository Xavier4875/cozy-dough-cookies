import { sendEmail } from './ses.js';

// In-memory only, lost on restart — same tradeoff as shipping/retryQueue.js
// and rewards/earnRetryQueue.js. Every email this app sends after the fact
// (receipts, order-status updates, staff new-order notifications) is a
// nice-to-have that must never block or fail the action that triggered it,
// but a transient SES/network hiccup shouldn't just be silently dropped
// forever either: this gives it a few automatic follow-up attempts, spaced
// out, before finally giving up. The email is already fully built by the
// time it's enqueued, so a retry just re-sends the same content rather than
// re-deriving it from whatever changed.
const RETRY_DELAY_MS = 5000;
const MAX_ATTEMPTS = 5;

export function enqueue(toEmail, subject, text, html, attempt = 1) {
  setTimeout(() => attemptSend(toEmail, subject, text, html, attempt), RETRY_DELAY_MS);
}

async function attemptSend(toEmail, subject, text, html, attempt) {
  try {
    await sendEmail(toEmail, subject, text, html);
  } catch (err) {
    console.error(`Retry ${attempt}/${MAX_ATTEMPTS} failed to send email to ${toEmail}:`, err);
    if (attempt < MAX_ATTEMPTS) {
      enqueue(toEmail, subject, text, html, attempt + 1);
    } else {
      console.error(`Giving up sending email to ${toEmail} after ${MAX_ATTEMPTS} attempts.`);
    }
  }
}
