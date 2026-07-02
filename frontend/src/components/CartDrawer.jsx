import { useCart } from '../context/CartContext.jsx';
import './CartDrawer.css';

function CartDrawer() {
  const {
    isCartOpen,
    closeCart,
    cart,
    removeFromCart,
    cartTotal,
    order,
    checkingOut,
    checkoutError,
    checkout,
    startNewOrder,
  } = useCart();

  if (!isCartOpen) return null;

  return (
    <div className="cart-drawer-overlay" onClick={closeCart}>
      <aside className="cart-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cart-drawer-header">
          <h2>{order ? 'Order confirmed' : 'Your Cart'}</h2>
          <button
            className="cart-drawer-close"
            onClick={closeCart}
            aria-label="Close cart"
          >
            ×
          </button>
        </div>

        {order ? (
          <div className="order-confirmation">
            <p>{order.message}</p>
            <p className="order-id">Order #{order.orderId}</p>
            <ul className="cart-list">
              {order.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.flavor} × {item.qty}
                  </span>
                  <span>${(item.price * item.qty).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <p className="cart-total">Total: ${order.total.toFixed(2)}</p>
            <button className="add-btn" onClick={startNewOrder}>
              Start new order
            </button>
          </div>
        ) : cart.length === 0 ? (
          <p className="empty-cart">Your cart is empty.</p>
        ) : (
          <>
            <ul className="cart-list">
              {cart.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.flavor} × {item.qty}
                  </span>
                  <span className="cart-item-right">
                    ${(item.price * item.qty).toFixed(2)}
                    <button
                      className="remove-btn"
                      onClick={() => removeFromCart(item.id)}
                      aria-label={`Remove one ${item.flavor}`}
                    >
                      −
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="cart-total">Total: ${cartTotal.toFixed(2)}</p>
            {checkoutError && <p className="checkout-error">{checkoutError}</p>}
            <button
              className="checkout-btn"
              onClick={checkout}
              disabled={checkingOut}
            >
              {checkingOut ? 'Placing order...' : 'Checkout'}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

export default CartDrawer;
