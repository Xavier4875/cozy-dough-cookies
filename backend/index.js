// Must be the first import: ES module imports are evaluated in order before
// any of this file's own statements run, and db/client.js (imported below,
// transitively via ordersRepo.js) reads AWS_* env vars at construction time.
// A later `dotenv.config()` call here would run only after that client was
// already built with those vars unset.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db/client.js';
import { EXTERNAL_SALES_TABLE } from './db/schema.js';
import { Cookie, TEMPERATURE_CONTROLLED_FLAVORS } from './models/Cookie.js';
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
import { optionalAuth, requireAuth, requireActiveCustomer, requireStaff } from './middleware/auth.js';
import { addToCustomerGroup } from './auth/cognitoGroup.js';
import { REWARDS_CATALOG, getReward } from './rewards/catalog.js';
import { validateAddress } from './shipping/usps.js';
import { enqueue as enqueueAddressRetry } from './shipping/retryQueue.js';
import { checkIpRateLimit } from './shipping/ipRateLimit.js';
import {
  EMAIL_RE,
  PICKUP_DATE_RE,
  PICKUP_TIME_RE,
  PICKUP_OPEN_MINUTES,
  PICKUP_CLOSE_MINUTES,
  PICKUP_MIN_NOTICE_MS,
  STATE_RE,
  ZIP_RE,
  UNITS_PER_SIZE,
  MIN_ORDER_SUBTOTAL,
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
// Shared by validateFulfillment (customer self-scheduling) and staff's
// confirm-pickup endpoint — a staff edit must clear the same bar a customer's
// own request would, not a looser one.
// sameDay bypasses the normal 24-hour notice floor for the "Request same
// day pickup" flow — but only for a pickup date that really is today
// server-side; a client claiming sameDay for some other date is still held
// to the regular floor (never trust the flag alone to skip the real check).
function validatePickupDateTime(pickupDate, pickupTime, sameDay = false) {
  if (!pickupDate || !PICKUP_DATE_RE.test(pickupDate)) {
    return 'A valid pickup date is required.';
  }
  if (!pickupTime || !PICKUP_TIME_RE.test(pickupTime)) {
    return 'Pickup time must be in 15-minute increments.';
  }
  const [year, month, day] = pickupDate.split('-').map(Number);
  const [hour, minute] = pickupTime.split(':').map(Number);
  const minutesOfDay = hour * 60 + minute;
  if (minutesOfDay < PICKUP_OPEN_MINUTES || minutesOfDay > PICKUP_CLOSE_MINUTES) {
    return 'Pickup time must be between 10:00am and 7:00pm.';
  }
  const pickupDateTime = new Date(year, month - 1, day, hour, minute);
  // new Date rolls over out-of-range components (e.g. day 32) instead of
  // failing, so a mismatched getDate() catches an invalid calendar date
  // like 2026-02-30 that the regex alone can't reject.
  if (pickupDateTime.getDate() !== day || pickupDateTime.getMonth() !== month - 1) {
    return 'A valid pickup date is required.';
  }
  const now = new Date();
  const isActuallyToday =
    year === now.getFullYear() && month - 1 === now.getMonth() && day === now.getDate();
  const minNoticeMs = sameDay && isActuallyToday ? 0 : PICKUP_MIN_NOTICE_MS;
  if (pickupDateTime.getTime() - now.getTime() < minNoticeMs) {
    return minNoticeMs === 0
      ? 'That pickup time has already passed today.'
      : 'Pickup must be scheduled at least 24 hours in advance.';
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
    const pickupError = validatePickupDateTime(pickupDate, pickupTime, fulfillment.sameDay === true);
    if (pickupError) return pickupError;
  }
  return null;
}

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Stubbed out for now — real data comes once DynamoDB is wired up.
// One product per flavor per size (single/half dozen/full dozen), built from
// Cookie's own type->flavor table so the list isn't duplicated here.
const SIZES = ['single', 'half_dozen', 'full_dozen'];
const PRODUCTS = [];
for (const [type, info] of Object.entries(Cookie.TYPES)) {
  for (const flavor of info.flavors) {
    for (const size of SIZES) {
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

// Real persistence, no real payment yet — prices/totals are computed
// server-side from PRODUCTS so the client can't just send whatever total it
// wants, and every order gets written to DynamoDB. Guest checkout stays
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

  const requestedOrders = Array.isArray(req.body.orders) ? req.body.orders : [];

  if (requestedOrders.length === 0) {
    return res.status(400).json({ error: 'Cart has no orders.' });
  }

  // A token can stay cryptographically valid for its full lifetime even
  // after the account behind it is deleted (deleting a Cognito user doesn't
  // revoke tokens already issued to it) — so a stale second tab could
  // otherwise still have orders attributed to, and earn/redeem points on, a
  // customerId that no longer resolves to anyone. Downgrade silently to
  // guest checkout rather than erroring, the same as an actually-unauthenticated
  // request — checkout already fully supports that path.
  if (req.user && !(await getCustomerById(req.user.customerId))) {
    req.user = null;
  }

  const contactError = validateContact(req.body.contact);
  if (contactError) {
    return res.status(400).json({ error: contactError });
  }
  const fulfillmentError = validateFulfillment(req.body.fulfillment);
  if (fulfillmentError) {
    return res.status(400).json({ error: fulfillmentError });
  }

  const contact = {
    firstName: String(req.body.contact.firstName).trim(),
    lastName: String(req.body.contact.lastName).trim(),
    email: String(req.body.contact.email).trim(),
  };
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
    return res.status(400).json({ error: 'Sign in to redeem rewards.' });
  }
  const resolvedRedemptions = []; // [{ orderIndex, entry, flavors }]
  for (let i = 0; i < requestedOrders.length; i++) {
    const redemptions = Array.isArray(requestedOrders[i].redemptions) ? requestedOrders[i].redemptions : [];
    for (const redemption of redemptions) {
      const key = redemption?.key;
      const flavors = redemption?.flavors;
      const entry = getReward(key);
      if (!entry) {
        return res.status(400).json({ error: `Unknown reward: ${key}` });
      }
      if (!Array.isArray(flavors) || flavors.length !== entry.qty) {
        return res.status(400).json({
          error: `${entry.label} requires exactly ${entry.qty} flavor selection${entry.qty > 1 ? 's' : ''}.`,
        });
      }
      const validFlavors = Cookie.TYPES[entry.type].flavors;
      if (flavors.some((f) => !validFlavors.includes(f))) {
        return res.status(400).json({ error: `Invalid flavor selection for ${entry.label}.` });
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
      return res.status(400).json({ error: 'An order has no cookies in it.' });
    }

    const order = new Order();
    for (const { id, qty } of requestedItems) {
      const cookie = PRODUCTS.find((p) => p.id === id);
      if (!cookie) {
        return res.status(400).json({ error: `Unknown product id: ${id}` });
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ error: `Invalid quantity for ${cookie.flavor}.` });
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
    return res.status(400).json({
      error: `Each order must have a value of at least $${MIN_ORDER_SUBTOTAL.toFixed(2)}.`,
    });
  }

  if (fulfillment.method === 'shipping' && cart.orders.some((order) => order.requiresPickup)) {
    return res.status(400).json({
      error: 'This order contains temperature-controlled items that can only be picked up, not shipped.',
    });
  }

  // Runs after every cheap, local, no-I/O check above (contact/fulfillment
  // shape, redemption auth, item/qty validity, temperature-controlled vs.
  // shipping conflict) so a request that was always going to be rejected for
  // one of those reasons never burns a real USPS API call first — and so it
  // never surfaces "couldn't verify address" when the actual problem is
  // something unrelated, like a temperature-controlled item on a ship order.
  // Set once verification fails non-blockingly (rate-limited or a genuine
  // USPS outage/timeout) — after orders are persisted below, this queues
  // them for automatic re-verification the moment the quota window resets.
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
      // null) must never block.
      return res.status(400).json({
        error: 'We couldn\'t verify that shipping address with USPS. Please double-check it and try again.',
      });
    } else if (result.verified === false) {
      fulfillment.addressVerified = false; // couldn't be checked; kept as customer entered it
      addressNeedsRetry = true;
    }
    // result.verified === null (no USPS credentials configured) → leave
    // fulfillment exactly as before, no addressVerified field at all — and
    // no retry, since there's nothing to retry against.
  }

  // Spend points before persisting anything. If this fails (insufficient
  // balance — including a race against a concurrent checkout), reject the
  // whole checkout with nothing created; this ordering is what prevents ever
  // handing out a free item that wasn't actually paid for in points.
  let balanceAfterSpend = null;
  if (totalPointsRequired > 0) {
    try {
      balanceAfterSpend = await redeemRewardsPoints(req.user.customerId, totalPointsRequired);
    } catch (err) {
      console.error('Failed to redeem rewards points:', err);
      return res.status(500).json({ error: 'Failed to redeem rewards. Please try again.' });
    }
    if (balanceAfterSpend === null) {
      return res.status(400).json({ error: 'Not enough rewards points.' });
    }
  }

  try {
    const persistedOrders = [];
    for (const order of cart.orders) {
      const { items, total: subtotal } = order.toJSON();
      const shippingFee = fulfillment.method === 'shipping' ? order.shippingFee : 0;
      const record = {
        orderId: randomUUID(),
        status: 'placed',
        items,
        subtotal,
        ...(fulfillment.method === 'shipping' && { shippingFee }),
        total: subtotal + shippingFee,
        contact,
        email: contact.email,
        fulfillment,
        payment: null,
        createdAt: new Date().toISOString(),
        ...(req.user && { customerId: req.user.customerId }),
      };
      persistedOrders.push(await createOrder(record));
    }

    if (addressNeedsRetry) {
      enqueueAddressRetry(persistedOrders.map((o) => o.orderId), fulfillment.shippingAddress);
    }

    // Signed-in customers earn 1 point per $1 spent. Guests earn nothing —
    // they have no Customers row at all. If the points update fails after
    // the orders already saved, the order still succeeds: points are a perk,
    // the order is the thing that must not fail. (Free reward items already
    // contribute $0 to grandTotal, so earning needs no adjustment for them.)
    let rewards;
    if (req.user) {
      rewards = {};
      if (totalPointsRequired > 0) rewards.spent = totalPointsRequired;
      try {
        const pointsEarned = Math.round(cart.grandTotal);
        const balance = await addRewardsPoints(req.user.customerId, pointsEarned);
        rewards.earned = pointsEarned;
        rewards.balance = balance;
      } catch (err) {
        console.error('Failed to award rewards points:', err);
        if (balanceAfterSpend !== null) rewards.balance = balanceAfterSpend;
      }
    }

    res.json({
      orders: persistedOrders,
      grandTotal: cart.grandTotal,
      ...(rewards && { rewards }),
      message: 'Order placed! (mock checkout — no payment was actually taken)',
    });
  } catch (err) {
    console.error('Failed to persist order:', err);
    res.status(500).json({ error: 'Failed to save your order. Please try again.' });
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
const SIZE_LABEL_UNITS = { Single: 1, 'Half Dozen': 6, 'Full Dozen': 12 };

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
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    default:
      return null; // 'total' — no lower bound
  }
}

// Staff's Sales dashboard — total revenue plus two rankings (by menu item,
// and by individual cookie count) for a given period. Canceled orders never
// happened, so they're excluded entirely; reward-redeemed line items (id
// starting with "reward-") are excluded from both rankings — their
// composite flavor label ("Free Half Dozen: 3 Chocolate Chip, 3 M&M")
// doesn't cleanly attribute to one flavor/size, and their $0 price already
// keeps revenue correct whether they're counted or not. Filtered by
// createdAt (when the order was placed), not pickup/fulfillment time — this
// app's mock checkout already treats payment as taken at order time. No GSI
// range-filters on createdAt alone (and "total" needs everything anyway),
// so this scans the whole table like Past Orders search's helpers do.
app.get('/api/sales', requireAuth, requireActiveCustomer, requireStaff, async (req, res) => {
  const period = req.query.period;
  if (!SALES_PERIODS.includes(period)) {
    return res.status(400).json({ error: 'period must be one of today, week, month, year, total.' });
  }
  try {
    const [allOrders, externalSalesResult] = await Promise.all([
      scanAllOrders(),
      docClient.send(new ScanCommand({ TableName: EXTERNAL_SALES_TABLE })),
    ]);
    const periodStart = salesPeriodStart(period, new Date());
    const orders = allOrders.filter(
      (order) => order.status !== 'canceled' && (periodStart === null || new Date(order.createdAt) >= periodStart)
    );
    // Staff-recorded revenue from sales made outside the site — counted
    // toward totalRevenue only, never itemsSold/flavorsSold (no items exist
    // for these).
    const externalSales = (externalSalesResult.Items ?? []).filter(
      (sale) => periodStart === null || new Date(sale.createdAt) >= periodStart
    );

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

        const cookies = (SIZE_LABEL_UNITS[item.sizeLabel] || 0) * item.qty;
        flavorTotals.set(item.flavor, (flavorTotals.get(item.flavor) || 0) + cookies);
      }
    }

    const itemsSold = [...itemTotals.values()].sort((a, b) => b.qty - a.qty || a.flavor.localeCompare(b.flavor));
    const flavorsSold = [...flavorTotals.entries()]
      .map(([flavor, cookies]) => ({ flavor, cookies }))
      .sort((a, b) => b.cookies - a.cookies || a.flavor.localeCompare(b.flavor));

    res.json({ period, totalRevenue, externalRevenue, itemsSold, flavorsSold });
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
// business-hours/notice-window rules a customer's own request would be
// (validatePickupDateTime), not a looser staff-only path. Purely a
// fulfillment-record update — order.status is a separate concern, entirely
// owned by set-status/complete below, so this can be called at any stage
// (not just 'placed') without side effects on where the order sits.
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
      const fulfillment = {
        method: 'pickup',
        pickupDate,
        pickupTime,
        ...(note && String(note).trim() && { staffNote: String(note).trim() }),
      };
      await updateOrderFulfillment(req.params.id, fulfillment);
      res.json({ fulfillment });
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
      res.json({ status: 'completed', completedAt });
    } catch (err) {
      console.error('Failed to complete order:', err);
      res.status(500).json({ error: 'Failed to complete order.' });
    }
  }
);

// The other terminal transition: stopping an order entirely, from any active
// stage (unlike /complete, this doesn't require reaching 'ready' first — a
// customer can call to cancel at any point before their order is done). Also
// one-way: once canceled, set-status's guard above refuses to move it
// anywhere else. Existing confirmedAt/readyAt are left untouched — "this was
// confirmed, then canceled" is real history worth keeping, not something to
// erase.
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

app.listen(PORT, () => {
  console.log(`Cozy Dough Cookies API listening on http://localhost:${PORT}`);
});
