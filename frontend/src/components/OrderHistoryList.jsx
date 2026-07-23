import { useState } from 'react';
import './OrderHistoryList.css';

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

function formatTime12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// A pickup date equal to the order's own placement date can only happen via
// the "Request same day pickup" link (PickupScheduleModal's normal calendar
// never allows selecting today), so this comparison alone tells same-day
// requests apart from ordinary ones — no separate flag stored on the order,
// and it stays correct even if staff later edit the pickup time.
function isSameDayPickup(order) {
  const placed = new Date(order.createdAt);
  const placedKey = `${placed.getFullYear()}-${String(placed.getMonth() + 1).padStart(2, '0')}-${String(placed.getDate()).padStart(2, '0')}`;
  return order.fulfillment.pickupDate === placedKey;
}

// order.status is the internal placed/confirmed/ready/completed pipeline
// staff drive from Order Tracking — this maps it to wording a customer
// should actually see, split by fulfillment method for the two stages whose
// meaning differs (pickup vs. shipping).
function statusLabel(order) {
  const isShipping = order.fulfillment?.method === 'shipping';
  switch (order.status) {
    case 'placed':
      return 'Placed';
    case 'confirmed':
      return 'Confirmed';
    case 'ready':
      return isShipping ? 'Shipped' : 'Ready for pickup';
    case 'completed':
      return isShipping ? 'Delivered' : 'Picked up';
    case 'canceled':
      return 'Canceled';
    default:
      return order.status;
  }
}

// Color/checkmark treatment matching the same visual language staff see on
// Order Tracking (gray -> green checkmark -> blue checkmark, red X if
// canceled) — so a status change is something a customer actually notices,
// not just a word buried in a line of text.
function statusBadgeClass(status) {
  switch (status) {
    case 'confirmed':
      return 'order-status-badge--confirmed';
    case 'ready':
    case 'completed':
      return 'order-status-badge--ready';
    case 'canceled':
      return 'order-status-badge--canceled';
    default:
      return 'order-status-badge--placed';
  }
}

function statusBadgePrefix(status) {
  if (status === 'placed') return '';
  return status === 'canceled' ? '✕ ' : '✓ ';
}

function OrderCard({ order }) {
  return (
    <div className="receipt-order">
      <p className="receipt-order-date">{formatOrderDate(order.createdAt)}</p>
      <p className="receipt-order-title">
        <span className="order-id">#{order.orderId}</span> —{' '}
        <span className={'order-status-badge ' + statusBadgeClass(order.status)}>
          {statusBadgePrefix(order.status)}
          {statusLabel(order)}
        </span>
      </p>
      {order.fulfillment?.method === 'pickup' &&
        order.fulfillment.pickupDate &&
        order.fulfillment.pickupTime && (
        <p className="receipt-order-pickup">
          {/* order.confirmedAt, not order.status !== 'placed' — a canceled order can
              reach a non-'placed' status without ever having actually been confirmed. */}
          {isSameDayPickup(order) ? (
            <>
              Same Day Pickup ({order.confirmedAt ? 'Confirmed' : 'Requested'}):{' '}
              {formatTime12h(order.fulfillment.pickupTime)}
            </>
          ) : (
            <>
              Pickup Time ({order.confirmedAt ? 'Confirmed' : 'Requested'}):{' '}
              {formatPickupDateTime(order.fulfillment.pickupDate, order.fulfillment.pickupTime)}
            </>
          )}
        </p>
      )}
      {order.fulfillment?.staffNote && (
        <p className="receipt-order-pickup">Note from staff: {order.fulfillment.staffNote}</p>
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
  );
}

// An order is "active" until it reaches one of the two terminal statuses
// staff can put it in (Order Tracking's completed/canceled) — same split as
// staff's Active/Recent tabs, just scoped to whichever order set the caller
// passed in, and, unlike Recent Orders, with no 7-day window: the full
// history stays visible under Past Orders indefinitely.
const PAST_STATUSES = ['completed', 'canceled'];

// The order list + Active/Past tab switcher shared by the customer-facing
// My Orders page (OrderHistory.jsx) and staff's Past Orders lookup
// (OrderTracking.jsx) — same component, same look, so staff see literally
// what a customer would see on their own account.
function OrderHistoryList({ orders, loading }) {
  const [tab, setTab] = useState('active');

  const visibleOrders = orders.filter((order) =>
    tab === 'active' ? !PAST_STATUSES.includes(order.status) : PAST_STATUSES.includes(order.status)
  );

  return (
    <>
      <div className="order-history-tabs">
        <button
          type="button"
          className={'order-history-tab' + (tab === 'active' ? ' order-history-tab--active' : '')}
          onClick={() => setTab('active')}
        >
          Active Orders
        </button>
        <button
          type="button"
          className={'order-history-tab' + (tab === 'past' ? ' order-history-tab--active' : '')}
          onClick={() => setTab('past')}
        >
          Past Orders
        </button>
      </div>

      {loading ? (
        <p className="empty-cart">Loading...</p>
      ) : visibleOrders.length === 0 ? (
        <p className="empty-cart">{tab === 'active' ? 'No active orders.' : 'No past orders yet.'}</p>
      ) : (
        visibleOrders.map((order) => <OrderCard key={order.orderId} order={order} />)
      )}
    </>
  );
}

export default OrderHistoryList;
