# Cozy Dough Cookies

Online store for Cozy Dough Cookies — React frontend, Node/Express backend, headed toward AWS + DynamoDB + Stripe.

## Structure

```
cozy-dough-cookies/
├── backend/     Node.js + Express API
└── frontend/    React app (Vite)
```

## Step 1: run it locally

**Backend**
```
cd backend
npm install
cp .env.example .env
npm run dev
```
Runs on http://localhost:4000. Visit http://localhost:4000/api/health to confirm it's up.

**Frontend** (in a second terminal)
```
cd frontend
npm install
npm run dev
```
Runs on http://localhost:5173. The dev server proxies `/api/*` requests to the backend (see `vite.config.js`), so no CORS setup needed locally.

Open http://localhost:5173 — you should see "Backend status: Cozy Dough Cookies API is running" and a stubbed cookie list. That confirms the frontend and backend are talking to each other.

## What's next

- **Step 2:** Design the DynamoDB table(s) for customers and orders.
- **Step 3:** Replace the stubbed `/api/products` route with real product/cart/order logic against DynamoDB (DynamoDB Local via Docker works well for this before touching AWS).
- **Step 4:** Add Stripe — Payment Intents on the backend, Stripe Elements on the frontend.
- **Step 5:** Deploy — S3 + CloudFront for the frontend, Lambda + API Gateway (or ECS) for the backend, real DynamoDB tables.
