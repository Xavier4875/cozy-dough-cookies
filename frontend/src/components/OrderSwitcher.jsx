import { useCart } from '../context/useCart.js';
import './OrderSwitcher.css';

function OrderSwitcher() {
  const { cart, activeOrderId, switchActiveOrder, startNewOrder, removeOrder } = useCart();

  return (
    <div className="order-switcher">
      {cart.orders.map((order, index) => (
        <div
          key={order.id}
          className={
            'order-chip' + (order.id === activeOrderId ? ' order-chip--active' : '')
          }
        >
          <button className="order-chip-label" onClick={() => switchActiveOrder(order.id)}>
            Order {index + 1}
            {order.cookieCount > 0 && ` (${order.cookieCount})`}
          </button>
          {cart.orders.length > 1 && (
            <button
              className="order-chip-remove"
              onClick={() => removeOrder(order.id)}
              aria-label={`Remove order ${index + 1}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button className="order-chip order-chip--new" onClick={startNewOrder}>
        + New order
      </button>
    </div>
  );
}

export default OrderSwitcher;
