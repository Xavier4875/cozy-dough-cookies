import { useContext } from 'react';
import { CartContext } from './CartContext.jsx';

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
