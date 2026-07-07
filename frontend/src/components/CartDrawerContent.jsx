import { useCart } from '../context/useCart.js';
import './CartDrawerContent.css';

// The actual cart data/checkout UI, with no knowledge of whether it's
// rendered inside a right-side drawer (desktop) or a bottom sheet (mobile)
// — those shells just wrap this in different positioning/animation chrome.
function CartDrawerContent() {
  const {
    closeCart,
    cart,
    activeOrderId,
    switchActiveOrder,
    removeOrder,
    placedOrders,
    checkingOut,
    checkoutError,
    checkoutOrder,
    checkoutAll,
  } = useCart();

  return (
    <>
      <div className="cart-drawer-header">
        <h2>Your Cart</h2>
        <button
          className="cart-drawer-close"
          onClick={closeCart}
          aria-label="Close cart"
        >
          ×
        </button>
      </div>

      {placedOrders.length > 0 && (
        <div className="order-history">
          <h3 className="order-history-title">Order history</h3>
          {placedOrders.map((order) => (
            <div key={order.orderId} className="receipt-order">
              <p className="receipt-order-title">
                <span className="order-id">#{order.orderId}</span>
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
          ))}
        </div>
      )}

      <h3 className="cart-section-title">In progress</h3>
      {cart.isEmpty ? (
        <p className="empty-cart">Your cart is empty.</p>
      ) : (
        <>
          {cart.orders.map((order, index) => (
            <div
              key={order.id}
              className={
                'cart-order' + (order.id === activeOrderId ? ' cart-order--active' : '')
              }
            >
              <div className="cart-order-header">
                <button
                  className="cart-order-title"
                  onClick={() => switchActiveOrder(order.id)}
                >
                  Order {index + 1}
                  {order.id === activeOrderId && ' (editing)'}
                </button>
                {cart.orders.length > 1 && (
                  <button
                    className="remove-btn"
                    onClick={() => removeOrder(order.id)}
                    aria-label={`Remove order ${index + 1}`}
                  >
                    −
                  </button>
                )}
              </div>
              {order.isEmpty ? (
                <p className="empty-cart">No cookies yet.</p>
              ) : (
                <ul className="cart-list">
                  {order.items.map((item) => (
                    <li key={item.cookie.id}>
                      <span>
                        {item.cookie.flavor} ({item.cookie.sizeLabel}) × {item.qty}
                      </span>
                      <span>${(item.cookie.price * item.qty).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="cart-order-footer">
                <p className="cart-total">Order total: ${order.total.toFixed(2)}</p>
                {!order.isEmpty && (
                  <button
                    className="checkout-order-btn"
                    onClick={() => checkoutOrder(order.id)}
                    disabled={checkingOut}
                  >
                    Checkout this order
                  </button>
                )}
              </div>
            </div>
          ))}
          <p className="cart-total cart-grand-total">
            Grand total: ${cart.grandTotal.toFixed(2)}
          </p>
          {checkoutError && <p className="checkout-error">{checkoutError}</p>}
          <button
            className="checkout-btn"
            onClick={checkoutAll}
            disabled={checkingOut || cart.isEmpty}
          >
            {checkingOut ? 'Placing order...' : 'Checkout all orders'}
          </button>
        </>
      )}
    </>
  );
}

export default CartDrawerContent;
