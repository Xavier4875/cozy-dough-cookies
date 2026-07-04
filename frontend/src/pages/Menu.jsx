import { useCart } from '../context/useCart.js';
import ImagePlaceholder from '../components/ImagePlaceholder.jsx';
import OrderSwitcher from '../components/OrderSwitcher.jsx';
import './Menu.css';

const TYPE_ORDER = ['standard', 'special', 'premium'];
const TYPE_LABELS = {
  standard: 'Standard',
  special: 'Special',
  premium: 'Premium',
};

function Menu() {
  const { products, addCookieToActiveOrder, removeCookieFromActiveOrder, qtyInActiveOrder } =
    useCart();

  return (
    <div className="menu-page">
      <h1>Menu</h1>
      <OrderSwitcher />
      {TYPE_ORDER.map((type) => {
        const typeProducts = products.filter((p) => p.type === type);
        if (typeProducts.length === 0) return null;
        return (
          <section
            key={type}
            className={`product-section product-section--${type}`}
          >
            <h2 className="product-section-title">
              {TYPE_LABELS[type]}{' '}
              <span className="product-section-price">
                ${typeProducts[0].price.toFixed(2)} each
              </span>
            </h2>
            <div className="cookie-grid">
              {typeProducts.map((p) => {
                const qty = qtyInActiveOrder(p.id);
                return (
                  <div key={p.id} className="cookie-card">
                    <ImagePlaceholder label={p.flavor} aspectRatio="1 / 1" />
                    <p className="cookie-flavor">{p.flavor}</p>
                    <div className="cookie-stepper">
                      <button
                        className="stepper-btn"
                        onClick={() => removeCookieFromActiveOrder(p.id)}
                        disabled={qty === 0}
                        aria-label={`Remove one ${p.flavor}`}
                      >
                        −
                      </button>
                      <span className="stepper-qty">{qty}</span>
                      <button
                        className="stepper-btn"
                        onClick={() => addCookieToActiveOrder(p)}
                        aria-label={`Add one ${p.flavor}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default Menu;
