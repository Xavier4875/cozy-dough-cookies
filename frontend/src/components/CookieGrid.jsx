import { useEffect, useRef, useState } from 'react';
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

// Staff-only three-dot control shown on each cookie card — lets staff flip
// an item in/out of stock without leaving the menu. Kept as its own
// component (rather than inline in the products.map below) since it needs
// its own open/closed state per card.
function StockMenu({ product, onSetSoldOut }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Same click-outside-to-close pattern as ShippingAddressModal's state list.
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  function choose(is_sold_out) {
    setIsOpen(false);
    if (is_sold_out !== Boolean(product.is_sold_out)) {
      onSetSoldOut(product.id, is_sold_out);
    }
  }

  return (
    <div className="cookie-stock-menu" ref={menuRef}>
      <button
        type="button"
        className="cookie-stock-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={`Stock options for ${product.flavor}`}
        aria-expanded={isOpen}
      >
        &#8942;
      </button>
      {isOpen && (
        <div className="cookie-stock-menu-popup">
          <label className="cookie-stock-menu-option">
            <input
              type="radio"
              name={`stock-${product.id}`}
              checked={!product.is_sold_out}
              onChange={() => choose(false)}
            />
            In stock
          </label>
          <label className="cookie-stock-menu-option">
            <input
              type="radio"
              name={`stock-${product.id}`}
              checked={Boolean(product.is_sold_out)}
              onChange={() => choose(true)}
            />
            Out of stock
          </label>
        </div>
      )}
    </div>
  );
}

function CookieGrid({
  products,
  addCookieToActiveOrder,
  removeCookieFromActiveOrder,
  qtyInActiveOrder,
  typeOrder = DEFAULT_TYPE_ORDER,
  typeLabels = DEFAULT_TYPE_LABELS,
  priceUnitLabel = 'each',
  isStaff = false,
  onSetSoldOut,
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
              <div
                key={p.id}
                className={'cookie-card' + (p.is_sold_out ? ' cookie-card--sold-out' : '')}
              >
                {isStaff && <StockMenu product={p} onSetSoldOut={onSetSoldOut} />}
                <div className="cookie-card-body">
                  {p.is_sold_out && <p className="cookie-sold-out-badge">Sold Out</p>}
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
                      disabled={p.is_sold_out}
                      aria-label={`Add one ${p.flavor}`}
                    >
                      +
                    </button>
                  </div>
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
