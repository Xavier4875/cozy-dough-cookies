// Must be the first import: ES module imports are evaluated in order before
// any of this file's own statements run, and db/client.js (imported below,
// transitively via ordersRepo.js) reads AWS_* env vars at construction time.
// A later `dotenv.config()` call here would run only after that client was
// already built with those vars unset.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, scanAll } from './db/client.js';
import { EXTERNAL_SALES_TABLE } from './db/schema.js';
import { Cookie, TEMPERATURE_CONTROLLED_FLAVORS, isDietaryRestrictedType } from './models/Cookie.js';
import { Order } from './models/Order.js';
import { Cart } from './models/Cart.js';
import {
  createOrder,
  getOrderById,
  queryOrdersByCustomerId,
  queryOrdersByEmail,
  queryActiveOrders,
  queryCompletedOrders,
  queryCanceledOrders,
  scanGuestOrders,
  scanAllOrders,
  updateOrderFulfillment,
  setOrderStatus,
} from './db/ordersRepo.js';
import {
  upsertCustomer,
  getCustomerById,
  scanAllCustomers,
  addRewardsPoints,
  redeemRewardsPoints,
  deleteCustomer,
} from './db/customersRepo.js';
import {
  putCode as putVerificationCode,
  getVerification,
  markVerified,
  recordFailedAttempt,
  isCurrentlyVerified,
} from './db/verificationRepo.js';
import { optionalAuth, requireAuth, requireActiveCustomer, requireStaff } from './middleware/auth.js';
import { installAsyncErrorHandling } from './middleware/asyncHandler.js';
import { addToCustomerGroup } from './auth/cognitoGroup.js';
import { REWARDS_CATALOG, getReward } from './rewards/catalog.js';
import { validateAddress } from './shipping/usps.js';
import { enqueue as enqueueAddressRetry } from './shipping/retryQueue.js';
import { enqueue as enqueueEarnRetry } from './rewards/earnRetryQueue.js';
import { checkIpRateLimit } from './shipping/ipRateLimit.js';
import { checkEmailSendRateLimit } from './email/rateLimit.js';
import { sendVerificationCodeEmail, sendEmail } from './email/ses.js';
import { buildReceiptEmail } from './email/receipt.js';
import { buildPickupTimeEmail, buildStatusChangeEmail } from './email/orderStatusEmail.js';
import { buildStaffNewOrderEmail } from './email/staffNotification.js';
import { enqueue as enqueueEmailRetry } from './email/emailRetryQueue.js';
import { getStripeClient } from './stripe/client.js';
import {
  EMAIL_RE,
  PICKUP_DATE_RE,
  PICKUP_TIME_RE,
  PICKUP_OPEN_MINUTES,
  PICKUP_CLOSE_MINUTES,
  PICKUP_EXTENDED_NOTICE_MS,
  STATE_RE,
  ZIP_RE,
  UNITS_PER_SIZE,
  MIN_ORDER_SUBTOTAL,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  CARD_SURCHARGE_RATE,
  CARD_SURCHARGE_API_VERSION,
} from './constants.js';

// Groups repeated flavor picks ("Chocolate Chip" chosen for 2 of a Two
// Dozen reward's dozens) into a single "Chocolate Chip ×2" entry rather than
// listing the same name twice.
function summarizeFlavors(flavors) {
  const counts = new Map();
  for (const flavor of flavors) counts.set(flavor, (counts.get(flavor) || 0) + 1);
  return [...counts.entries()].map(([flavor, n]) => (n > 1 ? `${flavor} ×${n}` : flavor)).join(', ');
}

function validateContact(contact) {
  if (!contact || typeof contact !== 'object') return 'Contact information is required.';
  const { firstName, lastName, email} = contact;
  if (!firstName || !String(firstName).trim()) return 'First name is required.';
  if (!lastName || !String(lastName).trim()) return 'Last name is required.';
  if (!email || !EMAIL_RE.test(String(email).trim())) return 'A valid email is required.';
  return null;
}

// Format-only checks — not validated against a real list of states/cities/
// zips (that's what usps.js's real USPS lookup is for). Shared by
// validateFulfillment below and the /api/shipping/validate-address endpoint,
// so both reject a malformed address the same way before ever spending a
// real USPS API call on it.
function validateShippingAddressFields(shippingAddress) {
  if (!shippingAddress || typeof shippingAddress !== 'object') {
    return 'A valid shipping address is required.';
  }
  const { line1, city, state, zip } = shippingAddress;
  if (!line1 || !String(line1).trim()) return 'Street address is required.';
  if (!city || !String(city).trim()) return 'City is required.';
  if (!state || !STATE_RE.test(String(state).trim())) return 'State must be a 2-letter abbreviation.';
  if (!zip || !ZIP_RE.test(String(zip).trim())) return 'A valid ZIP code is required.';
  return null;
}

// No timezone infrastructure exists anywhere in this app (single
// physical-location shop) — pickupDate/pickupTime are plain wall-clock
// values, interpreted in whatever local time zone this process runs in, same
// as the browser interprets them when building the picker. Good enough for a
// single-timezone business; would need real tz-awareness for multi-location.
function parsePickupDateTime(pickupDate, pickupTime) {
  const [year, month, day] = pickupDate.split('-').map(Number);
  const [hour, minute] = pickupTime.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

// Shared by validateFulfillment (customer self-scheduling) and staff's
// confirm-pickup endpoint — a staff edit must clear the same bar a customer's
// own request would, not a looser one.
// No advance-notice requirement for a regular pickup order — every pickup
// order is confirmed by staff after the fact regardless (see
// /api/orders/:id/confirm-pickup), so the only real constraints here are
// business hours and not picking a time that's already passed. Gluten-free/
// sugar-free orders get an *additional* 48-hour floor on top of this — see
// validateExtendedPickupNotice below, which only runs once the caller knows
// whether the order actually contains one (this function alone doesn't).
function validatePickupDateTime(pickupDate, pickupTime) {
  if (!pickupDate || !PICKUP_DATE_RE.test(pickupDate)) {
    return 'A valid pickup date is required.';
  }
  if (!pickupTime || !PICKUP_TIME_RE.test(pickupTime)) {
    return 'Pickup time must be in 15-minute increments.';
  }
  const [hour, minute] = pickupTime.split(':').map(Number);
  const minutesOfDay = hour * 60 + minute;
  if (minutesOfDay < PICKUP_OPEN_MINUTES || minutesOfDay > PICKUP_CLOSE_MINUTES) {
    return 'Pickup time must be between 10:00am and 7:00pm.';
  }
  const [, month, day] = pickupDate.split('-').map(Number);
  const pickupDateTime = parsePickupDateTime(pickupDate, pickupTime);
  // new Date rolls over out-of-range components (e.g. day 32) instead of
  // failing, so a mismatched getDate() catches an invalid calendar date
  // like 2026-02-30 that the regex alone can't reject.
  if (pickupDateTime.getDate() !== day || pickupDateTime.getMonth() !== month - 1) {
    return 'A valid pickup date is required.';
  }
  if (pickupDateTime.getTime() < Date.now()) {
    return 'That pickup time has already passed.';
  }
  return null;
}

// Only meaningful once the caller knows whether the order actually contains
// a gluten-free/sugar-free item — checked separately from
// validatePickupDateTime above because that's only known once the cart is
// resolved (see resolveCheckoutRequest), not from the fulfillment payload
// alone. requiresExtendedNotice is a plain boolean rather than a cart/order
// object so this works the same whether the caller has a live Cart (at
// checkout) or a persisted order record (staff's confirm-pickup endpoint).
function validateExtendedPickupNotice(fulfillment, requiresExtendedNotice) {
  if (fulfillment.method !== 'pickup' || !requiresExtendedNotice) return null;
  const pickupDateTime = parsePickupDateTime(fulfillment.pickupDate, fulfillment.pickupTime);
  if (pickupDateTime.getTime() - Date.now() < PICKUP_EXTENDED_NOTICE_MS) {
    return 'Gluten-free/sugar-free orders need at least 48 hours notice for pickup.';
  }
  return null;
}

function validateFulfillment(fulfillment) {
  if (!fulfillment || typeof fulfillment !== 'object') return 'Fulfillment method is required.';
  const { method, shippingAddress, pickupDate, pickupTime } = fulfillment;
  if (method !== 'pickup' && method !== 'shipping') {
    return 'Fulfillment method must be "pickup" or "shipping".';
  }
  if (method === 'shipping') {
    const addressError = validateShippingAddressFields(shippingAddress);
    if (addressError) return addressError;
  }
  if (method === 'pickup') {
    const pickupError = validatePickupDateTime(pickupDate, pickupTime);
    if (pickupError) return pickupError;
  }
  return null;
}

const app = express();
const PORT = process.env.PORT || 4000;
// Stays false until card-network advance notice is confirmed done AND
// Surcharging is turned on in the Stripe Dashboard — neither is true yet.
const CARD_SURCHARGE_ENABLED = process.env.ENABLE_CARD_SURCHARGE === 'true';

// Must run before any app.get/post/put/patch/delete calls below — it
// replaces those methods so every route registered afterward automatically
// forwards a rejected promise to Express's error handler instead of
// crashing the whole process (see middleware/asyncHandler.js).
installAsyncErrorHandling(app);

app.use(cors());
// The `verify` hook stashes the raw request bytes on req.rawBody alongside
// the normal parsed req.body — Stripe's webhook signature check (see
// /api/stripe/webhook) needs the exact original bytes, not a re-serialized
// JSON.stringify(req.body), which isn't guaranteed to match byte-for-byte.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Stubbed out for now — real data comes once DynamoDB is wired up.
// One product per flavor per applicable size, built from Cookie's own
// type->flavor->sizes table so the list isn't duplicated here — each type
// declares its own `sizes` (e.g. gluten-free/sugar-free only ever have
// 'batch'), so this doesn't need to know which types support which sizes.
const PRODUCTS = [];
for (const [type, info] of Object.entries(Cookie.TYPES)) {
  for (const flavor of info.flavors) {
    for (const size of info.sizes) {
      PRODUCTS.push(new Cookie(type, flavor, size));
    }
  }
}

// Simple health check so the frontend has something to talk to right away.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cozy Dough Cookies API is running' });
});

app.get('/api/products', (req, res) => {
  res.json(PRODUCTS);
});

// Staff-only menu control: marks an item in or out of stock. Mutates the
// same in-memory PRODUCTS entry /api/products serves, so it's visible to
// every customer on their next fetch — like the rest of this stubbed
// catalog (see the PRODUCTS comment above), this doesn't persist across a
// server restart yet.
app.post(
  '/api/products/:id/set-sold-out',
  requireAuth,
  requireActiveCustomer,
  requireStaff,
  async (req, res) => {
    const cookie = PRODUCTS.find((p) => p.id === req.params.id);
    if (!cookie) {
      return res.status(404).json({ error: 'Unknown product id.' });
    }
    if (typeof req.body.is_sold_out !== 'boolean') {
      return res.status(400).json({ error: 'is_sold_out must be true or false.' });
    }
    cookie.is_sold_out = req.body.is_sold_out;
    res.json({ id: cookie.id, is_sold_out: cookie.is_sold_out });
  }
);

// Server-authoritative reward catalog — the frontend fetches this rather
// than hardcoding point costs, so display and enforcement can't drift apart.
app.get('/api/rewards/catalog', (req, res) => {
  res.json(REWARDS_CATALOG);
});

// Lets the shipping address modal block progression on a bad address before
// the customer ever reaches checkout, instead of only finding out after
// filling out contact info too. Shares the same per-IP limiter as checkout's
// shipping path — it spends the same real, rate-limited USPS quota, so an
// abusive IP hitting this endpoint instead of checkout must be stopped the
// same way. Checkout still independently re-verifies with USPS when the
// order is actually placed (see the shipping block below) — this endpoint is
// purely a UX gate, never the source of truth, same as every other
// client-facing check in this app (rewards balance, cart totals, etc.).
app.post('/api/shipping/validate-address', async (req, res) => {
  if (!checkIpRateLimit(req.ip)) {
    return res.status(429).json({
      error: 'Too many address checks from this address. Please try again later.',
    });
  }
  const addressError = validateShippingAddressFields(req.body.shippingAddress);
  if (addressError) {
    return res.status(400).json({ error: addressError });
  }
  const { line1, line2, city, state, zip } = req.body.shippingAddress;
  const result = await validateAddress({
    line1: String(line1).trim(),
    line2: line2 ? String(line2).trim() : '',
    city: String(city).trim(),
    state: String(state).trim().toUpperCase(),
    zip: String(zip).trim(),
  });
  res.json(result);
});

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Guest checkout only — a signed-in customer already proved their email at
// Cognito signup. Sends a 6-digit code via SES; the corresponding record is
// only written after the send succeeds, so a failed send never leaves a
// "valid" code sitting around that was never actually delivered.
app.post('/api/email-verification/send', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (!checkEmailSendRateLimit(email)) {
    return res.status(429).json({
      error: 'Too many verification requests for this email. Please try again later.',
    });
  }

  const code = generateVerificationCode();
  try {
    await sendVerificationCodeEmail(email, code);
  } catch (err) {
    console.error('Failed to send verification email:', err);
    return res.status(502).json({ error: 'Failed to send verification email. Please try again.' });
  }
  await putVerificationCode(email, code);
  res.json({ sent: true });
});

app.post('/api/email-verification/confirm', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!EMAIL_RE.test(email) || !code) {
    return res.status(400).json({ error: 'Email and code are required.' });
  }

  const record = await getVerification(email);
  if (!record || record.expiresAt * 1000 < Date.now()) {
    return res.status(400).json({ error: 'That code has expired. Please request a new one.' });
  }
  if (record.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }

  const ok = await markVerified(email, code, EMAIL_VERIFICATION_MAX_ATTEMPTS);
  if (!ok) {
    await recordFailedAttempt(email);
    return res.status(400).json({ error: 'Incorrect code. Please try again.' });
  }
  res.json({ verified: true });
});

// Shared by /api/checkout/create-payment-intent and /api/checkout — both
// need the exact same server-computed cart (prices/totals come from
// PRODUCTS server-side, never trusted from the client), so this lives once
// rather than duplicated between "how much do I charge" and "what do I
// actually persist". Deliberately excludes USPS address validation and
// rewards-point spending: those are an externally-rate-limited call and an
// irreversible balance change respectively, and must only happen once, at
// the actual finalize step — not every time a price is computed. Mutates
// req.user (downgrading a stale token to guest) as a side effect, same as
// the original inline checkout logic did.
async function resolveCheckoutRequest(req) {
  const requestedOrders = Array.isArray(req.body.orders) ? req.body.orders : [];
  if (requestedOrders.length === 0) {
    return { error: 'Cart has no orders.', status: 400 };
  }

  // A token can stay cryptographically valid for its full lifetime even
  // after the account behind it is deleted (deleting a Cognito user doesn't
  // revoke tokens already issued to it) — so a stale second tab could
  // otherwise still have orders attributed to, and earn/redeem points on, a
  // customerId that no longer resolves to anyone. Downgrade silently to
  // guest checkout rather than erroring.
  if (req.user && !(await getCustomerById(req.user.customerId))) {
    req.user = null;
  }

  const contactError = validateContact(req.body.contact);
  if (contactError) return { error: contactError, status: 400 };
  const fulfillmentError = validateFulfillment(req.body.fulfillment);
  if (fulfillmentError) return { error: fulfillmentError, status: 400 };

  const contact = {
    firstName: String(req.body.contact.firstName).trim(),
    lastName: String(req.body.contact.lastName).trim(),
    email: String(req.body.contact.email).trim(),
  };

  // Guests must prove they own the inbox they're checking out with —
  // signed-in customers already did this once at signup, via Cognito.
  // Checked here (shared) rather than only at finalize, so a guest never
  // gets as far as entering card details only to be rejected afterward.
  if (!req.user) {
    const verification = await getVerification(contact.email.toLowerCase());
    if (!isCurrentlyVerified(verification)) {
      return { error: 'Please verify your email before checking out.', status: 400 };
    }
  }

  const fulfillment =
    req.body.fulfillment.method === 'shipping'
      ? {
          method: 'shipping',
          shippingAddress: {
            line1: String(req.body.fulfillment.shippingAddress.line1).trim(),
            line2: req.body.fulfillment.shippingAddress.line2
              ? String(req.body.fulfillment.shippingAddress.line2).trim()
              : '',
            city: String(req.body.fulfillment.shippingAddress.city).trim(),
            state: String(req.body.fulfillment.shippingAddress.state).trim().toUpperCase(),
            zip: String(req.body.fulfillment.shippingAddress.zip).trim(),
          },
        }
      : {
          method: 'pickup',
          pickupDate: req.body.fulfillment.pickupDate,
          pickupTime: req.body.fulfillment.pickupTime,
        };

  // Reward redemptions require an account — resolve every requested key
  // against the server-side catalog up front (never trust a client-supplied
  // cost or item), so a guest or an unknown key fails before anything else
  // is built. Keys may repeat within an order (redeeming the same reward
  // twice) — each occurrence counts separately toward both the point cost
  // and the free items added.
  const hasRedemptions = requestedOrders.some(
    (o) => Array.isArray(o.redemptions) && o.redemptions.length > 0
  );
  if (hasRedemptions && !req.user) {
    return { error: 'Sign in to redeem rewards.', status: 400 };
  }
  const resolvedRedemptions = []; // [{ orderIndex, entry, flavors }]
  for (let i = 0; i < requestedOrders.length; i++) {
    const redemptions = Array.isArray(requestedOrders[i].redemptions) ? requestedOrders[i].redemptions : [];
    for (const redemption of redemptions) {
      const key = redemption?.key;
      const flavors = redemption?.flavors;
      const entry = getReward(key);
      if (!entry) {
        return { error: `Unknown reward: ${key}`, status: 400 };
      }
      if (!Array.isArray(flavors) || flavors.length !== entry.qty) {
        return {
          error: `${entry.label} requires exactly ${entry.qty} flavor selection${entry.qty > 1 ? 's' : ''}.`,
          status: 400,
        };
      }
      const validFlavors = Cookie.TYPES[entry.type].flavors;
      if (flavors.some((f) => !validFlavors.includes(f))) {
        return { error: `Invalid flavor selection for ${entry.label}.`, status: 400 };
      }
      resolvedRedemptions.push({ orderIndex: i, entry, flavors });
    }
  }
  const totalPointsRequired = resolvedRedemptions.reduce((sum, r) => sum + r.entry.points, 0);

  const cart = new Cart();

  for (let i = 0; i < requestedOrders.length; i++) {
    const requestedOrder = requestedOrders[i];
    const requestedItems = Array.isArray(requestedOrder.items) ? requestedOrder.items : [];
    const orderHasRedemption = resolvedRedemptions.some((r) => r.orderIndex === i);
    if (requestedItems.length === 0 && !orderHasRedemption) {
      return { error: 'An order has no cookies in it.', status: 400 };
    }

    const order = new Order();
    for (const { id, qty } of requestedItems) {
      const cookie = PRODUCTS.find((p) => p.id === id);
      if (!cookie) {
        return { error: `Unknown product id: ${id}`, status: 400 };
      }
      if (cookie.is_sold_out) {
        return { error: `${cookie.flavor} is sold out.`, status: 400 };
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        return { error: `Invalid quantity for ${cookie.flavor}.`, status: 400 };
      }
      order.addCookie(cookie, qty);
    }
    cart.addOrder(order);
  }

  // Fold the free reward item(s) into their order before the shipping check
  // below, so a temperature-controlled reward correctly forces pickup just
  // like a paid item would.
  for (const { orderIndex, entry, flavors } of resolvedRedemptions) {
    cart.orders[orderIndex].addCookie(
      {
        id: `reward-${entry.key}`,
        type: entry.type,
        flavor: `${entry.label}: ${summarizeFlavors(flavors)}`,
        sizeLabel: entry.sizeLabel,
        price: 0,
        // Real menu-equivalent value, not the $0 actually charged — lets a
        // fully-redeemed order still count toward the minimum-order-value
        // checkout rule below instead of always reading as $0.
        value: entry.value,
        // Real per-flavor answer now that a flavor is actually chosen, rather
        // than entry.is_temperature_controlled's conservative per-type guess.
        is_temperature_controlled: flavors.some((f) => TEMPERATURE_CONTROLLED_FLAVORS.has(f)),
        // entry.qty is baked into the reward's identity (e.g. "Three Dozen"
        // is 3 full_dozen units) rather than the line-item qty below, which
        // stays 1 — so physicalCookieCount needs this precomputed total
        // rather than deriving it from a single is_full_dozen-style flag the
        // way a real menu item would.
        physicalCookieUnits: UNITS_PER_SIZE[entry.size] * entry.qty,
      },
      1
    );
  }

  // valueTotal, not total — a redeemed reward counts at its real menu value
  // here, not the $0 it actually charges, so an order paid for entirely in
  // points can still clear the minimum instead of always reading as $0.
  if (cart.orders.some((order) => order.valueTotal < MIN_ORDER_SUBTOTAL)) {
    return {
      error: `Each order must have a value of at least $${MIN_ORDER_SUBTOTAL.toFixed(2)}.`,
      status: 400,
    };
  }

  if (fulfillment.method === 'shipping' && cart.orders.some((order) => order.requiresPickup)) {
    return {
      error: 'This order contains temperature-controlled items that can only be picked up, not shipped.',
      status: 400,
    };
  }

  const noticeError = validateExtendedPickupNotice(
    fulfillment,
    cart.orders.some((order) => order.requiresExtendedPickupNotice)
  );
  if (noticeError) return { error: noticeError, status: 400 };

  return { contact, fulfillment, cart, resolvedRedemptions, totalPointsRequired };
}

// The actual dollar amount this checkout must charge — order.total (items
// only) plus shipping fee where it applies. Not cart.grandTotal, which only
// sums order.total across orders and omits shipping entirely; that field is
// kept as-is in the response below for display, but it's never what's
// actually charged.
function computeGrandTotal(cart, fulfillment) {
  return cart.orders.reduce((sum, order) => {
    const shippingFee = fulfillment.method === 'shipping' ? order.shippingFee : 0;
    return sum + order.total + shippingFee;
  }, 0);
}

// A failure that reaches this point in /api/checkout means Stripe has
// already actually charged the customer — unlike every rejection earlier in
// the handler (which happen before payment is ever verified), just
// returning an error here would leave them charged with no order to show
// for it. Refunding first is what keeps that from happening; the refund
// call itself is best-effort logged (not re-thrown) since the customer-
// facing error is the same either way, and a failed refund here still
// leaves the finalized-metadata guard in place against reusing the payment.
async function refundAndFail(res, paymentIntentId, status, message) {
  try {
    await getStripeClient().refunds.create({ payment_intent: paymentIntentId });
  } catch (err) {
    console.error(`Failed to refund payment ${paymentIntentId} after a failed checkout:`, err);
  }
  res.status(status).json({ error: message });
}

// Computes the trustworthy total for the cart described in the request body
// and creates a Stripe PaymentIntent for it. Called before the customer ever
// sees a card field — the frontend renders Stripe's Payment Element against
// the returned client secret, then only calls /api/checkout (below) once
// Stripe confirms the payment actually succeeded.
app.post('/api/checkout/create-payment-intent', optionalAuth, async (req, res) => {
  const resolved = await resolveCheckoutRequest(req);
  if (resolved.error) {
    return res.status(resolved.status).json({ error: resolved.error });
  }
  const { cart, fulfillment } = resolved;
  const amount = Math.round(computeGrandTotal(cart, fulfillment) * 100);
  if (amount <= 0) {
    return res.status(400).json({ error: 'Nothing to charge.' });
  }

  try {
    const paymentIntent = await getStripeClient().paymentIntents.create({
      amount,
      currency: 'usd',
      // Explicit, not automatic_payment_methods — Apple Pay/Google Pay are
      // surfaced by Stripe.js's Payment Element as wallet UI on top of the
      // 'card' type (detected client-side by device/browser support), not
      // separate PaymentIntent types that need enabling here. Being explicit
      // keeps whatever else might be enabled in the Dashboard (Klarna, Cash
      // App Pay, etc.) from silently showing up uninvited.
      payment_method_types: ['card'],
    });
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
      surchargeEnabled: CARD_SURCHARGE_ENABLED,
    });
  } catch (err) {
    console.error('Failed to create payment intent:', err);
    res.status(500).json({ error: 'Failed to start payment. Please try again.' });
  }
});

// Attaches a payment method to a not-yet-confirmed PaymentIntent and asks
// Stripe's (public-preview) surcharging feature whether this specific card
// can be surcharged at all — it checks funding type (credit vs. debit/
// prepaid) and country for us, which is exactly the check federal law
// requires before ever adding a surcharge. Stripe doesn't pick the rate;
// `maximum_amount` is only a technical ceiling, not a suggested amount — see
// computeSurchargeCents below for where the actual 3% comes from.
// Never throws: a preview-API shape change, the account not yet having
// Surcharging enabled in the Dashboard, or any other failure here must
// degrade to "no surcharge" rather than ever breaking checkout, since this
// whole feature is unverifiable-in-production until both of those are true.
async function checkSurchargeEligibility(paymentIntentId, paymentMethodId) {
  try {
    const updated = await getStripeClient().paymentIntents.update(
      paymentIntentId,
      {
        payment_method: paymentMethodId,
        amount_details: { surcharge: { enforce_validation: 'enabled' } },
      },
      { apiVersion: CARD_SURCHARGE_API_VERSION }
    );
    const surcharge = updated.amount_details?.surcharge;
    return {
      baseAmount: updated.amount,
      status: surcharge?.status === 'available' ? 'available' : 'unavailable',
      maximumAmount: surcharge?.maximum_amount,
    };
  } catch (err) {
    console.error(`Surcharge eligibility check failed for ${paymentIntentId} — proceeding without a surcharge:`, err);
    return { baseAmount: null, status: 'unavailable', maximumAmount: undefined };
  }
}

// Our own 3% (CARD_SURCHARGE_RATE), clamped to whatever technical ceiling
// Stripe returned for this card/network/country — see checkSurchargeEligibility.
function computeSurchargeCents(baseAmountCents, maximumAmountCents) {
  const raw = Math.round(baseAmountCents * CARD_SURCHARGE_RATE);
  return maximumAmountCents != null ? Math.min(raw, maximumAmountCents) : raw;
}

// Disclosure step only — never confirms the payment. Card-network rules
// require showing the surcharge amount to the customer, with the ability to
// cancel or pick a different card, before the charge actually happens; this
// is what the frontend calls once it has a paymentMethodId (from
// stripe.createPaymentMethod) but before it ever confirms anything.
app.post('/api/checkout/surcharge-preview', async (req, res) => {
  if (!CARD_SURCHARGE_ENABLED) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const { paymentIntentId, paymentMethodId } = req.body;
  if (!paymentIntentId || !paymentMethodId) {
    return res.status(400).json({ error: 'paymentIntentId and paymentMethodId are required.' });
  }
  const { baseAmount, status, maximumAmount } = await checkSurchargeEligibility(paymentIntentId, paymentMethodId);
  const surchargeAmount =
    status === 'available' && baseAmount != null ? computeSurchargeCents(baseAmount, maximumAmount) : 0;
  const totalAmount = (baseAmount ?? 0) + surchargeAmount;
  res.json({ surchargeAmount, totalAmount });
});

// Re-derives the surcharge itself (never trusts a client-supplied number for
// anything that affects the charged amount) and confirms the PaymentIntent
// server-side. A shape mismatch specifically on the surcharge-inclusive
// confirm call falls back to a plain confirm at the base amount — a failed
// validation error here leaves the PaymentIntent safely retryable, so this
// fallback can't double-charge or corrupt anything.
app.post('/api/checkout/confirm-payment', async (req, res) => {
  if (!CARD_SURCHARGE_ENABLED) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const { paymentIntentId, paymentMethodId } = req.body;
  if (!paymentIntentId || !paymentMethodId) {
    return res.status(400).json({ error: 'paymentIntentId and paymentMethodId are required.' });
  }
  const returnUrl = `${req.protocol}://${req.get('host')}/checkout/complete`;

  try {
    const confirmWithoutSurcharge = () =>
      getStripeClient().paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
        return_url: returnUrl,
      });

    const { baseAmount, status, maximumAmount } = await checkSurchargeEligibility(paymentIntentId, paymentMethodId);
    const surchargeAmount =
      status === 'available' && baseAmount != null ? computeSurchargeCents(baseAmount, maximumAmount) : 0;

    // baseAmount is only null when the eligibility check itself couldn't
    // reach Stripe — in that case we don't know a safe amount to confirm at
    // all, so skip straight to the plain fallback (which confirms at
    // whatever amount is already set on the PaymentIntent) rather than
    // attempting amount_to_confirm: 0.
    let confirmed;
    if (baseAmount == null) {
      confirmed = await confirmWithoutSurcharge();
    } else {
      try {
        confirmed = await getStripeClient().paymentIntents.confirm(
          paymentIntentId,
          {
            payment_method: paymentMethodId,
            amount_to_confirm: baseAmount + surchargeAmount,
            amount_details: { surcharge: { amount: surchargeAmount, enforce_validation: 'enabled' } },
            return_url: returnUrl,
          },
          { apiVersion: CARD_SURCHARGE_API_VERSION }
        );
      } catch (err) {
        console.error(`Surcharge-aware confirm failed for ${paymentIntentId} — retrying without a surcharge:`, err);
        confirmed = await confirmWithoutSurcharge();
      }
    }

    if (confirmed.status === 'succeeded') {
      return res.json({ status: 'succeeded' });
    }
    if (confirmed.status === 'requires_action') {
      return res.json({ status: 'requires_action', clientSecret: confirmed.client_secret });
    }
    return res.status(400).json({ error: 'Payment could not be completed.' });
  } catch (err) {
    console.error('Failed to confirm payment:', err);
    res.status(500).json({ error: 'Payment failed. Please try again.' });
  }
});

// Stripe's raw webhook payload, verified by signature — the authoritative,
// server-to-server confirmation that a payment actually succeeded,
// independent of whatever the browser's confirmPayment() call reported
// (which a closed tab or dropped connection could lose entirely). For now
// this only guards against checkout never being finalized after a real
// successful charge (e.g. the tab closing between payment and the finalize
// call below) — logging it clearly rather than leaving an already-charged
// payment with no order behind it silently unnoticed. Needs req.rawBody
// (see the express.json() verify hook above), not the parsed req.body —
// the signature is computed over the exact original bytes.
app.post('/api/stripe/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(req.rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    if (paymentIntent.metadata?.finalized !== 'true') {
      console.error(
        `Stripe payment ${paymentIntent.id} succeeded but was never finalized into an order — check manually.`
      );
    }
  }

  res.json({ received: true });
});

// Persists real orders to DynamoDB once a real Stripe payment has actually
// succeeded — prices/totals are computed server-side from PRODUCTS so the
// client can't just send whatever total it wants. Guest checkout stays
// fully supported: optionalAuth attaches req.user when a valid token is
// present but never blocks the request, so a signed-in customer's orders
// get a customerId stamped on and a guest's orders omit it entirely (the
// customerId-createdAt-index GSI is sparse, so that's the intended shape).
// contact/fulfillment apply to the whole checkout action and get stamped
// onto each order created in it — required for everyone, signed in or not.
// A cart can hold several orders at once (e.g. separate pickup batches), so
// the request carries a list of orders, each with its own cookie/qty items.
app.post('/api/checkout', optionalAuth, async (req, res) => {
  // Spam protection for the shipping/USPS path specifically — checked first,
  // before any other work, so an abusive IP is turned away as cheaply as
  // possible. Unlike usps.js's global quota limiter (which stays
  // non-blocking to protect capacity for everyone else), this one actually
  // rejects the request: the point here is stopping a single bad actor, not
  // preserving a shared resource.
  if (req.body.fulfillment?.method === 'shipping' && !checkIpRateLimit(req.ip)) {
    return res.status(429).json({
      error: 'Too many shipping checkout attempts from this address. Please try again later.',
    });
  }

  const resolved = await resolveCheckoutRequest(req);
  if (resolved.error) {
    return res.status(resolved.status).json({ error: resolved.error });
  }
  const { contact, fulfillment, cart, totalPointsRequired } = resolved;

  // Every checkout must be backed by a real, already-succeeded Stripe
  // payment for the exact amount this request computes — never trust a
  // client-supplied "it succeeded" flag. Retrieving fresh from Stripe (not
  // trusting whatever the frontend's confirmPayment() callback reported)
  // catches a tampered/replayed paymentIntentId, a still-pending payment, or
  // a mismatched amount before anything is persisted. The finalized-metadata
  // check stops the same successful payment being used for a second order.
  const paymentIntentId = req.body.paymentIntentId;
  if (!paymentIntentId) {
    return res.status(400).json({ error: 'Payment is required to complete checkout.' });
  }
  const expectedAmount = Math.round(computeGrandTotal(cart, fulfillment) * 100);
  let paymentIntent;
  try {
    // The preview apiVersion is required here whenever surcharging is on —
    // without it, amount_details.surcharge is simply absent from the
    // response even though the actual charge (paymentIntent.amount) already
    // includes it, which made the amount-match check below fail every
    // surcharged payment as a false "amount mismatch".
    // retrieve(id, params, options) — unlike update()/confirm() (which have
    // real params in that slot and reliably detect a request-options object
    // passed there instead), retrieve() with no params sent apiVersion to
    // Stripe as a literal (invalid) API parameter when passed positionally
    // as the 2nd arg. The empty {} params object here is required so
    // apiVersion lands in the 3rd (options) slot instead.
    paymentIntent = CARD_SURCHARGE_ENABLED
      ? await getStripeClient().paymentIntents.retrieve(paymentIntentId, {}, { apiVersion: CARD_SURCHARGE_API_VERSION })
      : await getStripeClient().paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    console.error('Failed to retrieve payment intent:', err);
    return res.status(400).json({ error: 'Could not verify payment. Please try again.' });
  }
  if (paymentIntent.status !== 'succeeded') {
    return res.status(400).json({ error: 'Payment has not been completed.' });
  }
  // A surcharge (see /api/checkout/confirm-payment) adds to what Stripe
  // actually charged beyond expectedAmount — amount_details.surcharge.amount
  // is 0/absent whenever no surcharge applied, so this is a no-op then.
  const surchargeAmount = paymentIntent.amount_details?.surcharge?.amount ?? 0;
  if (paymentIntent.amount !== expectedAmount + surchargeAmount) {
    return res.status(400).json({ error: 'Payment amount does not match this order.' });
  }
  if (paymentIntent.metadata?.finalized === 'true') {
    return res.status(400).json({ error: 'This payment has already been used for an order.' });
  }
  // Marked immediately after verifying, before any persistence — the
  // narrowest possible window for a double-submitted finalize request to
  // slip past the check above and create duplicate orders from one payment.
  await getStripeClient().paymentIntents.update(paymentIntentId, { metadata: { finalized: 'true' } });

  // Runs after payment is confirmed (not before) so a request that was
  // always going to be rejected here never wastes a real USPS API call —
  // and after every cheap, local check above, for the same reason it always
  // was. Set once verification fails non-blockingly (rate-limited or a
  // genuine USPS outage/timeout) — after orders are persisted below, this
  // queues them for automatic re-verification the moment the quota window
  // resets.
  let addressNeedsRetry = false;
  if (fulfillment.method === 'shipping') {
    const result = await validateAddress(fulfillment.shippingAddress);
    if (result.verified === true) {
      fulfillment.shippingAddress = result.standardized; // more accurate for actual delivery
      fulfillment.addressVerified = true;
    } else if (result.reason === 'rejected') {
      // USPS actively checked and said this address isn't deliverable — the
      // only case that blocks checkout. A USPS outage/timeout or rate-limit
      // ('error'/'rate_limited') or no credentials configured (verified ===
      // null) must never block. Payment already succeeded by this point, so
      // this refunds it rather than just erroring out with the charge stuck.
      return refundAndFail(
        res,
        paymentIntentId,
        400,
        'We couldn\'t verify that shipping address with USPS. Please double-check it and try again.'
      );
    } else if (result.verified === false) {
      fulfillment.addressVerified = false; // couldn't be checked; kept as customer entered it
      addressNeedsRetry = true;
    }
    // result.verified === null (no USPS credentials configured) → leave
    // fulfillment exactly as before, no addressVerified field at all — and
    // no retry, since there's nothing to retry against.
  }

  // Spent after payment is confirmed, not before — unlike the old mock
  // checkout, a failure here can no longer just reject the whole request
  // with nothing created, since the customer has already been genuinely
  // charged. See the redemptionSpendFailed handling below: the order still
  // gets created regardless (the reward item was already included in what
  // was charged), the points just can't be deducted.
  let balanceAfterSpend = null;
  let redemptionSpendFailed = false;
  if (totalPointsRequired > 0) {
    try {
      balanceAfterSpend = await redeemRewardsPoints(req.user.customerId, totalPointsRequired);
      if (balanceAfterSpend === null) redemptionSpendFailed = true;
    } catch (err) {
      console.error('Failed to redeem rewards points after payment succeeded:', err);
      redemptionSpendFailed = true;
    }
    if (redemptionSpendFailed) {
      console.error(
        `Order for ${contact.email} proceeding without deducting ${totalPointsRequired} points — payment ${paymentIntentId} already succeeded.`
      );
    }
  }

  try {
    // One PaymentIntent-level surcharge split across potentially several
    // persisted order records (a checkout can hold multiple pickup
    // batches) — prorated by each order's share of the pre-surcharge
    // total, with the last order absorbing whatever cents rounding leaves
    // over so the parts always sum to exactly surchargeAmount. This is a
    // no-op (every share is 0) whenever no surcharge was actually applied.
    const preSurchargeCentsByOrder = cart.orders.map((order) => {
      const shippingFee = fulfillment.method === 'shipping' ? order.shippingFee : 0;
      return Math.round((order.total + shippingFee) * 100);
    });
    const preSurchargeCentsSum = preSurchargeCentsByOrder.reduce((sum, cents) => sum + cents, 0);
    let surchargeRemainingCents = surchargeAmount;
    const surchargeCentsByOrder = preSurchargeCentsByOrder.map((cents, i) => {
      if (i === cart.orders.length - 1) return surchargeRemainingCents;
      const share = preSurchargeCentsSum > 0 ? Math.round((cents / preSurchargeCentsSum) * surchargeAmount) : 0;
      surchargeRemainingCents -= share;
      return share;
    });

    const persistedOrders = [];
    for (const [i, order] of cart.orders.entries()) {
      const { items, total: subtotal } = order.toJSON();
      const shippingFee = fulfillment.method === 'shipping' ? order.shippingFee : 0;
      const surchargeFee = surchargeCentsByOrder[i] / 100;
      const record = {
        orderId: randomUUID(),
        status: 'placed',
        items,
        subtotal,
        ...(fulfillment.method === 'shipping' && { shippingFee }),
        ...(surchargeFee > 0 && { surchargeFee }),
        total: subtotal + shippingFee + surchargeFee,
        contact,
        email: contact.email,
        fulfillment,
        payment: {
          provider: 'stripe',
          paymentIntentId,
          amount: paymentIntent.amount,
          // Unprorated, authoritative surcharge total straight from Stripe
          // (cents, matching `amount` above) — so reconciliation never has
          // to re-sum prorated surchargeFee across sibling order records.
          ...(surchargeAmount > 0 && { surchargeAmount }),
          status: 'succeeded',
        },
        createdAt: new Date().toISOString(),
        ...(req.user && { customerId: req.user.customerId }),
      };
      persistedOrders.push(await createOrder(record));
    }

    if (addressNeedsRetry) {
      enqueueAddressRetry(persistedOrders.map((o) => o.orderId), fulfillment.shippingAddress);
    }

    // A receipt is a nice-to-have, not part of the transaction itself — a
    // failed send (or SES being unconfigured entirely, e.g. local dev)
    // must never fail an otherwise-successful checkout. Built once so a
    // retry re-sends the exact same content rather than re-deriving it.
    const receipt = buildReceiptEmail({ contact, fulfillment, orders: persistedOrders });
    try {
      await sendEmail(contact.email, receipt.subject, receipt.text, receipt.html);
    } catch (err) {
      console.error('Failed to send receipt email:', err);
      enqueueEmailRetry(contact.email, receipt.subject, receipt.text, receipt.html);
    }

    // Same best-effort treatment for staff's new-order notification — a
    // failed/unconfigured send here must not fail the checkout either.
    if (process.env.STAFF_NOTIFICATION_EMAIL) {
      const staffEmail = buildStaffNewOrderEmail({ contact, fulfillment, orders: persistedOrders });
      try {
        await sendEmail(process.env.STAFF_NOTIFICATION_EMAIL, staffEmail.subject, staffEmail.text, staffEmail.html);
      } catch (err) {
        console.error('Failed to send staff new-order notification:', err);
        enqueueEmailRetry(process.env.STAFF_NOTIFICATION_EMAIL, staffEmail.subject, staffEmail.text, staffEmail.html);
      }
    }

    // Signed-in customers earn 1 point per $1 spent. Guests earn nothing —
    // they have no Customers row at all. If the points update fails after
    // the orders already saved, the order still succeeds: points are a perk,
    // the order is the thing that must not fail. (Free reward items already
    // contribute $0 to grandTotal, so earning needs no adjustment for them.)
    // A failure here queues an automatic retry (earnRetryQueue.js) rather
    // than just being logged and dropped — same "don't block the order, but
    // don't silently lose the side effect either" shape as the shipping
    // address retry queue above.
    let rewards;
    if (req.user) {
      rewards = {};
      if (totalPointsRequired > 0 && !redemptionSpendFailed) rewards.spent = totalPointsRequired;
      const pointsEarned = Math.round(cart.grandTotal);
      try {
        const balance = await addRewardsPoints(req.user.customerId, pointsEarned);
        rewards.earned = pointsEarned;
        rewards.balance = balance;
      } catch (err) {
        console.error('Failed to award rewards points:', err);
        if (balanceAfterSpend !== null) rewards.balance = balanceAfterSpend;
        enqueueEarnRetry(req.user.customerId, pointsEarned);
      }
    }

    res.json({
      orders: persistedOrders,
      grandTotal: cart.grandTotal,
      ...(rewards && { rewards }),
      message: 'Order placed!',
    });
  } catch (err) {
    console.error('Failed to persist order:', err);
    return refundAndFail(res, paymentIntentId, 500, 'Failed to save your order. Please try again.');
  }
});

// Returns the signed-in customer's own order history, newest first.
// Registered before /api/orders/:id — Express matches routes in
// registration order, and :id would otherwise swallow "mine" as an id.
app.get('/api/orders/mine', requireAuth, requireActiveCustomer, async (req, res) => {
  try {
    const orders = await queryOrdersByCustomerId(req.user.customerId);
    res.json({ orders });
  } catch (err) {
    console.error('Failed to fetch order history:', err);
    res.status(500).json({ error: 'Failed to fetch order history.' });
  }
});

// Staff's fulfillment queue — every order not yet completed (placed,
// confirmed, or ready), across every customer and guest. Registered before
// /api/orders/:id for the same reason as /api/orders/mine above.
app.get('/api/orders/active', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  try {
    const orders = await queryActiveOrders();
    res.json({ orders });
  } catch (err) {
    console.error('Failed to fetch active orders:', err);
    res.status(500).json({ error: 'Failed to fetch active orders.' });
  }
});

// Staff's recent-order history — every order marked done (picked up or
// delivered) or canceled within the last 7 days. This is a display window,
// not a retention policy: the order row itself is never deleted, so a
// customer's own order history keeps showing it indefinitely even after it
// ages out here. A canceled order gets a spot here too — otherwise it would
// disappear from every staff view the moment it left Active Orders, with no
// record it ever existed. Registered before /api/orders/:id for the same
// reason as above.
const RECENT_ORDERS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// The one terminal timestamp that applies to a given order, regardless of
// which terminal status it ended at.
function terminalTimestamp(order) {
  return order.completedAt || order.canceledAt;
}

app.get('/api/orders/recent', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  try {
    const [completed, canceled] = await Promise.all([queryCompletedOrders(), queryCanceledOrders()]);
    const cutoff = Date.now() - RECENT_ORDERS_WINDOW_MS;
    const orders = [...completed, ...canceled]
      .filter((order) => {
        const t = terminalTimestamp(order);
        return t && new Date(t).getTime() >= cutoff;
      })
      .sort((a, b) => terminalTimestamp(b).localeCompare(terminalTimestamp(a)));
    res.json({ orders });
  } catch (err) {
    console.error('Failed to fetch recent orders:', err);
    res.status(500).json({ error: 'Failed to fetch recent orders.' });
  }
});

// Staff's Past Orders lookup — a specific person's complete order history,
// identified by exactly one of customerId (registered accounts) or email
// (guests, who have no customerId at all). Same response shape as /mine, so
// the frontend can hand it straight to the same OrderHistoryList component a
// customer sees on their own My Orders page. Registered before
// /api/orders/:id for the same routing reason as /mine, /active, /recent.
app.get('/api/orders/history', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  const { customerId, email } = req.query;
  if (!customerId && !email) {
    return res.status(400).json({ error: 'customerId or email is required.' });
  }
  try {
    const orders = customerId
      ? await queryOrdersByCustomerId(customerId)
      : await queryOrdersByEmail(email);
    res.json({ orders });
  } catch (err) {
    console.error('Failed to fetch order history:', err);
    res.status(500).json({ error: 'Failed to fetch order history.' });
  }
});

const SALES_PERIODS = ['today', 'week', 'month', 'year', 'total'];

// Individual-cookie weight per box size, keyed on the sizeLabel string
// that's actually persisted on order.items (not the is_single/is_half_dozen
// flags Order.js's in-memory physicalCookieCount getter reads) — same
// weights, just re-expressed for the stored shape.
const SIZE_LABEL_UNITS = { Single: 1, 'Half Dozen': 6, 'Full Dozen': 12, Batch: 24 };

// 'month' and 'year' aren't handled here — they take an explicit year (and,
// for 'month', a month) rather than always meaning "now"'s period, so each
// needs its own start *and* end bound rather than fitting this open-ended
// shape (see the route below).
function salesPeriodStart(period, now) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return startOfDay;
    case 'week': {
      const start = new Date(startOfDay);
      start.setDate(start.getDate() - start.getDay()); // most recent Sunday
      return start;
    }
    default:
      return null; // 'total' — no lower bound
  }
}

// Shared by the top-level period totals and week's per-day breakdown below
// — same rules either way: canceled orders never happened, so they're
// excluded entirely; reward-redeemed line items (id starting with "reward-")
// are excluded from both rankings — their composite flavor label ("Free Half
// Dozen: 3 Chocolate Chip, 3 M&M") doesn't cleanly attribute to one
// flavor/size, and their $0 price already keeps revenue correct whether
// they're counted or not.
function aggregateSales(orders, externalSales) {
  const externalRevenue = externalSales.reduce((sum, sale) => sum + sale.amount, 0);
  const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0) + externalRevenue;

  const itemTotals = new Map(); // `${flavor}|${sizeLabel}` -> { flavor, sizeLabel, qty, revenue }
  const flavorTotals = new Map(); // flavor -> cookies

  for (const order of orders) {
    for (const item of order.items) {
      if (item.id.startsWith('reward-')) continue;
      const itemKey = `${item.flavor}|${item.sizeLabel}`;
      const itemEntry =
        itemTotals.get(itemKey) || { flavor: item.flavor, sizeLabel: item.sizeLabel, qty: 0, revenue: 0 };
      itemEntry.qty += item.qty;
      itemEntry.revenue += item.price * item.qty;
      itemTotals.set(itemKey, itemEntry);

      // physicalCookieUnits (persisted per-item — see Order.js) wins when
      // present, since a handful of items (e.g. gluten-free/sugar-free
      // Brownie batches) don't match their sizeLabel's usual unit count.
      // Falls back to the sizeLabel table for anything persisted before
      // that field existed.
      const unitsPerItem = item.physicalCookieUnits ?? SIZE_LABEL_UNITS[item.sizeLabel] ?? 0;
      const cookies = unitsPerItem * item.qty;
      flavorTotals.set(item.flavor, (flavorTotals.get(item.flavor) || 0) + cookies);
    }
  }

  const itemsSold = [...itemTotals.values()].sort((a, b) => b.qty - a.qty || a.flavor.localeCompare(b.flavor));
  const flavorsSold = [...flavorTotals.entries()]
    .map(([flavor, cookies]) => ({ flavor, cookies }))
    .sort((a, b) => b.cookies - a.cookies || a.flavor.localeCompare(b.flavor));

  return { totalRevenue, externalRevenue, itemsSold, flavorsSold };
}

// Staff's Sales dashboard — total revenue plus two rankings (by menu item,
// and by individual cookie count) for a given period, via aggregateSales
// above. Filtered by createdAt (when the order was placed), not
// pickup/fulfillment time — payment is confirmed by Stripe before an order
// is ever persisted, so createdAt already reflects when payment was taken.
// No GSI range-filters on createdAt alone (and "total" needs everything
// anyway), so this scans the whole table like Past Orders search's helpers do.
//
// The 'week' period additionally splits into a `days` array (Sunday through
// Saturday, one aggregateSales result each) for Sales.jsx's day-by-day
// breakdown — built by slicing the already-fetched week orders/externalSales
// rather than a second scan.
//
// 'month' takes optional ?year=&month= (1-12), and 'year' takes optional
// ?year=, both defaulting to real "now" — this is what lets Sales.jsx's
// Monthly/Yearly tabs page back and forward through arbitrary
// months/years rather than only ever showing "this month"/"this year".
// Unlike the other periods these need an explicit upper bound too (the
// month's or year's end), not just "so far" — though for the current
// month/year that upper bound never actually excludes anything, since no
// order can exist later than right now anyway.
app.get('/api/sales', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  const period = req.query.period;
  if (!SALES_PERIODS.includes(period)) {
    return res.status(400).json({ error: 'period must be one of today, week, month, year, total.' });
  }

  const now = new Date();
  let periodStart;
  let periodEnd = null;
  let year;
  let month;
  if (period === 'month') {
    year = req.query.year !== undefined ? Number(req.query.year) : now.getFullYear();
    month = req.query.month !== undefined ? Number(req.query.month) : now.getMonth() + 1;
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year must be 2000-2100 and month must be 1-12.' });
    }
    periodStart = new Date(year, month - 1, 1);
    periodEnd = new Date(year, month, 1);
  } else if (period === 'year') {
    year = req.query.year !== undefined ? Number(req.query.year) : now.getFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'year must be 2000-2100.' });
    }
    periodStart = new Date(year, 0, 1);
    periodEnd = new Date(year + 1, 0, 1);
  } else {
    periodStart = salesPeriodStart(period, now);
  }

  try {
    const [allOrders, allExternalSales] = await Promise.all([
      scanAllOrders(),
      scanAll({ TableName: EXTERNAL_SALES_TABLE }),
    ]);
    const orders = allOrders.filter(
      (order) =>
        order.status !== 'canceled' &&
        (periodStart === null || new Date(order.createdAt) >= periodStart) &&
        (periodEnd === null || new Date(order.createdAt) < periodEnd)
    );
    // Staff-recorded revenue from sales made outside the site — counted
    // toward totalRevenue only, never itemsSold/flavorsSold (no items exist
    // for these).
    const externalSales = allExternalSales.filter(
      (sale) =>
        (periodStart === null || new Date(sale.createdAt) >= periodStart) &&
        (periodEnd === null || new Date(sale.createdAt) < periodEnd)
    );

    let days;
    if (period === 'week') {
      days = [];
      for (let i = 0; i < 7; i++) {
        const dayStart = new Date(periodStart);
        dayStart.setDate(dayStart.getDate() + i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const dayOrders = orders.filter((o) => {
          const t = new Date(o.createdAt);
          return t >= dayStart && t < dayEnd;
        });
        const dayExternalSales = externalSales.filter((s) => {
          const t = new Date(s.createdAt);
          return t >= dayStart && t < dayEnd;
        });
        days.push({
          date: `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`,
          ...aggregateSales(dayOrders, dayExternalSales),
        });
      }
    }

    res.json({
      period,
      ...(period === 'month' && { year, month }),
      ...(period === 'year' && { year }),
      ...aggregateSales(orders, externalSales),
      ...(days && { days }),
    });
  } catch (err) {
    console.error('Failed to compute sales:', err);
    res.status(500).json({ error: 'Failed to compute sales.' });
  }
});

// Records a sale made outside the site (in person, a market, etc.) as a
// bare dollar amount — no items/flavors, it only ever affects /api/sales'
// totalRevenue. createdAt is stamped server-side, not client-supplied, same
// as every other timestamp in this app.
app.post('/api/sales/external', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number.' });
  }
  try {
    const sale = { id: randomUUID(), amount, createdAt: new Date().toISOString() };
    await docClient.send(new PutCommand({ TableName: EXTERNAL_SALES_TABLE, Item: sale }));
    res.json(sale);
  } catch (err) {
    console.error('Failed to record external sale:', err);
    res.status(500).json({ error: 'Failed to record external sale.' });
  }
});

// Requires auth: a customer may only fetch their own orders, staff may
// fetch any. Guest orders have no customerId to match against, so they're
// only reachable by staff through this endpoint.
app.get('/api/orders/:id', requireAuth, requireActiveCustomer, async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (order.customerId !== req.user.customerId && req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Not authorized to view this order.' });
    }
    res.json(order);
  } catch (err) {
    console.error('Failed to fetch order:', err);
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// Staff confirming or adjusting a customer's requested pickup time. "Confirm"
// and "Edit" are the same call: the frontend sends the order's existing
// pickupDate/pickupTime unchanged for a plain confirm, or new values (plus an
// optional customer-visible note) for an edit — either way the result is the
// same: a re-validated pickup time. Staff edits are held to the exact same
// business-hours rule a customer's own request would be (validatePickupDateTime),
// not a looser staff-only path. Confirming/editing
// the pickup time doubles as confirming the order itself — staff shouldn't
// need a separate "Change Order Status" click for what's really one action.
// Only bumps status forward out of 'placed'; an order already at 'confirmed'
// or beyond isn't moved backward or re-stamped by a later pickup-time edit.
app.post(
  '/api/orders/:id/confirm-pickup',
  requireAuth,
  requireActiveCustomer,
  requireStaff,
  async (req, res) => {
    try {
      const order = await getOrderById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      if (order.fulfillment?.method !== 'pickup') {
        return res.status(400).json({ error: 'This order is not a pickup order.' });
      }
      const { pickupDate, pickupTime, note } = req.body;
      const pickupError = validatePickupDateTime(pickupDate, pickupTime);
      if (pickupError) {
        return res.status(400).json({ error: pickupError });
      }
      const noticeError = validateExtendedPickupNotice(
        { method: 'pickup', pickupDate, pickupTime },
        order.items.some((item) => isDietaryRestrictedType(item.type))
      );
      if (noticeError) {
        return res.status(400).json({ error: noticeError });
      }
      const changed = pickupDate !== order.fulfillment.pickupDate || pickupTime !== order.fulfillment.pickupTime;
      const staffNote = note && String(note).trim() ? String(note).trim() : undefined;
      const fulfillment = {
        method: 'pickup',
        pickupDate,
        pickupTime,
        ...(staffNote && { staffNote }),
      };
      await updateOrderFulfillment(req.params.id, fulfillment);

      let statusUpdate = null;
      if (order.status === 'placed') {
        statusUpdate = { status: 'confirmed', confirmedAt: order.confirmedAt || new Date().toISOString(), readyAt: null };
        await setOrderStatus(req.params.id, statusUpdate);
      }

      // Only the pickup-time email, not also a separate status-change one —
      // its own message already says "confirmed" (see buildPickupTimeEmail),
      // so a second email here would just repeat the same news twice.
      const email = buildPickupTimeEmail({ contact: order.contact, pickupDate, pickupTime, changed, note: staffNote, order });
      try {
        await sendEmail(order.contact.email, email.subject, email.text, email.html);
      } catch (err) {
        console.error('Failed to send pickup-time email:', err);
        enqueueEmailRetry(order.contact.email, email.subject, email.text, email.html);
      }

      res.json({ fulfillment, ...statusUpdate });
    } catch (err) {
      console.error('Failed to confirm pickup:', err);
      res.status(500).json({ error: 'Failed to confirm pickup.' });
    }
  }
);

// Free correction among the three active stages — staff can jump an order
// directly to any of placed/confirmed/ready, forward or backward, right up
// until it's completed. This is the recovery path for misclicks (e.g.
// accidentally confirming the wrong order: just set it back to 'placed').
// Backfills/clears timestamps so a later Recent Orders timeline stays
// coherent no matter how staff got there:
//  - -> placed: clear confirmedAt and readyAt (nothing has happened yet).
//  - -> confirmed: keep an existing confirmedAt (don't lose the original
//    confirm time on a ready -> confirmed correction), clear readyAt.
//  - -> ready: stamp readyAt now; backfill confirmedAt too if it was somehow
//    never set (e.g. a direct placed -> ready jump), so "Ready" never shows
//    without a preceding "Confirmed".
// 'completed' is deliberately not one of the allowed targets here — it's
// only reachable through the one-way /complete endpoint below.
const ACTIVE_STATUSES = ['placed', 'confirmed', 'ready'];

app.post(
  '/api/orders/:id/set-status',
  requireAuth,
  requireActiveCustomer,
  requireStaff,
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!ACTIVE_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
      }
      const order = await getOrderById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      if (order.status === 'completed' || order.status === 'canceled') {
        return res.status(400).json({ error: 'This order can no longer be edited.' });
      }
      const now = new Date().toISOString();
      const updates = { status };
      if (status === 'placed') {
        updates.confirmedAt = null;
        updates.readyAt = null;
      } else if (status === 'confirmed') {
        updates.confirmedAt = order.confirmedAt || now;
        updates.readyAt = null;
      } else {
        updates.confirmedAt = order.confirmedAt || now;
        updates.readyAt = now;
      }
      await setOrderStatus(req.params.id, updates);

      const email = buildStatusChangeEmail({ contact: order.contact, method: order.fulfillment.method, status, order });
      if (email) {
        try {
          await sendEmail(order.contact.email, email.subject, email.text, email.html);
        } catch (err) {
          console.error('Failed to send order-status email:', err);
          enqueueEmailRetry(order.contact.email, email.subject, email.text, email.html);
        }
      }

      res.json(updates);
    } catch (err) {
      console.error('Failed to update order status:', err);
      res.status(500).json({ error: 'Failed to update order status.' });
    }
  }
);

// The one remaining one-way transition: marking a ready order picked
// up/delivered. Unlike set-status above, this isn't freely correctable —
// once an order is completed it leaves Active Orders for Recent Orders and
// this app has no path back (matches the "until it's completed" boundary
// on staff's free-editing window).
app.post(
  '/api/orders/:id/complete',
  requireAuth,
  requireActiveCustomer,
  requireStaff,
  async (req, res) => {
    try {
      const order = await getOrderById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      if (order.status !== 'ready') {
        return res.status(400).json({ error: 'Order must be marked ready before it can be completed.' });
      }
      const completedAt = new Date().toISOString();
      await setOrderStatus(req.params.id, { status: 'completed', completedAt });

      const email = buildStatusChangeEmail({ contact: order.contact, method: order.fulfillment.method, status: 'completed', order });
      if (email) {
        try {
          await sendEmail(order.contact.email, email.subject, email.text, email.html);
        } catch (err) {
          console.error('Failed to send order-status email:', err);
          enqueueEmailRetry(order.contact.email, email.subject, email.text, email.html);
        }
      }

      res.json({ status: 'completed', completedAt });
    } catch (err) {
      console.error('Failed to complete order:', err);
      res.status(500).json({ error: 'Failed to complete order.' });
    }
  }
);

// The other terminal transition: stopping an order entirely, from any active
// stage (unlike /complete, this doesn't require reaching 'ready' first —
// staff can cancel at any point before an order is done). Also one-way: once
// canceled, set-status's guard above refuses to move it anywhere else.
// Existing confirmedAt/readyAt are left untouched — "this was confirmed,
// then canceled" is real history worth keeping, not something to erase.
app.post(
  '/api/orders/:id/cancel',
  requireAuth,
  requireActiveCustomer,
  requireStaff,
  async (req, res) => {
    try {
      const order = await getOrderById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      if (order.status === 'completed' || order.status === 'canceled') {
        return res.status(400).json({ error: 'This order can no longer be canceled.' });
      }
      const canceledAt = new Date().toISOString();
      await setOrderStatus(req.params.id, { status: 'canceled', canceledAt });

      const email = buildStatusChangeEmail({ contact: order.contact, method: order.fulfillment.method, status: 'canceled', order });
      if (email) {
        try {
          await sendEmail(order.contact.email, email.subject, email.text, email.html);
        } catch (err) {
          console.error('Failed to send order-status email:', err);
          enqueueEmailRetry(order.contact.email, email.subject, email.text, email.html);
        }
      }

      res.json({ status: 'canceled', canceledAt });
    } catch (err) {
      console.error('Failed to cancel order:', err);
      res.status(500).json({ error: 'Failed to cancel order.' });
    }
  }
);

// Cognito doesn't know about our DynamoDB Customers table, so the frontend
// calls this right after sign-in/sign-up-confirmation to upsert a row from
// the verified token's claims. Safe to call repeatedly (plain overwrite).
app.post('/api/customers/sync', requireAuth, async (req, res) => {
  try {
    // Every account is auto-enrolled in the 'customer' Cognito group here —
    // covers brand-new sign-ups (their token has no groups yet) and also
    // self-heals any pre-existing account that predates this group. Skipped
    // for staff: they're moved into their own group by hand in the AWS
    // Console, and this must never fight that by adding them back to
    // 'customer'. The `groups.includes` check (real membership, not just
    // `role`) also avoids a redundant AWS call once a fresh token already
    // reflects the group. addToCustomerGroup never throws — a transient AWS
    // error (e.g. missing IAM permission) must not block the DB sync below.
    if (req.user.role !== 'staff' && !req.user.groups.includes('customer')) {
      await addToCustomerGroup(req.user.customerId);
    }
    const record = await upsertCustomer({
      customerId: req.user.customerId,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      role: req.user.role,
      updatedAt: new Date().toISOString(),
    });
    res.json(record);
  } catch (err) {
    console.error('Failed to sync customer:', err);
    res.status(500).json({ error: 'Failed to sync customer.' });
  }
});

const SEARCHABLE_FIELDS = ['firstName', 'lastName', 'email'];
const SECONDARY_SORT_FIELD = { firstName: 'lastName', lastName: 'firstName', email: 'lastName' };

// Staff's Past Orders search — matches registered customers and guest
// checkouts (guests never get a Customers row, so they're found by grouping
// their orders by email instead) against one chosen field. An empty q
// returns every distinct guest, unfiltered — guests have no other way to be
// found later, so this is literally the "show guest orders by default"
// behavior, with no separate default-mode branch needed on the frontend.
app.get('/api/customers/search', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  const field = req.query.field;
  if (!SEARCHABLE_FIELDS.includes(field)) {
    return res.status(400).json({ error: 'field must be one of firstName, lastName, email.' });
  }
  const q = String(req.query.q || '').trim().toLowerCase();
  try {
    const guestOrders = await scanGuestOrders();
    // One entry per distinct email (grouping key lowercased so casing
    // differences don't split one guest into two rows; the *returned* email
    // keeps its original stored casing, so a follow-up /api/orders/history
    // lookup still exact-matches the GSI), keeping the contact info from
    // that email's most-recently-placed order.
    const guestsByEmail = new Map();
    for (const order of guestOrders) {
      const key = order.email.toLowerCase();
      const existing = guestsByEmail.get(key);
      if (!existing || order.createdAt > existing.createdAt) {
        guestsByEmail.set(key, {
          type: 'guest',
          email: order.email,
          firstName: order.contact.firstName,
          lastName: order.contact.lastName,
          createdAt: order.createdAt,
        });
      }
    }
    let guestAccounts = [...guestsByEmail.values()];
    let customerAccounts = [];

    if (!q) {
      customerAccounts = [];
    } else {
      // Prefix match, not substring — "t" should find "Test"/"tony", not
      // "Keithrick" (which merely contains a t partway through and would
      // otherwise sort ahead of both purely on alphabetical accident).
      guestAccounts = guestAccounts.filter((g) => g[field].toLowerCase().startsWith(q));
      const customers = await scanAllCustomers();
      // Any registered account that matches, staff included, and regardless
      // of whether they've ever placed an order — existing is the only bar,
      // not order history (guests are the opposite: an order is literally
      // how they're found at all, since they have no account otherwise).
      customerAccounts = customers
        .filter((c) => String(c[field] || '').toLowerCase().startsWith(q))
        .map((c) => ({
          type: 'customer',
          customerId: c.customerId,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
        }));
    }

    // Sorted by whichever field staff searched by — a first-name search
    // reads oddly if results come back ordered by last name instead.
    const secondaryField = SECONDARY_SORT_FIELD[field];
    const accounts = [...customerAccounts, ...guestAccounts]
      .sort((a, b) => a[field].localeCompare(b[field]) || a[secondaryField].localeCompare(b[secondaryField]))
      .map(({ createdAt, ...rest }) => rest);
    res.json({ accounts });
  } catch (err) {
    console.error('Failed to search customers:', err);
    res.status(500).json({ error: 'Failed to search customers.' });
  }
});

// Falls back to the token's own claims if the sync call hasn't landed yet,
// so this never 404s for a valid token.
app.get('/api/customers/me', requireAuth, async (req, res) => {
  try {
    const record = await getCustomerById(req.user.customerId);
    res.json(
      record ?? {
        customerId: req.user.customerId,
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        role: req.user.role,
        rewards: 0,
      }
    );
  } catch (err) {
    console.error('Failed to fetch customer:', err);
    res.status(500).json({ error: 'Failed to fetch customer.' });
  }
});

// Deletes only our own record — the frontend calls this while its session is
// still valid, then separately deletes the Cognito identity itself (that
// step has to come second: once the Cognito user is gone, its token can no
// longer authenticate this request at all).
app.delete('/api/customers/me', requireAuth, async (req, res) => {
  try {
    await deleteCustomer(req.user.customerId);
    res.json({ message: 'Account data deleted.' });
  } catch (err) {
    console.error('Failed to delete customer:', err);
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

// Registered last — Express only routes to a 4-arg middleware for errors,
// which is exactly what asyncHandler (installAsyncErrorHandling above)
// forwards a rejected route handler's error into via next(err). Every
// endpoint now fails the same way (a clean JSON 500) instead of the request
// hanging or the process going down.
app.use((err, req, res, next) => {
  console.error(`Unhandled error in ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Last-resort safety net for anything that still somehow bypasses the
// per-route wrapping above (e.g. a bug outside any request, not inside one
// of this app's own setTimeout-based retry queues, which already catch
// their own errors). Node's default behavior on either of these is to
// crash anyway — this just logs clearly first, then exits deliberately so
// the process supervisor (node --watch locally; a real one in production)
// restarts a clean process rather than one left in a possibly-corrupted state.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection reached the process boundary:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`Cozy Dough Cookies API listening on http://localhost:${PORT}`);
});
