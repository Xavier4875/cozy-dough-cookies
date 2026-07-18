import { useCart } from '../context/useCart.js';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import './OrderHistory.css';

function OrderHistory() {
  const { isAuthenticated } = useAuth();
  const { orderHistory, orderHistoryLoading } = useCart();

  if (!isAuthenticated) {
    return (
      <div className="order-history-page">
        <div className="page-mascot">
          <Mascot />
        </div>
        <p className="order-history-signin-note">Sign in to see your order history.</p>
      </div>
    );
  }

  return (
    <div className="order-history-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>Order History</h1>
      {orderHistoryLoading ? (
        <p className="empty-cart">Loading...</p>
      ) : orderHistory.length === 0 ? (
        <p className="empty-cart">No past orders yet.</p>
      ) : (
        orderHistory.map((order) => (
          <div key={order.orderId} className="receipt-order">
            <p className="receipt-order-title">
              <span className="order-id">#{order.orderId}</span> — {order.status}
            </p>
            <ul className="cart-list">
              {order.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.flavor} ({item.sizeLabel}) × {item.qty}
                  </span>
                  <span>${(item.price * item.qty).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <p className="cart-total">Order total: ${order.total.toFixed(2)}</p>
          </div>
        ))
      )}
    </div>
  );
}

export default OrderHistory;
