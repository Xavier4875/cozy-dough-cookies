export class Cart {
  constructor() {
    this.orders = [];
  }

  addOrder(order) {
    this.orders.push(order);
  }

  get grandTotal() {
    return this.orders.reduce((sum, order) => sum + order.total, 0);
  }

  toJSON() {
    return {
      orders: this.orders.map((order) => order.toJSON()),
      grandTotal: this.grandTotal,
    };
  }
}
