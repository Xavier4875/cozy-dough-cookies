import { createContext, useEffect, useState } from 'react';
import { Cart } from '../models/Cart.js';
import { Order } from '../models/Order.js';
import { useAuth } from './useAuth.js';
import { UNITS_PER_SIZE } from '../constants.js';

// Exported so useCart.js (a separate file, kept apart so this file only
// exports the CartProvider component — mixing a component export with a
// plain hook export in one file breaks Vite Fast Refresh) can read from it.
export const CartContext = createContext(null);

export function CartProvider({ children }) {
  const { isAuthenticated, getIdToken } = useAuth();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState(() => new Cart([new Order()]));
  const [activeOrderId, setActiveOrderId] = useState(() => cart.orders[0].id);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [orderHistory, setOrderHistory] = useState([]);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [rewardsCatalog, setRewardsCatalog] = useState([]);
  const [rewardsBalance, setRewardsBalance] = useState(0);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    fetch('/api/rewards/catalog')
      .then((res) => res.json())
      .then((data) => setRewardsCatalog(data))
      .catch(() => setRewardsCatalog([]));
  }, []);

  // The balance only exists for signed-in customers — guests never accrue or
  // spend points, so there's nothing to fetch for them.
  useEffect(() => {
    if (!isAuthenticated) {
      setRewardsBalance(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        const res = await fetch('/api/customers/me', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!cancelled && res.ok) setRewardsBalance(data.rewards ?? 0);
      } catch {
        // Leave the last-known balance in place on a transient failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // Order history only exists for signed-in customers — guests never see it.
  useEffect(() => {
    if (!isAuthenticated) {
      setOrderHistory([]);
      return;
    }
    let cancelled = false;
    refreshOrderHistory(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  async function refreshOrderHistory(isCancelled = () => false) {
    setOrderHistoryLoading(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/orders/mine', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!isCancelled()) setOrderHistory(res.ok ? data.orders : []);
    } catch {
      if (!isCancelled()) setOrderHistory([]);
    } finally {
      if (!isCancelled()) setOrderHistoryLoading(false);
    }
  }

  const activeOrder = cart.orders.find((order) => order.id === activeOrderId) ?? cart.orders[0];

  // Derived, not stored — summing reward items currently sitting in the cart
  // on every render is what makes redeeming/un-redeeming update the displayed
  // balance immediately, with no separate bookkeeping to keep in sync.
  const pendingRedeemedPoints = cart.orders.reduce(
    (sum, order) =>
      sum +
      order.items.reduce(
        (s, item) => s + (item.cookie.isReward ? item.cookie.pointsCost * item.qty : 0),
        0
      ),
    0
  );
  const availableRewardsPoints = rewardsBalance - pendingRedeemedPoints;

  function addCookieToActiveOrder(cookie) {
    setCart((prev) => prev.updateOrder(activeOrderId, (order) => order.addCookie(cookie)));
  }

  function removeCookieFromOrder(orderId, cookieId) {
    setCart((prev) => prev.updateOrder(orderId, (order) => order.removeCookie(cookieId)));
  }

  function removeCookieFromActiveOrder(cookieId) {
    removeCookieFromOrder(activeOrderId, cookieId);
  }

  // Guarded client-side so the button can't be clicked past the balance, but
  // checkout re-verifies and spends atomically server-side regardless — this
  // check is purely a UX nicety, never the source of truth.
  function redeemReward(reward) {
    if (availableRewardsPoints < reward.points) return;
    addCookieToActiveOrder({
      id: `reward-${reward.key}`,
      rewardKey: reward.key,
      isReward: true,
      pointsCost: reward.points,
      type: reward.type,
      flavor: `${reward.label} (redeemed)`,
      sizeLabel: reward.sizeLabel,
      price: 0,
      is_temperature_controlled: reward.is_temperature_controlled,
      // reward.qty is baked into the reward's identity (e.g. "Three Dozen"
      // is 3 full_dozen units), not the line-item qty — mirrors the same
      // fix server-side in backend/index.js's redemption fold-in.
      physicalCookieUnits: UNITS_PER_SIZE[reward.size] * reward.qty,
    });
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
    const headers = { 'Content-Type': 'application/json' };
    if (isAuthenticated) {
      const token = await getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers,
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
      const data = await submitToBackend({ orders: [order.toCheckoutPayload()], ...details });
      if (data.rewards?.balance !== undefined) setRewardsBalance(data.rewards.balance);
      removeOrder(orderId);
      if (isAuthenticated) refreshOrderHistory();
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
      const data = await submitToBackend({ ...payload, ...details });
      if (data.rewards?.balance !== undefined) setRewardsBalance(data.rewards.balance);
      const fresh = new Order();
      setCart(new Cart([fresh]));
      setActiveOrderId(fresh.id);
      if (isAuthenticated) refreshOrderHistory();
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
    removeCookieFromOrder,
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
    orderHistory,
    orderHistoryLoading,
    rewardsCatalog,
    rewardsBalance,
    pendingRedeemedPoints,
    availableRewardsPoints,
    redeemReward,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
