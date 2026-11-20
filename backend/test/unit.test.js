// Unit tests for the backend's business rules: menu items, orders and carts,
// checkout rules, reward points, the pickup notice, the customer emails, rate
// limits and the small format checks.
//
// Run them with `npm test` (from backend/). They use Node's built-in test runner,
// so there is nothing to install, and they never touch the network, AWS,
// DynamoDB, Stripe or a real inbox: every test works on plain in-memory objects.
//
// Keep each `it` a single check of one rule (several assertions are fine) and
// avoid loops that create tests, so the summary's test count stays meaningful.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { Cookie, isDietaryRestrictedType, dietaryMarker } from '../models/Cookie.js';
import { Order } from '../models/Order.js';
import { Cart } from '../models/Cart.js';
import { minimumOrderError, rewardsBalanceError } from '../checkout/rules.js';
import { REWARDS_CATALOG, getReward } from '../rewards/catalog.js';
import { allocateEarnedPoints, allocateSpentPoints, pointsToReverse } from '../rewards/points.js';
import { PICKUP_NOTICE_VERSION, PICKUP_NOTICES } from '../pickup/notice.js';
import {
  formatMoney,
  escapeHtml,
  formatAddressLines,
  pickupAddressLine,
  formatPickupDateTime,
  isRewardItem,
  rewardPointsFor,
  buildOrderTableText,
  buildOrderTableHtml,
} from '../email/format.js';
import { buildReceiptEmail } from '../email/receipt.js';
import { buildStatusChangeEmail, buildRefundEmail, buildPickupTimeEmail } from '../email/orderStatusEmail.js';
import { buildFreeOrderRecords, CHECKOUT_KEY_RE } from '../checkout/freeCheckout.js';
// A plain helper from the website's code (no React, no imports), tested here with the rest.
import { buildBillingDetails } from '../../frontend/src/stripe/billingDetails.js';
import { PAYMENT_ELEMENT_OPTIONS } from '../../frontend/src/stripe/paymentElementOptions.js';
import {
  EMAIL_RE,
  ZIP_RE,
  STATE_RE,
  PICKUP_DATE_RE,
  PICKUP_TIME_RE,
  PICKUP_OPEN_MINUTES,
  PICKUP_CLOSE_MINUTES,
  PICKUP_ADDRESS,
  SHIPPING_FEE_MEDIUM,
  SHIPPING_FEE_LARGE,
  EMAIL_VERIFICATION_RATE_LIMIT_MAX_CALLS_DEFAULT,
  EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS_DEFAULT,
  IP_RATE_LIMIT_MAX_CALLS_DEFAULT,
  IP_RATE_LIMIT_WINDOW_MS_DEFAULT,
} from '../constants.js';

// These modules read their limits from the environment when they load, so make
// sure a developer's own settings can't change what the tests expect.
for (const name of [
  'EMAIL_VERIFICATION_RATE_LIMIT_MAX_CALLS',
  'EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS',
  'IP_RATE_LIMIT_MAX_CALLS',
  'IP_RATE_LIMIT_WINDOW_MS',
]) {
  delete process.env[name];
}
const { checkEmailSendRateLimit } = await import('../email/rateLimit.js');
const { checkIpRateLimit } = await import('../shipping/ipRateLimit.js');
const { parseAddressList, fromHeader, staffRecipients } = await import('../email/ses.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cookie = (type, flavor, size) => new Cookie(type, flavor, size);

// A redeemed reward the way checkout folds it into an order (see backend/index.js).
function rewardItem(overrides = {}) {
  return {
    id: 'reward-standard-dozen',
    type: 'standard',
    flavor: 'Standard Dozen: Monster',
    sizeLabel: 'Dozen',
    price: 0,
    isReward: true,
    pointsCost: 600,
    is_temperature_controlled: false,
    physicalCookieUnits: 12,
    ...overrides,
  };
}

function orderOf(...entries) {
  const order = new Order();
  for (const [product, qty = 1] of entries) order.addCookie(product, qty);
  return order;
}

// An order as it is saved and handed to the email builders.
function savedOrder(overrides = {}) {
  return {
    items: [
      {
        id: 'standard:chocolate-chip:half_dozen',
        type: 'standard',
        flavor: 'Chocolate Chip',
        sizeLabel: 'Half Dozen',
        price: 12,
        qty: 1,
      },
    ],
    subtotal: 12,
    total: 12,
    status: 'placed',
    fulfillment: { method: 'pickup', pickupDate: '2026-11-20', pickupTime: '17:00' },
    ...overrides,
  };
}

const CONTACT = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

// ---------------------------------------------------------------------------
// Menu items (models/Cookie.js)
// ---------------------------------------------------------------------------

describe('Cookie (menu items)', () => {
  it('builds a URL-safe id from what the product is, not where it sits in the catalog', () => {
    assert.equal(Cookie.idFor('standard', 'Chocolate Chip', 'half_dozen'), 'standard:chocolate-chip:half_dozen');
    assert.equal(Cookie.idFor('standard', 'M&M', 'single'), 'standard:m-m:single');
    assert.equal(Cookie.idFor('premium', 'Oatmeal Cream Pie', 'full_dozen'), 'premium:oatmeal-cream-pie:full_dozen');
    assert.equal(cookie('special', 'Brownie', 'single').id, 'special:brownie:single');
    assert.equal(cookie('special', 'Brownie', 'single').id, cookie('special', 'Brownie', 'single').id);
  });

  it('refuses an unknown type, a flavor the type does not offer, and an unknown size', () => {
    assert.throws(() => cookie('mystery', 'Chocolate Chip', 'single'), /Unknown cookie type/);
    assert.throws(() => cookie('special', 'Chocolate Chip', 'single'), /not a valid special flavor/);
    assert.throws(() => cookie('standard', 'Chocolate Chip', 'giant'), /Unknown cookie size/);
  });

  it('prices each type and size from the menu price table', () => {
    assert.equal(cookie('standard', 'Monster', 'single').price, 2.5);
    assert.equal(cookie('standard', 'Monster', 'half_dozen').price, 12);
    assert.equal(cookie('standard', 'Monster', 'full_dozen').price, 24);
    assert.equal(cookie('special', 'Brownie', 'single').price, 3.5);
    assert.equal(cookie('special', 'Brownie', 'half_dozen').price, 18);
    assert.equal(cookie('special', 'Brownie', 'full_dozen').price, 36);
    assert.equal(cookie('premium', 'Oatmeal Cream Pie', 'single').price, 7);
    assert.equal(cookie('cozy_rolls', 'Cozy Rolls', 'cozy_rolls').price, 32);
  });

  it('sells gluten-free and sugar-free only as a batch of 29 cookies', () => {
    const gf = cookie('gluten_free_standard', 'Monster', 'batch');
    const gfSpecial = cookie('gluten_free_special', 'Brownie', 'batch');
    const sf = cookie('sugar_free_standard', 'Butter', 'batch');
    assert.equal(gf.price, 80);
    assert.equal(gfSpecial.price, 95);
    assert.equal(sf.price, 80);
    assert.equal(gf.sizeLabel, 'Batch');
    assert.equal(gf.is_batch, true);
    assert.equal(gf.physicalCookieUnits, 29);
  });

  it('names a Cozy Dough Bucket by its type and shows the flavor as its detail', () => {
    const bucket = cookie('bucket', 'Monster', 'bucket');
    assert.equal(bucket.flavor, 'Cozy Dough Bucket');
    assert.equal(bucket.baseFlavor, 'Monster');
    assert.equal(bucket.sizeLabel, 'Monster');
    assert.equal(bucket.price, 55);
    assert.equal(bucket.is_in_buckets, true);
    // A bucket is its own item, so it stays out of every cookie count.
    assert.equal(bucket.physicalCookieUnits, undefined);
  });

  it('describes the Gobble Bucket exactly as the menu shows it', () => {
    const gobble = cookie('seasonal_gobble_bucket', 'Gobble Bucket', 'item');
    assert.equal(gobble.id, 'seasonal_gobble_bucket:gobble-bucket:item');
    assert.equal(gobble.price, 40);
    assert.equal(gobble.sizeLabel, 'Chocolate Chip, Monster & Sugar');
    assert.equal(gobble.menuDescription, 'A mix of mini chocolate chip, monster, and sugar cookies.');
    assert.equal(gobble.is_item, true);
    assert.equal(gobble.priceOnCard, true);
    assert.equal(gobble.is_sold_out, false);
    // Never shipped, so no box size depends on it.
    assert.equal(gobble.physicalCookieUnits, undefined);
  });

  it('marks refrigerated items and the Gobble Bucket as pickup only, and ordinary cookies as shippable', () => {
    const gobble = cookie('seasonal_gobble_bucket', 'Gobble Bucket', 'item');
    // Not refrigerated, but the shop does not ship it.
    assert.equal(gobble.is_temperature_controlled, false);
    assert.equal(gobble.is_pickup_only, true);

    for (const refrigerated of [
      cookie('special', 'Strawberry Cheesecake', 'half_dozen'),
      cookie('premium', 'Oatmeal Cream Pie', 'single'),
      cookie('cozy_rolls', 'Cozy Rolls', 'cozy_rolls'),
      cookie('bucket', 'Butter', 'bucket'),
    ]) {
      assert.equal(refrigerated.is_temperature_controlled, true, refrigerated.id);
      assert.equal(refrigerated.is_pickup_only, true, refrigerated.id);
    }

    const plain = cookie('standard', 'Chocolate Chip', 'full_dozen');
    assert.equal(plain.is_temperature_controlled, false);
    assert.equal(plain.is_pickup_only, false);
  });

  it('includes its computed price and size label when sent as JSON', () => {
    const json = JSON.parse(JSON.stringify(cookie('special', 'Brownie', 'half_dozen')));
    assert.equal(json.price, 18);
    assert.equal(json.sizeLabel, 'Half Dozen');
    assert.equal(json.is_half_dozen, true);
    assert.equal(json.is_pickup_only, false);
    assert.equal(json.menuDescription, null);
  });

  it('recognises gluten-free and sugar-free types and gives them their GF / SF marker', () => {
    assert.equal(isDietaryRestrictedType('gluten_free_bucket'), true);
    assert.equal(isDietaryRestrictedType('sugar_free_special'), true);
    assert.equal(isDietaryRestrictedType('standard'), false);
    assert.ok(!isDietaryRestrictedType(undefined));
    assert.equal(dietaryMarker('gluten_free_standard'), 'GF');
    assert.equal(dietaryMarker('sugar_free_bucket'), 'SF');
    assert.equal(dietaryMarker('premium'), null);
    assert.equal(dietaryMarker(undefined), null);
  });

  it('builds every product in the catalog with a unique id and a price above zero', () => {
    const ids = new Set();
    let count = 0;
    for (const [type, info] of Object.entries(Cookie.TYPES)) {
      for (const flavor of info.flavors) {
        for (const size of info.sizes) {
          const product = cookie(type, flavor, size);
          assert.ok(product.price > 0, `${product.id} has no price`);
          ids.add(product.id);
          count++;
        }
      }
    }
    assert.equal(ids.size, count, 'two products share an id');
    assert.ok(count >= 90, `expected the full menu, found ${count} products`);
  });
});

// ---------------------------------------------------------------------------
// Orders and carts (models/Order.js, models/Cart.js)
// ---------------------------------------------------------------------------

describe('Order', () => {
  it('merges the same product into one line and totals price times quantity', () => {
    const half = cookie('standard', 'Monster', 'half_dozen');
    const single = cookie('special', 'Brownie', 'single');
    const order = new Order();
    order.addCookie(half);
    order.addCookie(half, 2);
    order.addCookie(single);
    assert.equal(order.items.length, 2);
    assert.equal(order.items[0].qty, 3);
    assert.equal(order.total, 3 * 12 + 3.5); // three half dozens at $12 and one special single at $3.50
  });

  it('counts physical cookies by box size, and leaves buckets, rolls and the Gobble Bucket out', () => {
    const order = orderOf(
      [cookie('standard', 'Monster', 'single'), 1], // 1
      [cookie('standard', 'Monster', 'half_dozen'), 2], // 12
      [cookie('standard', 'Monster', 'full_dozen'), 1], // 12
      [cookie('gluten_free_standard', 'Monster', 'batch'), 1], // 29
      [cookie('bucket', 'Monster', 'bucket'), 2], // not cookies
      [cookie('cozy_rolls', 'Cozy Rolls', 'cozy_rolls'), 1], // not cookies
      [cookie('seasonal_gobble_bucket', 'Gobble Bucket', 'item'), 3] // not cookies
    );
    assert.equal(order.physicalCookieCount, 1 + 12 + 12 + 29);
  });

  it('counts a redeemed reward by its own cookie total instead of its quantity', () => {
    const order = orderOf([rewardItem({ physicalCookieUnits: 24 }), 1]);
    assert.equal(order.physicalCookieCount, 24);
  });

  it('charges the medium shipping fee up to 36 cookies and the large fee above that', () => {
    const threeDozen = cookie('standard', 'Monster', 'full_dozen');
    const order = orderOf([threeDozen, 3]); // exactly 36
    assert.equal(order.physicalCookieCount, 36);
    assert.equal(order.shippingFee, SHIPPING_FEE_MEDIUM);
    assert.equal(SHIPPING_FEE_MEDIUM, 24);

    order.addCookie(cookie('standard', 'Monster', 'single')); // 37
    assert.equal(order.physicalCookieCount, 37);
    assert.equal(order.shippingFee, SHIPPING_FEE_LARGE);
    assert.equal(SHIPPING_FEE_LARGE, 30);
  });

  it('requires pickup when any item is refrigerated or pickup only, but not for ordinary cookies', () => {
    const plain = cookie('standard', 'Monster', 'half_dozen');
    const gobble = cookie('seasonal_gobble_bucket', 'Gobble Bucket', 'item');
    const rolls = cookie('cozy_rolls', 'Cozy Rolls', 'cozy_rolls');
    assert.equal(orderOf([plain, 2]).requiresPickup, false);
    assert.equal(orderOf([gobble, 1]).requiresPickup, true);
    assert.equal(orderOf([rolls, 1]).requiresPickup, true);
    // One pickup-only item makes the whole order pickup only.
    assert.equal(orderOf([plain, 1], [gobble, 1]).requiresPickup, true);
    // A redeemed reward carries only the refrigeration flag, and that is enough.
    assert.equal(orderOf([rewardItem({ is_temperature_controlled: true }), 1]).requiresPickup, true);
  });

  it('asks for extended pickup notice for gluten-free and sugar-free items, and knows when it holds a reward', () => {
    assert.equal(orderOf([cookie('gluten_free_standard', 'Monster', 'batch'), 1]).requiresExtendedPickupNotice, true);
    assert.equal(orderOf([cookie('sugar_free_special', 'Brownie', 'batch'), 1]).requiresExtendedPickupNotice, true);
    assert.equal(orderOf([cookie('standard', 'Monster', 'single'), 1]).requiresExtendedPickupNotice, false);

    assert.equal(orderOf([cookie('standard', 'Monster', 'single'), 1]).hasReward, false);
    assert.equal(orderOf([rewardItem(), 1]).hasReward, true);
  });

  it('saves reward details only on reward lines when turned into JSON', () => {
    const order = orderOf([cookie('standard', 'Monster', 'half_dozen'), 2], [rewardItem(), 1]);
    const json = order.toJSON();
    assert.equal(json.orderId, order.id);
    assert.equal(json.total, 24);
    const [paid, reward] = json.items;
    assert.equal(paid.qty, 2);
    assert.equal(paid.price, 12);
    assert.equal('isReward' in paid, false);
    assert.equal(reward.isReward, true);
    assert.equal(reward.pointsCost, 600);
    assert.equal(reward.price, 0);
  });
});

describe('Cart', () => {
  it('adds up its orders and reports each order with the grand total', () => {
    const cart = new Cart();
    cart.addOrder(orderOf([cookie('standard', 'Monster', 'half_dozen'), 1])); // 12
    cart.addOrder(orderOf([cookie('special', 'Brownie', 'full_dozen'), 1])); // 36
    assert.equal(cart.grandTotal, 48);
    const json = cart.toJSON();
    assert.equal(json.grandTotal, 48);
    assert.equal(json.orders.length, 2);
    assert.notEqual(json.orders[0].orderId, json.orders[1].orderId);
  });
});

// ---------------------------------------------------------------------------
// Checkout rules (checkout/rules.js)
// ---------------------------------------------------------------------------

describe('Checkout rules', () => {
  const cartOf = (...orders) => {
    const cart = new Cart();
    for (const order of orders) cart.addOrder(order);
    return cart;
  };

  it('rejects an order under $12 with the customer-facing message, and accepts exactly $12', () => {
    const small = cartOf(orderOf([cookie('standard', 'Monster', 'single'), 1])); // $2.50
    assert.equal(minimumOrderError(small), 'Each order must total at least $12.00, unless it redeems a reward.');
    const exact = cartOf(orderOf([cookie('standard', 'Monster', 'half_dozen'), 1])); // $12
    assert.equal(minimumOrderError(exact), null);
  });

  it('lets an order that redeems a reward through even though it is worth less than $12', () => {
    const rewardOnly = cartOf(orderOf([rewardItem(), 1])); // $0
    assert.equal(minimumOrderError(rewardOnly), null);
  });

  it('checks the minimum on every order, so one small order fails the whole cart', () => {
    const big = orderOf([cookie('standard', 'Monster', 'full_dozen'), 1]);
    const small = orderOf([cookie('standard', 'Monster', 'single'), 1]);
    assert.ok(minimumOrderError(cartOf(big, small)));
    assert.equal(minimumOrderError(cartOf(big, orderOf([cookie('standard', 'Monster', 'half_dozen'), 1]))), null);
  });

  it('allows rewards the balance covers and explains a shortfall, treating a negative or missing balance as zero', () => {
    assert.equal(rewardsBalanceError(300, 300), null);
    assert.equal(rewardsBalanceError(300, 5000), null);
    assert.equal(rewardsBalanceError(300, 120), 'You need 300 points for these rewards but have 120.');
    // Nothing to redeem means nothing to check, whatever the balance.
    assert.equal(rewardsBalanceError(0, -50), null);
    // A cancel can leave the balance negative; it is never shown as less than zero.
    assert.equal(rewardsBalanceError(50, -25), 'You need 50 points for these rewards but have 0.');
    assert.equal(rewardsBalanceError(50, NaN), 'You need 50 points for these rewards but have 0.');
    assert.equal(rewardsBalanceError(50, undefined), 'You need 50 points for these rewards but have 0.');
  });
});

// ---------------------------------------------------------------------------
// Rewards catalog and points (rewards/catalog.js, rewards/points.js)
// ---------------------------------------------------------------------------

describe('Rewards catalog', () => {
  const find = (key) => REWARDS_CATALOG.find((r) => r.key === key);

  it('lets a reward mix as many flavors as it has six-cookie portions', () => {
    const expected = {
      'standard-single': [1, 1],
      'standard-half-dozen': [6, 1],
      'standard-dozen': [12, 2],
      'standard-2dozen': [24, 4],
      'standard-3dozen': [36, 6],
      'standard-4dozen': [48, 8],
    };
    for (const [key, [cookies, flavorSlots]] of Object.entries(expected)) {
      assert.equal(find(key).cookies, cookies, `${key} cookies`);
      assert.equal(find(key).flavorSlots, flavorSlots, `${key} flavor slots`);
    }
    // Every portion is whole and never smaller than six cookies (or the whole reward when it is smaller).
    for (const r of REWARDS_CATALOG) {
      assert.equal(r.slotCookies * r.flavorSlots, r.cookies, r.key);
      assert.ok(r.slotCookies <= 6, r.key);
    }
  });

  it('costs 25 points per menu dollar, except the two singles that are pinned to 50 and 75', () => {
    assert.equal(find('standard-single').points, 50);
    assert.equal(find('special-single').points, 75);
    // Pinned: they stay 50 and 75 even though 25 points per menu dollar would now give 62.5 and 87.5.
    assert.notEqual(find('standard-single').points, Cookie.TYPES.standard.prices.single * 25);
    assert.notEqual(find('special-single').points, Cookie.TYPES.special.prices.single * 25);
    assert.equal(find('premium-single').points, 7 * 25);
    assert.equal(find('standard-dozen').points, 24 * 25);
    assert.equal(find('special-dozen').points, 36 * 25);
    assert.equal(find('standard-2dozen').points, 48 * 25);
    assert.equal(find('premium-2dozen').points, 168 * 25);
  });

  it('has a unique key for every reward and finds rewards by key', () => {
    const keys = REWARDS_CATALOG.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(getReward('standard-dozen').label, 'Standard Dozen');
    assert.equal(getReward('does-not-exist'), null);
    assert.equal(getReward(undefined), null);
  });

  it('flags only the standard rewards as shippable, since special and premium may need refrigeration', () => {
    assert.equal(find('standard-3dozen').is_temperature_controlled, false);
    assert.equal(find('special-dozen').is_temperature_controlled, true);
    assert.equal(find('premium-half-dozen').is_temperature_controlled, true);
  });
});

describe('Reward points', () => {
  it('splits earned points so the shares add up to exactly what the cart earned', () => {
    // $10.50 + $10.50 earns 21 points; rounding each order alone would give 22.
    const shares = allocateEarnedPoints([10.5, 10.5], 21);
    assert.deepEqual(shares, [11, 10]);
    assert.equal(shares[0] + shares[1], 21);
    assert.deepEqual(allocateEarnedPoints([40], 40), [40]);
    assert.deepEqual(allocateEarnedPoints([], 0), []);
  });

  it('keeps the shares summing to the rounded grand total for awkward amounts', () => {
    const totals = [3.3, 3.3, 3.4];
    const shares = allocateEarnedPoints(totals, 10);
    assert.deepEqual(shares, [3, 4, 3]);
    assert.equal(shares.reduce((a, b) => a + b, 0), 10);

    const oddTotals = [12.49, 7.51, 0.4, 24.0];
    const grand = oddTotals.reduce((a, b) => a + b, 0);
    assert.equal(allocateEarnedPoints(oddTotals, grand).reduce((a, b) => a + b, 0), Math.round(grand));
  });

  it('charges each order for the rewards redeemed inside it', () => {
    const redemptions = [
      { orderIndex: 0, entry: { points: 300 } },
      { orderIndex: 2, entry: { points: 50 } },
      { orderIndex: 2, entry: { points: 75 } },
    ];
    assert.deepEqual(allocateSpentPoints(redemptions, 3), [300, 0, 125]);
    assert.deepEqual(allocateSpentPoints([], 2), [0, 0]);
  });

  it('gives points back only for a signed-in customer, and only whole positive amounts', () => {
    assert.deepEqual(pointsToReverse({ customerId: 'c1', pointsEarned: 40, pointsSpent: 600 }), { earned: 40, spent: 600 });
    assert.deepEqual(pointsToReverse({ pointsEarned: 40, pointsSpent: 600 }), { earned: 0, spent: 0 }); // guest
    assert.deepEqual(pointsToReverse({ customerId: 'c1' }), { earned: 0, spent: 0 }); // older order
    assert.deepEqual(pointsToReverse({ customerId: 'c1', pointsEarned: 2.5, pointsSpent: -10 }), { earned: 0, spent: 0 });
    assert.deepEqual(pointsToReverse(null), { earned: 0, spent: 0 });
  });
});

// ---------------------------------------------------------------------------
// Pickup notice (pickup/notice.js)
// ---------------------------------------------------------------------------

describe('Pickup notice', () => {
  it('keeps a saved wording for the version the server currently requires', () => {
    assert.match(PICKUP_NOTICE_VERSION, /^\d{4}-\d{2}-\d{2}$/);
    const notice = PICKUP_NOTICES[PICKUP_NOTICE_VERSION];
    assert.ok(notice, 'the current version has no entry, so no order could match its wording');
    assert.equal(notice.heading, 'Please read before placing your order');
    assert.equal(notice.paragraphs.length, 2);
    assert.equal(notice.checkbox, 'I understand the pickup notice above.');
  });

  it('tells the customer the time is a request and that a missed pickup is forfeited after 24 hours', () => {
    const [request, forfeit] = PICKUP_NOTICES[PICKUP_NOTICE_VERSION].paragraphs;
    assert.match(request, /is a request/);
    assert.match(request, /wait for that confirmation/);
    assert.match(forfeit, /within 24 hours/);
    assert.match(forfeit, /forfeited with no refund/);
  });
});

// ---------------------------------------------------------------------------
// Email formatting (email/format.js)
// ---------------------------------------------------------------------------

describe('Email formatting', () => {
  it('formats money with a dollar sign and two decimals, and escapes HTML', () => {
    assert.equal(formatMoney(40), '$40.00');
    assert.equal(formatMoney(12.5), '$12.50');
    assert.equal(formatMoney(0), '$0.00');
    assert.equal(escapeHtml(`<b onclick="x">Tom & Jerry's</b>`), '&lt;b onclick=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;');
    assert.equal(escapeHtml(42), '42');
  });

  it('lays out address lines, skipping a missing second line, and builds the pickup address line', () => {
    assert.deepEqual(formatAddressLines({ line1: '1 Main St', city: 'Omaha', state: 'NE', zip: '68102' }), [
      '1 Main St',
      'Omaha, NE 68102',
    ]);
    assert.deepEqual(formatAddressLines({ line1: '1 Main St', line2: 'Apt 4', city: 'Omaha', state: 'NE', zip: '68102' }), [
      '1 Main St',
      'Apt 4',
      'Omaha, NE 68102',
    ]);
    assert.equal(pickupAddressLine(), `Pickup address: ${PICKUP_ADDRESS}`);
  });

  it('writes pickup times on the day and hour the customer chose, whatever the server timezone', () => {
    const evening = formatPickupDateTime('2026-11-20', '17:00');
    assert.match(evening, /November 20, 2026/);
    assert.match(evening, /5:00\sPM/);
    const morning = formatPickupDateTime('2026-01-01', '09:30');
    assert.match(morning, /January 1, 2026/);
    assert.match(morning, /9:30\sAM/);
  });

  it('words reward lines as points, marks gluten-free items, and shows shipping only when there is a fee', () => {
    const order = {
      items: [
        { id: 'standard:chocolate-chip:half_dozen', type: 'standard', flavor: 'Chocolate Chip', sizeLabel: 'Half Dozen', price: 12, qty: 2 },
        { id: 'reward-standard-dozen', type: 'standard', flavor: 'Standard Dozen: Monster', sizeLabel: 'Dozen', price: 0, isReward: true, pointsCost: 600, qty: 1 },
        { id: 'gluten_free_standard:monster:batch', type: 'gluten_free_standard', flavor: 'Monster', sizeLabel: 'Batch', price: 80, qty: 1 },
      ],
      subtotal: 104,
      total: 104,
    };
    assert.deepEqual(buildOrderTableText(order), [
      '  2 x Chocolate Chip (Half Dozen) - $24.00',
      '  1 x Standard Dozen: Monster (Dozen) - Redeemed with 600 points',
      '  1 x Monster (GF, Batch) - $80.00',
      '  Subtotal: $104.00',
      '  Total: $104.00',
      '  Points redeemed: 600',
    ]);
    assert.ok(buildOrderTableText({ ...order, shippingFee: 24, total: 128 }).includes('  Shipping: $24.00'));
    assert.ok(buildOrderTableHtml(order).includes('Redeemed with points'));

    // Reward helpers, including orders saved before the reward flag existed.
    assert.equal(isRewardItem({ isReward: true }), true);
    assert.equal(isRewardItem({ id: 'reward-standard-dozen' }), true);
    assert.equal(isRewardItem({ id: 'standard:monster:single' }), false);
    assert.equal(rewardPointsFor({ pointsCost: 600, qty: 1 }), 600);
    assert.equal(rewardPointsFor({ id: 'reward-standard-dozen', qty: 2 }), 1200);
    assert.equal(rewardPointsFor({ id: 'reward-not-a-reward', qty: 1 }), null);
  });
});

// ---------------------------------------------------------------------------
// Customer emails (email/receipt.js, email/orderStatusEmail.js)
// ---------------------------------------------------------------------------

describe('Receipt email', () => {
  const gobbleOrder = savedOrder({
    items: [
      {
        id: 'seasonal_gobble_bucket:gobble-bucket:item',
        type: 'seasonal_gobble_bucket',
        flavor: 'Gobble Bucket',
        sizeLabel: 'Chocolate Chip, Monster & Sugar',
        price: 40,
        qty: 1,
      },
    ],
    subtotal: 40,
    total: 40,
  });

  it('presents a pickup time as a request, with the pickup address, and escapes the HTML version', () => {
    const email = buildReceiptEmail({
      contact: CONTACT,
      fulfillment: { method: 'pickup', pickupDate: '2026-11-20', pickupTime: '17:00' },
      orders: [gobbleOrder],
    });
    assert.equal(email.subject, 'Your Cozy Dough Cookies receipt');
    assert.match(email.text, /Thanks for your order, Ada!/);
    assert.match(email.text, /Requested pickup: .*November 20, 2026/);
    assert.match(email.text, /Your pickup time is a request/);
    assert.ok(email.text.includes(`Pickup address: ${PICKUP_ADDRESS}`));
    assert.ok(email.text.includes('Gobble Bucket (Chocolate Chip, Monster & Sugar)'));
    assert.ok(email.html.includes('Gobble Bucket (Chocolate Chip, Monster &amp; Sugar)'));
    assert.equal(/Shipping to/.test(email.text), false);
  });

  it('shows the shipping address and fee on a shipped order, and never lets a name inject HTML', () => {
    const email = buildReceiptEmail({
      contact: { ...CONTACT, firstName: '<script>alert(1)</script>' },
      fulfillment: {
        method: 'shipping',
        shippingAddress: { line1: '1 Main St', line2: 'Apt 4', city: 'Omaha', state: 'NE', zip: '68102' },
      },
      orders: [savedOrder({ shippingFee: 24, total: 36 })],
    });
    assert.match(email.text, /Shipping to:\n\n1 Main St\n\nApt 4\n\nOmaha, NE 68102/);
    assert.ok(email.text.includes('Shipping: $24.00'));
    assert.equal(email.text.includes(PICKUP_ADDRESS), false);
    assert.equal(email.html.includes('<script>'), false);
    assert.ok(email.html.includes('&lt;script&gt;'));
  });

  it('labels each order of a multi-order checkout and adds a grand total', () => {
    const email = buildReceiptEmail({
      contact: CONTACT,
      fulfillment: { method: 'pickup', pickupDate: '2026-11-20', pickupTime: '12:00' },
      orders: [savedOrder(), gobbleOrder],
    });
    assert.ok(email.text.includes('Order 1 of 2'));
    assert.ok(email.text.includes('Order 2 of 2'));
    assert.ok(email.text.includes('Grand total: $52.00'));
    // A single-order checkout carries none of that.
    const single = buildReceiptEmail({ contact: CONTACT, fulfillment: { method: 'pickup', pickupDate: '2026-11-20', pickupTime: '12:00' }, orders: [savedOrder()] });
    assert.equal(single.text.includes('Order 1 of 1'), false);
    assert.equal(single.text.includes('Grand total'), false);
  });
});

describe('Order status emails', () => {
  it('sends nothing for stages the customer is not told about, and words the rest for the way the order is fulfilled', () => {
    assert.equal(buildStatusChangeEmail({ contact: CONTACT, method: 'pickup', status: 'placed', order: savedOrder() }), null);
    assert.equal(buildStatusChangeEmail({ contact: CONTACT, method: 'carrier-pigeon', status: 'ready', order: savedOrder() }), null);

    const pickupDone = buildStatusChangeEmail({ contact: CONTACT, method: 'pickup', status: 'completed', order: savedOrder() });
    assert.ok(pickupDone.text.includes('Your order has been picked up. Thanks for stopping by!'));
    assert.ok(pickupDone.text.includes(`Pickup address: ${PICKUP_ADDRESS}`));

    const shipped = buildStatusChangeEmail({
      contact: CONTACT,
      method: 'shipping',
      status: 'ready',
      order: savedOrder({ fulfillment: { method: 'shipping', shippingAddress: { line1: '1 Main St', city: 'Omaha', state: 'NE', zip: '68102' } } }),
    });
    assert.ok(shipped.text.includes('Your order has shipped!'));
    assert.ok(shipped.text.includes('Shipping to:'));
    assert.equal(shipped.subject, 'Your Cozy Dough Cookies order update');
  });

  it('tells a customer about their refund and any reward points returned when an order is canceled', () => {
    const email = buildStatusChangeEmail({
      contact: CONTACT,
      method: 'pickup',
      status: 'canceled',
      order: savedOrder(),
      refund: { amount: 4000 },
      pointsReturned: 1,
    });
    assert.ok(email.text.includes('Your order has been canceled.'));
    assert.ok(email.text.includes('A refund of $40.00 has been issued to your original payment method.'));
    assert.ok(email.text.includes('5-10 business days'));
    assert.ok(email.text.includes('The 1 reward point you used on this order has been returned to your account.'));

    const many = buildStatusChangeEmail({ contact: CONTACT, method: 'pickup', status: 'canceled', order: savedOrder(), pointsReturned: 300 });
    assert.ok(many.text.includes('The 300 reward points you used on this order have been returned to your account.'));
    assert.equal(many.text.includes('A refund of'), false);
  });

  it('writes a refund email for an order already picked up, without the pickup address', () => {
    const email = buildRefundEmail({ contact: CONTACT, order: savedOrder(), refund: { amount: 1200 } });
    assert.equal(email.subject, 'Your Cozy Dough Cookies refund');
    assert.ok(email.text.includes('Hi Ada,'));
    assert.ok(email.text.includes('Your order has been refunded.'));
    assert.ok(email.text.includes('A refund of $12.00 has been issued'));
    assert.equal(email.text.includes('Pickup address'), false);
  });

  it('says plainly when a pickup time was changed, and always carries the 24-hour reminder and address', () => {
    const base = { contact: CONTACT, pickupDate: '2026-11-21', pickupTime: '11:00' };
    const unchanged = buildPickupTimeEmail({ ...base, changed: false, order: savedOrder({ fulfillment: { method: 'pickup', pickupDate: '2026-11-21', pickupTime: '11:00' } }) });
    const firstChange = buildPickupTimeEmail({ ...base, changed: true, order: savedOrder({ status: 'placed' }) });
    const laterChange = buildPickupTimeEmail({ ...base, changed: true, note: 'Back door, please.', order: savedOrder({ status: 'confirmed' }) });

    assert.equal(unchanged.subject, 'Your Cozy Dough Cookies pickup time');
    assert.match(unchanged.text, /confirmed for your requested pickup time/);
    assert.equal(unchanged.text.includes('Please note'), false);

    assert.equal(firstChange.subject, 'Your Cozy Dough Cookies pickup time has changed');
    assert.match(firstChange.text, /we had to change your pickup time/);
    assert.match(firstChange.text, /You requested: .*November 20, 2026/s);
    assert.match(firstChange.text, /Your confirmed pickup time: .*November 21, 2026/s);

    assert.match(laterChange.text, /still confirmed, but we had to change your pickup time/);
    assert.match(laterChange.text, /Previous pickup time:/);
    assert.ok(laterChange.text.includes('Note from us: Back door, please.'));

    for (const email of [unchanged, firstChange, laterChange]) {
      assert.match(email.text, /within 24 hours of that time, the order will be forfeited with no refund/);
      assert.ok(email.text.includes(`Pickup address: ${PICKUP_ADDRESS}`));
    }
  });
});

// ---------------------------------------------------------------------------
// Checkout with points only (checkout/freeCheckout.js)
// ---------------------------------------------------------------------------

describe('Points-only checkout', () => {
  const checkoutKey = 'abcdefghij0123456789';
  const now = new Date('2026-11-20T21:00:00.000Z');
  const build = (overrides = {}) => {
    const cart = new Cart();
    cart.addOrder(orderOf([rewardItem(), 1]));
    cart.addOrder(orderOf([rewardItem({ id: 'reward-special-single', pointsCost: 75, flavor: 'Special Single: Brownie', physicalCookieUnits: 1 }), 1]));
    return buildFreeOrderRecords({
      user: { customerId: 'cust-1' },
      contact: CONTACT,
      fulfillment: { method: 'pickup', pickupDate: '2026-11-22', pickupTime: '12:00' },
      cart,
      resolvedRedemptions: [
        { orderIndex: 0, entry: { points: 600 } },
        { orderIndex: 1, entry: { points: 75 } },
      ],
      checkoutKey,
      pickupNoticeVersion: PICKUP_NOTICE_VERSION,
      now,
      ...overrides,
    });
  };

  it('saves $0 orders with no payment, earning nothing and spending what each order redeemed', () => {
    const records = build();
    assert.equal(records.length, 2);
    for (const record of records) {
      assert.equal(record.status, 'placed');
      assert.equal(record.total, 0);
      assert.equal(record.subtotal, 0);
      assert.equal(record.pointsEarned, 0);
      assert.equal(record.customerId, 'cust-1');
      assert.equal(record.email, CONTACT.email);
      assert.equal(record.createdAt, now.toISOString());
      assert.equal('payment' in record, false);
      assert.deepEqual(record.pickupNotice, { version: PICKUP_NOTICE_VERSION, acknowledgedAt: now.toISOString() });
    }
    assert.deepEqual(records.map((r) => r.pointsSpent), [600, 75]);
  });

  it('derives order ids from the customer and one-time key, so a retry cannot create a second order', () => {
    const first = build().map((r) => r.orderId);
    const retry = build().map((r) => r.orderId);
    assert.deepEqual(first, retry);
    assert.equal(new Set(first).size, 2);
    for (const id of first) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);

    const otherKey = build({ checkoutKey: 'zyxwvutsrq9876543210' }).map((r) => r.orderId);
    const otherCustomer = build({ user: { customerId: 'cust-2' } }).map((r) => r.orderId);
    assert.equal(otherKey.some((id) => first.includes(id)), false);
    assert.equal(otherCustomer.some((id) => first.includes(id)), false);

    // The one-time key's accepted shape.
    assert.match('123e4567-e89b-12d3-a456-426614174000', CHECKOUT_KEY_RE);
    assert.doesNotMatch('too-short', CHECKOUT_KEY_RE);
    assert.doesNotMatch('has spaces in it, which is bad!!', CHECKOUT_KEY_RE);
  });
});

// ---------------------------------------------------------------------------
// Rate limits (email/rateLimit.js, shipping/ipRateLimit.js)
// ---------------------------------------------------------------------------

describe('Rate limits', () => {
  it('lets one email address request a few verification codes an hour, then stops, then resets', () => {
    const email = `limit-test-${Date.now()}@example.com`;
    for (let i = 0; i < EMAIL_VERIFICATION_RATE_LIMIT_MAX_CALLS_DEFAULT; i++) {
      assert.equal(checkEmailSendRateLimit(email), true, `request ${i + 1} should be allowed`);
    }
    assert.equal(checkEmailSendRateLimit(email), false);
    // Someone else's inbox has its own allowance.
    assert.equal(checkEmailSendRateLimit(`other-${email}`), true);

    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      mock.timers.tick(EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS_DEFAULT);
      assert.equal(checkEmailSendRateLimit(email), true, 'a new window should start after an hour');
    } finally {
      mock.timers.reset();
    }
  });

  it('turns away an IP address that makes too many checkout requests, but not other addresses', () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < IP_RATE_LIMIT_MAX_CALLS_DEFAULT; i++) {
      assert.equal(checkIpRateLimit(ip), true, `request ${i + 1} should be allowed`);
    }
    assert.equal(checkIpRateLimit(ip), false);
    assert.equal(checkIpRateLimit('198.51.100.7'), true);

    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      mock.timers.tick(IP_RATE_LIMIT_WINDOW_MS_DEFAULT);
      assert.equal(checkIpRateLimit(ip), true, 'a new window should start after an hour');
    } finally {
      mock.timers.reset();
    }
  });
});

// ---------------------------------------------------------------------------
// Input formats (constants.js)
// ---------------------------------------------------------------------------

describe('Input formats', () => {
  it('accepts well-formed emails, ZIP codes and states and rejects malformed ones', () => {
    for (const ok of ['a@b.co', 'first.last+tag@example.com']) assert.match(ok, EMAIL_RE);
    for (const bad of ['', 'a@b', 'a b@c.d', '@c.d', 'plain']) assert.doesNotMatch(bad, EMAIL_RE);

    for (const ok of ['68123', '68123-4567']) assert.match(ok, ZIP_RE);
    for (const bad of ['6812', '681234', '68123-45', 'abcde']) assert.doesNotMatch(bad, ZIP_RE);

    for (const ok of ['NE', 'ne']) assert.match(ok, STATE_RE);
    for (const bad of ['N', 'NEB', '12']) assert.doesNotMatch(bad, STATE_RE);

    assert.match('2026-11-20', PICKUP_DATE_RE);
    assert.doesNotMatch('11/20/2026', PICKUP_DATE_RE);
  });

  it('accepts only quarter-hour pickup times, inside the 10am to 7pm hours the shop is open', () => {
    for (const ok of ['10:00', '10:15', '14:30', '18:45', '19:00']) assert.match(ok, PICKUP_TIME_RE);
    for (const bad of ['10:10', '24:00', '9:00', '10:5', '10:60', '']) assert.doesNotMatch(bad, PICKUP_TIME_RE);
    assert.equal(PICKUP_OPEN_MINUTES, 10 * 60);
    assert.equal(PICKUP_CLOSE_MINUTES, 19 * 60);
  });
});

// ---------------------------------------------------------------------------
// What the payment form tells Stripe about the customer (frontend/src/stripe/billingDetails.js)
// ---------------------------------------------------------------------------

describe('Billing details sent to Stripe', () => {
  it("sends the customer's full name and email, tidied, and nothing else", () => {
    const details = buildBillingDetails({ firstName: '  Ada ', lastName: 'Lovelace', email: ' ada@example.com ' });
    assert.deepEqual(details, { name: 'Ada Lovelace', email: 'ada@example.com' });
    // No address (the payment form collects that itself) and no receipt_email (our own receipt is the one customers get).
    assert.deepEqual(Object.keys(details).sort(), ['email', 'name']);
  });

  it('hides the Google Pay button for now, but leaves Apple Pay and the card form alone', () => {
    assert.equal(PAYMENT_ELEMENT_OPTIONS.wallets.googlePay, 'never');
    // Apple Pay (and Link) are not mentioned, so they keep Stripe's default of showing when available.
    assert.deepEqual(Object.keys(PAYMENT_ELEMENT_OPTIONS.wallets), ['googlePay']);
    // Nothing else about the form is changed here.
    assert.deepEqual(Object.keys(PAYMENT_ELEMENT_OPTIONS), ['wallets']);
  });

  it('sends only the pieces that exist, and never a blank', () => {
    assert.deepEqual(buildBillingDetails({ firstName: 'Ada', lastName: '', email: '' }), { name: 'Ada' });
    assert.deepEqual(buildBillingDetails({ firstName: '', lastName: 'Lovelace', email: 'ada@example.com' }), { name: 'Lovelace', email: 'ada@example.com' });
    assert.deepEqual(buildBillingDetails({ email: 'ada@example.com' }), { email: 'ada@example.com' });
    assert.deepEqual(buildBillingDetails({ firstName: '   ', lastName: null, email: undefined }), {});
    assert.deepEqual(buildBillingDetails({}), {});
    assert.deepEqual(buildBillingDetails(undefined), {});
    assert.deepEqual(buildBillingDetails(null), {});
  });
});

// ---------------------------------------------------------------------------
// Email addresses and senders (email/ses.js)
// ---------------------------------------------------------------------------

describe('Email senders and recipients', () => {
  it('reads address lists separated by commas, semicolons or spaces, and drops blanks and repeats', () => {
    assert.deepEqual(parseAddressList('a@x.com, b@x.com;a@x.com   c@x.com ,'), ['a@x.com', 'b@x.com', 'c@x.com']);
    assert.deepEqual(parseAddressList(''), []);
    assert.deepEqual(parseAddressList(undefined), []);

    assert.equal(fromHeader('orders@example.com'), '"Cozy Dough Cookies" <orders@example.com>');
    assert.equal(fromHeader('Cozy Dough Cookies <orders@example.com>'), 'Cozy Dough Cookies <orders@example.com>');

    const before = process.env.STAFF_NOTIFICATION_EMAIL;
    process.env.STAFF_NOTIFICATION_EMAIL = 'owner@example.com; baker@example.com';
    try {
      assert.deepEqual(staffRecipients(), ['owner@example.com', 'baker@example.com']);
    } finally {
      if (before === undefined) delete process.env.STAFF_NOTIFICATION_EMAIL;
      else process.env.STAFF_NOTIFICATION_EMAIL = before;
    }
  });
});
