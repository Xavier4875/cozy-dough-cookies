import { useCart } from '../context/useCart.js';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import './OrderHistory.css';

function formatOrderDate(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// pickupDate/pickupTime are plain "YYYY-MM-DD"/"HH:MM" wall-clock strings
// (no timezone info — see PickupScheduleModal), so this builds a local Date
// directly from the components rather than parsing them as an ISO instant.
function formatPickupDateTime(pickupDate, pickupTime) {
  const [year, month, day] = pickupDate.split('-').map(Number);
  const [hour, minute] = pickupTime.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShippingAddress(shippingAddress) {
  // Legacy orders (placed before structured addresses existed) stored this
  // as a plain free-text string — render it as-is rather than crashing.
  if (typeof shippingAddress === 'string') return shippingAddress;
  const { line1, line2, city, state, zip } = shippingAddress;
  return [line1, line2, `${city}, ${state} ${zip}`].filter(Boolean).join(', ');
}

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
            <p className="receipt-order-date">{formatOrderDate(order.createdAt)}</p>
            <p className="receipt-order-title">
              <span className="order-id">#{order.orderId}</span> — {order.status}
            </p>
            {order.fulfillment?.method === 'pickup' &&
              order.fulfillment.pickupDate &&
              order.fulfillment.pickupTime && (
              <p className="receipt-order-pickup">
                Pickup: {formatPickupDateTime(order.fulfillment.pickupDate, order.fulfillment.pickupTime)}
              </p>
            )}
            {order.fulfillment?.method === 'shipping' && order.fulfillment.shippingAddress && (
              <p className="receipt-order-pickup">
                Shipping to: {formatShippingAddress(order.fulfillment.shippingAddress)}
              </p>
            )}
            {order.fulfillment?.addressVerified === false && (
              <p className="receipt-order-pickup">
                Address could not be verified — please double-check it's correct.
              </p>
            )}
            {order.shippingFee !== undefined && (
              <p className="receipt-order-pickup">
                Shipping &amp; handling: ${order.shippingFee.toFixed(2)}
              </p>
            )}
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
