import { useState, useEffect } from 'react';
import './App.css';

const TYPE_ORDER = ['standard', 'special', 'premium'];
const TYPE_LABELS = {
  standard: 'Standard',
  special: 'Special',
  premium: 'Premium',
};

function App() {
  const [status, setStatus] = useState('checking...');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [order, setOrder] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.message))
      .catch(() => setStatus('Could not reach the backend'));

    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch(() => setProducts([]));
  }, []);

  function addToCart(product) {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...product, qty: 1 }];
    });
  }

  function removeFromCart(productId) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.id === productId ? { ...item, qty: item.qty - 1 } : item
        )
        .filter((item) => item.qty > 0)
    );
  }

  async function handleCheckout() {
    setCheckingOut(true);
    setCheckoutError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((item) => ({ id: item.id, qty: item.qty })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Checkout failed.');
      }
      setOrder(data);
      setCart([]);
    } catch (err) {
      setCheckoutError(err.message);
    } finally {
      setCheckingOut(false);
    }
  }

  function startNewOrder() {
    setOrder(null);
    setCheckoutError('');
  }

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  return (
    <div className="app">
      <h1>Cozy Dough Cookies</h1>
      <p className="status">Backend status: {status}</p>

      <h2>Cookies</h2>
      {TYPE_ORDER.map((type) => {
        const typeProducts = products.filter((p) => p.type === type);
        if (typeProducts.length === 0) return null;
        return (
          <section key={type} className={`product-section product-section--${type}`}>
            <h3 className="product-section-title">
              {TYPE_LABELS[type]}{' '}
              <span className="product-section-price">
                ${typeProducts[0].price.toFixed(2)} each
              </span>
            </h3>
            <ul className="product-list">
              {typeProducts.map((p) => (
                <li key={p.id}>
                  <span>{p.flavor}</span>
                  <button className="add-btn" onClick={() => addToCart(p)}>
                    Add to cart
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {order ? (
        <div className="order-confirmation">
          <h2>Order confirmed</h2>
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
      ) : (
        <>
          <h2>Cart {cartCount > 0 && `(${cartCount})`}</h2>
          {cart.length === 0 ? (
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
              <p className="cart-total">Total: ${total.toFixed(2)}</p>
              {checkoutError && <p className="checkout-error">{checkoutError}</p>}
              <button
                className="checkout-btn"
                onClick={handleCheckout}
                disabled={checkingOut}
              >
                {checkingOut ? 'Placing order...' : 'Checkout'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;
