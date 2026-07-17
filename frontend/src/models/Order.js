// crypto.randomUUID() only exists in secure contexts (HTTPS, or the
// special-cased localhost) — it's silently absent when the dev server is
// opened over plain HTTP via a LAN IP (e.g. testing on a phone). Falling
// back to a timestamp+random id keeps id generation working everywhere.
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Immutable-style: every mutation method returns a *new* Order rather than
// modifying this one, so instances can be dropped straight into React state.
export class Order {
  constructor(items = [], id = null) {
    // A module-level counter can reset (e.g. on a dev-server hot reload)
    // while existing Order objects are still sitting in React state,
    // producing duplicate ids/React keys. A random id can't collide with
    // a pre-reset one.
    this.id = id ?? generateId();
    this.items = items; // [{ cookie, qty }]
  }

  addCookie(cookie) {
    const existing = this.items.find((item) => item.cookie.id === cookie.id);
    const items = existing
      ? this.items.map((item) =>
          item.cookie.id === cookie.id ? { ...item, qty: item.qty + 1 } : item
        )
      : [...this.items, { cookie, qty: 1 }];
    return new Order(items, this.id);
  }

  removeCookie(cookieId) {
    const items = this.items
      .map((item) =>
        item.cookie.id === cookieId ? { ...item, qty: item.qty - 1 } : item
      )
      .filter((item) => item.qty > 0);
    return new Order(items, this.id);
  }

  qtyOf(cookieId) {
    return this.items.find((item) => item.cookie.id === cookieId)?.qty ?? 0;
  }

  get isEmpty() {
    return this.items.length === 0;
  }

  get total() {
    return this.items.reduce((sum, item) => sum + item.cookie.price * item.qty, 0);
  }

  get cookieCount() {
    return this.items.reduce((sum, item) => sum + item.qty, 0);
  }

  // Shipping isn't available when any item needs refrigeration.
  get requiresPickup() {
    return this.items.some((item) => item.cookie.is_temperature_controlled);
  }

  toCheckoutPayload() {
    // Reward items carry no price the server should trust — only the key is
    // sent, and it's repeated once per qty (redeeming the same reward twice
    // is two occurrences, not one entry with a count), matching how the
    // backend resolves and re-adds each redemption individually.
    const items = [];
    const redemptions = [];
    for (const item of this.items) {
      if (item.cookie.isReward) {
        for (let i = 0; i < item.qty; i++) redemptions.push(item.cookie.rewardKey);
      } else {
        items.push({ id: item.cookie.id, qty: item.qty });
      }
    }
    return { items, redemptions };
  }
}
