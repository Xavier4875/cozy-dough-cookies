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

  toJSON() {
    return {
      orderId: this.id,
      items: this.items.map((item) => ({
        id: item.cookie.id,
        type: item.cookie.type,
        flavor: item.cookie.flavor,
        sizeLabel: item.cookie.sizeLabel,
        price: item.cookie.price,
        qty: item.qty,
      })),
      total: this.total,
    };
  }
}
