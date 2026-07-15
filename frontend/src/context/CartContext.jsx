import { createContext, useEffect, useState } from 'react';
import { Cart } from '../models/Cart.js';
import { Order } from '../models/Order.js';

// Exported so useCart.js (a separate file, kept apart so this file only
// exports the CartProvider component — mixing a component export with a
// plain hook export in one file breaks Vite Fast Refresh) can read from it.
export const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState(() => new Cart([new Order()]));
  const [activeOrderId, setActiveOrderId] = useState(() => cart.orders[0].id);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch(() => setProducts([]));
  }, []);

  const activeOrder = cart.orders.find((order) => order.id === activeOrderId) ?? cart.orders[0];

  function addCookieToActiveOrder(cookie) {
    setCart((prev) => prev.updateOrder(activeOrderId, (order) => order.addCookie(cookie)));
  }

  function removeCookieFromActiveOrder(cookieId) {
    setCart((prev) => prev.updateOrder(activeOrderId, (order) => order.removeCookie(cookieId)));
  }

  function qtyInActiveOrder(cookieId) {
    return activeOrder.qtyOf(cookieId);
  }

  function startNewOrder() {
    const order = new Order();
    setCart((prev) => prev.addOrder(order));
    setActiveOrderId(order.id);
  }

  function switchActiveOrder(orderId) {
    setActiveOrderId(orderId);
  }

  function removeOrder(orderId) {
    const next = cart.removeOrder(orderId);
    if (orderId !== activeOrderId) {
      setCart(next);
      return;
    }
    if (next.orders.length > 0) {
      setActiveOrderId(next.orders[0].id);
      setCart(next);
    } else {
      const fresh = new Order();
      setActiveOrderId(fresh.id);
      setCart(next.addOrder(fresh));
    }
  }

  async function submitToBackend(payload) {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Checkout failed.');
    }
    return data;
  }

  // Checks out a single order, leaving every other in-progress order untouched.
  // `details` is { contact, fulfillment } collected by the checkout form.
  // Returns whether it succeeded, so the caller knows whether to dismiss the
  // form or leave it open (with the error visible) for a retry.
  async function checkoutOrder(orderId, details) {
    const order = cart.orders.find((o) => o.id === orderId);
    if (!order || order.isEmpty) return false;

    setCheckingOut(true);
    setCheckoutError('');
    try {
      await submitToBackend({ orders: [order.toCheckoutPayload()], ...details });
      removeOrder(orderId);
      return true;
    } catch (err) {
      setCheckoutError(err.message);
      return false;
    } finally {
      setCheckingOut(false);
    }
  }

  // Checks out every non-empty order in the cart together, then starts fresh.
  async function checkoutAll(details) {
    const payload = cart.toCheckoutPayload();
    if (payload.orders.length === 0) return false;

    setCheckingOut(true);
    setCheckoutError('');
    try {
      await submitToBackend({ ...payload, ...details });
      const fresh = new Order();
      setCart(new Cart([fresh]));
      setActiveOrderId(fresh.id);
      return true;
    } catch (err) {
      setCheckoutError(err.message);
      return false;
    } finally {
      setCheckingOut(false);
    }
  }

  const value = {
    products,
    cart,
    activeOrder,
    activeOrderId,
    addCookieToActiveOrder,
    removeCookieFromActiveOrder,
    qtyInActiveOrder,
    startNewOrder,
    switchActiveOrder,
    removeOrder,
    isCartOpen,
    openCart: () => setIsCartOpen(true),
    closeCart: () => setIsCartOpen(false),
    toggleCart: () => setIsCartOpen((prev) => !prev),
    checkingOut,
    checkoutError,
    checkoutOrder,
    checkoutAll,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
