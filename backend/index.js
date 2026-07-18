// Must be the first import: ES module imports are evaluated in order before
// any of this file's own statements run, and db/client.js (imported below,
// transitively via ordersRepo.js) reads AWS_* env vars at construction time.
// A later `dotenv.config()` call here would run only after that client was
// already built with those vars unset.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { Cookie } from './models/Cookie.js';
import { Order } from './models/Order.js';
import { Cart } from './models/Cart.js';
import { createOrder, getOrderById, queryOrdersByCustomerId } from './db/ordersRepo.js';
import {
  upsertCustomer,
  getCustomerById,
  addRewardsPoints,
  redeemRewardsPoints,
  deleteCustomer,
} from './db/customersRepo.js';
import { optionalAuth, requireAuth, requireActiveCustomer } from './middleware/auth.js';
import { REWARDS_CATALOG, getReward } from './rewards/catalog.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateContact(contact) {
  if (!contact || typeof contact !== 'object') return 'Contact information is required.';
  const { firstName, lastName, email} = contact;
  if (!firstName || !String(firstName).trim()) return 'First name is required.';
  if (!lastName || !String(lastName).trim()) return 'Last name is required.';
  if (!email || !EMAIL_RE.test(String(email).trim())) return 'A valid email is required.';
  return null;
}

function validateFulfillment(fulfillment) {
  if (!fulfillment || typeof fulfillment !== 'object') return 'Fulfillment method is required.';
  const { method, shippingAddress } = fulfillment;
  if (method !== 'pickup' && method !== 'shipping') {
    return 'Fulfillment method must be "pickup" or "shipping".';
  }
  if (method === 'shipping' && (!shippingAddress || !String(shippingAddress).trim())) {
    return 'Shipping address is required for shipping orders.';
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
      ? { method: 'shipping', shippingAddress: String(req.body.fulfillment.shippingAddress).trim() }
      : { method: 'pickup' };

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
  const resolvedRedemptions = []; // [{ orderIndex, entry }]
  for (let i = 0; i < requestedOrders.length; i++) {
    const keys = Array.isArray(requestedOrders[i].redemptions) ? requestedOrders[i].redemptions : [];
    for (const key of keys) {
      const entry = getReward(key);
      if (!entry) {
        return res.status(400).json({ error: `Unknown reward: ${key}` });
      }
      resolvedRedemptions.push({ orderIndex: i, entry });
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
  for (const { orderIndex, entry } of resolvedRedemptions) {
    cart.orders[orderIndex].addCookie(
      {
        id: `reward-${entry.key}`,
        type: entry.type,
        flavor: `${entry.label} (redeemed)`,
        sizeLabel: entry.sizeLabel,
        price: 0,
        is_temperature_controlled: entry.is_temperature_controlled,
      },
      1
    );
  }

  if (fulfillment.method === 'shipping' && cart.orders.some((order) => order.requiresPickup)) {
    return res.status(400).json({
      error: 'This order contains temperature-controlled items that can only be picked up, not shipped.',
    });
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
      const { items, total } = order.toJSON();
      const record = {
        orderId: randomUUID(),
        status: 'placed',
        items,
        subtotal: total,
        total,
        contact,
        email: contact.email,
        fulfillment,
        payment: null,
        createdAt: new Date().toISOString(),
        ...(req.user && { customerId: req.user.customerId }),
      };
      persistedOrders.push(await createOrder(record));
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

// Cognito doesn't know about our DynamoDB Customers table, so the frontend
// calls this right after sign-in/sign-up-confirmation to upsert a row from
// the verified token's claims. Safe to call repeatedly (plain overwrite).
app.post('/api/customers/sync', requireAuth, async (req, res) => {
  try {
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
