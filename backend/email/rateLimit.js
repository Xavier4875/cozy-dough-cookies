import { envNumber } from '../shipping/usps.js';
import {
  EMAIL_VERIFICATION_RATE_LIMIT_MAX_CALLS_DEFAULT,
  EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS_DEFAULT,
} from '../constants.js';

// Keyed by the target email, not the caller's IP — the resource being
// protected is a given inbox (and, indirectly, SES send quota), not any one
// requester, so this caps "how many codes can be sent to X per hour"
// regardless of which IP is asking. Kept separate from shipping/ipRateLimit.js
// — that one already exists for a different endpoint's spam protection, and
// sharing a bucket would mean sending a verification code eats into a
// customer's shipping-checkout quota (and vice versa).
const WINDOW_MS = envNumber(
  'EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS',
  EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS_DEFAULT
);
const MAX_CALLS = envNumber(
  'EMAIL_VERIFICATION_RATE_LIMIT_MAX_CALLS',
  EMAIL_VERIFICATION_RATE_LIMIT_MAX_CALLS_DEFAULT
);
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const requestsByEmail = new Map(); // email -> { count, windowStart }

export function checkEmailSendRateLimit(email) {
  const now = Date.now();
  const entry = requestsByEmail.get(email);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    requestsByEmail.set(email, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MAX_CALLS) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of requestsByEmail) {
    if (now - entry.windowStart >= WINDOW_MS) requestsByEmail.delete(email);
  }
}, SWEEP_INTERVAL_MS).unref();
