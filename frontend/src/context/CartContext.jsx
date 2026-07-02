import { createContext, useContext, useEffect, useState } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [order, setOrder] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
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

  function qtyInCart(productId) {
    return cart.find((item) => item.id === productId)?.qty ?? 0;
  }

  async function checkout() {
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

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  const value = {
    products,
    cart,
    addToCart,
    removeFromCart,
    qtyInCart,
    cartTotal,
    cartCount,
    isCartOpen,
    openCart: () => setIsCartOpen(true),
    closeCart: () => setIsCartOpen(false),
    toggleCart: () => setIsCartOpen((prev) => !prev),
    order,
    checkingOut,
    checkoutError,
    checkout,
    startNewOrder,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
