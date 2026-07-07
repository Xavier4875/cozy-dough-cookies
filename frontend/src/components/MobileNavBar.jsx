import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useCart } from '../context/useCart.js';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import './MobileNavBar.css';

const TABS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/menu', label: 'Menu', icon: '🍪' },
  { to: '/policy', label: 'Policy', icon: '🚚' },
  { to: '/nutrition', label: 'Nutrition', icon: '🥛' },
];

// Mobile chrome: a slim top bar (brand + cart icon only, no inline tabs —
// that's what made the desktop NavBar wrap to 3 lines on narrow screens)
// plus a fixed bottom tab bar, the standard native-app mobile nav pattern.
function MobileNavBar() {
  const { cart, toggleCart } = useCart();
  const cartCount = cart.orderCount;
  const topBarRef = useRef(null);
  const bottomBarRef = useRef(null);

  usePublishHeight(topBarRef, '--navbar-height');
  usePublishHeight(bottomBarRef, '--bottom-tabbar-height');

  return (
    <>
      <header className="mobile-topbar" ref={topBarRef}>
        <div className="navbar-brand">Cozy Dough Cookies</div>
        <button className="cart-icon-btn" onClick={toggleCart} aria-label="Open cart">
          🛒
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </button>
      </header>
      <nav className="mobile-tabbar" ref={bottomBarRef}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              'mobile-tab' + (isActive ? ' mobile-tab--active' : '')
            }
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="mobile-tab-label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default MobileNavBar;
