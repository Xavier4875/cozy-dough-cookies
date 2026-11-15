import { useEffect, useRef, useState } from 'react';
import ImagePlaceholder from './ImagePlaceholder.jsx';
import { dietaryMarker } from '../constants.js';
import { cookieImageFor } from '../cookieImages.js';
import './CookieGrid.css';

// The price tiers CookieGrid lists first by default, in display order — one
// section per type (the Regular menu's Singles/Half Dozens/Full Dozens
// sections each filter the product list down to their own size first). The
// Gluten-Free/Sugar-Free tabs pass their own typeOrder/typeLabels instead.
// Any other product type present is drawn after these, in the order the
// backend lists them, so a type missing from here is never silently dropped.
const DEFAULT_TYPE_ORDER = ['standard', 'special', 'premium'];
const DEFAULT_TYPE_LABELS = {
  standard: 'Standard',
  special: 'Special',
  premium: 'Premium',
};

// A readable heading for a product type nobody gave a label: 'seasonal_special'
// becomes "Seasonal Special".
function humanizeType(type) {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// How long the "saved" confirmation stays up before the popup closes itself.
const SAVED_MESSAGE_MS = 1500;
const NO_STATUS = { state: 'idle', message: '' };

// Staff-only three-dot control shown on each cookie card — lets staff flip
// an item in/out of stock without leaving the menu. Kept as its own
// component (rather than inline in the products.map below) since it needs
// its own open/closed state per card.
//
// Staff always see what happened to a change: "Saving…" while the request is
// out, a green "✓ Marked …" once the server confirms (then the popup closes
// itself), or a red "✕ <reason>" if it failed. A failure stays on screen,
// even if the popup is closed, until staff dismiss it or try again — the
// card itself only changes after the server says yes, so without this a
// failed change would look like nothing happened. `onSetSoldOut` must
// return a promise that rejects with a displayable message on failure.
export function StockMenu({ product, onSetSoldOut }) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState(NO_STATUS);
  const menuRef = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  // Same click-outside-to-close pattern as ShippingAddressModal's state list.
  // Also active while a failure is showing, so clicking elsewhere dismisses it.
  useEffect(() => {
    if (!isOpen && status.state !== 'error') return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
        setStatus((current) => (current.state === 'error' ? NO_STATUS : current));
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, status.state]);

  async function choose(is_sold_out) {
    if (is_sold_out === Boolean(product.is_sold_out)) {
      setIsOpen(false);
      return;
    }
    clearTimeout(closeTimerRef.current);
    setStatus({ state: 'saving', message: '' });
    try {
      await onSetSoldOut(product.id, is_sold_out);
    } catch (err) {
      setStatus({ state: 'error', message: err.message || 'Could not update this item.' });
      return;
    }
    setStatus({
      state: 'saved',
      message: is_sold_out ? 'Marked out of stock' : 'Marked in stock',
    });
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setStatus(NO_STATUS);
    }, SAVED_MESSAGE_MS);
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
      {(isOpen || status.state !== 'idle') && (
        <div className="cookie-stock-menu-popup">
          {isOpen && (
            <>
              <label className="cookie-stock-menu-option">
                <input
                  type="radio"
                  name={`stock-${product.id}`}
                  checked={!product.is_sold_out}
                  disabled={status.state === 'saving'}
                  onChange={() => choose(false)}
                />
                In stock
              </label>
              <label className="cookie-stock-menu-option">
                <input
                  type="radio"
                  name={`stock-${product.id}`}
                  checked={Boolean(product.is_sold_out)}
                  disabled={status.state === 'saving'}
                  onChange={() => choose(true)}
                />
                Out of stock
              </label>
            </>
          )}
          {status.state !== 'idle' && (
            <p
              className={`cookie-stock-status cookie-stock-status--${status.state}`}
              role={status.state === 'error' ? 'alert' : 'status'}
            >
              {status.state === 'saving' && 'Saving…'}
              {status.state === 'saved' && `✓ ${status.message}`}
              {status.state === 'error' && `✕ ${status.message}`}
            </p>
          )}
          {status.state === 'error' && (
            <button
              type="button"
              className="cookie-stock-status-dismiss"
              onClick={() => setStatus(NO_STATUS)}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// One standard menu card: photo, name (with the size note and GF/SF marker
// where they apply), a price when `showPrice` is set, the temperature-
// controlled note, a sold-out badge, and a −/qty/+ stepper. Staff also get
// the stock menu in the corner.
export function CookieCard({
  product: p,
  qty,
  addCookieToActiveOrder,
  removeCookieFromActiveOrder,
  showPrice = false,
  isStaff = false,
  onSetSoldOut,
}) {
  const imageSrc = cookieImageFor(p.flavor);
  return (
    <div className={'cookie-card' + (p.is_sold_out ? ' cookie-card--sold-out' : '')}>
      {isStaff && <StockMenu product={p} onSetSoldOut={onSetSoldOut} />}
      <div className="cookie-card-body">
        {p.is_sold_out && <p className="cookie-sold-out-badge">Sold Out</p>}
        {imageSrc ? (
          <img src={imageSrc} alt={p.flavor} className="cookie-image" style={{ aspectRatio: '1 / 1' }} />
        ) : (
          <ImagePlaceholder label={p.flavor} aspectRatio="1 / 1" />
        )}
        <p className="cookie-flavor">
          {p.flavor}
          {p.menuSizeNote && ` (${p.menuSizeNote})`}
          {dietaryMarker(p.type) && ` (${dietaryMarker(p.type)})`}
        </p>
        {showPrice && <p className="cookie-price">${p.price.toFixed(2)}</p>}
        {p.is_temperature_controlled && (
          <p className="cookie-temp-note">Temperature Controlled: Pickup Required</p>
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
  const types = [...typeOrder, ...new Set(products.map((p) => p.type))].filter(
    (type, index, all) => all.indexOf(type) === index
  );
  return types.map((type) => {
    const typeProducts = products.filter((p) => p.type === type);
    if (typeProducts.length === 0) return null;
    // Types flagged priceOnCard (see backend/models/Cookie.js) show each
    // card's own price instead of sharing a tier heading ("Standard $2.00
    // each") — the section's own title is enough.
    const perCardPrice = typeProducts[0].priceOnCard;
    return (
      <section key={type} className={`product-section product-section--${type}`}>
        {!perCardPrice && (
          <h3 className="product-section-title">
            {typeLabels[type] ?? humanizeType(type)}{' '}
            <span className="product-section-price">
              ${typeProducts[0].price.toFixed(2)} {priceUnitLabel}
            </span>
          </h3>
        )}
        <div className="cookie-grid">
          {typeProducts.map((p) => (
            <CookieCard
              key={p.id}
              product={p}
              qty={qtyInActiveOrder(p.id)}
              addCookieToActiveOrder={addCookieToActiveOrder}
              removeCookieFromActiveOrder={removeCookieFromActiveOrder}
              showPrice={perCardPrice}
              isStaff={isStaff}
              onSetSoldOut={onSetSoldOut}
            />
          ))}
        </div>
      </section>
    );
  });
}

export default CookieGrid;
