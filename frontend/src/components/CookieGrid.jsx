import ImagePlaceholder from './ImagePlaceholder.jsx';
import { dietaryMarker } from '../constants.js';
import { cookieImageFor } from '../cookieImages.js';
import './CookieGrid.css';

const DEFAULT_TYPE_ORDER = ['standard', 'special', 'premium'];
const DEFAULT_TYPE_LABELS = {
  standard: 'Standard',
  special: 'Special',
  premium: 'Premium',
};

function CookieGrid({
  products,
  addCookieToActiveOrder,
  removeCookieFromActiveOrder,
  qtyInActiveOrder,
  typeOrder = DEFAULT_TYPE_ORDER,
  typeLabels = DEFAULT_TYPE_LABELS,
  priceUnitLabel = 'each',
}) {
  return typeOrder.map((type) => {
    const typeProducts = products.filter((p) => p.type === type);
    if (typeProducts.length === 0) return null;
    return (
      <section key={type} className={`product-section product-section--${type}`}>
        <h3 className="product-section-title">
          {typeLabels[type]}{' '}
          <span className="product-section-price">
            ${typeProducts[0].price.toFixed(2)} {priceUnitLabel}
          </span>
        </h3>
        <div className="cookie-grid">
          {typeProducts.map((p) => {
            const qty = qtyInActiveOrder(p.id);
            const imageSrc = cookieImageFor(p.flavor);
            return (
              <div key={p.id} className="cookie-card">
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    alt={p.flavor}
                    className="cookie-image"
                    style={{ aspectRatio: '1 / 1' }}
                  />
                ) : (
                  <ImagePlaceholder label={p.flavor} aspectRatio="1 / 1" />
                )}
                <p className="cookie-flavor">
                  {p.flavor}
                  {dietaryMarker(p.type) && ` (${dietaryMarker(p.type)})`}
                </p>
                {p.is_temperature_controlled && (
                  <p className="cookie-temp-note">Temperature Controlled: Pickup Required</p>
                )}
                {p.batchNote && (
                  <p className="cookie-batch-note">
                    ${p.price.toFixed(2)} {priceUnitLabel} — {p.batchNote}
                  </p>
                )}
                <div className="cookie-stepper">
                  <button
                    className="stepper-btn stepper-btn--remove"
                    onClick={() => removeCookieFromActiveOrder(p.id)}
                    disabled={qty === 0}
                    aria-label={`Remove one ${p.flavor}`}
                  >
                    −
                  </button>
                  <span className="stepper-qty">{qty}</span>
                  <button
                    className="stepper-btn stepper-btn--add"
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
  });
}

export default CookieGrid;
