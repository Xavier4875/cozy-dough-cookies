import { Order } from './Order.js';

// Immutable-style, same reasoning as Order: every method returns a new Cart.
export class Cart {
  constructor(orders = []) {
    this.orders = orders;
  }

  addOrder(order = new Order()) {
    return new Cart([...this.orders, order]);
  }

  removeOrder(orderId) {
    return new Cart(this.orders.filter((order) => order.id !== orderId));
  }

  updateOrder(orderId, updater) {
    return new Cart(
      this.orders.map((order) => (order.id === orderId ? updater(order) : order))
    );
  }

  get grandTotal() {
    return this.orders.reduce((sum, order) => sum + order.total, 0);
  }

  get cookieCount() {
    return this.orders.reduce((sum, order) => sum + order.cookieCount, 0);
  }

  get orderCount() {
    return this.orders.filter((order) => !order.isEmpty).length;
  }

  get isEmpty() {
    return this.orders.every((order) => order.isEmpty);
  }

  toCheckoutPayload() {
    return {
      orders: this.orders.filter((order) => !order.isEmpty).map((order) => order.toCheckoutPayload()),
    };
  }
}
