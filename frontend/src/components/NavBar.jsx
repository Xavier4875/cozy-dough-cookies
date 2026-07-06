import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useCart } from '../context/useCart.js';
import './NavBar.css';

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/menu', label: 'Menu' },
  { to: '/policy', label: 'Pickup/Delivery Policy' },
  { to: '/nutrition', label: 'Nutrition' },
];

function NavBar() {
  const { cart, toggleCart } = useCart();
  const cartCount = cart.orderCount;
  const navRef = useRef(null);

  // Publishes the navbar's real rendered height as a CSS var so sticky
  // elements further down the page (e.g. Menu's header/size-nav bars) can
  // offset below it correctly — the navbar wraps to extra lines on narrow
  // screens, so its height isn't a fixed number.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        '--navbar-height',
        `${el.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="navbar" ref={navRef}>
      <div className="navbar-brand">Cozy Dough Cookies</div>
      <nav className="navbar-tabs">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              'navbar-tab' + (isActive ? ' navbar-tab--active' : '')
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <button className="cart-icon-btn" onClick={toggleCart} aria-label="Open cart">
        🛒
        {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
      </button>
    </header>
  );
}

export default NavBar;
