# Cozy Dough Cookies

Online store for Cozy Dough Cookies — React frontend, Node/Express backend, headed toward AWS + DynamoDB + Stripe.

## Structure

```
cozy-dough-cookies/
├── backend/     Node.js + Express API
└── frontend/    React app (Vite)
```

## Step 1: run it locally

**DynamoDB Local** (via Java, not Docker)
```
cd backend
npm run db:local
```
Starts DynamoDB Local directly (no container) on http://localhost:8000, persisting data to `dynamodb-local/data` so it survives restarts. First run auto-extracts `DynamoDBLocal.jar` from the `amazon/dynamodb-local` Docker image (needs Docker installed for that one-time step only — nothing else in this flow touches Docker) and needs a JDK on the machine; set `JAVA_HOME` if it's installed somewhere `start-dynamodb-local.js` doesn't already check. Leave this running in its own terminal.

In a second terminal:
```
cd backend
npm run db:setup
```
Creates the `CozyDoughCustomers`/`CozyDoughOrders` tables. Safe to re-run any time — it skips tables that already exist, so this is also how you confirm data actually persisted after restarting `db:local`.

<details>
<summary>Alternative: DynamoDB Local via Docker (no persistence)</summary>

```
docker compose up -d
cd backend
npm run db:setup
```
Simpler if Docker's the only thing installed, but data resets on every container restart — DynamoDB Local's SQLite backend can't open its db file against Docker Desktop's volume backend on Windows (tried both a bind mount and a named volume), so `docker-compose.yml` runs `-inMemory` rather than hanging on every request.
</details>

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

- **Step 2 ✅:** DynamoDB schema designed — Customers (accounts, role from a Cognito group) and Orders (customer, admin, and guest orders in one table) — see `backend/db/schema.js`.
- **Step 3 ✅:** `/api/checkout` persists real orders to DynamoDB Local, with a checkout form collecting contact info and pickup/shipping fulfillment. The product catalog itself (`/api/products`) stays static/in-code for now — it's not customer or order data.
- **Step 4:** Add Cognito (real accounts, guest checkout stays optional) and Stripe — Payment Intents on the backend, Stripe Elements on the frontend.
- **Step 5:** Deploy — S3 + CloudFront for the frontend, Lambda + API Gateway (or ECS) for the backend, real DynamoDB tables, full Docker Compose stack (backend + frontend + DynamoDB) as the container images pushed to production.
