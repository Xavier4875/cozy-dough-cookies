import { NavLink } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import './NavBar.css';

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/menu', label: 'Menu' },
  { to: '/policy', label: 'Pickup/Delivery Policy' },
  { to: '/nutrition', label: 'Nutrition' },
];

function NavBar() {
  const { cartCount, toggleCart } = useCart();

  return (
    <header className="navbar">
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
