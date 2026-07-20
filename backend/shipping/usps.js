import { USPS_RATE_LIMIT_MAX_CALLS_DEFAULT, USPS_RATE_LIMIT_WINDOW_MS_DEFAULT } from '../constants.js';

const BASE_URL = process.env.USPS_API_BASE_URL || 'https://apis.usps.com';
const TOKEN_URL = `${BASE_URL}/oauth2/v3/token`;
const ADDRESS_URL = `${BASE_URL}/addresses/v3/address`;
const REQUEST_TIMEOUT_MS = 5000;
// Refetch this long before actual expiry, so a token that's about to expire
// mid-flight never gets used for a request that fails partway through.
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

function isConfigured() {
  return Boolean(process.env.USPS_CONSUMER_KEY && process.env.USPS_CONSUMER_SECRET);
}

// `||` would silently discard an explicit 0 override (0 is falsy), so this
// only falls back when the var is genuinely unset/blank/non-numeric.
// Exported so ipRateLimit.js (a sibling rate limiter) can reuse it too.
export function envNumber(name, fallback) {
  if (process.env[name] === undefined || process.env[name] === '') return fallback;
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

// USPS's Addresses API caps a new account at 60 requests/hour by default —
// account-wide, shared across every checkout, not per-customer. This is a
// fixed-window global limiter protecting that shared budget. Env overrides
// exist so the block→reset→retry cycle is testable without waiting a real
// hour, and so the limit can be raised later without a code change if USPS
// approves a higher quota — same override pattern as USPS_API_BASE_URL.
const RATE_LIMIT_WINDOW_MS = envNumber('USPS_RATE_LIMIT_WINDOW_MS', USPS_RATE_LIMIT_WINDOW_MS_DEFAULT);
const RATE_LIMIT_MAX_CALLS = envNumber('USPS_RATE_LIMIT_MAX_CALLS', USPS_RATE_LIMIT_MAX_CALLS_DEFAULT);

let rateLimitWindowStart = Date.now();
let rateLimitCallCount = 0;

// No lock needed: Node's single-threaded event loop means this check-then-
// increment runs atomically between await points.
function checkRateLimit() {
  if (Date.now() - rateLimitWindowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitWindowStart = Date.now();
    rateLimitCallCount = 0;
  }
  if (rateLimitCallCount >= RATE_LIMIT_MAX_CALLS) return false;
  rateLimitCallCount++;
  return true;
}

// Exported so retryQueue.js can schedule its retry pass for exactly when
// the current window's budget frees up.
export function getRateLimitResetAt() {
  return rateLimitWindowStart + RATE_LIMIT_WINDOW_MS;
}

let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
    return cachedToken.accessToken;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.USPS_CONSUMER_KEY,
      client_secret: process.env.USPS_CONSUMER_SECRET,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`USPS OAuth token request failed: ${res.status}`);
  }
  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

// Never throws. Four outcomes:
//   { verified: true, standardized }        — USPS confirmed it's deliverable.
//   { verified: false, reason: 'rejected' } — USPS actively checked and said
//                                              it's NOT deliverable. This is
//                                              the only outcome the checkout
//                                              handler blocks on.
//   { verified: false, reason: 'error' }    — unreachable, timed out, or
//                                              errored — we simply don't
//                                              know, so this must never
//                                              block checkout (a USPS outage
//                                              shouldn't mean the shop can't
//                                              take shipping orders).
//   { verified: false, reason: 'rate_limited' } — our own account-wide quota
//                                              is exhausted for this window;
//                                              same non-blocking treatment as
//                                              'error'. Both 'error' and
//                                              'rate_limited' get queued for
//                                              automatic retry — see
//                                              retryQueue.js.
//   { verified: null }                      — feature dormant, no credentials.
export async function validateAddress({ line1, line2, city, state, zip }) {
  if (!isConfigured()) return { verified: null };
  if (!checkRateLimit()) return { verified: false, reason: 'rate_limited' };

  try {
    const token = await getAccessToken();
    const [zipCode, zipPlus4] = zip.split('-');
    const params = new URLSearchParams({
      streetAddress: line1,
      secondaryAddress: line2 || '',
      city,
      state,
      ZIPCode: zipCode,
      ...(zipPlus4 && { ZIPPlus4: zipPlus4 }),
    });
    const res = await fetch(`${ADDRESS_URL}?${params}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Confirmed against real responses: USPS returns HTTP 400 with a
      // structured { error: { message, code, errors } } body for any problem
      // with the address content itself — "Address Not Found", "Invalid
      // City", "Invalid State", etc. (not a 200 + DPVConfirmation!=='Y' as
      // the public docs/examples implied). Any 400 with that recognizable
      // shape is a real deliverability rejection, regardless of which
      // specific message it carries. Anything else — auth failure, rate
      // limit, 5xx, network/timeout, or a 400 without this shape — is an
      // infrastructure problem, not USPS saying "no", and must not block.
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON error body */ }
      if (res.status === 400 && body?.error?.message) {
        return { verified: false, reason: 'rejected' };
      }
      return { verified: false, reason: 'error' };
    }

    const data = await res.json();
    // The actual response nests the standardized address under `address` and
    // the match/DPV status under `additionalInfo` — confirmed against a real
    // response, since USPS's public docs/examples describe a flatter shape
    // that doesn't match what the live API actually returns.
    if (data.additionalInfo?.DPVConfirmation !== 'Y') return { verified: false, reason: 'rejected' };

    return {
      verified: true,
      standardized: {
        line1: data.address.streetAddress,
        line2: data.address.secondaryAddress || '',
        city: data.address.city,
        state: data.address.state,
        zip: data.address.ZIPPlus4 ? `${data.address.ZIPCode}-${data.address.ZIPPlus4}` : data.address.ZIPCode,
      },
    };
  } catch (err) {
    console.error('USPS address validation failed:', err);
    return { verified: false, reason: 'error' };
  }
}
