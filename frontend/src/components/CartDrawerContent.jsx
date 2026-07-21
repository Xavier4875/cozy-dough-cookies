import { useState } from 'react';
import { useCart } from '../context/useCart.js';
import Mascot from './Mascot.jsx';
import CheckoutForm from './CheckoutForm.jsx';
import { MIN_ORDER_SUBTOTAL } from '../constants.js';
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
    addCookieToOrder,
    removeCookieFromOrder,
    checkingOut,
    checkoutError,
    checkoutOrder,
    checkoutAll,
  } = useCart();

  // { type: 'order', orderId } | { type: 'all' } | null — while set, the
  // contact/fulfillment form replaces the order list/checkout buttons below
  // rather than living alongside them, so there's never more than one
  // checkout action in flight at a time.
  const [checkoutTarget, setCheckoutTarget] = useState(null);

  const pickupOnly =
    checkoutTarget?.type === 'order'
      ? (cart.orders.find((order) => order.id === checkoutTarget.orderId)?.requiresPickup ?? false)
      : checkoutTarget?.type === 'all'
        ? cart.requiresPickup
        : false;

  // The pickup-scheduling modal's confirm step shows the actual order(s)
  // being checked out, same order/id-matching logic as pickupOnly above.
  const checkoutOrders =
    checkoutTarget?.type === 'order'
      ? cart.orders.filter((order) => order.id === checkoutTarget.orderId)
      : checkoutTarget?.type === 'all'
        ? cart.orders.filter((order) => !order.isEmpty)
        : [];

  async function handleCheckoutSubmit(details) {
    const success =
      checkoutTarget.type === 'order'
        ? await checkoutOrder(checkoutTarget.orderId, details)
        : await checkoutAll(details);
    if (success) setCheckoutTarget(null);
  }

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

      <Mascot className="cart-mascot" />

      {checkoutTarget ? (
        <CheckoutForm
          onSubmit={handleCheckoutSubmit}
          onCancel={() => setCheckoutTarget(null)}
          submitting={checkingOut}
          error={checkoutError}
          pickupOnly={pickupOnly}
          orders={checkoutOrders}
        />
      ) : (
        <>
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
                    <button
                      className="remove-btn"
                      onClick={() => removeOrder(order.id)}
                      aria-label={`Remove order ${index + 1}`}
                    >
                      −
                    </button>
                  </div>
                  {order.isEmpty ? (
                    <p className="empty-cart">No cookies yet.</p>
                  ) : (
                    <ul className="cart-list">
                      {order.items.map((item) => (
                        <li key={item.cookie.id}>
                          <span>
                            {item.cookie.flavor} ({item.cookie.sizeLabel})
                            {item.cookie.isReward ? (
                              <>
                                {' '}× {item.qty}
                                <button
                                  className="remove-btn reward-remove-btn"
                                  onClick={() => removeCookieFromOrder(order.id, item.cookie.id)}
                                  aria-label={`Remove ${item.cookie.flavor} reward`}
                                >
                                  ×
                                </button>
                              </>
                            ) : (
                              <span className="cart-item-stepper">
                                <button
                                  className="stepper-btn stepper-btn--remove"
                                  onClick={() => removeCookieFromOrder(order.id, item.cookie.id)}
                                  aria-label={`Remove one ${item.cookie.flavor}`}
                                >
                                  −
                                </button>
                                <span className="stepper-qty">{item.qty}</span>
                                <button
                                  className="stepper-btn stepper-btn--add"
                                  onClick={() => addCookieToOrder(order.id, item.cookie)}
                                  aria-label={`Add one ${item.cookie.flavor}`}
                                >
                                  +
                                </button>
                              </span>
                            )}
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
                        onClick={() => setCheckoutTarget({ type: 'order', orderId: order.id })}
                        disabled={checkingOut || order.valueTotal < MIN_ORDER_SUBTOTAL}
                      >
                        Checkout this order
                      </button>
                    )}
                  </div>
                  {!order.isEmpty && order.valueTotal < MIN_ORDER_SUBTOTAL && (
                    <p className="cart-min-order-note">
                      Add ${(MIN_ORDER_SUBTOTAL - order.valueTotal).toFixed(2)} more to meet the $
                      {MIN_ORDER_SUBTOTAL.toFixed(2)} order minimum.
                    </p>
                  )}
                </div>
              ))}
              <p className="cart-total cart-grand-total">
                Grand total: ${cart.grandTotal.toFixed(2)}
              </p>
              {checkoutError && <p className="checkout-error">{checkoutError}</p>}
              <button
                className="checkout-btn"
                onClick={() => setCheckoutTarget({ type: 'all' })}
                disabled={
                  checkingOut ||
                  cart.isEmpty ||
                  cart.orders.some((order) => !order.isEmpty && order.valueTotal < MIN_ORDER_SUBTOTAL)
                }
              >
                Checkout all orders
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}

export default CartDrawerContent;
