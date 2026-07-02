import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Cookie } from './models/Cookie.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Stubbed out for now — real data comes once DynamoDB is wired up.
const PRODUCTS = [
  new Cookie('standard', 'Chocolate Chip'),
  new Cookie('standard', 'Monster'),
  new Cookie('standard', 'Butter'),
  new Cookie('standard', 'Peanut Butter'),
  new Cookie('standard', 'Snickerdoodle'),
  new Cookie('standard', 'Oatmeal'),
  new Cookie('standard', 'Oatmeal Raisin'),
  new Cookie('standard', 'Butterscotch'),
  new Cookie('standard', 'Oatmeal Scotchies'),
  new Cookie('special', 'Lemon'),
  new Cookie('special', 'White Chocolate Raspberry'),
  new Cookie('special', 'Strawberry Cheesecake'),
  new Cookie('special', 'Brownie'),
  new Cookie('premium', 'Strawberry-Blueberry-Cheesecake Sandwich'),
  new Cookie('premium', 'Oatmeal Cream Pie'),
];

let nextOrderId = 1;

// Simple health check so the frontend has something to talk to right away.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cozy Dough Cookies API is running' });
});

app.get('/api/products', (req, res) => {
  res.json(PRODUCTS);
});

// Mock checkout: no real payment yet, but prices/totals are computed
// server-side from PRODUCTS so the client can't just send whatever total it wants.
app.post('/api/checkout', (req, res) => {
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];

  if (requestedItems.length === 0) {
    return res.status(400).json({ error: 'Cart is empty.' });
  }

  const orderItems = [];
  for (const { id, qty } of requestedItems) {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) {
      return res.status(400).json({ error: `Unknown product id: ${id}` });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: `Invalid quantity for ${product.flavor}.` });
    }
    orderItems.push({
      id: product.id,
      type: product.type,
      flavor: product.flavor,
      price: product.price,
      qty,
    });
  }

  const total = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);

  res.json({
    orderId: `CDC-${nextOrderId++}`,
    items: orderItems,
    total,
    message: 'Order placed! (mock checkout — no payment was actually taken)',
  });
});

app.listen(PORT, () => {
  console.log(`Cozy Dough Cookies API listening on http://localhost:${PORT}`);
});
