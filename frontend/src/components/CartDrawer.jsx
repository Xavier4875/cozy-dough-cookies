import { useCart } from '../context/useCart.js';
import CartDrawerContent from './CartDrawerContent.jsx';
import './CartDrawer.css';

function CartDrawer() {
  const { isCartOpen, closeCart } = useCart();

  if (!isCartOpen) return null;

  return (
    <div className="cart-drawer-overlay" onClick={closeCart}>
      <aside className="cart-drawer" onClick={(e) => e.stopPropagation()}>
        <CartDrawerContent />
      </aside>
    </div>
  );
}

export default CartDrawer;
