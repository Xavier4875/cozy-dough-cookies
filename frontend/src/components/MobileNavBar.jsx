import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useCart } from '../context/useCart.js';
import { useAuth } from '../context/useAuth.js';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import { NAV_TABS as TABS } from '../constants.js';
import './MobileNavBar.css';

// Mobile chrome: a slim top bar (brand + cart icon only, no inline tabs —
// that's what made the desktop NavBar wrap to 3 lines on narrow screens)
// plus a fixed bottom tab bar, the standard native-app mobile nav pattern.
function MobileNavBar() {
  const { cart, toggleCart } = useCart();
  const { isAuthenticated, toggleAccount } = useAuth();
  const cartCount = cart.orderCount;
  const wrapperRef = useRef(null);

  usePublishHeight(wrapperRef, '--navbar-height');

  return (
    <div className="mobile-nav-wrapper" ref={wrapperRef}>
      <header className="mobile-topbar">
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
        <button className="cart-icon-btn" onClick={toggleCart} aria-label="Open cart">
          🛒
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </button>
      </header>
      <nav className="mobile-tabbar">
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
    </div>
  );
}

export default MobileNavBar;
