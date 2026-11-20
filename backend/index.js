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
import { Cookie, TEMPERATURE_CONTROLLED_FLAVORS, isDietaryRestrictedType, dietaryMarker } from './models/Cookie.js';
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
  cancelOrderRecord,
  updateOrderPoints,
  deterministicOrderId,
  DuplicateOrderError,
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
import { allocateEarnedPoints, allocateSpentPoints, pointsToReverse } from './rewards/points.js';
import { minimumOrderError, rewardsBalanceError } from './checkout/rules.js';
import { placeFreeOrders } from './checkout/freeCheckout.js';
import { PICKUP_NOTICE_VERSION } from './pickup/notice.js';
import { validateAddress } from './shipping/usps.js';
import { enqueue as enqueueAddressRetry } from './shipping/retryQueue.js';
import { enqueue as enqueueEarnRetry } from './rewards/earnRetryQueue.js';
import { checkIpRateLimit } from './shipping/ipRateLimit.js';
import { checkEmailSendRateLimit } from './email/rateLimit.js';
import { sendVerificationCodeEmail, sendEmail, staffRecipients } from './email/ses.js';
import { buildReceiptEmail } from './email/receipt.js';
import { buildPickupTimeEmail, buildStatusChangeEmail, buildRefundEmail } from './email/orderStatusEmail.js';
import { buildStaffNewOrderEmail } from './email/staffNotification.js';
import { enqueue as enqueueEmailRetry } from './email/emailRetryQueue.js';
import { getStripeClient, isLiveMode } from './stripe/client.js';
import { summarizePaymentMethod } from './stripe/paymentMethod.js';
import { refundOrderPayment, refundWholePayment, orderRefundCents } from './stripe/refunds.js';
import { handleStripeEvent } from './stripe/webhookEvents.js';
import { notifyStaff } from './email/staffAlert.js';
import {
  EMAIL_RE,
  PICKUP_DATE_RE,
  PICKUP_TIME_RE,
  PICKUP_OPEN_MINUTES,
  PICKUP_CLOSE_MINUTES,
  PICKUP_EXTENDED_NOTICE_MS,
  STATE_RE,
  ZIP_RE,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
} from './constants.js';

// How a redeemed reward's flavors read on the order: just the name when the
// whole reward is one flavor ("Oatmeal"), otherwise the cookie count of each
// ("6 Chocolate Chip, 6 Snickerdoodle"). `flavors` has one entry per portion of
// the reward and `cookiesPerPortion` is that portion's size (entry.slotCookies),
// so a flavor picked for several portions is added up into one entry.
function summarizeFlavors(flavors, cookiesPerPortion) {
  const counts = new Map();
  for (const flavor of flavors) counts.set(flavor, (counts.get(flavor) || 0) + 1);
  if (counts.size === 1) return flavors[0];
  return [...counts.entries()].map(([flavor, n]) => `${n * cookiesPerPortion} ${flavor}`).join(', ');
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

// How many reverse proxies sit in front of this server (0 when it's reached
// directly, as in local dev). req.ip — which the per-IP rate limits below key
// on — is the socket's address unless Express is told to trust the proxy's
// X-Forwarded-For header, and behind a proxy that address is the proxy itself:
// every visitor would share one rate-limit bucket. Only raise this when the
// backend port is reachable solely through the proxy (otherwise a client could
// spoof the header); the production compose file sets it to 1 for Caddy.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 0);

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

// The menu catalog. It lives in code (Cookie.TYPES), not in DynamoDB — only
// customers, orders and the other records in db/schema.js are persisted — so
// a menu change is a code change plus a redeploy.
// One product per flavor per applicable size, built from Cookie's own
// type->flavor->sizes table so the list isn't duplicated here — each type
// declares its own `sizes` (e.g. gluten-free/sugar-free only ever have
// 'batch'), so this doesn't need to know which types support which sizes.
// Every checkout and sold-out lookup resolves a product by its id in this
// list, so anything not built here can't be ordered.
const PRODUCTS = [];
const seenProductIds = new Set();
for (const [type, info] of Object.entries(Cookie.TYPES)) {
  for (const flavor of info.flavors) {
    for (const size of info.sizes) {
      const product = new Cookie(type, flavor, size);
      // Ids are derived from type/flavor/size (see Cookie.idFor), so two
      // different products slugging to the same id would make one unreachable
      // — better to refuse to start than to quietly sell the wrong thing.
      if (seenProductIds.has(product.id)) {
        throw new Error(`Duplicate product id "${product.id}" — rename one of the flavors.`);
      }
      seenProductIds.add(product.id);
      PRODUCTS.push(product);
    }
  }
}

// Liveness check — returns 200 whenever the process is up and serving requests.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cozy Dough Cookies API is running' });
});

app.get('/api/products', (req, res) => {
  res.json(PRODUCTS);
});

// Staff-only menu control: marks an item in or out of stock. Mutates the
// same in-memory PRODUCTS entry /api/products serves, so it's visible to
// every customer on their next fetch. The flag lives only in that in-memory
// entry (see the PRODUCTS comment above), so it doesn't persist across a
// backend restart — everything comes back in stock.
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
  let customer = null;
  if (req.user) {
    customer = await getCustomerById(req.user.customerId);
    if (!customer) req.user = null;
  }

  const contactError = validateContact(req.body.contact);
  if (contactError) return { error: contactError, status: 400 };
  const fulfillmentError = validateFulfillment(req.body.fulfillment);
  if (fulfillmentError) return { error: fulfillmentError, status: 400 };

  // A pickup order can only be placed by someone who ticked "I understand" on
  // the pickup notice (see pickup/notice.js). The browser sends the version of
  // the notice it showed; anything else — missing, or a version this server
  // doesn't currently require — is refused, which is also what stops a stale
  // browser tab from agreeing to wording it never saw. It is checked here, in
  // the code shared by every checkout request, so the payment can't even be
  // started without it. The agreement is saved on the order (pickupNotice), not
  // inside `fulfillment`: staff confirming a pickup time replaces that whole
  // object (see confirm-pickup), which would erase it.
  const isPickup = req.body.fulfillment.method === 'pickup';
  if (isPickup && req.body.fulfillment.acknowledgedPickupNotice !== PICKUP_NOTICE_VERSION) {
    return {
      error:
        "Please read and agree to the pickup notice before placing your order. If you don't see it, refresh the page and try again.",
      status: 400,
    };
  }

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
      // One flavor per portion of the reward (see flavorSlots in
      // rewards/catalog.js). A portion is always at least six cookies, so
      // checking the count of picks is what enforces "at least six of each
      // flavor" and "no more flavors than the reward has portions" — there is
      // no way to express a flavor with fewer than six, however the request is
      // crafted.
      if (!Array.isArray(flavors) || flavors.length !== entry.flavorSlots) {
        return {
          error:
            entry.flavorSlots === 1
              ? `${entry.label} needs exactly 1 flavor.`
              : `${entry.label} needs its ${entry.cookies} cookies divided into ${entry.flavorSlots} portions of ${entry.slotCookies}, each with a flavor.`,
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
        return { error: `${cookie.flavor} (${cookie.sizeLabel}) is sold out.`, status: 400 };
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
        flavor: `${entry.label}: ${summarizeFlavors(flavors, entry.slotCookies)}`,
        sizeLabel: entry.sizeLabel,
        price: 0,
        // Marks the line as a redeemed reward, which exempts its order from the
        // minimum-order rule below. pointsCost is saved with the order item (see
        // Order.toJSON) so receipts and order screens can say what it cost in
        // points even if reward prices change later.
        isReward: true,
        pointsCost: entry.points,
        // Real per-flavor answer now that a flavor is actually chosen, rather
        // than entry.is_temperature_controlled's conservative per-type guess.
        is_temperature_controlled: flavors.some((f) => TEMPERATURE_CONTROLLED_FLAVORS.has(f)),
        // The reward's size is baked into its identity (e.g. "Three Dozen"
        // is 36 cookies) rather than the line-item qty below, which stays 1
        // — so physicalCookieCount needs this precomputed total rather than
        // deriving it from a single is_full_dozen-style flag the way a real
        // menu item would.
        physicalCookieUnits: entry.cookies,
      },
      1
    );
  }

  // Orders that redeem a reward are exempt from the minimum (see rules.js).
  const minimumError = minimumOrderError(cart);
  if (minimumError) return { error: minimumError, status: 400 };

  if (fulfillment.method === 'shipping' && cart.orders.some((order) => order.requiresPickup)) {
    // Say why: refrigerated items versus items the shop just doesn't ship.
    const hasRefrigerated = cart.orders.some((order) => order.items.some((item) => item.cookie.is_temperature_controlled));
    return {
      error: hasRefrigerated
        ? 'This order contains temperature-controlled items that can only be picked up, not shipped.'
        : 'This order contains items that are available for pickup only, not shipping.',
      status: 400,
    };
  }

  const noticeError = validateExtendedPickupNotice(
    fulfillment,
    cart.orders.some((order) => order.requiresExtendedPickupNotice)
  );
  if (noticeError) return { error: noticeError, status: 400 };

  // The balance is returned (not checked here) because the callers differ: a
  // payment must check it BEFORE anything is charged (see the two payment
  // endpoints below), while a points-only checkout leaves the decision to its
  // all-or-nothing transaction, so that a repeated request reads as "already
  // placed" rather than "not enough points".
  return {
    contact,
    fulfillment,
    cart,
    resolvedRedemptions,
    totalPointsRequired,
    rewardsBalance: customer?.rewards,
    // Which notice a pickup customer agreed to (undefined for shipping); the
    // finalize step saves it on each order.
    pickupNoticeVersion: isPickup ? PICKUP_NOTICE_VERSION : undefined,
  };
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
// for it. Refunding first is what keeps that from happening. The customer-
// facing error is the same whether or not the refund worked, so a failed
// refund isn't re-thrown — but it does alert staff straight away, since it
// leaves a customer out of pocket with nothing created for them. A failed
// refund also leaves the finalized-metadata guard in place against reusing
// the payment. Returns the refund record, or null if it didn't go through.
async function refundPayment(paymentIntentId) {
  try {
    return await refundWholePayment(paymentIntentId);
  } catch (err) {
    console.error(`Failed to refund payment ${paymentIntentId} after a failed checkout:`, err);
    await notifyStaff({
      subject: 'A checkout failed after the customer was charged, and the automatic refund failed',
      lines: [
        `Payment ${paymentIntentId} succeeded, then the checkout couldn't be completed, and refunding it automatically also failed (${err.message}).`,
        `The customer has been charged and has no order. Refund it by hand: https://dashboard.stripe.com/${isLiveMode() ? '' : 'test/'}payments/${paymentIntentId}`,
      ],
    });
    return null;
  }
}

// Orders that were already saved when a later step of the same checkout
// failed (the payment is about to be refunded in full, so none of them can
// stand). Marked canceled rather than deleted, so staff never bake for a
// refunded order but the history of what happened stays. Best-effort per
// order: one failing to update must not stop the rest.
async function cancelPersistedOrders(orders, refund) {
  const canceledAt = new Date().toISOString();
  for (const order of orders) {
    try {
      await setOrderStatus(order.orderId, {
        status: 'canceled',
        canceledAt,
        cancelReason: 'checkout_failed',
        ...(refund && { refund }),
        // The checkout failed before any points were spent or awarded, so
        // these orders have none to give back.
        ...(order.customerId && { pointsEarned: 0, pointsSpent: 0 }),
      });
    } catch (err) {
      console.error(`Couldn't cancel order ${order.orderId} after a failed checkout:`, err);
    }
  }
}

// Best-effort correction of the points orders recorded for themselves (see
// updateOrderPoints): one failing to update must not stop the rest, or fail
// a checkout that has otherwise succeeded.
async function clearOrderPoints(orders, fields) {
  await Promise.all(
    orders.map((order) =>
      updateOrderPoints(order.orderId, fields).catch((err) =>
        console.error(`Couldn't correct the points recorded on order ${order.orderId}:`, err)
      )
    )
  );
}

async function refundAndFail(res, paymentIntentId, status, message, { savedOrders = [] } = {}) {
  const refund = await refundPayment(paymentIntentId);
  await cancelPersistedOrders(savedOrders, refund);
  res.status(status).json({ error: message });
}

// The customer's receipt and staff's new-order notification, for a checkout
// whose orders have just been saved (paid or points-only). A receipt is a
// nice-to-have, not part of the transaction itself — a failed send (or SES
// being unconfigured entirely, e.g. local dev) must never fail an otherwise-
// successful checkout. Built once so a retry re-sends the exact same content
// rather than re-deriving it. Never throws.
async function sendOrderEmails({ contact, fulfillment, orders }) {
  try {
    const receipt = buildReceiptEmail({ contact, fulfillment, orders });
    try {
      await sendEmail(contact.email, receipt.subject, receipt.text, receipt.html);
    } catch (err) {
      console.error('Failed to send receipt email:', err);
      enqueueEmailRetry(contact.email, receipt.subject, receipt.text, receipt.html);
    }

    // Same best-effort treatment for staff's new-order notification — a
    // failed/unconfigured send here must not fail the checkout either.
    const staffTo = staffRecipients();
    if (staffTo.length > 0) {
      const staffEmail = buildStaffNewOrderEmail({ contact, fulfillment, orders });
      try {
        await sendEmail(staffTo, staffEmail.subject, staffEmail.text, staffEmail.html);
      } catch (err) {
        console.error('Failed to send staff new-order notification:', err);
        enqueueEmailRetry(staffTo, staffEmail.subject, staffEmail.text, staffEmail.html);
      }
    }
  } catch (err) {
    console.error("Couldn't build the order emails:", err);
  }
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
  const { contact, cart, fulfillment, totalPointsRequired, rewardsBalance } = resolved;
  // Before anything is created: the balance must cover every reward in the
  // cart, so the customer hears it now, not after entering card details.
  const balanceError = rewardsBalanceError(totalPointsRequired, rewardsBalance);
  if (balanceError) {
    return res.status(400).json({ error: balanceError });
  }
  const amount = Math.round(computeGrandTotal(cart, fulfillment) * 100);
  if (amount <= 0) {
    // Everything in this checkout is redeemed with points, so there is nothing
    // for Stripe to charge: tell the browser to skip the payment step and go
    // straight to /api/checkout (see placeFreeOrders). Only a checkout that
    // really does redeem rewards can be free.
    if (totalPointsRequired > 0) {
      return res.json({ amount: 0, free: true });
    }
    return res.status(400).json({ error: 'Nothing to charge.' });
  }

  try {
    const paymentIntent = await getStripeClient().paymentIntents.create({
      amount,
      currency: 'usd',
      // Shown next to the payment in the Stripe Dashboard, so a charge with no
      // matching order (or a dispute) can be traced back to a customer.
      metadata: { contactEmail: contact.email },
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
    });
  } catch (err) {
    console.error('Failed to create payment intent:', err);
    res.status(500).json({ error: 'Failed to start payment. Please try again.' });
  }
});

// Stripe's raw webhook payload, verified by signature — the authoritative,
// server-to-server word on what happened to money, independent of whatever
// the browser reported (a closed tab or dropped connection could lose that
// entirely). What each event leads to — alerting staff about a customer
// charged with no order, a chargeback, or a refund that failed — lives in
// stripe/webhookEvents.js, along with the list of events the endpoint must be
// subscribed to. Needs req.rawBody (see the express.json() verify hook
// above), not the parsed req.body — the signature is computed over the exact
// original bytes.
app.post('/api/stripe/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(req.rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // One line, not the whole error object: anyone can POST to this public
    // URL, and the object dumps ~40 lines including the request's payload and
    // header. Stripe's message runs on past its first line into boilerplate.
    const reason = String(err.message).split('\n')[0].trim();
    console.error(`Stripe webhook signature verification failed (from ${req.ip}): ${reason}`);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // A non-2xx answer makes Stripe send the event again later.
    console.error(`Failed to handle Stripe event ${event.id} (${event.type}):`, err);
    return res.status(500).json({ error: 'Webhook handling failed.' });
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
  const { contact, fulfillment, cart, totalPointsRequired, resolvedRedemptions, pickupNoticeVersion } = resolved;

  // A checkout that costs nothing because it is paid for entirely in reward
  // points has no Stripe payment to verify. It is its own path: the server has
  // just computed that the amount is exactly $0 itself (never trusting the
  // client), and the orders plus the points deduction are saved atomically. Any
  // paymentIntentId in the request is ignored — nothing is charged.
  if (Math.round(computeGrandTotal(cart, fulfillment) * 100) === 0) {
    const placed = await placeFreeOrders({
      user: req.user,
      contact,
      fulfillment,
      cart,
      resolvedRedemptions,
      totalPointsRequired,
      checkoutKey: req.body.checkoutKey,
      pickupNoticeVersion,
    });
    if (placed.error) {
      return res.status(placed.status).json({ error: placed.error });
    }
    await sendOrderEmails({ contact, fulfillment, orders: placed.orders });
    // Read back rather than computed, so the balance shown is the real one.
    const customer = await getCustomerById(req.user.customerId).catch(() => null);
    return res.json({
      orders: placed.orders,
      grandTotal: 0,
      rewards: { spent: totalPointsRequired, earned: 0, ...(customer && { balance: customer.rewards }) },
      message: 'Order placed!',
    });
  }

  // A paid checkout may only redeem rewards the customer can afford, and that
  // must be known BEFORE Stripe is consulted: once a card has been charged there
  // is no good way to take back a reward that couldn't be paid for, so "sort the
  // points out afterwards" would hand out free rewards. (Spending the points
  // below is still atomic, and settles a race between two simultaneous
  // checkouts; this is what stops a request for rewards it can't afford.)
  const balanceError = rewardsBalanceError(totalPointsRequired, resolved.rewardsBalance);
  if (balanceError) {
    return res.status(400).json({ error: balanceError });
  }

  // Every checkout must be backed by a real, already-succeeded Stripe
  // payment for the exact amount this request computes — never trust a
  // client-supplied "it succeeded" flag. Retrieving fresh from Stripe (not
  // trusting whatever the frontend's confirmPayment() callback reported)
  // catches a tampered/replayed paymentIntentId, a still-pending payment, or
  // a mismatched amount before anything is persisted. The finalized-metadata
  // check stops the same successful payment being used for a second order.
  // The charge is expanded so the order can record which card or wallet was
  // actually used (see summarizePaymentMethod).
  const paymentIntentId = req.body.paymentIntentId;
  if (!paymentIntentId) {
    return res.status(400).json({ error: 'Payment is required to complete checkout.' });
  }
  const expectedAmount = Math.round(computeGrandTotal(cart, fulfillment) * 100);
  let paymentIntent;
  try {
    paymentIntent = await getStripeClient().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
  } catch (err) {
    console.error('Failed to retrieve payment intent:', err);
    return res.status(400).json({ error: 'Could not verify payment. Please try again.' });
  }
  if (paymentIntent.status !== 'succeeded') {
    return res.status(400).json({ error: 'Payment has not been completed.' });
  }
  if (paymentIntent.amount !== expectedAmount) {
    return res.status(400).json({ error: 'Payment amount does not match this order.' });
  }
  if (paymentIntent.metadata?.finalized === 'true') {
    return res.status(400).json({ error: 'This payment has already been used for an order.' });
  }
  // Marked immediately after verifying, before anything else happens. This is
  // what rejects a *later* attempt to reuse the payment — including one whose
  // checkout failed and was refunded (the payment still reads "succeeded"
  // afterwards). Two requests arriving at the same moment can both get past the
  // check above before either marks it, so this alone isn't enough; the
  // exactly-once guarantee comes from createOrder below.
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

  // Saving the orders is also what makes this payment exactly-once. Their ids
  // are derived from the payment (deterministicOrderId) and createOrder won't
  // overwrite an existing one, so if two finalize requests for the same
  // payment race past the checks above (a double-click, a retry), DynamoDB
  // lets only one of them write — the other fails on the very first order.
  // That loser stops right there: the payment is the winner's now, so it must
  // not refund anything or spend any reward points. This runs before reward
  // points are spent for the same reason, so a duplicate can never deduct
  // them twice.
  const paymentMethod = summarizePaymentMethod(paymentIntent);
  // Each order notes its own share of the points this checkout earns and
  // spends, so canceling it later can move exactly that share back (see
  // rewards/points.js). These are the amounts the checkout intends to move —
  // written with the order, and corrected below if the points then fail to.
  const earnedShares = req.user ? allocateEarnedPoints(cart.orders.map((o) => o.total), cart.grandTotal) : [];
  const spentShares = req.user ? allocateSpentPoints(resolvedRedemptions, cart.orders.length) : [];
  const persistedOrders = [];
  try {
    for (const [index, order] of cart.orders.entries()) {
      const { items, total: subtotal } = order.toJSON();
      const shippingFee = fulfillment.method === 'shipping' ? order.shippingFee : 0;
      const createdAt = new Date().toISOString();
      const record = {
        orderId: deterministicOrderId(paymentIntentId, index),
        status: 'placed',
        items,
        subtotal,
        ...(fulfillment.method === 'shipping' && { shippingFee }),
        total: subtotal + shippingFee,
        contact,
        email: contact.email,
        fulfillment,
        payment: {
          provider: 'stripe',
          paymentIntentId,
          amount: paymentIntent.amount,
          status: 'succeeded',
          ...(paymentMethod && { method: paymentMethod }),
        },
        createdAt,
        // The agreement to the pickup notice that came with this order (see
        // pickup/notice.js): the notice's version, and the server time the order
        // was saved with it attached — the same instant as createdAt.
        ...(pickupNoticeVersion && { pickupNotice: { version: pickupNoticeVersion, acknowledgedAt: createdAt } }),
        ...(req.user && {
          customerId: req.user.customerId,
          pointsEarned: earnedShares[index],
          pointsSpent: spentShares[index],
        }),
      };
      persistedOrders.push(await createOrder(record));
    }
  } catch (err) {
    if (err instanceof DuplicateOrderError && persistedOrders.length === 0) {
      return res.status(409).json({ error: 'This payment has already been used for an order.' });
    }
    console.error('Failed to persist order:', err);
    return refundAndFail(res, paymentIntentId, 500, 'Failed to save your order. Please try again.', {
      savedOrders: persistedOrders,
    });
  }

  // From here the orders exist and the customer has paid for them, so nothing
  // below may refund the payment or fail the request. Every step is a
  // follow-up that logs — and where it matters, retries — its own failure.

  // Lets someone looking at this payment in the Stripe Dashboard find its orders.
  getStripeClient()
    .paymentIntents.update(paymentIntentId, {
      metadata: { orderIds: persistedOrders.map((o) => o.orderId).join(',').slice(0, 500) },
    })
    .catch((err) => console.error(`Couldn't tag payment ${paymentIntentId} with its order ids:`, err));

  if (addressNeedsRetry) {
    enqueueAddressRetry(persistedOrders.map((o) => o.orderId), fulfillment.shippingAddress);
  }

  // Spent only now, after the orders are safely saved — so a failure here
  // can't just reject the request with nothing created (the customer has
  // already been genuinely charged), and a failed save above never leaves
  // points deducted for an order that doesn't exist. See redemptionSpendFailed
  // below: the order stands regardless (the reward item was already included
  // in what was charged), the points just can't be deducted.
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
      // Those points were never taken, so canceling these orders must not give
      // them back.
      await clearOrderPoints(persistedOrders, { pointsSpent: 0 });
    }
  }

  await sendOrderEmails({ contact, fulfillment, orders: persistedOrders });

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
      // If awarding ultimately gives up, the orders must stop claiming points
      // they never earned, or canceling one would take back points that were
      // never added.
      enqueueEarnRetry(req.user.customerId, pointsEarned, () =>
        clearOrderPoints(persistedOrders, { pointsEarned: 0 })
      );
    }
  }

  res.json({
    orders: persistedOrders,
    grandTotal: cart.grandTotal,
    ...(rewards && { rewards }),
    message: 'Order placed!',
  });
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
// which terminal status it ended at. For an order refunded after pickup (both
// completedAt and canceledAt exist) it is the later one — the refund — so a
// refund staff just issued shows up under Recent Orders even if the pickup was
// more than 7 days ago.
function terminalTimestamp(order) {
  return [order.completedAt, order.canceledAt].filter(Boolean).sort().at(-1);
}

// Whether an order still counts as "recent": it ended (picked up, delivered or
// canceled) within the window. This single rule decides both what the Recent
// Orders list shows and which picked-up orders can still be refunded from the
// app (see /api/orders/:id/refund), so the two can never disagree.
function isWithinRecentWindow(order) {
  const t = terminalTimestamp(order);
  return Boolean(t) && new Date(t).getTime() >= Date.now() - RECENT_ORDERS_WINDOW_MS;
}

app.get('/api/orders/recent', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  try {
    const [completed, canceled] = await Promise.all([queryCompletedOrders(), queryCanceledOrders()]);
    const orders = [...completed, ...canceled]
      .filter(isWithinRecentWindow)
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

// Fallback cookie count per sizeLabel, for stored order items that have no
// physicalCookieUnits of their own (see aggregateSales). Keyed on the
// sizeLabel string persisted on order.items, since stored orders don't keep
// the is_single/is_half_dozen flags Order.js's in-memory physicalCookieCount
// reads. 'Batch' is 24 here on purpose: it's what a batch held before
// batches became ~29 cookies (UNITS_PER_SIZE.batch), so older orders keep
// their original counts. Anything not listed (buckets, Cozy Rolls) counts 0.
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

  const itemTotals = new Map(); // `${flavor}|${sizeLabel}|${marker}` -> { flavor, sizeLabel, type, qty, revenue }
  const flavorTotals = new Map(); // flavor -> cookies

  for (const order of orders) {
    for (const item of order.items) {
      if (item.id.startsWith('reward-')) continue;
      // The GF/SF marker is part of the key (and `type` is sent along so the
      // Sales page can show it) — otherwise a regular, gluten-free and
      // sugar-free item with the same name and size (e.g. the three Cozy
      // Dough Buckets) would collapse into one row at mixed prices.
      const itemKey = `${item.flavor}|${item.sizeLabel}|${dietaryMarker(item.type) ?? ''}`;
      const itemEntry =
        itemTotals.get(itemKey) ||
        { flavor: item.flavor, sizeLabel: item.sizeLabel, type: item.type, qty: 0, revenue: 0 };
      itemEntry.qty += item.qty;
      itemEntry.revenue += item.price * item.qty;
      itemTotals.set(itemKey, itemEntry);

      // physicalCookieUnits (persisted per-item — see Order.js) wins when
      // present, since a batch's real count (29) differs from the legacy
      // SIZE_LABEL_UNITS entry. Falls back to that table for anything
      // persisted before that field existed.
      // Items with no cookie count at all (e.g. Cozy Dough Buckets, Cozy
      // Rolls) are left out of this ranking entirely — they still show in
      // itemsSold.
      const unitsPerItem = item.physicalCookieUnits ?? SIZE_LABEL_UNITS[item.sizeLabel] ?? 0;
      if (unitsPerItem > 0) {
        const cookies = unitsPerItem * item.qty;
        flavorTotals.set(item.flavor, (flavorTotals.get(item.flavor) || 0) + cookies);
      }
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
// rules a customer's own request would be (validatePickupDateTime, plus
// validateExtendedPickupNotice for gluten-free/sugar-free orders), not a
// looser staff-only path.
// Confirming/editing the pickup time doubles as confirming the order itself —
// staff shouldn't need a separate "Change Order Status" click for what's
// really one action. Only bumps status forward out of 'placed'; an order
// already at 'confirmed' or beyond isn't moved backward or re-stamped by a
// later pickup-time edit. The response carries the saved fulfillment plus,
// only when the status was bumped, the new status fields.
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
//
// Canceling gives the customer their money back by default: the order's own
// total (shipping included) is refunded to the card it was paid with — a
// partial refund of the charge, since one checkout can hold several orders
// on a single charge. Staff can cancel *without* a refund by sending
// { refund: false }, for an order that's forfeited under the pickup policy.
// The refund goes first: if Stripe refuses it, the order is left exactly as
// it was and staff are told why, so an order is never shown as canceled
// while the customer is still charged for it. What happened is saved on the
// order (refund, or refundSkipped).
//
// Reward points follow the refund: a canceled-with-refund order has the points
// it earned taken back and the points it spent on redeemed rewards returned
// (pointsAdjustment on the order); a no-refund cancel leaves points alone.
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

      const refundRequested = req.body?.refund !== false;
      let refund = null;
      if (refundRequested) {
        try {
          const result = await refundOrderPayment(order);
          if (result.refunded) refund = result.refund;
        } catch (err) {
          console.error(`Failed to refund order ${order.orderId} while canceling it:`, err);
          return res.status(502).json({
            error: `The payment couldn't be refunded (${err.message}), so the order was not canceled. Try again, or cancel it without a refund and refund it yourself in Stripe.`,
          });
        }
      }
      // Only worth recording as a deliberate choice when there was a payment to refund.
      const refundSkipped = !refundRequested && Boolean(order.payment?.paymentIntentId);

      // Reward points follow the money: when the order is canceled with a
      // refund (or it cost no money, only points), what it earned is taken back
      // and what it spent is returned. A forfeited order (no refund) leaves
      // them alone — the customer paid for it and keeps what they earned.
      const points = refundRequested ? pointsToReverse(order) : { earned: 0, spent: 0 };

      const canceledAt = new Date().toISOString();
      // Status and points change in one transaction, so the points move exactly
      // once even if two cancel requests race.
      const result = await cancelOrderRecord(order, { canceledAt, refund, refundSkipped, points });
      if (!result.canceled) {
        return res.status(400).json({ error: 'This order can no longer be canceled.' });
      }
      const { pointsAdjusted } = result;

      const email = buildStatusChangeEmail({
        contact: order.contact,
        method: order.fulfillment.method,
        status: 'canceled',
        order,
        refund,
        pointsReturned: pointsAdjusted?.spent ?? 0,
      });
      if (email) {
        try {
          await sendEmail(order.contact.email, email.subject, email.text, email.html);
        } catch (err) {
          console.error('Failed to send order-status email:', err);
          enqueueEmailRetry(order.contact.email, email.subject, email.text, email.html);
        }
      }

      res.json({
        status: 'canceled',
        canceledAt,
        ...(refund && { refund }),
        ...(refundSkipped && { refundSkipped: true }),
        ...(pointsAdjusted && {
          pointsAdjustment: { earnedTakenBack: pointsAdjusted.earned, spentReturned: pointsAdjusted.spent },
        }),
      });
    } catch (err) {
      console.error('Failed to cancel order:', err);
      res.status(500).json({ error: 'Failed to cancel order.' });
    }
  }
);

// Refunding an order that was already picked up or delivered (marked completed)
// — the cancel endpoint above refuses those, but a customer can still be owed
// their money back after the fact (the wrong thing handed over, a quality
// complaint, or an order marked picked up by mistake). Only while the order is
// still "recent" (see isWithinRecentWindow: the same 7 days Recent Orders shows);
// older than that, it's refused. Same safety as a cancel:
//  - The Stripe refund goes first. If Stripe refuses it, the order is left exactly
//    as it was and staff are told why, so an order is never shown as refunded
//    while the customer is still charged. It is idempotent per order, so a retry
//    (or a double-click) can't pay the customer twice.
//  - The order's own total (shipping included) is what goes back, to the card it
//    was paid with — a partial refund of the charge, since one checkout can hold
//    several orders.
//  - Reward points follow the money, exactly as for a cancel with refund: what the
//    order earned is taken back and what it spent is returned, in the same
//    transaction that marks the order, so they move once even if two requests race.
// The order becomes 'canceled' with refundedAfterCompletion (see cancelOrderRecord):
// that keeps it out of Sales and everything else that already treats canceled
// orders as "never happened", while screens say "Refunded" and completedAt keeps
// the history of the pickup. A points-only order (nothing paid) can be "refunded"
// too: its points come back. An order with nothing to give back is refused.
app.post(
  '/api/orders/:id/refund',
  requireAuth,
  requireActiveCustomer,
  requireStaff,
  async (req, res) => {
    try {
      const order = await getOrderById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      if (order.status === 'canceled') {
        return res.status(400).json({ error: 'This order has already been canceled or refunded.' });
      }
      if (order.status !== 'completed') {
        return res.status(400).json({
          error: "Only an order that's been picked up or delivered can be refunded here. Cancel an active order from Active Orders instead.",
        });
      }
      // Only while the order is still under Recent Orders. After that it is
      // settled history: a late refund is a decision for the Stripe Dashboard,
      // not a button in the app. Checked here (not just by hiding the button) so
      // a page left open past the cutoff, or a crafted request, gets the same answer.
      if (!isWithinRecentWindow(order)) {
        return res.status(400).json({
          error: `This order was ${order.fulfillment?.method === 'shipping' ? 'delivered' : 'picked up'} more than ${RECENT_ORDERS_WINDOW_MS / 86400000} days ago, so it can no longer be refunded here. If the customer is still owed money, refund the payment in the Stripe Dashboard.`,
        });
      }

      const hasPayment = Boolean(order.payment?.paymentIntentId) && orderRefundCents(order) > 0;
      const points = pointsToReverse(order);
      if (!hasPayment && points.spent === 0) {
        return res.status(400).json({ error: 'There is nothing to refund on this order.' });
      }

      let refund = null;
      if (hasPayment) {
        try {
          const result = await refundOrderPayment(order);
          if (result.refunded) refund = result.refund;
        } catch (err) {
          console.error(`Failed to refund completed order ${order.orderId}:`, err);
          return res.status(502).json({
            error: `The payment couldn't be refunded (${err.message}), so the order was left as it was. Try again, or refund it yourself in Stripe.`,
          });
        }
      }

      const canceledAt = new Date().toISOString();
      const result = await cancelOrderRecord(order, { canceledAt, refund, points, afterCompletion: true });
      if (!result.canceled) {
        return res.status(400).json({ error: 'This order has already been refunded or is no longer completed.' });
      }
      const { pointsAdjusted } = result;

      const email = buildRefundEmail({
        contact: order.contact,
        order,
        refund,
        pointsReturned: pointsAdjusted?.spent ?? 0,
      });
      try {
        await sendEmail(order.contact.email, email.subject, email.text, email.html);
      } catch (err) {
        console.error('Failed to send refund email:', err);
        enqueueEmailRetry(order.contact.email, email.subject, email.text, email.html);
      }

      res.json({
        status: 'canceled',
        canceledAt,
        refundedAfterCompletion: true,
        ...(refund && { refund }),
        ...(pointsAdjusted && {
          pointsAdjustment: { earnedTakenBack: pointsAdjusted.earned, spentReturned: pointsAdjusted.spent },
        }),
      });
    } catch (err) {
      console.error('Failed to refund order:', err);
      res.status(500).json({ error: 'Failed to refund order.' });
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
// endpoint fails the same way (a clean JSON 500) instead of the request
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
// the process supervisor (node --watch locally; a container orchestrator
// such as ECS in production) restarts a clean process rather than one left
// in a possibly-corrupted state.
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
