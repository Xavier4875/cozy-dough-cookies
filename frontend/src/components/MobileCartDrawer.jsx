import { useCart } from '../context/useCart.js';
import CartDrawerContent from './CartDrawerContent.jsx';
import './MobileCartDrawer.css';

// Same cart content as the desktop CartDrawer, in a bottom-sheet shell
// instead of a right-side panel — a near-full-height sheet reads more like
// a native mobile app than a drawer that only covers part of the screen.
function MobileCartDrawer() {
  const { isCartOpen, closeCart } = useCart();

  if (!isCartOpen) return null;

  return (
    <div className="mobile-cart-overlay" onClick={closeCart}>
      <aside className="mobile-cart-sheet" onClick={(e) => e.stopPropagation()}>
        <CartDrawerContent />
      </aside>
    </div>
  );
}

export default MobileCartDrawer;
