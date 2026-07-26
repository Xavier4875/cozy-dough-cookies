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
docker compose --profile local-dynamodb up -d
cd backend
npm run db:setup
```
Simpler if Docker's the only thing installed, but data resets on every container restart — DynamoDB Local's SQLite backend can't open its db file against Docker Desktop's volume backend on Windows (tried both a bind mount and a named volume), so `docker-compose.yml` runs `-inMemory` rather than hanging on every request. The `--profile local-dynamodb` flag is required — this service is opt-in, not part of the default `docker compose up` (see below), since the app itself now talks to real AWS DynamoDB by default.
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

## Full stack via Docker Compose

```
docker compose up -d --build backend frontend
```
Builds and runs the whole app as two containers: backend on http://localhost:4000, frontend (a production Vite build served by nginx, with `/api/*` reverse-proxied to the backend container — see `frontend/nginx.conf`) on http://localhost:8080. This talks to real AWS (DynamoDB, Cognito, SES, USPS) by default via `backend/.env` — it does **not** start `dynamodb-local` (that stays behind the `--profile local-dynamodb` flag above, since nothing in this mode is configured to use it). `docker compose down` tears both containers down.

## What's next

- **Step 2 ✅:** DynamoDB schema designed — Customers (accounts, role from a Cognito group) and Orders (customer, admin, and guest orders in one table) — see `backend/db/schema.js`.
- **Step 3 ✅:** `/api/checkout` persists real orders, with a checkout form collecting contact info and pickup/shipping fulfillment. The product catalog itself (`/api/products`) stays static/in-code for now — it's not customer or order data.
- **Step 4:** Cognito ✅ (real accounts, guest checkout stays optional, guest checkout gated behind an SES-emailed verification code). Stripe still pending — Payment Intents on the backend, Stripe Elements on the frontend; checkout is a mock ("no payment was actually taken") until then.
- **Step 5 (in progress):** Real DynamoDB tables ✅, full Docker Compose stack (backend + frontend) ✅. Still pending: actually hosting those container images on AWS (ECS/Fargate or similar) instead of running them locally, and lifting SES out of sandbox mode (currently can only email addresses individually verified in SES).
