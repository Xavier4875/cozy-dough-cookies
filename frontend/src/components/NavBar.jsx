import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useCart } from '../context/useCart.js';
import { useAuth } from '../context/useAuth.js';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import './NavBar.css';

const TABS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/menu', label: 'Menu', icon: '🍪' },
  { to: '/policy', label: 'Policy', icon: '🚚' },
  { to: '/nutrition', label: 'Nutrition', icon: '🥛' },
];

function NavBar() {
  const { cart, toggleCart } = useCart();
  const { isAuthenticated, toggleAccount } = useAuth();
  const cartCount = cart.orderCount;
  const navRef = useRef(null);

  // Publishes the navbar's real rendered height as a CSS var so sticky
  // elements further down the page (e.g. Menu's header/size-nav bars) can
  // offset below it correctly — the navbar wraps to extra lines on narrow
  // screens, so its height isn't a fixed number.
  usePublishHeight(navRef, '--navbar-height');

  return (
    <header className="navbar" ref={navRef}>
      <div className="navbar-left">
        <div className="navbar-auth">
          {isAuthenticated ? (
            <button
              className="account-icon-btn"
              onClick={toggleAccount}
              aria-label="Open account menu"
            >
              👤
            </button>
          ) : (
            <NavLink to="/sign-in" className="navbar-auth-btn">
              Sign In
            </NavLink>
          )}
        </div>
        <div className="navbar-brand">Cozy Dough Cookies</div>
      </div>
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
            <span className="navbar-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="navbar-tab-label">{tab.label}</span>
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
