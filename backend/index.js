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
import { createOrder, getOrderById } from './db/ordersRepo.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateContact(contact) {
  if (!contact || typeof contact !== 'object') return 'Contact information is required.';
  const { name, email, phone } = contact;
  if (!name || !String(name).trim()) return 'Name is required.';
  if (!email || !EMAIL_RE.test(String(email).trim())) return 'A valid email is required.';
  if (!phone || !String(phone).trim()) return 'Phone number is required.';
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

// Real persistence, no real payment yet — prices/totals are computed
// server-side from PRODUCTS so the client can't just send whatever total it
// wants, and every order gets written to DynamoDB. No accounts/Cognito yet,
// so every order is created without a customerId (effectively a guest
// order); contact/fulfillment apply to the whole checkout action and get
// stamped onto each order created in it.
// A cart can hold several orders at once (e.g. separate pickup batches), so
// the request carries a list of orders, each with its own cookie/qty items.
app.post('/api/checkout', async (req, res) => {
  const requestedOrders = Array.isArray(req.body.orders) ? req.body.orders : [];

  if (requestedOrders.length === 0) {
    return res.status(400).json({ error: 'Cart has no orders.' });
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
    name: String(req.body.contact.name).trim(),
    email: String(req.body.contact.email).trim(),
    phone: String(req.body.contact.phone).trim(),
  };
  const fulfillment =
    req.body.fulfillment.method === 'shipping'
      ? { method: 'shipping', shippingAddress: String(req.body.fulfillment.shippingAddress).trim() }
      : { method: 'pickup' };

  const cart = new Cart();

  for (const requestedOrder of requestedOrders) {
    const requestedItems = Array.isArray(requestedOrder.items) ? requestedOrder.items : [];
    if (requestedItems.length === 0) {
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
      };
      persistedOrders.push(await createOrder(record));
    }

    res.json({
      orders: persistedOrders,
      grandTotal: cart.grandTotal,
      message: 'Order placed! (mock checkout — no payment was actually taken)',
    });
  } catch (err) {
    console.error('Failed to persist order:', err);
    res.status(500).json({ error: 'Failed to save your order. Please try again.' });
  }
});

// Mainly for verifying persistence end-to-end, and a head start on an
// order-confirmation page later.
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    res.json(order);
  } catch (err) {
    console.error('Failed to fetch order:', err);
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

app.listen(PORT, () => {
  console.log(`Cozy Dough Cookies API listening on http://localhost:${PORT}`);
});
