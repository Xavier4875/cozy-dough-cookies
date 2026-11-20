// End-to-end tests: the REAL server (index.js) driven over HTTP, against a throwaway in-memory DynamoDB Local.
//
// Run with `npm run test:integration` (or `npm test`, which runs these and the unit tests) from backend/.
//
// What is real: the Express server, every route, the order/points/refund logic, and the database code.
// What is faked, so nothing real can ever be touched:
//   - the database is DynamoDB Local, started here on a free port, in memory, and stopped when the tests end;
//   - sign-in: a fake token table stands in for Cognito;
//   - email: SES is replaced by a list this file reads, so no email is ever sent;
//   - Stripe: payments and refunds are replaced by in-memory stand-ins.
// Every setting is forced to a test value BEFORE any backend code loads (backend/.env would otherwise be read by
// dotenv), and the file refuses to run if the database it would talk to is not on this computer.
//
// It needs Java and dynamodb-local/DynamoDBLocal.jar (the same things `npm run db:local` uses). If either is
// missing, the server tests are skipped with a message and only the "Receipt wording" tests run.
//
// The tests in each group run in order and build on one another (place an order, then confirm it, then refund it),
// so when one fails, the ones after it in the same group may fail too: fix the first failure first.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pure modules (no settings read at load time), safe to import up front.
import { PICKUP_NOTICE_VERSION as V, PICKUP_NOTICES } from '../pickup/notice.js';
import { formatPickupDateTime } from '../email/format.js';
import { buildReceiptEmail } from '../email/receipt.js';
import { buildPickupTimeEmail, buildStatusChangeEmail } from '../email/orderStatusEmail.js';
import { Order } from '../models/Order.js';

// ---------------------------------------------------------------------------
// Finding Java and the DynamoDB Local jar
// ---------------------------------------------------------------------------

const backendDir = path.resolve(fileURLToPath(import.meta.url), '../..');
const dynamoDir = path.resolve(backendDir, '../dynamodb-local');
const jarPath = path.join(dynamoDir, 'DynamoDBLocal.jar');

function findJava() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const roots = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft\\jdk',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
  ].filter(Boolean);
  for (const home of roots) {
    if (!existsSync(home)) continue;
    const direct = path.join(home, 'bin', exe);
    if (existsSync(direct)) return direct;
    for (const entry of readdirSync(home, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(home, entry.name, 'bin', exe);
      if (existsSync(nested)) return nested;
    }
  }
  const onPath = spawnSync('java', ['-version'], { stdio: 'ignore' });
  return !onPath.error && onPath.status === 0 ? 'java' : null;
}

const javaExe = existsSync(jarPath) ? findJava() : null;
const skipReason = !existsSync(jarPath)
  ? 'dynamodb-local/DynamoDBLocal.jar not found (run `npm run db:local` once to download it)'
  : !javaExe
    ? 'no Java runtime found (install a JDK or set JAVA_HOME)'
    : false;

// ---------------------------------------------------------------------------
// Small helpers that do not depend on the server
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Emails go out just after the response; give them a moment before looking.
const flushEmails = () => sleep(150);
const key = () => `key-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (plusDays) => {
  const d = new Date(Date.now() + plusDays * 24 * 3600 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const pickupAck = () => ({ method: 'pickup', pickupDate: dayKey(10), pickupTime: '12:00', acknowledgedPickupNotice: V });
const SHIP = { method: 'shipping', shippingAddress: { line1: '1 Main St', city: 'Omaha', state: 'NE', zip: '68102' } };
const contactFor = (id) => ({ firstName: 'Test', lastName: id, email: `${id}@example.com` });
const detail = (r) => `${r.status} ${JSON.stringify(r.body)}`;
const textOf = (message) => message.Message.Body.Text.Data;
const htmlOf = (message) => message.Message.Body.Html.Data;

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

async function waitFor(check, what, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(150);
  }
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

// ---------------------------------------------------------------------------
// The harness: filled in by the `before` hook below, read by the tests
// ---------------------------------------------------------------------------

let dynamo = null; // the DynamoDB Local child process
let realConsole = null;
let BASE = '';

let api; // (method, path, body, token) -> { status, body }
let user; // (id, groups?) -> fake sign-in token for that user
let seed; // (id, rewards, role?) -> puts a customer row in the database
let balance; // (id) -> that customer's reward points
let allOrders; // () -> every order in the database
let putOrder; // (order) -> puts an order row straight into the database
let prods; // the menu, as the server sends it
let staffTok; // a staff member's token

let getOrderById;
let getCustomerById;
let createOrdersSpendingPoints;
let DuplicateOrderError;
let InsufficientPointsError;
let putCode;
let markVerified;
let PutCommand;
let docClient;
let CUSTOMERS_TABLE;

const sent = []; // every email the server "sent" (SES input objects)
const stripeState = { calls: [], refunds: [], failRefunds: false }; // what the server asked Stripe to do
const toCustomer = (email) => sent.filter((m) => m.Destination.ToAddresses.includes(email));
const creates = () => stripeState.calls.filter((c) => c === 'create').length;

async function startEverything() {
  const dbPort = await freePort();
  const serverPort = await freePort();

  // Every setting the server reads, forced BEFORE any backend module loads (backend/.env is never allowed to
  // decide anything here: dotenv only fills in settings that are not already set).
  Object.assign(process.env, {
    AWS_REGION: 'us-east-1',
    DYNAMODB_ENDPOINT: `http://127.0.0.1:${dbPort}`,
    AWS_ACCESS_KEY_ID: 'local',
    AWS_SECRET_ACCESS_KEY: 'local',
    PORT: String(serverPort),
    STRIPE_SECRET_KEY: 'sk_test_dummydummydummydummy',
    STRIPE_WEBHOOK_SECRET: 'whsec_dummydummydummydummydummy',
    COGNITO_USER_POOL_ID: 'us-east-1_testpool1',
    COGNITO_CLIENT_ID: 'testclient',
    COGNITO_REGION: 'us-east-1',
    SES_SENDER_EMAIL: 'orders@cozydoughcookies.com',
    SES_REPLY_TO_EMAIL: '',
    STAFF_NOTIFICATION_EMAIL: 'staff1@example.com,staff2@example.com',
    // No address checking: the USPS keys are blanked and its address points nowhere.
    USPS_CONSUMER_KEY: '',
    USPS_CONSUMER_SECRET: '',
    USPS_API_BASE_URL: 'http://127.0.0.1:9',
    CUSTOMERS_TABLE_NAME: 'TestCustomers',
    ORDERS_TABLE_NAME: 'TestOrders',
    EXTERNAL_SALES_TABLE_NAME: 'TestExternalSales',
    EMAIL_VERIFICATIONS_TABLE_NAME: 'TestEmailVerifications',
  });
  BASE = `http://127.0.0.1:${serverPort}`;

  // The database: DynamoDB Local, in memory, on its own port.
  dynamo = spawn(javaExe, ['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb', '-port', String(dbPort)], {
    cwd: dynamoDir,
    stdio: 'ignore',
  });
  dynamo.on('error', (err) => {
    throw new Error(`Could not start DynamoDB Local with "${javaExe}": ${err.message}`);
  });
  await waitFor(() => portOpen(dbPort), 'DynamoDB Local to start');

  // Faked services, installed on the very classes the server uses (same files, so the same objects).
  const { SESClient } = await import('@aws-sdk/client-ses');
  SESClient.prototype.send = async function (command) {
    sent.push(command.input);
    return {};
  };

  const { CognitoJwtVerifier } = await import('aws-jwt-verify');
  const TOKENS = {};
  user = (id, groups = ['customer']) => {
    TOKENS[`tok-${id}`] = {
      sub: id,
      email: `${id}@example.com`,
      given_name: 'Test',
      family_name: id,
      'cognito:groups': groups,
    };
    return `tok-${id}`;
  };
  CognitoJwtVerifier.prototype.verify = async function (token) {
    if (!TOKENS[token]) throw new Error('bad token');
    return TOKENS[token];
  };

  const { getStripeClient } = await import('../stripe/client.js');
  const stripe = getStripeClient();
  const piAmounts = {};
  const refundsByKey = new Map();
  let piCount = 0;
  let refundCount = 0;
  stripe.paymentIntents.create = async (params) => {
    const id = `pi_test_${++piCount}`;
    piAmounts[id] = params.amount;
    stripeState.calls.push('create');
    return { id, client_secret: `cs_${id}`, amount: params.amount };
  };
  stripe.paymentIntents.retrieve = async (id) => {
    stripeState.calls.push('retrieve');
    return {
      id,
      status: 'succeeded',
      amount: piAmounts[id],
      metadata: {},
      latest_charge: { payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } } },
    };
  };
  stripe.paymentIntents.update = async () => {
    stripeState.calls.push('update');
    return {};
  };
  stripe.refunds.create = async (params, options = {}) => {
    stripeState.calls.push('refund');
    stripeState.refunds.push({ params, key: options.idempotencyKey });
    if (stripeState.failRefunds) throw new Error('Stripe says: charge could not be refunded (test)');
    // Like Stripe, a repeat of the same idempotency key hands back the original refund.
    if (options.idempotencyKey && refundsByKey.has(options.idempotencyKey)) return refundsByKey.get(options.idempotencyKey);
    const refund = { id: `re_test_${++refundCount}`, amount: params.amount, status: 'succeeded', created: Math.floor(Date.now() / 1000) };
    if (options.idempotencyKey) refundsByKey.set(options.idempotencyKey, refund);
    return refund;
  };

  // The database layer. Refuse to go on unless it points at this computer.
  const client = await import('../db/client.js');
  const { baseClient } = client;
  docClient = client.docClient;
  const endpoint = typeof baseClient.config.endpoint === 'function' ? await baseClient.config.endpoint() : null;
  assert.ok(
    endpoint && ['127.0.0.1', 'localhost'].includes(endpoint.hostname),
    'The integration tests must only ever talk to a database on this computer.'
  );
  const schema = await import('../db/schema.js');
  CUSTOMERS_TABLE = schema.CUSTOMERS_TABLE;
  const { CreateTableCommand } = await import('@aws-sdk/client-dynamodb');
  for (const definition of [
    schema.ordersTableDefinition,
    schema.customersTableDefinition,
    schema.emailVerificationsTableDefinition,
    schema.externalSalesTableDefinition,
  ]) {
    await baseClient.send(new CreateTableCommand(definition));
  }
  const lib = await import('@aws-sdk/lib-dynamodb');
  PutCommand = lib.PutCommand;
  const { ScanCommand } = lib;

  ({ getCustomerById } = await import('../db/customersRepo.js'));
  ({ getOrderById, createOrdersSpendingPoints, DuplicateOrderError, InsufficientPointsError } = await import('../db/ordersRepo.js'));
  ({ putCode, markVerified } = await import('../db/verificationRepo.js'));

  seed = (id, rewards, role = 'customer') =>
    docClient.send(
      new PutCommand({
        TableName: schema.CUSTOMERS_TABLE,
        Item: { customerId: id, email: `${id}@example.com`, firstName: 'Test', lastName: id, role, rewards },
      })
    );
  balance = async (id) => (await getCustomerById(id))?.rewards;
  allOrders = async () => (await docClient.send(new ScanCommand({ TableName: schema.ORDERS_TABLE }))).Items ?? [];
  putOrder = (order) => docClient.send(new PutCommand({ TableName: schema.ORDERS_TABLE, Item: order }));

  // Start the real server. Its own log lines are swallowed so the test report stays readable.
  realConsole = { log: console.log, error: console.error, warn: console.warn };
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  await import('../index.js');
  api = async (method, urlPath, body, token) => {
    const res = await fetch(BASE + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* no body */
    }
    return { status: res.status, body: json };
  };
  await waitFor(async () => (await api('GET', '/api/health')).status === 200, 'the server to start', 15000);

  await seed('staff1', 0, 'staff');
  staffTok = user('staff1', ['staff']);
  prods = (await api('GET', '/api/products')).body;
}

function stopEverything() {
  if (realConsole) {
    console.log = realConsole.log;
    console.error = realConsole.error;
    console.warn = realConsole.warn;
  }
  if (dynamo) dynamo.kill();
}
process.on('exit', () => dynamo?.kill());

// ---------------------------------------------------------------------------
// The server tests
// ---------------------------------------------------------------------------

describe('Server end to end', { skip: skipReason }, () => {
  before(startEverything);
  after(stopEverything);

  // =========================================================================
  describe('Gobble Bucket (seasonal item)', () => {
    let G;
    let half;
    let g1;
    let salesBefore;
    const intent = (items, fulfillment = pickupAck(), token = g1) =>
      api('POST', '/api/checkout/create-payment-intent', { orders: [{ items, redemptions: [] }], contact: contactFor('g1'), fulfillment }, token);

    before(async () => {
      await seed('g1', 0);
      g1 = user('g1');
      G = prods.find((p) => p.type === 'seasonal_gobble_bucket');
      half = prods.find((p) => p.type === 'standard' && p.flavor === 'Chocolate Chip' && p.sizeLabel === 'Half Dozen');
      salesBefore = (await api('GET', '/api/sales?period=total', undefined, staffTok)).body.totalRevenue;
    });

    it('is on the menu exactly once, named, priced and described the way the menu shows it', () => {
      assert.equal(prods.filter((p) => p.type === 'seasonal_gobble_bucket').length, 1);
      assert.equal(prods.filter((p) => p.flavor === 'Gobble Bucket').length, 1);
      assert.equal(G.flavor, 'Gobble Bucket');
      assert.equal(G.price, 40);
      assert.equal(G.sizeLabel, 'Chocolate Chip, Monster & Sugar');
      assert.equal(G.menuDescription, 'A mix of mini chocolate chip, monster, and sugar cookies.');
      // An ordinary card with its own price, not a flavor picker, and nothing for the customer to choose.
      assert.equal(G.priceOnCard, true);
      assert.equal(G.pickerTitle, null);
      assert.equal(G.is_sold_out, false);
      // Not counted as cookies, and not any other kind of item.
      assert.equal(G.physicalCookieUnits, undefined);
      assert.ok(G.is_item && !G.is_batch && !G.is_bucket && !G.is_single && !G.is_half_dozen && !G.is_full_dozen);
    });

    it('is pickup only without being refrigerated, and the refrigerated items stay pickup only too', () => {
      assert.equal(G.is_temperature_controlled, false);
      assert.equal(G.is_pickup_only, true);
      const refrigerated = prods.filter((p) => p.is_temperature_controlled);
      assert.ok(refrigerated.length > 0);
      assert.ok(refrigerated.every((p) => p.is_pickup_only === true), 'every refrigerated product must also be pickup only');
      // The Gobble Bucket is the only pickup-only product that is not refrigerated.
      const notCold = prods.filter((p) => p.is_pickup_only && !p.is_temperature_controlled).map((p) => p.flavor);
      assert.deepEqual([...new Set(notCold)], ['Gobble Bucket']);
      // Ordinary cookies are neither, so they ship as before.
      assert.ok(prods.filter((p) => ['standard', 'special', 'premium'].includes(p.type)).every((p) => !p.is_pickup_only === !p.is_temperature_controlled));
    });

    it('leaves the rest of the menu alone, and has no standalone sugar cookie', () => {
      const others = prods.filter((p) => p.type !== 'seasonal_gobble_bucket');
      assert.ok(others.length > 50);
      assert.ok(others.every((p) => p.is_item === false && p.menuDescription === null), 'no other product should carry the seasonal fields');
      assert.ok(!prods.some((p) => p.baseFlavor === 'Sugar' || p.baseFlavor === 'Sugar Cookie'), 'sugar cookies exist only inside the bucket');
    });

    it('charges $40 for one, $80 for two, and adds it to an ordinary order', async () => {
      let r = await intent([{ id: G.id, qty: 1 }]);
      assert.ok(r.status === 200 && r.body.amount === 4000, detail(r));
      r = await intent([{ id: G.id, qty: 2 }]);
      assert.ok(r.status === 200 && r.body.amount === 8000, detail(r));
      r = await intent([{ id: G.id, qty: 1 }, { id: half.id, qty: 1 }]);
      assert.ok(r.status === 200 && r.body.amount === 5200, detail(r));
    });

    it('cannot be shipped, and says why: pickup only, not "temperature controlled"', async () => {
      let r = await intent([{ id: G.id, qty: 1 }], SHIP);
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /available for pickup only, not shipping/);
      assert.doesNotMatch(r.body.error, /temperature/);
      // Also when mixed with ordinary cookies that could ship alone.
      r = await intent([{ id: G.id, qty: 1 }, { id: half.id, qty: 1 }], SHIP);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /available for pickup only/);

      // Refrigerated items keep their own wording.
      const cheesecake = prods.find((p) => p.flavor === 'Strawberry Cheesecake' && p.sizeLabel === 'Half Dozen');
      r = await intent([{ id: cheesecake.id, qty: 1 }], SHIP);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /temperature-controlled items that can only be picked up, not shipped/);
      r = await intent([{ id: G.id, qty: 1 }, { id: cheesecake.id, qty: 1 }], SHIP);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /temperature-controlled/, 'the refrigerated reason is the one given when both are present');
      const bucket = prods.find((p) => p.type === 'bucket');
      r = await intent([{ id: bucket.id, qty: 1 }], SHIP);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /temperature-controlled/);

      // An ordinary order still ships.
      r = await intent([{ id: half.id, qty: 2 }], SHIP);
      assert.ok(r.status === 200 && r.body.amount > 0, detail(r));
    });

    it('refuses a zero quantity, a made-up variant, and a pickup order without the agreement', async () => {
      let r = await intent([{ id: G.id, qty: 0 }]);
      assert.equal(r.status, 400, detail(r));
      r = await intent([{ id: 'seasonal_gobble_bucket:gobble-bucket:bucket', qty: 1 }]);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Unknown product/);
      r = await intent([{ id: G.id, qty: 1 }], { ...pickupAck(), acknowledgedPickupNotice: undefined });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /agree to the pickup notice/);
    });

    it('is saved, and the customer and staff are emailed, when a paid order is placed', async () => {
      const cart = { orders: [{ items: [{ id: G.id, qty: 1 }], redemptions: [] }] };
      const fulfillment = pickupAck();
      const created = await api('POST', '/api/checkout/create-payment-intent', { ...cart, contact: contactFor('g1'), fulfillment }, g1);
      sent.length = 0;
      const placed = await api('POST', '/api/checkout', { ...cart, contact: contactFor('g1'), fulfillment, paymentIntentId: created.body.paymentIntentId }, g1);
      assert.ok(placed.status === 200 && placed.body.orders?.length === 1, detail(placed));

      const order = await getOrderById(placed.body.orders[0].orderId);
      const item = order.items[0];
      assert.equal(item.flavor, 'Gobble Bucket');
      assert.equal(item.sizeLabel, 'Chocolate Chip, Monster & Sugar');
      assert.equal(item.price, 40);
      assert.equal(item.qty, 1);
      assert.equal(item.is_temperature_controlled, false, 'nothing to keep cold');
      assert.equal(order.total, 40);
      assert.equal(order.fulfillment.method, 'pickup');
      assert.equal(order.pickupNotice?.version, V);
      assert.equal(await balance('g1'), 40, 'earns 1 point per dollar');

      await flushEmails();
      const receipt = textOf(toCustomer('g1@example.com')[0]);
      assert.match(receipt, /Gobble Bucket \(Chocolate Chip, Monster & Sugar\)/);
      assert.match(receipt, /\$40\.00/);
      const staffMail = textOf(toCustomer('staff1@example.com')[0]);
      assert.match(staffMail, /Gobble Bucket \(Chocolate Chip, Monster & Sugar\)/, 'so the baker knows what to make');
    });

    it('can be marked out of stock by staff, which stops orders for it until it is back', async () => {
      const toggle = (soldOut) => api('POST', `/api/products/${encodeURIComponent(G.id)}/set-sold-out`, { is_sold_out: soldOut }, staffTok);
      try {
        let r = await toggle(true);
        assert.ok(r.status === 200 && r.body.is_sold_out === true, detail(r));
        r = await intent([{ id: G.id, qty: 1 }]);
        assert.equal(r.status, 400);
        assert.match(r.body.error, /Gobble Bucket \(Chocolate Chip, Monster & Sugar\) is sold out/);
      } finally {
        await toggle(false);
      }
      const back = await intent([{ id: G.id, qty: 1 }]);
      assert.equal(back.status, 200, detail(back));
    });

    it('shows up in Sales as an item sold, and is not counted as cookies', async () => {
      const sales = await api('GET', '/api/sales?period=total', undefined, staffTok);
      assert.equal(sales.status, 200, detail(sales));
      const sold = sales.body.itemsSold.find((x) => x.flavor === 'Gobble Bucket');
      assert.ok(sold, 'Gobble Bucket should be listed under items sold');
      assert.equal(sold.qty, 1);
      assert.equal(sold.revenue, 40);
      assert.equal(sold.sizeLabel, 'Chocolate Chip, Monster & Sugar');
      assert.equal(sales.body.totalRevenue - salesBefore, 40);
      assert.ok(!sales.body.flavorsSold.some((x) => /Gobble/.test(x.flavor)), 'a bucket is not a cookie count');
    });
  });

  // =========================================================================
  describe('Minimum order and points-only checkout', () => {
    let single;
    let half;
    let c1, c2, c3, c4, c5, c6;
    let k1;
    let order1;
    const reward = (k, flavors = ['Snickerdoodle']) => ({ key: k, flavors });
    const cart = (items, redemptions = []) => ({ orders: [{ items, redemptions }] });
    const intent = (id, token, orders, fulfillment = pickupAck()) =>
      api('POST', '/api/checkout/create-payment-intent', { ...orders, contact: contactFor(id), fulfillment }, token);
    const checkout = (id, token, orders, extra = {}) =>
      api('POST', '/api/checkout', { ...orders, contact: contactFor(id), fulfillment: pickupAck(), ...extra }, token);
    const find = (flavor, sizeLabel) => prods.find((p) => p.type === 'standard' && p.flavor === flavor && p.sizeLabel === sizeLabel);

    before(async () => {
      await seed('c1', 350);
      await seed('c2', 300);
      await seed('c3', 0);
      await seed('c4', 100);
      await seed('c5', 600);
      c1 = user('c1');
      c2 = user('c2');
      c3 = user('c3');
      c4 = user('c4');
      c5 = user('c5');
      // A guest who has already verified their email, as the real flow would leave them.
      await putCode('g@example.com', '123456');
      await markVerified('g@example.com', '123456', 5);
      single = find('Chocolate Chip', 'Single');
      half = find('Chocolate Chip', 'Half Dozen');
      stripeState.calls.length = 0;
    });

    it('still requires $12 for an ordinary order, for signed-in customers and verified guests alike', async () => {
      assert.ok(single && half, 'test products found');
      // The menu prices the server sends: a standard single is $2.50 and a special single $3.50.
      assert.equal(single.price, 2.5);
      assert.equal(prods.find((p) => p.type === 'special' && p.sizeLabel === 'Single').price, 3.5);
      let r = await intent('c1', c1, cart([{ id: single.id, qty: 1 }]));
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /at least \$12\.00/);
      r = await intent('c1', c1, cart([{ id: single.id, qty: 4 }])); // 4 x $2.50 = $10
      assert.equal(r.status, 400);
      assert.match(r.body.error, /at least \$12\.00/);
      r = await intent('c1', c1, cart([{ id: single.id, qty: 5 }])); // 5 x $2.50 = $12.50, just over the minimum
      assert.ok(r.status === 200 && r.body.amount === 1250, detail(r));
      r = await intent('c1', c1, cart([{ id: half.id, qty: 1 }])); // $12
      assert.ok(r.status === 200 && r.body.amount === 1200 && !!r.body.clientSecret, detail(r));

      r = await api('POST', '/api/checkout/create-payment-intent', { ...cart([{ id: single.id, qty: 1 }]), contact: contactFor('g'), fulfillment: pickupAck() });
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /at least \$12\.00/);
      // A guest who has not verified their email is stopped before the minimum is even looked at.
      r = await api('POST', '/api/checkout/create-payment-intent', { ...cart([{ id: single.id, qty: 1 }]), contact: contactFor('nobody'), fulfillment: pickupAck() });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /verify your email/);
    });

    it('exempts an order that redeems a reward from the $12 minimum', async () => {
      const before = creates();
      let r = await intent('c1', c1, cart([{ id: single.id, qty: 1 }], [reward('standard-single')]));
      assert.ok(r.status === 200 && r.body.amount === 250 && !!r.body.clientSecret, `only the paid $2.50 single is charged: ${detail(r)}`);
      r = await intent('c1', c1, cart([], [reward('standard-single')]));
      assert.ok(r.status === 200 && r.body.free === true && r.body.amount === 0, `a reward alone is free: ${detail(r)}`);
      assert.equal(creates() - before, 1, 'no Stripe payment is created for the free order');
    });

    it('checks the points balance before anything is charged', async () => {
      let r = await intent('c3', c3, cart([{ id: single.id, qty: 1 }], [reward('standard-single')]));
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /You need 50 points/);
      assert.match(r.body.error, /have 0/);

      const createsBefore = creates();
      const callsBefore = stripeState.calls.length;
      r = await checkout('c3', c3, cart([{ id: single.id, qty: 1 }], [reward('standard-single')]), { paymentIntentId: 'pi_made_up' });
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /You need 50 points/);
      assert.ok(!stripeState.calls.slice(callsBefore).includes('retrieve'), 'Stripe is never consulted');
      assert.equal(creates(), createsBefore, 'no payment was created');
      assert.equal((await allOrders()).filter((o) => o.customerId === 'c3').length, 0, 'and no order exists');

      r = await intent('c4', c4, cart([], [reward('standard-half-dozen')]));
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /You need 300 points/);
      assert.match(r.body.error, /have 100/);
      r = await api('POST', '/api/checkout/create-payment-intent', { ...cart([], [reward('standard-single')]), contact: contactFor('g'), fulfillment: pickupAck() });
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /Sign in/, 'a guest cannot redeem at all');
    });

    it('places a points-only order for $0 that spends exactly the points and never touches Stripe', async () => {
      sent.length = 0;
      stripeState.calls.length = 0;
      k1 = key();
      const r = await checkout('c1', c1, cart([], [reward('standard-half-dozen')]), { checkoutKey: k1 });
      assert.ok(r.status === 200 && r.body.message === 'Order placed!', detail(r));
      order1 = r.body.orders[0];
      assert.equal(r.body.grandTotal, 0);
      assert.deepEqual(
        { spent: r.body.rewards.spent, earned: r.body.rewards.earned, balance: r.body.rewards.balance },
        { spent: 300, earned: 0, balance: 50 }
      );

      const saved = await getOrderById(order1.orderId);
      assert.equal(saved.status, 'placed');
      assert.equal(saved.total, 0);
      assert.equal(saved.pointsSpent, 300);
      assert.equal(saved.pointsEarned, 0);
      assert.equal(saved.customerId, 'c1');
      assert.equal(saved.payment, undefined, 'nothing was paid, so there is no payment record');
      assert.equal(await balance('c1'), 50, '350 - 300');
      assert.equal(saved.items.length, 1);
      assert.match(saved.items[0].flavor, /Standard Half Dozen/);
      assert.equal(saved.items[0].price, 0);
      assert.equal(saved.items[0].isReward, true);
      assert.equal(saved.items[0].pointsCost, 300);
      assert.equal(stripeState.calls.length, 0, 'Stripe was never touched');
    });

    it('labels the redeemed reward in the receipt and in the staff email', async () => {
      await flushEmails();
      const toC1 = toCustomer('c1@example.com')[0];
      const toStaff = toCustomer('staff1@example.com')[0];
      assert.ok(toC1, 'the customer got a receipt');
      assert.match(textOf(toC1), /Pickup address: 15003 S 21st St/);
      assert.match(textOf(toC1), /Redeemed with 300 points/);
      assert.match(textOf(toC1), /Points redeemed: 300/);
      assert.match(htmlOf(toC1), /Redeemed with points/);
      assert.ok(toStaff, 'staff got the new-order email');
      assert.match(textOf(toStaff), /Redeemed with 300 points/);
      assert.equal(toStaff.Destination.ToAddresses.length, 2, 'both staff addresses, in one message');
    });

    it('places an order exactly once, however many times it is sent', async () => {
      let r = await checkout('c1', c1, cart([], [reward('standard-half-dozen')]), { checkoutKey: k1 });
      assert.equal(r.status, 409, detail(r));
      assert.match(r.body.error, /already been placed/, 'not "you need 300 points"');
      assert.equal(await balance('c1'), 50);
      assert.equal((await allOrders()).filter((o) => o.customerId === 'c1').length, 1);

      await seed('c6', 1000);
      c6 = user('c6');
      const sameKey = key();
      const results = await Promise.all(Array.from({ length: 8 }, () => checkout('c6', c6, cart([], [reward('standard-half-dozen')]), { checkoutKey: sameKey })));
      assert.equal(results.filter((x) => x.status === 200).length, 1, results.map((x) => x.status).join(','));
      assert.equal(results.filter((x) => x.status === 409).length, 7);
      assert.equal(await balance('c6'), 700, 'the 300 points were taken exactly once');
      assert.equal((await allOrders()).filter((o) => o.customerId === 'c6').length, 1);
    });

    it('lets only one of two different checkouts racing for the same points through', async () => {
      const racers = await Promise.all([
        checkout('c2', c2, cart([], [reward('standard-half-dozen')]), { checkoutKey: key() }),
        checkout('c2', c2, cart([], [reward('standard-half-dozen')]), { checkoutKey: key() }),
      ]);
      assert.deepEqual(racers.map((x) => x.status).sort(), [200, 400]);
      assert.equal(await balance('c2'), 0, 'never negative');
      assert.equal((await allOrders()).filter((o) => o.customerId === 'c2').length, 1);
      const loser = racers.find((x) => x.status === 400);
      assert.match(loser.body.error, /enough reward points|You need 300 points/, 'the loser is told why');
    });

    it('gives nothing away to bad requests', async () => {
      const before = (await allOrders()).length;
      let r = await checkout('c5', c5, cart([], [reward('standard-single')]));
      assert.equal(r.status, 400, `no checkoutKey: ${detail(r)}`);
      r = await checkout('c5', c5, cart([], [reward('standard-single')]), { checkoutKey: 'short' });
      assert.equal(r.status, 400, 'malformed checkoutKey');
      r = await checkout('c5', c5, cart([], [reward('standard-single')]), { checkoutKey: 'x'.repeat(200) });
      assert.equal(r.status, 400, 'oversized checkoutKey');
      assert.equal((await allOrders()).length, before, 'no order was created');
      assert.equal(await balance('c5'), 600, 'and the balance is untouched');

      const callsBefore = stripeState.calls.length;
      r = await checkout('c5', c5, cart([], [reward('standard-single')]), { checkoutKey: key(), paymentIntentId: 'pi_whatever' });
      assert.equal(r.status, 200, 'a stray paymentIntentId on a $0 checkout is ignored');
      assert.equal(await balance('c5'), 550);
      assert.equal(stripeState.calls.length, callsBefore, 'it is placed, not charged');

      r = await api('POST', '/api/checkout', { ...cart([], [reward('standard-single')]), contact: contactFor('g'), fulfillment: pickupAck(), checkoutKey: key() });
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /Sign in/, 'signed out, even as a verified guest');

      const shipped = await api('POST', '/api/checkout/create-payment-intent', { ...cart([], [reward('standard-single')]), contact: contactFor('c5'), fulfillment: SHIP }, c5);
      assert.ok(shipped.status === 200 && shipped.body.amount > 0 && !shipped.body.free, `shipping a reward still costs the fee: ${detail(shipped)}`);
    });

    it('places several reward orders from one checkout together, each with its own points', async () => {
      const r = await checkout('c4', c4, { orders: [{ items: [], redemptions: [reward('standard-single')] }, { items: [], redemptions: [reward('standard-single')] }] }, { checkoutKey: key() });
      assert.ok(r.status === 200 && r.body.orders.length === 2, detail(r));
      assert.ok(r.body.orders.every((o) => o.pointsSpent === 50));
      assert.equal(await balance('c4'), 0, '100 - 50 - 50');
      assert.equal(new Set(r.body.orders.map((o) => o.orderId)).size, 2);
    });

    it('gives the points back when staff cancel a points-only order, once, and they can be spent again', async () => {
      const callsBefore = stripeState.calls.length;
      const cancel = await api('POST', `/api/orders/${order1.orderId}/cancel`, { refund: true }, staffTok);
      assert.ok(cancel.status === 200 && cancel.body.status === 'canceled', detail(cancel));
      assert.equal(cancel.body.pointsAdjustment?.spentReturned, 300);
      assert.equal(cancel.body.pointsAdjustment?.earnedTakenBack, 0);
      assert.equal(await balance('c1'), 350, '50 + 300');
      assert.equal(stripeState.calls.length, callsBefore, 'no payment, so Stripe is not involved');

      const again = await api('POST', `/api/orders/${order1.orderId}/cancel`, { refund: true }, staffTok);
      assert.equal(again.status, 400, 'canceling twice is refused');
      assert.equal(await balance('c1'), 350, 'and returns no more points');

      await flushEmails();
      const cancelEmail = toCustomer('c1@example.com').at(-1);
      assert.match(textOf(cancelEmail), /300 reward points/);

      const r = await checkout('c1', c1, cart([], [reward('standard-half-dozen')]), { checkoutKey: key() });
      assert.equal(r.status, 200, detail(r));
      assert.equal(await balance('c1'), 50, 'the returned points can be spent again');
    });

    it('saves orders and the points deduction together or not at all', async () => {
      const rec = (orderId) => ({
        orderId,
        status: 'placed',
        items: [],
        subtotal: 0,
        total: 0,
        contact: contactFor('c5'),
        email: 'c5@example.com',
        fulfillment: pickupAck(),
        createdAt: new Date().toISOString(),
        customerId: 'c5',
        pointsEarned: 0,
        pointsSpent: 10,
      });
      const attempt = async (records, customerId, points) => {
        try {
          await createOrdersSpendingPoints(records, customerId, points);
          return null;
        } catch (err) {
          return err;
        }
      };

      await seed('c7', 5);
      let err = await attempt([rec('tx-1'), rec('tx-2')], 'c7', 10);
      assert.ok(err instanceof InsufficientPointsError, 'not enough points');
      assert.ok(!(await getOrderById('tx-1')) && !(await getOrderById('tx-2')), 'neither order was written');
      assert.equal(await balance('c7'), 5);

      await seed('c8', 100);
      assert.equal(await attempt([rec('tx-3')], 'c8', 10), null);
      err = await attempt([rec('tx-3')], 'c8', 10);
      assert.ok(err instanceof DuplicateOrderError, 'an order id that already exists');
      assert.equal(await balance('c8'), 90, 'the points were not spent a second time (90, not 80)');

      err = await attempt([rec('tx-4')], 'no-such-customer', 10);
      assert.ok(err instanceof InsufficientPointsError, 'a customer row that does not exist');
      assert.ok(!(await getOrderById('tx-4')));

      await docClient.send(new PutCommand({ TableName: CUSTOMERS_TABLE, Item: { customerId: 'c9', email: 'c9@example.com' } }));
      err = await attempt([rec('tx-5')], 'c9', 1);
      assert.ok(err instanceof InsufficientPointsError, 'a customer row with no rewards attribute at all');
      assert.ok(!(await getOrderById('tx-5')));
    });

    it('leaves the ordinary paid checkout untouched', async () => {
      let r = await intent('c1', c1, cart([{ id: half.id, qty: 2 }]));
      assert.ok(r.status === 200 && r.body.amount === 2400, detail(r));
      assert.match(r.body.clientSecret, /^cs_/);
      r = await checkout('c1', c1, cart([{ id: half.id, qty: 1 }]));
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /Payment is required/);
    });
  });

  // =========================================================================
  describe('Rewards with several flavors', () => {
    let m1;
    const CC = 'Chocolate Chip', SN = 'Snickerdoodle', OA = 'Oatmeal', BU = 'Butter', MM = 'M&M', MO = 'Monster', PB = 'Peanut Butter', OR = 'Oatmeal Raisin', BS = 'Butterscotch';
    const SCH = 'Strawberry Cheesecake', BR = 'Brownie', OCP = 'Oatmeal Cream Pie';
    const redeem = (k, flavors) => ({ orders: [{ items: [], redemptions: [{ key: k, flavors }] }] });
    const intent = (orders, fulfillment = pickupAck()) =>
      api('POST', '/api/checkout/create-payment-intent', { ...orders, contact: contactFor('m1'), fulfillment }, m1);
    const place = (orders, fulfillment = pickupAck()) =>
      api('POST', '/api/checkout', { ...orders, contact: contactFor('m1'), fulfillment, checkoutKey: key() }, m1);
    const accepted = (r, label) => assert.ok(r.status === 200 && r.body.free === true && r.body.amount === 0, `${label}: expected accepted, got ${detail(r)}`);
    const refused = (r, label) => assert.equal(r.status, 400, `${label}: expected refused, got ${detail(r)}`);
    const savedItem = async (r) => (await getOrderById(r.body.orders[0].orderId)).items[0];

    before(async () => {
      await seed('m1', 30000);
      m1 = user('m1');
    });

    it('tells the browser how each reward splits into portions, and keeps the point costs', async () => {
      const catalog = (await api('GET', '/api/rewards/catalog')).body;
      const want = {
        'standard-single': [1, 1, 1], 'special-single': [1, 1, 1], 'premium-single': [1, 1, 1],
        'standard-half-dozen': [6, 6, 1], 'special-half-dozen': [6, 6, 1], 'premium-half-dozen': [6, 6, 1],
        'standard-dozen': [12, 6, 2], 'special-dozen': [12, 6, 2], 'premium-dozen': [12, 6, 2],
        'standard-2dozen': [24, 6, 4], 'special-2dozen': [24, 6, 4], 'premium-2dozen': [24, 6, 4],
        'standard-3dozen': [36, 6, 6], 'special-3dozen': [36, 6, 6],
        'standard-4dozen': [48, 6, 8], 'special-4dozen': [48, 6, 8],
      };
      for (const [rewardKey, [cookies, slotCookies, slots]] of Object.entries(want)) {
        const entry = catalog.find((c) => c.key === rewardKey);
        assert.ok(entry, `${rewardKey} is in the catalog`);
        assert.deepEqual([entry.cookies, entry.slotCookies, entry.flavorSlots], [cookies, slotCookies, slots], rewardKey);
      }
      assert.equal(catalog.length, Object.keys(want).length, 'every reward in the catalog is covered');
      const costs = { 'standard-dozen': 600, 'standard-2dozen': 1200, 'standard-3dozen': 1800, 'standard-4dozen': 2400, 'standard-single': 50, 'special-single': 75, 'special-dozen': 900 };
      for (const [rewardKey, points] of Object.entries(costs)) {
        assert.equal(catalog.find((c) => c.key === rewardKey).points, points, rewardKey);
      }
    });

    it('allows exactly one flavor for a single and a half dozen', async () => {
      accepted(await intent(redeem('standard-half-dozen', [OA])), 'half dozen, 1 flavor');
      refused(await intent(redeem('standard-half-dozen', [OA, BU])), 'half dozen, 2 flavors');
      refused(await intent(redeem('standard-half-dozen', [])), 'half dozen, no flavor');
      accepted(await intent(redeem('standard-single', [BU])), 'single, 1 flavor');
      refused(await intent(redeem('standard-single', [BU, OA])), 'single, 2 flavors');
    });

    it('allows a dozen at most two flavors, six cookies each', async () => {
      accepted(await intent(redeem('standard-dozen', [CC, SN])), 'dozen, 6 + 6');
      accepted(await intent(redeem('standard-dozen', [OA, OA])), 'dozen, 12 of one flavor');
      refused(await intent(redeem('standard-dozen', [CC, SN, OA])), 'dozen, 3 flavors');
      const oneOnly = await intent(redeem('standard-dozen', [CC]));
      refused(oneOnly, 'dozen, 1 pick (the old one-flavor shape): a half-filled order can never be placed');
      refused(await intent(redeem('standard-dozen', [])), 'dozen, none');
    });

    it('allows two, three and four dozen as many flavors as they have six-cookie portions', async () => {
      accepted(await intent(redeem('standard-2dozen', [CC, SN, OA, BU])), 'two dozen, 4 flavors');
      accepted(await intent(redeem('standard-2dozen', [CC, CC, CC, SN])), 'two dozen, 18 + 6');
      accepted(await intent(redeem('standard-2dozen', [CC, CC, SN, SN])), 'two dozen, 12 + 12');
      accepted(await intent(redeem('standard-2dozen', [CC, CC, CC, CC])), 'two dozen, 24 of one');
      refused(await intent(redeem('standard-2dozen', [CC, SN, OA, BU, MM])), 'two dozen, 5 flavors');
      refused(await intent(redeem('standard-2dozen', [CC, SN])), 'two dozen, 2 picks');
      accepted(await intent(redeem('standard-3dozen', [CC, SN, OA, BU, MM, MO])), 'three dozen, 6 flavors');
      refused(await intent(redeem('standard-3dozen', [CC, SN, OA, BU, MM, MO, PB])), 'three dozen, 7 flavors');
      accepted(await intent(redeem('standard-4dozen', [CC, SN, OA, BU, MM, MO, PB, OR])), 'four dozen, 8 flavors');
      refused(await intent(redeem('standard-4dozen', [CC, SN, OA, BU, MM, MO, PB, OR, BS])), 'four dozen, 9 flavors');
      refused(await intent(redeem('standard-4dozen', [CC, SN, OA, BU, MM, MO])), 'four dozen, 6 picks');
    });

    it("only accepts flavors that belong to the reward's type, and only real flavor names", async () => {
      let r = await intent(redeem('standard-dozen', [BR, OA]));
      refused(r, 'a special flavor in a standard reward');
      assert.match(r.body.error, /Invalid flavor/);
      accepted(await intent(redeem('special-dozen', [SCH, BR])), 'special dozen, cheesecake + brownie');
      refused(await intent(redeem('special-dozen', [CC, BR])), 'special dozen with a standard flavor');
      accepted(await intent(redeem('premium-2dozen', [OCP, OCP, OCP, OCP])), 'premium two dozen');
      refused(await intent(redeem('premium-dozen', [OCP, CC])), 'premium dozen with a non-premium flavor');
      refused(await intent(redeem('standard-dozen', [{ a: 1 }, 5])), 'objects and numbers as flavors');
      refused(await intent(redeem('standard-dozen', [null, null])), 'nulls as flavors');
      refused(await intent({ orders: [{ items: [], redemptions: [{ key: 'standard-dozen', flavors: 'Chocolate Chip' }] }] }), 'flavors as a string');
      refused(await intent({ orders: [{ items: [], redemptions: [{ key: 'standard-dozen' }] }] }), 'flavors missing');
    });

    it('saves, charges and emails the flavor split when a mixed dozen is placed', async () => {
      sent.length = 0;
      const before = await getCustomerById('m1');
      const r = await place(redeem('standard-dozen', [CC, SN]));
      assert.ok(r.status === 200 && r.body.grandTotal === 0 && r.body.rewards?.spent === 600, detail(r));
      const item = await savedItem(r);
      assert.equal(item.flavor, 'Standard Dozen: 6 Chocolate Chip, 6 Snickerdoodle');
      assert.equal(item.physicalCookieUnits, 12);
      assert.equal(item.price, 0);
      assert.equal(item.isReward, true);
      assert.equal(item.pointsCost, 600);
      assert.equal((await getCustomerById('m1')).rewards, before.rewards - 600);

      await flushEmails();
      const receipt = textOf(toCustomer('m1@example.com')[0]);
      assert.match(receipt, /Standard Dozen: 6 Chocolate Chip, 6 Snickerdoodle/);
      assert.match(receipt, /Redeemed with 600 points/);
      assert.ok(
        toCustomer('staff1@example.com').some((m) => /6 Chocolate Chip, 6 Snickerdoodle/.test(textOf(m))),
        'the staff email shows the split too, so the baker knows what to make'
      );
    });

    it('names larger redemptions, and single-flavor ones, correctly on the saved order line', async () => {
      let item = await savedItem(await place(redeem('standard-2dozen', [CC, CC, CC, SN])));
      assert.equal(item.flavor, 'Two Dozen Standard: 18 Chocolate Chip, 6 Snickerdoodle');
      assert.equal(item.physicalCookieUnits, 24);
      assert.equal(item.pointsCost, 1200);

      item = await savedItem(await place(redeem('standard-dozen', [OA, OA])));
      assert.equal(item.flavor, 'Standard Dozen: Oatmeal', 'a dozen of one flavor reads simply');

      item = await savedItem(await place(redeem('standard-3dozen', [CC, SN, OA, BU, MM, MO])));
      assert.equal(item.flavor, 'Three Dozen Standard: 6 Chocolate Chip, 6 Snickerdoodle, 6 Oatmeal, 6 Butter, 6 M&M, 6 Monster');
      assert.equal(item.physicalCookieUnits, 36);

      item = await savedItem(await place(redeem('standard-half-dozen', [BS])));
      assert.equal(item.flavor, 'Standard Half Dozen: Butterscotch');
      assert.equal(item.physicalCookieUnits, 6);
    });

    it('still treats pickup-only flavors and shipping fees as before', async () => {
      let r = await intent(redeem('special-dozen', [SCH, BR]), SHIP);
      refused(r, 'a dozen with one refrigerated flavor cannot ship');
      assert.match(r.body.error, /temperature-controlled/);

      r = await place(redeem('special-dozen', [SCH, BR]));
      const item = await savedItem(r);
      assert.equal(r.status, 200, detail(r));
      assert.equal(item.is_temperature_controlled, true, 'but it can be picked up, and is marked refrigerated');
      assert.equal(item.flavor, 'Special Dozen: 6 Strawberry Cheesecake, 6 Brownie');

      r = await intent(redeem('special-dozen', [BR, BR]), SHIP);
      assert.ok(r.status === 200 && r.body.amount === 2400 && !r.body.free, `a dozen of only Brownie ships for the $24 fee: ${detail(r)}`);
      r = await intent(redeem('standard-3dozen', [CC, SN, OA, BU, MM, MO]), SHIP);
      assert.ok(r.status === 200 && r.body.amount === 2400, `36 cookies ship at the $24 box rate: ${detail(r)}`);
      r = await intent(redeem('standard-4dozen', [CC, SN, OA, BU, MM, MO, PB, OR]), SHIP);
      assert.ok(r.status === 200 && r.body.amount === 3000, `48 cookies ship at the $30 box rate: ${detail(r)}`);
    });
  });

  // =========================================================================
  describe('Refund after pickup', () => {
    let half;
    let r1, r2;
    let salesBefore;
    let paidA, paidB, paidC, freeD, guestId, keptId;
    const refundCalls = stripeState.refunds;
    const sumSales = async () => {
      const body = (await api('GET', '/api/sales?period=total', undefined, staffTok)).body;
      return { revenue: body.totalRevenue, qty: (body.itemsSold ?? []).reduce((n, i) => n + i.qty, 0) };
    };

    async function placePaid(id, token, qty = 1) {
      const cart = { orders: [{ items: [{ id: half.id, qty }], redemptions: [] }] };
      const fulfillment = pickupAck();
      const i = await api('POST', '/api/checkout/create-payment-intent', { ...cart, contact: contactFor(id), fulfillment }, token);
      const c = await api('POST', '/api/checkout', { ...cart, contact: contactFor(id), fulfillment, paymentIntentId: i.body.paymentIntentId }, token);
      return c.body.orders[0].orderId;
    }
    async function placeFree(id, token) {
      const cart = { orders: [{ items: [], redemptions: [{ key: 'standard-half-dozen', flavors: ['Snickerdoodle'] }] }] };
      const c = await api('POST', '/api/checkout', { ...cart, contact: contactFor(id), fulfillment: pickupAck(), checkoutKey: key() }, token);
      return c.body.orders[0].orderId;
    }
    const confirm = (id) => api('POST', `/api/orders/${id}/confirm-pickup`, { pickupDate: pickupAck().pickupDate, pickupTime: '12:00' }, staffTok);
    const setStatus = (id, status) => api('POST', `/api/orders/${id}/set-status`, { status }, staffTok);
    const complete = (id) => api('POST', `/api/orders/${id}/complete`, undefined, staffTok);
    async function pickedUp(id) {
      await confirm(id);
      await setStatus(id, 'ready');
      return complete(id);
    }
    const refund = (id, token = staffTok) => api('POST', `/api/orders/${id}/refund`, {}, token);

    before(async () => {
      await seed('r1', 1000);
      await seed('r2', 1000);
      r1 = user('r1');
      r2 = user('r2');
      half = prods.find((p) => p.type === 'standard' && p.flavor === 'Chocolate Chip' && p.sizeLabel === 'Half Dozen');
      salesBefore = await sumSales();
      refundCalls.length = 0;
      stripeState.failRefunds = false;
    });

    it('only refunds a picked-up order, and only for staff', async () => {
      paidA = await placePaid('r1', r1, 1); // $12 paid, earns 12 points
      assert.equal(await balance('r1'), 1012, 'setup: points earned');
      let r = await refund(paidA, r1);
      assert.equal(r.status, 403, `a customer cannot call it: ${detail(r)}`);
      r = await api('POST', `/api/orders/${paidA}/refund`, {});
      assert.equal(r.status, 401, 'signed out');
      r = await refund('no-such-order');
      assert.equal(r.status, 404);
      r = await refund(paidA);
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /Active Orders/, 'an order still in progress is canceled from Active Orders instead');
      assert.equal(refundCalls.length, 0, 'nothing was refunded');
      assert.equal((await getOrderById(paidA)).status, 'placed', 'and the order is untouched');
    });

    it('refunds exactly what was paid, records it, and takes back the points it earned', async () => {
      const rc = await pickedUp(paidA);
      assert.equal(rc.status, 200, `setup: marked picked up: ${detail(rc)}`);
      assert.equal((await getOrderById(paidA)).status, 'completed');
      const cancelTry = await api('POST', `/api/orders/${paidA}/cancel`, { refund: true }, staffTok);
      assert.equal(cancelTry.status, 400, 'the ordinary cancel still refuses a completed order');
      assert.match(cancelTry.body.error, /no longer be canceled/);

      sent.length = 0;
      const before = await getOrderById(paidA);
      const r = await refund(paidA);
      assert.ok(r.status === 200 && r.body.status === 'canceled' && r.body.refundedAfterCompletion === true, detail(r));
      assert.equal(refundCalls.length, 1, 'Stripe was asked once');
      assert.equal(refundCalls[0].params.amount, 1200, 'for exactly $12.00');
      assert.equal(refundCalls[0].params.payment_intent, before.payment.paymentIntentId);
      assert.equal(refundCalls[0].key, `order-cancel-refund-${paidA}`, 'with the per-order duplicate-protection key');

      const o = await getOrderById(paidA);
      assert.equal(o.status, 'canceled');
      assert.ok(o.canceledAt);
      assert.equal(o.refundedAfterCompletion, true);
      assert.equal(o.refund?.amount, 1200);
      assert.equal(o.refund?.status, 'succeeded');
      assert.ok(o.completedAt && o.completedAt === before.completedAt, 'completedAt is kept: it was picked up, then refunded');
      assert.equal(o.pickupNotice?.version, V, 'the agreement record is untouched');
      assert.equal(o.total, 12);
      assert.equal(o.items.length, 1);
      assert.equal(await balance('r1'), 1000, 'the 12 earned points were taken back');
      assert.deepEqual({ taken: o.pointsAdjustment?.earnedTakenBack, returned: o.pointsAdjustment?.spentReturned }, { taken: 12, returned: 0 });
      assert.equal(r.body.pointsAdjustment?.earnedTakenBack, 12, 'the response reports the points movement');
    });

    it('emails the customer a refund, not a cancellation', async () => {
      await flushEmails();
      const email = toCustomer('r1@example.com').at(-1);
      assert.equal(email.Message.Subject.Data, 'Your Cozy Dough Cookies refund');
      const text = textOf(email);
      assert.match(text, /Your order has been refunded\./);
      assert.doesNotMatch(text, /canceled/i);
      assert.match(text, /A refund of \$12\.00 has been issued to your original payment method\. It can take 5-10 business days/);
      assert.doesNotMatch(text, /Pickup address|Pickup time/, 'that part is over');
      assert.match(htmlOf(email), /Your order has been refunded\./);
      assert.match(htmlOf(email), /\$12\.00/);
    });

    it('never pays twice when asked again', async () => {
      const calls = refundCalls.length;
      const points = await balance('r1');
      const emails = toCustomer('r1@example.com').length;
      const r = await refund(paidA);
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /already been canceled or refunded/);
      assert.equal(refundCalls.length, calls, 'no Stripe call');
      assert.equal(await balance('r1'), points, 'no points moved');
      assert.equal(toCustomer('r1@example.com').length, emails, 'no second email');
    });

    it('changes nothing when Stripe refuses, and works on a retry', async () => {
      paidB = await placePaid('r1', r1, 2); // $24
      await pickedUp(paidB);
      const points = await balance('r1');
      sent.length = 0;
      stripeState.failRefunds = true;
      try {
        const r = await refund(paidB);
        assert.equal(r.status, 502, detail(r));
        assert.match(r.body.error, /Stripe says: charge could not be refunded/);
        assert.match(r.body.error, /left as it was/);
        const o = await getOrderById(paidB);
        assert.equal(o.status, 'completed');
        assert.ok(!o.refund && !o.refundedAfterCompletion);
        assert.equal(await balance('r1'), points, 'points unmoved');
        assert.equal(sent.length, 0, 'no email');
      } finally {
        stripeState.failRefunds = false;
      }
      const retry = await refund(paidB);
      assert.ok(retry.status === 200 && retry.body.refund?.amount === 2400, detail(retry));
    });

    it('refunds once and moves points once even when the button is double-clicked', async () => {
      paidC = await placePaid('r1', r1, 1);
      await pickedUp(paidC);
      const points = await balance('r1');
      const callsBefore = refundCalls.length;
      sent.length = 0;
      const results = await Promise.all([refund(paidC), refund(paidC), refund(paidC)]);
      assert.equal(results.filter((x) => x.status === 200).length, 1, results.map((x) => x.status).join(','));
      assert.equal(results.filter((x) => x.status === 400).length, 2, 'the others are told it is already refunded');
      assert.equal(new Set(refundCalls.slice(callsBefore).map((c) => c.key)).size, 1, 'Stripe saw one idempotency key');
      assert.equal(await balance('r1'), points - 12, 'the 12 earned points were taken back exactly once');
      await flushEmails();
      assert.equal(toCustomer('r1@example.com').length, 1, 'only one refund email');
    });

    it('returns the points of a refunded points-only order, with no Stripe call and no money line', async () => {
      freeD = await placeFree('r2', r2);
      assert.equal(await balance('r2'), 700, 'setup: 300 points spent');
      await pickedUp(freeD);
      const callsBefore = refundCalls.length;
      sent.length = 0;
      const r = await refund(freeD);
      assert.equal(r.status, 200, detail(r));
      assert.ok(!r.body.refund);
      assert.equal(refundCalls.length, callsBefore);
      assert.equal(await balance('r2'), 1000);
      assert.equal(r.body.pointsAdjustment?.spentReturned, 300);

      await flushEmails();
      const text = textOf(toCustomer('r2@example.com').at(-1));
      assert.match(text, /Your order has been refunded\./);
      assert.match(text, /The 300 reward points you used on this order have been returned to your account\./);
      assert.doesNotMatch(text, /A refund of/);
      const o = await getOrderById(freeD);
      assert.equal(o.status, 'canceled');
      assert.equal(o.refundedAfterCompletion, true);
      assert.ok(!o.refund);
    });

    it('refuses a completed order with nothing to give back', async () => {
      const emptyId = 'manual-empty-order';
      await putOrder({
        orderId: emptyId,
        status: 'completed',
        items: [],
        subtotal: 0,
        total: 0,
        contact: contactFor('r2'),
        email: 'r2@example.com',
        fulfillment: { method: 'pickup', pickupDate: dayKey(1), pickupTime: '12:00' },
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      const r = await refund(emptyId);
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /nothing to refund/);
      assert.equal((await getOrderById(emptyId)).status, 'completed');
    });

    it('refunds a guest order (no account) with the money back and no points', async () => {
      const guest = { firstName: 'G', lastName: 'Guest', email: 'guest@example.com' };
      const cart = { orders: [{ items: [{ id: half.id, qty: 1 }], redemptions: [] }] };
      await putCode('guest@example.com', '123456');
      await markVerified('guest@example.com', '123456', 5);
      const i = await api('POST', '/api/checkout/create-payment-intent', { ...cart, contact: guest, fulfillment: pickupAck() });
      const c = await api('POST', '/api/checkout', { ...cart, contact: guest, fulfillment: pickupAck(), paymentIntentId: i.body.paymentIntentId });
      guestId = c.body?.orders?.[0]?.orderId;
      assert.ok(c.status === 200 && guestId, `setup: guest order placed: ${detail(c)}`);
      await pickedUp(guestId);
      const r = await refund(guestId);
      assert.ok(r.status === 200 && r.body.refund?.amount === 1200 && !r.body.pointsAdjustment, detail(r));
    });

    it('drops refunded orders out of Sales but keeps them in Recent Orders, newest event first', async () => {
      keptId = await placePaid('r1', r1, 3); // $36, picked up and NOT refunded
      await pickedUp(keptId);

      const sales = await sumSales();
      assert.equal(sales.revenue - salesBefore.revenue, 36, 'only the kept order counts toward revenue');
      assert.equal(sales.qty - salesBefore.qty, 3, 'and only its three half dozens count as items sold');
      const refundedTotal = (await Promise.all([paidA, paidB, paidC, guestId].map((id) => getOrderById(id)))).reduce((n, o) => n + o.total, 0);
      assert.equal(refundedTotal, 12 + 24 + 12 + 12, 'the refunded orders really were worth money, and are left out');

      const recent = await api('GET', '/api/orders/recent', undefined, staffTok);
      const ids = recent.body.orders.map((x) => x.orderId);
      for (const id of [paidA, paidB, paidC, freeD, guestId]) assert.ok(ids.includes(id), `${id} should be under Recent Orders`);
      const flagged = recent.body.orders.find((x) => x.orderId === guestId);
      assert.ok(flagged.refundedAfterCompletion === true && flagged.completedAt && flagged.canceledAt, 'refunded orders keep their pickup history');
      assert.equal(ids[0], keptId, 'the order picked up last comes first');
      assert.ok(
        ids.indexOf(guestId) < ids.indexOf(freeD) && ids.indexOf(freeD) < ids.indexOf(paidC) && ids.indexOf(paidC) < ids.indexOf(paidA),
        'then the refunds, newest first'
      );

      const mine = await api('GET', '/api/orders/mine', undefined, r1);
      const mineA = mine.body.orders.find((x) => x.orderId === paidA);
      assert.equal(mineA?.status, 'canceled');
      assert.equal(mineA.refundedAfterCompletion, true);
      assert.equal(mineA.refund?.amount, 1200, "the customer's own history shows the refund");
    });

    it('only refunds within the 7 days an order stays under Recent Orders', async () => {
      const DAY = 24 * 3600 * 1000;
      const ago = (ms) => new Date(Date.now() - ms).toISOString();
      const oldPaid = (id, completedMsAgo, extra = {}) => ({
        orderId: id,
        status: 'completed',
        items: [{ id: 'standard:chocolate-chip:half_dozen', type: 'standard', flavor: 'Chocolate Chip', sizeLabel: 'Half Dozen', price: 12, qty: 1 }],
        subtotal: 12,
        total: 12,
        contact: contactFor('r1'),
        email: 'r1@example.com',
        customerId: 'r1',
        pointsEarned: 12,
        pointsSpent: 0,
        fulfillment: { method: 'pickup', pickupDate: dayKey(-8), pickupTime: '12:00' },
        createdAt: ago(completedMsAgo + 3600000),
        confirmedAt: ago(completedMsAgo + 1800000),
        readyAt: ago(completedMsAgo + 600000),
        completedAt: ago(completedMsAgo),
        payment: { provider: 'stripe', paymentIntentId: `pi_${id}`, amount: 1200, status: 'succeeded' },
        ...extra,
      });
      await putOrder(oldPaid('old-8-days', 8 * DAY));
      await putOrder(oldPaid('old-just-over-7', 7 * DAY + 60 * 1000));
      await putOrder(oldPaid('recent-6-days-23h', 6 * DAY + 23 * 3600000));
      await putOrder(oldPaid('recent-1-hour', 3600000));

      const calls = refundCalls.length;
      const points = await balance('r1');
      sent.length = 0;
      let r = await refund('old-8-days');
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, /picked up more than 7 days ago, so it can no longer be refunded here/);
      assert.match(r.body.error, /Stripe Dashboard/, 'and says where to go instead');
      assert.equal(refundCalls.length, calls, 'no Stripe call');
      assert.equal((await getOrderById('old-8-days')).status, 'completed');
      assert.equal(await balance('r1'), points);
      assert.equal(sent.length, 0);

      r = await refund('old-just-over-7');
      assert.equal(r.status, 400, `7 days and 1 minute: ${detail(r)}`);
      assert.match(r.body.error, /more than 7 days ago/);
      r = await refund('recent-6-days-23h');
      assert.ok(r.status === 200 && r.body.refund?.amount === 1200, `6 days 23 hours is still recent: ${detail(r)}`);
      r = await refund('recent-1-hour');
      assert.equal(r.status, 200, detail(r));

      const recent = await api('GET', '/api/orders/recent', undefined, staffTok);
      const ids = recent.body.orders.map((x) => x.orderId);
      assert.ok(!ids.includes('old-8-days') && !ids.includes('old-just-over-7'), 'the two refused orders are not under Recent Orders');
      assert.ok(ids.includes('recent-6-days-23h') && ids.includes('recent-1-hour'), 'the two allowed ones are');

      await putOrder({ ...oldPaid('old-ship', 9 * DAY), fulfillment: { method: 'shipping', shippingAddress: { line1: '1 Main St', city: 'Omaha', state: 'NE', zip: '68102' } } });
      const shipped = await refund('old-ship');
      assert.equal(shipped.status, 400);
      assert.match(shipped.body.error, /delivered more than 7 days ago/, 'a shipped order says "delivered", not "picked up"');
    });
  });

  // =========================================================================
  describe('Pickup agreement and pickup-time emails', () => {
    let half;
    let p1;
    let paidIntent;
    let placedOrderId;
    let twoOrders;
    const freeCart = { orders: [{ items: [], redemptions: [{ key: 'standard-half-dozen', flavors: ['Snickerdoodle'] }] }] };
    const cart = (n = 1) => ({ orders: Array.from({ length: n }, () => ({ items: [{ id: half.id, qty: 1 }], redemptions: [] })) });
    const intent = (c, fulfillment) => api('POST', '/api/checkout/create-payment-intent', { ...c, contact: contactFor('p1'), fulfillment }, p1);
    const checkout = (c, fulfillment, extra = {}) => api('POST', '/api/checkout', { ...c, contact: contactFor('p1'), fulfillment, ...extra }, p1);
    const confirm = (id, body) => api('POST', `/api/orders/${id}/confirm-pickup`, body, staffTok);
    const lastToCustomer = () => toCustomer('p1@example.com').at(-1);
    const ASK = /agree to the pickup notice/;
    const withoutAck = () => {
      const { acknowledgedPickupNotice, ...rest } = pickupAck(); // eslint-disable-line no-unused-vars
      return rest;
    };

    before(async () => {
      await seed('p1', 5000);
      p1 = user('p1');
      half = prods.find((p) => p.type === 'standard' && p.flavor === 'Chocolate Chip' && p.sizeLabel === 'Half Dozen');
      stripeState.calls.length = 0;
    });

    it('requires the agreement to place a pickup order, and not a shipping order', async () => {
      const createsAtStart = creates();
      let r = await intent(cart(), withoutAck());
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, ASK);
      assert.match(r.body.error, /refresh the page/, 'it tells them what to do');
      assert.equal(creates(), createsAtStart, 'refused before any payment is created');
      r = await intent(cart(), { ...withoutAck(), acknowledgedPickupNotice: '2020-01-01' });
      assert.equal(r.status, 400, 'an unknown or old version');
      assert.match(r.body.error, ASK);
      assert.equal((await intent(cart(), { ...withoutAck(), acknowledgedPickupNotice: true })).status, 400, '"true" instead of the version');
      assert.equal((await intent(cart(), { ...withoutAck(), acknowledgedPickupNotice: '' })).status, 400, 'an empty value');

      r = await intent(cart(), pickupAck());
      assert.ok(r.status === 200 && r.body.amount === 1200 && !!r.body.clientSecret, `the current version is accepted: ${detail(r)}`);
      paidIntent = r.body;
      const createsAfterGood = creates();

      const callsBefore = stripeState.calls.length;
      r = await checkout(cart(), withoutAck(), { paymentIntentId: paidIntent.paymentIntentId });
      assert.equal(r.status, 400, `finalizing without the agreement: ${detail(r)}`);
      assert.match(r.body.error, ASK);
      assert.ok(!stripeState.calls.slice(callsBefore).includes('retrieve'), 'Stripe is not even consulted');
      assert.equal((await allOrders()).filter((o) => o.customerId === 'p1').length, 0, 'and no order is saved');

      r = await intent(cart(), SHIP);
      assert.ok(r.status === 200 && r.body.amount > 0, `shipping orders do not need it: ${detail(r)}`);
      assert.equal(creates(), createsAfterGood + 1, 'the refused requests created no extra payments');
    });

    it('saves the agreement on a paid pickup order, kept out of the fulfillment staff can overwrite', async () => {
      const t0 = Date.now();
      const r = await checkout(cart(), pickupAck(), { paymentIntentId: paidIntent.paymentIntentId });
      assert.ok(r.status === 200 && r.body.orders?.length === 1, detail(r));
      const o = await getOrderById(r.body.orders[0].orderId);
      placedOrderId = o.orderId;
      assert.equal(o.pickupNotice?.version, V);
      assert.equal(typeof o.pickupNotice?.acknowledgedAt, 'string');
      assert.ok(Math.abs(new Date(o.pickupNotice.acknowledgedAt).getTime() - t0) < 10000, 'a real timestamp from just now');
      assert.equal(o.pickupNotice.acknowledgedAt, o.createdAt);
      assert.deepEqual(Object.keys(o.fulfillment).sort(), ['method', 'pickupDate', 'pickupTime']);
      assert.ok(PICKUP_NOTICES[o.pickupNotice.version]?.paragraphs?.length, 'the version recorded maps to the saved wording');

      const created = await intent(cart(2), pickupAck());
      const two = await checkout(cart(2), pickupAck(), { paymentIntentId: created.body.paymentIntentId });
      twoOrders = await Promise.all(two.body.orders.map((x) => getOrderById(x.orderId)));
      assert.ok(two.status === 200 && twoOrders.length === 2 && twoOrders.every((x) => x.pickupNotice?.version === V), 'each order of a two-order checkout carries it');

      const shippingIntent = await intent(cart(), SHIP);
      const shipped = await checkout(cart(), SHIP, { paymentIntentId: shippingIntent.body.paymentIntentId });
      const shippedOrder = await getOrderById(shipped.body.orders[0].orderId);
      assert.equal(shipped.status, 200);
      assert.equal(shippedOrder.pickupNotice, undefined, 'a shipping order carries no pickup agreement');
      assert.equal(shippedOrder.fulfillment.method, 'shipping');
    });

    it('requires the agreement for a points-only pickup order too, and saves it', async () => {
      let r = await intent(freeCart, withoutAck());
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, ASK);
      const points = await balance('p1');
      const ordersBefore = (await allOrders()).length;
      r = await checkout(freeCart, withoutAck(), { checkoutKey: key() });
      assert.equal(r.status, 400, detail(r));
      assert.match(r.body.error, ASK);
      assert.equal(await balance('p1'), points, 'no points spent');
      assert.equal((await allOrders()).length, ordersBefore, 'no order saved');

      r = await intent(freeCart, pickupAck());
      assert.ok(r.status === 200 && r.body.free === true, detail(r));
      r = await checkout(freeCart, pickupAck(), { checkoutKey: key() });
      const saved = await getOrderById(r.body.orders[0].orderId);
      assert.ok(r.status === 200 && saved.pickupNotice?.version === V && saved.payment === undefined, detail(r));
      assert.equal(saved.pickupNotice.acknowledgedAt, saved.createdAt);
      assert.equal(saved.fulfillment.acknowledgedPickupNotice, undefined, 'the fulfillment stays clean');
      assert.equal(await balance('p1'), points - 300);
    });

    it('lets staff see the agreement on the active orders list', async () => {
      const r = await api('GET', '/api/orders/active', undefined, staffTok);
      assert.equal(r.status, 200, detail(r));
      const listed = r.body.orders?.find((x) => x.orderId === placedOrderId);
      assert.equal(listed?.pickupNotice?.version, V);
    });

    it('keeps the agreement when staff change the time, and the email shows both times and says so', async () => {
      sent.length = 0;
      const newDate = dayKey(11);
      const newTime = '15:00';
      const r = await confirm(placedOrderId, { pickupDate: newDate, pickupTime: newTime, note: 'We are closed that morning.' });
      assert.ok(r.status === 200 && r.body.status === 'confirmed', detail(r));
      const o = await getOrderById(placedOrderId);
      assert.equal(o.pickupNotice?.version, V, 'the agreement survives the confirm replacing fulfillment');
      assert.equal(o.fulfillment.pickupTime, newTime);
      assert.equal(o.fulfillment.pickupDate, newDate);

      await flushEmails();
      const m = lastToCustomer();
      const txt = textOf(m);
      assert.equal(m.Message.Subject.Data, 'Your Cozy Dough Cookies pickup time has changed');
      assert.match(txt, /Your order has been confirmed, but we had to change your pickup time\./);
      assert.ok(txt.includes(`You requested: ${formatPickupDateTime(pickupAck().pickupDate, '12:00')}\nYour confirmed pickup time: ${formatPickupDateTime(newDate, newTime)}`), 'both times');
      assert.match(txt, /Please note: your confirmed pickup time is different from the time you requested\. Please come at your confirmed time\. If it doesn't work for you, just reply to this email and let us know\./);
      assert.match(txt, /Pickup address: 15003 S 21st St/);
      assert.match(txt, /Note from us: We are closed that morning\./);
      assert.match(txt, /within 24 hours of that time, the order will be forfeited with no refund\. If your plans change, just reply to this email and let us know!/);
      const at = (s) => txt.indexOf(s);
      assert.ok(
        at('we had to change') < at('You requested') && at('You requested') < at('Please note:') && at('Please note:') < at('Pickup address') &&
          at('Pickup address') < at('Note from us') && at('Note from us') < at('Please pick up your order at your scheduled') && at('Please pick up your order at your scheduled') < at('Chocolate Chip'),
        'lines come in the order: headline, times, note, address, staff note, reminder, items'
      );
      const html = htmlOf(m).replace(/&#39;|&#x27;/g, "'");
      assert.ok(html.includes(`<strong>Your confirmed pickup time: ${formatPickupDateTime(newDate, newTime)}</strong>`), 'the new time is bold in the HTML version');
      assert.match(html, /<strong>Please note:<\/strong> your confirmed pickup time is different/);
      assert.match(html, /within 24 hours of that time, the order will be forfeited with no refund/);
    });

    it('words a second change to an already confirmed order differently, and still keeps the agreement', async () => {
      const first = { d: dayKey(11), t: '15:00' };
      const newer = { d: dayKey(12), t: '10:30' };
      sent.length = 0;
      const r = await confirm(placedOrderId, { pickupDate: newer.d, pickupTime: newer.t });
      await flushEmails();
      const m = lastToCustomer();
      const txt = textOf(m);
      assert.ok(r.status === 200 && /Your order is still confirmed, but we had to change your pickup time\./.test(txt), detail(r));
      assert.ok(txt.includes(`Previous pickup time: ${formatPickupDateTime(first.d, first.t)}\nYour new pickup time: ${formatPickupDateTime(newer.d, newer.t)}`));
      assert.match(txt, /Please note: your pickup time has changed\. Please come at your new time; the previous time no longer applies\./);
      assert.equal(m.Message.Subject.Data, 'Your Cozy Dough Cookies pickup time has changed');
      assert.match(txt, /24 hours/);
      assert.doesNotMatch(txt, /You requested/, 'no stale "requested" wording');
      assert.equal((await getOrderById(placedOrderId)).pickupNotice?.version, V);
    });

    it('sends the plain confirmation, with the 24-hour reminder, when the requested time is kept', async () => {
      const second = twoOrders[0];
      sent.length = 0;
      const r = await confirm(second.orderId, { pickupDate: second.fulfillment.pickupDate, pickupTime: second.fulfillment.pickupTime });
      await flushEmails();
      const m = lastToCustomer();
      const txt = textOf(m);
      assert.equal(r.status, 200, detail(r));
      const when = formatPickupDateTime(second.fulfillment.pickupDate, second.fulfillment.pickupTime);
      assert.ok(txt.includes(`Your order has been confirmed for your requested pickup time: ${when}.`));
      assert.equal(m.Message.Subject.Data, 'Your Cozy Dough Cookies pickup time');
      assert.doesNotMatch(txt, /Please note/);
      assert.doesNotMatch(txt, /You requested/);
      assert.match(txt, /Please pick up your order at your scheduled pickup time\. If it hasn't been picked up and we haven't heard from you within 24 hours of that time/);
      assert.match(txt, /Pickup address: 15003 S 21st St/);
      assert.equal((await getOrderById(second.orderId)).pickupNotice?.version, V, 'its saved agreement is intact');
    });

    it('escapes HTML in a staff note instead of putting it in the email', async () => {
      const third = twoOrders[1];
      sent.length = 0;
      await confirm(third.orderId, { pickupDate: third.fulfillment.pickupDate, pickupTime: third.fulfillment.pickupTime, note: '<script>alert(1)</script>' });
      await flushEmails();
      const html = htmlOf(lastToCustomer());
      assert.doesNotMatch(html, /<script>/);
      assert.match(html, /&lt;script&gt;/);
    });
  });
});

// ---------------------------------------------------------------------------
// Receipt wording: builds the emails with the real email code. Needs no server, so it always runs.
// ---------------------------------------------------------------------------

describe('Receipt wording for pickup requests', () => {
  const contact = { firstName: 'Test', lastName: 'Check', email: 'nobody@example.com' };
  const pickup = { method: 'pickup', pickupDate: '2026-12-05', pickupTime: '14:30' };
  const ship = { method: 'shipping', shippingAddress: { line1: '1 Main St', line2: '', city: 'Omaha', state: 'NE', zip: '68102' } };
  const paid = new Order();
  paid.addCookie({ id: 'standard:snickerdoodle:half_dozen', type: 'standard', flavor: 'Snickerdoodle', sizeLabel: 'Half Dozen', price: 12 }, 2);
  const redeemed = new Order();
  redeemed.addCookie({ id: 'reward-standard-dozen', type: 'standard', flavor: 'Standard Dozen: 6 Chocolate Chip, 6 Oatmeal', sizeLabel: 'Dozen', price: 0, isReward: true, pointsCost: 600 }, 1);
  const rec = (order, fulfillment) => ({ items: order.toJSON().items, subtotal: order.total, total: order.total, fulfillment });
  // The HTML version, flattened to the words a person would read.
  const decode = (h) => h.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const NOTE = "Your pickup time is a request. We'll email you as soon as it's confirmed, so please wait for that confirmation before coming to pick up your order.";
  const OLD_WORDING = ['not a confirmation', 'is ready before coming by'];

  it('says the pickup time is a request, word for word, between the requested time and the address', () => {
    const email = buildReceiptEmail({ contact, fulfillment: pickup, orders: [rec(paid, pickup)] });
    assert.match(email.text, /Requested pickup: .*December.*5/);
    assert.ok(email.text.includes(NOTE));
    assert.ok(decode(email.html).includes(NOTE), 'the HTML version says it too');
    for (const old of OLD_WORDING) {
      assert.ok(!email.text.includes(old) && !decode(email.html).includes(old), `the old wording "${old}" is gone`);
    }
    const lines = email.text.split('\n\n');
    const at = lines.findIndex((l) => /^Requested pickup:/.test(l));
    assert.equal(lines[at + 1], NOTE);
    assert.match(lines[at + 2], /^Pickup address:/);
    assert.match(email.text, /Pickup address: 15003 S 21st St/);
  });

  it('keeps the note, once, on a points-only pickup receipt and on a two-order checkout', () => {
    let email = buildReceiptEmail({ contact, fulfillment: pickup, orders: [rec(redeemed, pickup)] });
    assert.ok(email.text.includes(NOTE));
    assert.match(email.text, /Redeemed with 600 points/);
    email = buildReceiptEmail({ contact, fulfillment: pickup, orders: [rec(paid, pickup), rec(redeemed, pickup)] });
    assert.equal(email.text.split(NOTE).length, 2, 'the note appears exactly once');
    assert.ok(email.text.indexOf(NOTE) < email.text.indexOf('Order 1 of 2'), 'at the top, above the orders');
  });

  it('leaves the pickup note and address off a shipping receipt', () => {
    const email = buildReceiptEmail({ contact, fulfillment: ship, orders: [rec(paid, ship)] });
    assert.ok(!email.text.includes('pickup time is a request'));
    assert.doesNotMatch(email.text, /Pickup address/);
    assert.match(email.text, /Shipping to:/);
    assert.ok(!decode(email.html).includes('pickup time is a request'));
  });

  it('leaves the confirmation and status emails alone: by then the time is confirmed, not requested', () => {
    const full = { ...pickup, method: 'pickup' };
    const confirmed = buildPickupTimeEmail({ contact, pickupDate: '2026-12-05', pickupTime: '14:30', changed: false, note: '', order: rec(paid, full) });
    assert.match(confirmed.text, /has been confirmed for your requested pickup time/);
    assert.ok(!confirmed.text.includes('pickup time is a request'));
    const ready = buildStatusChangeEmail({ contact, method: 'pickup', status: 'ready', order: rec(paid, full) });
    assert.match(ready.text, /Pickup time:/);
    assert.ok(!ready.text.includes('pickup time is a request'));
  });
});
