import { SHIPPING_MEDIUM_MAX_COOKIES, SHIPPING_FEE_MEDIUM, SHIPPING_FEE_LARGE } from '../constants.js';
import { isDietaryRestrictedType } from './Cookie.js';

// Prefixed with a per-boot id so a dev-server restart (node --watch resets
// this counter back to 1) can't produce an order id that collides with one
// already shown to a user before the restart.
const bootId = Date.now().toString(36);

export class Order {
  static #nextId = 1;

  constructor() {
    this.id = `${bootId}-${Order.#nextId++}`;
    this.items = []; // { cookie: Cookie, qty: number }
  }

  addCookie(cookie, qty = 1) {
    const existing = this.items.find((item) => item.cookie.id === cookie.id);
    if (existing) {
      existing.qty += qty;
    } else {
      this.items.push({ cookie, qty });
    }
  }

  get total() {
    return this.items.reduce((sum, item) => sum + item.cookie.price * item.qty, 0);
  }

  // Whether this order redeems a reward — such an order is exempt from the
  // minimum-order rule (see checkout/rules.js).
  get hasReward() {
    return this.items.some((item) => item.cookie.isReward === true);
  }

  // Shipping isn't available when any item can't be shipped: it needs
  // refrigeration, or the shop simply doesn't ship it (is_pickup_only, e.g. the
  // Gobble Bucket). Redeemed rewards carry only is_temperature_controlled, which is
  // why that is checked too.
  get requiresPickup() {
    return this.items.some((item) => item.cookie.is_pickup_only || item.cookie.is_temperature_controlled);
  }

  // Gluten-free/sugar-free batches need real lead time to bake — see
  // PICKUP_EXTENDED_NOTICE_MS and validateExtendedPickupNotice in
  // backend/index.js, which is what actually enforces this at checkout.
  get requiresExtendedPickupNotice() {
    return this.items.some((item) => isDietaryRestrictedType(item.cookie.type));
  }

  // Actual physical cookie count, weighted by box size — distinct from a
  // line-item qty sum, since e.g. one Full Dozen item is 12 cookies, not 1.
  // Reward items carry an explicit physicalCookieUnits instead of an
  // is_single/is_half_dozen/is_full_dozen flag, since a reward's own qty
  // (e.g. "Three Dozen" = 3 full_dozen units) is baked into its identity
  // rather than the line-item qty, which stays 1 for a single redemption.
  get physicalCookieCount() {
    return this.items.reduce((sum, item) => {
      const unitsPerBox =
        item.cookie.physicalCookieUnits !== undefined
          ? item.cookie.physicalCookieUnits
          : item.cookie.is_single ? 1 : item.cookie.is_half_dozen ? 6 : item.cookie.is_full_dozen ? 12 : 0;
      return sum + unitsPerBox * item.qty;
    }, 0);
  }

  get shippingFee() {
    return this.physicalCookieCount <= SHIPPING_MEDIUM_MAX_COOKIES ? SHIPPING_FEE_MEDIUM : SHIPPING_FEE_LARGE;
  }

  toJSON() {
    return {
      orderId: this.id,
      items: this.items.map((item) => ({
        id: item.cookie.id,
        type: item.cookie.type,
        flavor: item.cookie.flavor,
        sizeLabel: item.cookie.sizeLabel,
        price: item.cookie.price,
        is_temperature_controlled: item.cookie.is_temperature_controlled,
        // Persisted so sales aggregation (which reads stored orders, not
        // live Cookie instances) can still get the right cookie count for
        // an item whose physicalCookieUnits doesn't match its sizeLabel's
        // usual unit count — e.g. a gluten-free/sugar-free batch (29, not the
        // 24 in the legacy table). undefined for items with no cookie count,
        // same as on Cookie.
        physicalCookieUnits: item.cookie.physicalCookieUnits,
        // A redeemed reward is saved as one, with what it cost in points per
        // unit, so every screen and email can label it "Redeemed with points"
        // (its price is $0 — the cost is in points). Absent on ordinary items.
        ...(item.cookie.isReward === true && { isReward: true, pointsCost: item.cookie.pointsCost }),
        qty: item.qty,
      })),
      total: this.total,
    };
  }
}
