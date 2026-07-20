import { SHIPPING_MEDIUM_MAX_COOKIES, SHIPPING_FEE_MEDIUM, SHIPPING_FEE_LARGE } from '../constants.js';

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

  // Shipping isn't available when any item needs refrigeration.
  get requiresPickup() {
    return this.items.some((item) => item.cookie.is_temperature_controlled);
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
        qty: item.qty,
      })),
      total: this.total,
    };
  }
}
