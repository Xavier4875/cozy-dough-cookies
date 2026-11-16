# Cozy Dough Cookies

Online ordering for Cozy Dough Cookies, a single-location cookie shop in Bellevue, Nebraska. Customers browse the menu, build one or more orders, and pay by card, Apple Pay or Google Pay (Stripe). Orders are picked up in person or shipped via USPS. Staff manage orders, sold-out items and sales from the same site.

> **Status:** not live yet. The app has run on AWS before as a test deployment (to try Apple Pay on a real HTTPS domain), but those resources were torn down. See [Deployment](#deployment).

## Contents

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Running it locally](#running-it-locally)
- [Configuration](#configuration)
- [The menu](#the-menu)
- [Ordering rules](#ordering-rules)
- [Staff features](#staff-features)
- [Data model](#data-model)
- [API](#api)
- [Deployment](#deployment)
- [Conventions](#conventions)
- [Known limitations](#known-limitations)

## Tech stack

| Layer | What it uses |
| --- | --- |
| Frontend | React 18, React Router 7, Vite 8 (plain JS/JSX, no TypeScript) |
| Backend | Node 22+, Express 4 (ES modules) |
| Data | DynamoDB (real AWS in `us-east-2`, or DynamoDB Local for offline work) |
| Accounts | Amazon Cognito (User Pool). Staff are members of a `staff` group |
| Payments | Stripe Payment Element: card, Apple Pay, Google Pay. No surcharge |
| Email | Amazon SES: guest verification codes, receipts, order updates, staff alerts |
| Shipping | USPS Addresses API for address validation. A flat fee is charged |
| Containers | Docker Compose runs the backend and an nginx-served frontend |

## Repository layout

```
cozy-dough-cookies/
├── backend/
│   ├── index.js            All HTTP routes, checkout, sales aggregation
│   ├── constants.js        Business-rule constants (mirrored in the frontend)
│   ├── models/             Cookie (menu catalog) and Order
│   ├── rewards/            Rewards catalog + retry queue for point earning
│   ├── db/                 DynamoDB client, table definitions, repositories
│   ├── auth/, middleware/  Cognito group helper; auth + async-error middleware
│   ├── email/              SES sender, receipt/status/staff emails, rate limit
│   ├── shipping/           USPS validation, rate limiters, retry queue
│   ├── stripe/             Lazily constructed Stripe client; card/wallet summary
│   └── scripts/            Table creation, DynamoDB Local, Cognito backfill
├── frontend/
│   ├── src/pages/          Home, Menu (+Mobile), Policy, Nutrition, Rewards,
│   │                       OrderHistory, OrderTracking (staff), Sales (staff),
│   │                       SignIn, SignUp, ForgotPassword
│   ├── src/components/     Menu grids, cart/account drawers, checkout, modals
│   ├── src/context/        AuthContext (Cognito), CartContext (cart + API calls)
│   ├── src/models/         Cart, Order (client-side cart model)
│   ├── src/constants.js    Business-rule constants (mirrored from backend)
│   ├── src/cookie-images/  Menu photos, mapped in src/cookieImages.js
│   ├── src/assets/         Hero image, background, mascot poses
│   └── nginx.conf          Container web server: SPA fallback + /api proxy
├── image-originals/        Full-size originals of images that were compressed
│                           for the site (not part of either build)
└── docker-compose.yml      backend, frontend (+ optional dynamodb-local)
```

## Running it locally

**Prerequisites:** Node 22 or newer, and a real Cognito User Pool, Stripe test keys and an SES-verified sender (see [Configuration](#configuration)). Sign-in, checkout and emails all call those services even in local dev. USPS credentials are optional: without them, shipping addresses are accepted as typed.

### 1. Database

Pick one.

**Real AWS DynamoDB (what `backend/.env` points at by default).** Make sure `DYNAMODB_ENDPOINT` is unset or blank in `backend/.env`, set `AWS_REGION`, and use credentials that can read and write the tables.

**DynamoDB Local, with persistence (via Java, not Docker)**

```
cd backend
npm run db:local
```

Starts DynamoDB Local on http://localhost:8000 and keeps its data in `dynamodb-local/data`. The first run extracts `DynamoDBLocal.jar` from the `amazon/dynamodb-local` Docker image (needs Docker installed for that one step) and needs a JDK; set `JAVA_HOME` if it isn't in a standard location. Leave it running in its own terminal and set `DYNAMODB_ENDPOINT=http://localhost:8000`.

<details>
<summary>DynamoDB Local in Docker (no persistence)</summary>

```
docker compose --profile local-dynamodb up -d
```

Data is lost whenever the container restarts (see the comment in `docker-compose.yml` for why). The `--profile` flag is required; this service is opt-in. To point the backend container at it, set `DYNAMODB_ENDPOINT=http://dynamodb-local:8000` (the container name, not `localhost`).
</details>

Then create the tables (safe to re-run; existing tables are skipped):

```
cd backend
npm run db:setup
```

### 2. Backend

```
cd backend
npm install
cp .env.example .env     # then fill in real values
npm run dev              # node --watch, restarts on file changes
```

Runs on http://localhost:4000. Check http://localhost:4000/api/health.

### 3. Frontend

```
cd frontend
cp .env.example .env     # then fill in real values
npm install
npm run dev
```

Runs on http://localhost:5173. The Vite dev server proxies `/api/*` to the backend, so no CORS setup is needed. To try it from a phone on the same network, run `npm run dev -- --host` and open `http://<your-computer's-IP>:5173`.

### Full stack in Docker Compose

```
docker compose up -d --build backend frontend
```

Builds both images. The backend is on http://localhost:4000 and the frontend (a production Vite build served by nginx, which proxies `/api/*` to the backend container) is on http://localhost:8080. The backend container reads `backend/.env` and talks to real AWS by default. `docker compose down` stops both.

If the build fails with `failed to execute bake`, run it with `COMPOSE_BAKE=false` set in front of the command.

There is no automated test suite. Changes are checked by running the app.

## Configuration

Backend settings live in `backend/.env` (copy `backend/.env.example`, which documents every variable). Frontend settings live in `frontend/.env`.

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (test-mode keys locally) |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | AWS access. In ECS the task role supplies credentials instead |
| `DYNAMODB_ENDPOINT` | DynamoDB Local URL. Leave unset to use real DynamoDB |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION` | Token verification and group management |
| `SES_SENDER_EMAIL` | The address all email is sent from, shown to customers as "Cozy Dough Cookies". Use an address on your own verified SES domain (production uses `orders@cozydoughcookies.com`). Don't use a Gmail/Yahoo/Outlook address: mail that claims to be from one but is sent by Amazon fails the providers' sender checks and lands in junk. The domain also needs DKIM, a custom MAIL FROM domain and a DMARC record (all set up for cozydoughcookies.com) |
| `STAFF_NOTIFICATION_EMAIL` | Receives a message for every new order, and the payment alerts (charged with no order, chargebacks, failed refunds). One address, or several separated by commas — they all get the same message. Unset disables the emails; alerts are still written to the server log |
| `SES_REPLY_TO_EMAIL` | Optional. Where a customer's reply to a receipt or status email goes, for when the sender address has no inbox. One address or several, comma-separated |
| `USPS_CONSUMER_KEY`, `USPS_CONSUMER_SECRET`, `USPS_API_BASE_URL` | Shipping address validation. Unset disables it |
| `*_RATE_LIMIT_*` | Optional USPS, per-IP and per-email limits (defaults in `backend/constants.js`) |
| `CUSTOMERS_TABLE_NAME`, `ORDERS_TABLE_NAME`, `EXTERNAL_SALES_TABLE_NAME`, `EMAIL_VERIFICATIONS_TABLE_NAME` | Optional table-name overrides |
| `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION` | Frontend Cognito config (not secret, baked into the build) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Frontend Stripe key (same mode as the secret key) |

`backend/.env` is excluded from git and from the Docker build context, and the backend container receives it at run time instead. `frontend/.env` is read when the frontend is built, and only the `VITE_`-prefixed values (none of them secret) end up in the shipped JavaScript. Keep real keys out of source control.

## The menu

The menu is defined in code, in `Cookie.TYPES` in `backend/models/Cookie.js`. Each type lists its flavors, the sizes it comes in and a price per size. At startup `backend/index.js` builds one product for every flavor and size combination and serves the list at `/api/products`. Changing the menu is a code change plus a redeploy; only customers, orders, sales and verification codes are stored in DynamoDB.

| Menu section | Items | Price |
| --- | --- | --- |
| **Standard** cookies | Chocolate Chip, M&M, Monster, Butter, Peanut Butter, Snickerdoodle, Oatmeal, Oatmeal Raisin, Butterscotch, Oatmeal Scotchies | $2 single, $12 half dozen, $24 dozen |
| **Special** cookies | Strawberry Cheesecake, Brownie | $3 single, $18 half dozen, $36 dozen |
| **Premium** cookies | Oatmeal Cream Pie | $7 single, $42 half dozen, $84 dozen |
| **Cozy Dough Bucket** | One bucket in any standard flavor | $55 |
| **Cozy Rolls** | Set of 4 | $32 |
| **Gluten-Free** tab | Standard and special flavors, sold by the batch (about 29 cookies); plus a Cozy Dough Bucket | $80 standard batch, $95 special batch, $65 bucket |
| **Sugar-Free** tab | Same as Gluten-Free | Same as Gluten-Free |

Things worth knowing:

- **Product ids** are derived from what the product is: `` `${type}:${flavor-slug}:${size}` ``, for example `standard:m-m:single`. Adding, removing or reordering items never renumbers the others. The server refuses to start if two products produce the same id.
- **Cozy Dough Buckets** are one product per flavor behind a single menu card with a flavor-picker popup. In the cart and on receipts they read "Cozy Dough Bucket (Flavor)". Buckets and Cozy Rolls are their own items, so they're left out of cookie counts (shipping box size and the Sales page's cookies-per-flavor ranking). Buckets are made to order, so they have no sold-out toggle.
- **How the menu draws a product** comes from its type in `Cookie.TYPES`, not from names in the frontend. A type with a `pickerTitle` (the buckets) shows as one flavor-picker card with that title; a type with `priceOnCard: true` (Cozy Rolls) shows its price on each card instead of a shared "$X each" heading. The Regular tab sorts products into its sections by the flags `/api/products` sends (`is_single`, `is_half_dozen`, `is_full_dozen`, `is_in_buckets`, `is_cozy_rolls`); the Gluten-Free and Sugar-Free tabs take every `gluten_free_*` / `sugar_free_*` type. The desktop and phone menus share one body, `frontend/src/components/MenuContent.jsx`.
- **Adding to the menu:**
  - *A new type in an existing section* (for example another price tier): add it to `Cookie.TYPES` and it appears automatically, after the known tiers, titled from its name. Add a label to `DEFAULT_TYPE_LABELS` in `CookieGrid.jsx` for a nicer title or a fixed position.
  - *A new gluten-free or sugar-free tier:* name the type `gluten_free_*` / `sugar_free_*`; it appears on that tab after the standard and special batches.
  - *A new section* (its own nav button): add a flag for it on `Cookie` and an entry in `COOKIE_SIZES` in `frontend/src/constants.js`. A product that fits no section isn't shown, and a development build warns about it in the browser console.
  - *Photos:* add the file and its name in `cookieImages.js`.
- **Temperature-controlled** items (Strawberry Cheesecake, Oatmeal Cream Pie, buckets, Cozy Rolls) can only be picked up. Any order containing one can't ship.
- **Gluten-free and sugar-free** types are named `gluten_free_*` / `sugar_free_*` on purpose. The tab a product appears on, the "GF"/"SF" marker and the 48-hour notice rule all key off that prefix, so any new type with that prefix picks all three up automatically.
- **Photos** go in `frontend/src/cookie-images/` and are mapped to a product name in `frontend/src/cookieImages.js`. Keep them to about 768px square as JPEG (cards show them at roughly 140 to 200px); a full-size camera or editor export can be over 1 MB and slows every menu visit. The mascot poses in `frontend/src/assets/mascot/` are WebP, 520px tall (they display at 170px). Products without a photo show a placeholder. Every file in that folder is bundled whether or not it's used, which is fine for keeping seasonal photos on hand: they add a little to the build size but nothing to page load, since a photo only downloads when it's shown.
- **Reward photos** work the same way: files go in `frontend/src/reward-images/` and are mapped to a reward's key (for example `standard-single`, from `backend/rewards/catalog.js`) in `frontend/src/rewardImages.js`. A reward can also reuse a menu photo (the Premium Single shows the Oatmeal Cream Pie photo) by naming it in `rewardImages.js`. A reward without a photo shows a placeholder.
- **The Nutrition page** is hand-written (`frontend/src/pages/Nutrition.jsx`); its allergen table is not generated from the catalog, so update it when the menu changes. The **Policy page** is also hand-written and repeats a few rules from this README (minimum order, notice periods, shipping fees).
- **Rewards** costs are derived from menu prices at 25 points per $1 of value (the standard and special singles are pinned at 50 and 75 points). A price change updates reward costs automatically.

## Ordering rules

Values live in `backend/constants.js` and are mirrored under the same names in `frontend/src/constants.js`. Change them in both places.

- **Minimum order:** $12 subtotal per order, before shipping. A reward redeemed with points counts at its menu value.
- **Several orders per checkout:** the cart can hold more than one order (for example, different pickup times). Contact and fulfillment details apply to the whole checkout.
- **Pickup:** 10:00am to 7:00pm in 15-minute slots. The calendar offers dates up to 3 months ahead. Today isn't selectable in the calendar; customers can send a same-day request instead, which staff confirm. Gluten-free and sugar-free orders need at least 48 hours' notice and can't use the same-day request.
- **Pickup address** is shown only in customer emails about a pickup order: the receipt, the pickup-time confirmation, and every status update (confirmed, ready, picked up, canceled). Staff emails leave it out, and the app itself never displays it. Don't add it to any page.
- **Shipping:** USPS to all 50 states, D.C. and U.S. territories. The fee is a flat $24 for up to 36 cookies and $30 above that. Addresses are validated against USPS; a USPS outage or rate limit never blocks checkout, and those addresses are re-checked automatically later.
- **Guests vs. accounts:** guests can check out without an account but must verify their email with a 6-digit code first. They earn no points and have no order history. Registered customers skip verification, earn 1 point per $1 spent and see their orders under My Orders.
- **Payment:** the cart is sent to the backend, which computes the total itself and creates a Stripe PaymentIntent. The browser then collects payment with Stripe's Payment Element. Only after Stripe reports success does the browser call `/api/checkout`, which re-checks the payment (status and exact amount, and that it hasn't been used before) and then saves the orders, spends reward points, and sends the receipt and staff notification. If saving the orders fails after the charge, or USPS reports a shipping address as undeliverable, the payment is refunded in full and any orders already saved are marked canceled.
- **A payment becomes orders exactly once.** Order ids are derived from the payment, and saving an order refuses to overwrite an existing one, so if two requests finalize the same payment at the same moment (a double-click, a retry) DynamoDB lets only one through. The other gets a 409 and changes nothing: no refund, no reward points spent twice. Reward points are only spent after the orders are saved.
- **Canceling an order refunds it.** Staff see a checked "Refund $X to the customer's card" box when canceling a paid order. The order's own total, shipping included, is refunded to the card it was paid with (a partial refund, since one checkout can hold several orders on one charge), and the customer's cancellation email says so. Unchecking the box cancels without a refund, for an order forfeited under the pickup policy. The refund is made first: if Stripe refuses it, the order stays active and staff see the reason, so an order is never shown as canceled while the customer is still charged. Refunds are idempotent, so a retry can't pay twice.
- **Reward points follow the refund.** Each order of a signed-in customer records its own share of the points the checkout earned and spent (`pointsEarned`, `pointsSpent`; a checkout with several orders splits them so the shares add up exactly). Canceling an order *with* a refund (or one that cost no money, paid entirely in points) takes back the points it earned and returns the points it spent on redeemed rewards; canceling *without* a refund leaves points alone, since the customer paid and keeps what they earned. The order status and the customer's balance change in one DynamoDB transaction, so the points move exactly once even if two cancel requests race, and an order can't end up canceled with its points unadjusted. What moved is saved on the order as `pointsAdjustment`, shown in the staff cancel dialog beforehand and on the order's timeline afterwards, and the customer's cancellation email mentions points returned. Guests have no points. If a checkout's points ultimately fail to move (the spend is refused, or awarding gives up after its retries), the orders' recorded shares are zeroed so a later cancel doesn't move points that never moved.
- **Stripe webhook and staff alerts.** The webhook endpoint (`/api/stripe/webhook`) must be subscribed to `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`, `charge.dispute.closed` and `refund.failed`. Staff are emailed at the `STAFF_NOTIFICATION_EMAIL` addresses (and the server logs it) when a customer was charged but no order exists 15 minutes later, when a chargeback is opened or closed, when a refund fails, and when a checkout fails and its automatic refund also fails. The links in those emails point at the test or live Dashboard to match the key in use.
- **Prices are never trusted from the browser.** The server rebuilds every cart from its own catalog; client-side totals are a preview only.
- **Order stages:** `placed` → `confirmed` → `ready` → `completed`, plus `canceled`. Staff can move an order freely among the first three; `completed` and `canceled` are one-way.
- **Emails** (all through SES): receipt, staff new-order notification, pickup-time confirmation, stage updates, guest verification code. A failed send is retried a few times and never fails the order.

## Staff features

Staff accounts are ordinary Cognito accounts that someone has moved into the `staff` group by hand in the AWS Console. Every account is added to a `customer` group automatically at sign-in; staff are left alone.

- **Order Tracking** (`/order-tracking`): active orders, recent orders (last 7 days, including canceled), and a Past Orders search across registered customers and guests. Each order shows its items, totals, how it was paid (for example "Visa ending in 4242" or "Apple Pay (Mastercard ending in 4444)") and its fulfillment details. Staff confirm or change pickup times, change status, mark orders picked up or delivered, and cancel orders.
- **Sales** (`/sales`): revenue plus Items Sold and Cookie Flavors rankings for today, this week (with a day-by-day breakdown), any month, any year, or all time. Staff can also record sales made outside the site (events, in person), which count toward revenue only.
- **Sold-out toggles:** staff see a three-dot menu on each cookie card on the menu to mark an item in or out of stock. The menu shows the result of every change: "Saving…", a green "✓ Marked out of stock" or "✓ Marked in stock", or a red "✕" with the reason if it failed (for example an expired sign-in or the server being down), which stays up until it's dismissed. Cozy Dough Buckets have no toggle on purpose: they're made to order, so they're never sold out.

## Data model

Defined in `backend/db/schema.js`; `npm run db:setup` creates them.

| Table | Key | Holds |
| --- | --- | --- |
| `CozyDoughCustomers` | `customerId` (GSI `email-index`) | One row per registered account: profile and rewards balance. Role comes from the Cognito group, not from this table |
| `CozyDoughOrders` | `orderId` (GSIs by customer, by status, and by email, each sorted by `createdAt`) | Every order: customers, staff and guests (guest rows have no `customerId`) |
| `CozyDoughExternalSales` | `id` | Staff-recorded sales made outside the site |
| `CozyDoughEmailVerifications` | `email` | The one live verification code per guest email, with a TTL |

Each order's `payment` record holds the Stripe PaymentIntent id, the amount charged for the whole checkout (every order in a multi-order checkout shares it) and the payment method: card brand and last four digits, plus the wallet (Apple Pay, Google Pay) when one was used. Full card numbers never touch this app. A canceled order also records what happened to its money: a `refund` (Stripe id, amount in cents, status), or `refundSkipped` when staff canceled without refunding, or `cancelReason: 'checkout_failed'` for an order canceled automatically after a failed checkout. A signed-in customer's order also records `pointsEarned` and `pointsSpent` (its share of the checkout's reward points), and a canceled one a `pointsAdjustment` (`earnedTakenBack`, `spentReturned`) when points moved back.

Orders are never deleted. Deleting an account removes the customer row and the Cognito user but leaves past orders in place.

## API

Everything is under `/api`. "Staff" means a valid token in the `staff` group.

| Access | Endpoints |
| --- | --- |
| Public | `GET /health`, `GET /products`, `GET /rewards/catalog`, `POST /shipping/validate-address`, `POST /email-verification/send`, `POST /email-verification/confirm` |
| Optional sign-in (guest or customer) | `POST /checkout/create-payment-intent`, `POST /checkout` |
| Stripe | `POST /stripe/webhook` (signature-verified) |
| Signed-in customer | `GET /orders/mine`, `GET /orders/:id` (their own; staff can fetch any), `POST /customers/sync`, `GET` and `DELETE /customers/me` |
| Staff | `GET /orders/active`, `/orders/recent`, `/orders/history`, `GET /customers/search`, `POST /orders/:id/confirm-pickup`, `/set-status`, `/complete`, `/cancel`, `POST /products/:id/set-sold-out`, `GET /sales`, `POST /sales/external` |

## Deployment

The container images are built to run on AWS. This is the layout that was used for the earlier test deployment, and the one to recreate when the site goes live:

- **Frontend:** `npm run build`, upload `dist/` to a private S3 bucket behind CloudFront. CloudFront forwards `/api/*` to the backend, which is why the frontend only ever uses relative `/api/...` URLs (the Vite proxy and `nginx.conf` do the same job locally).
- **Backend:** build `backend/Dockerfile`, push it to ECR and run it on ECS Fargate behind an HTTPS load balancer. The task role grants DynamoDB, SES and Cognito access, so no static AWS keys are needed. The Stripe and USPS secrets go in Secrets Manager and are injected into the task.
- **Domain and HTTPS:** Apple Pay and Google Pay need a real HTTPS domain, and Apple Pay also needs that domain registered with Stripe.
- **Before taking real orders:** create the Stripe webhook in **live mode** pointing at the live URL, subscribed to the events listed under Ordering rules, and set its signing secret; register the domain for Apple Pay in live mode too (registration is per mode); move SES out of sandbox mode (until then it can only email verified addresses); and switch the secret key and the publishable key to live mode together. Then make one small real payment and cancel it with a refund, to see the whole path work.
- **Redeploying:** for the backend, push a new image and run `aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment`. For the frontend, `aws s3 sync dist/ s3://<bucket> --delete` and invalidate CloudFront if changes don't show.

The backend image sets `TZ=America/Chicago`. Pickup dates and times are plain local wall-clock values, so the server's timezone must match the shop's.

## Conventions

- **Shared constants** (shipping fees, pickup hours, minimum order, batch size, and so on) exist twice, as `backend/constants.js` and `frontend/src/constants.js`, because the two projects share no package. They use identical names; keep them in sync.
- **The server is the source of truth.** The frontend recomputes totals, notice windows and so on only to give instant feedback; the backend re-validates all of it.
- **Comments explain why**, not what. When behavior changes, update or delete the comment next to it.

## Known limitations

- Sold-out flags live in server memory, so every item is back in stock after a backend restart.
- The Stripe webhook alerts staff when a customer was charged but has no order; it doesn't create the order itself or refund automatically. The 15-minute wait before that check is an in-memory timer, so a backend restart inside that window skips the check for that payment.
- Canceling an order with a refund takes back the points it earned even if the customer has since spent them, so their balance can go below zero (they owe the points back, and can't redeem again until they've earned them). Orders placed before points were recorded on orders carry no `pointsEarned`/`pointsSpent`, so canceling one moves no points.
- The email, points and USPS retry queues are in memory and are lost if the backend restarts.
- The 3-month limit on pickup dates is only enforced in the UI, not by the backend.
- Orders placed before the card details were recorded show "Paid through Stripe" in Order Tracking's Payment Method row, since which card was used isn't stored for them.
