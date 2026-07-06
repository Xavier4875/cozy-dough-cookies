import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Cookie } from './models/Cookie.js';
import { Order } from './models/Order.js';
import { Cart } from './models/Cart.js';

dotenv.config();

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

// Mock checkout: no real payment yet, but prices/totals are computed
// server-side from PRODUCTS so the client can't just send whatever total it wants.
// A cart can hold several orders at once (e.g. separate pickup batches), so the 
// request carries a list of orders, each with its own list of cookie/qty items.
app.post('/api/checkout', (req, res) => {
  const requestedOrders = Array.isArray(req.body.orders) ? req.body.orders : [];

  if (requestedOrders.length === 0) {
    return res.status(400).json({ error: 'Cart has no orders.' });
  }

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

  res.json({
    ...cart.toJSON(),
    message: 'Order placed! (mock checkout — no payment was actually taken)',
  });
});

app.listen(PORT, () => {
  console.log(`Cozy Dough Cookies API listening on http://localhost:${PORT}`);
});
