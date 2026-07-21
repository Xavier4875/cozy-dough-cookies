import { useEffect, useRef, useState } from 'react';
import { US_STATES, ZIP_RE } from '../constants.js';
import './ShippingAddressModal.css';

function formatAddress({ line1, line2, city, state, zip }) {
  return [line1, line2, `${city}, ${state} ${zip}`].filter(Boolean).join(', ');
}

function ShippingAddressModal({ isOpen, orders = [], onCancel, onConfirm }) {
  const [step, setStep] = useState('address');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [formError, setFormError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  // USPS's corrected version of what was typed, once confirmed deliverable —
  // null until then, and also null when USPS couldn't be reached at all (the
  // non-blocking path), in which case the address is used exactly as typed.
  const [standardizedAddress, setStandardizedAddress] = useState(null);
  const [isStateListOpen, setIsStateListOpen] = useState(false);
  const stateFieldRef = useRef(null);

  // Closes the state list on any click outside it — same
  // click-outside-to-close idea the modal overlay itself already uses.
  useEffect(() => {
    if (!isStateListOpen) return;
    function handleClickOutside(e) {
      if (stateFieldRef.current && !stateFieldRef.current.contains(e.target)) {
        setIsStateListOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isStateListOpen]);

  if (!isOpen) return null;

  function resetFields() {
    setStep('address');
    setLine1('');
    setLine2('');
    setCity('');
    setState('');
    setZip('');
    setFormError('');
    setStandardizedAddress(null);
    setIsStateListOpen(false);
  }

  function handleCancel() {
    resetFields();
    onCancel();
  }

  // Blocks progression to the confirm/place-order step until USPS actually
  // confirms the address — the same real-time check checkout itself does,
  // just moved earlier so a bad address is caught before contact info and
  // order review, not after. Checkout still independently re-verifies with
  // USPS when the order is placed; this is purely an earlier UX gate.
  async function handleAddressSubmit(e) {
    e.preventDefault();
    if (!line1.trim()) return setFormError('Street address is required.');
    if (!city.trim()) return setFormError('City is required.');
    if (!state) return setFormError('State is required.');
    if (!ZIP_RE.test(zip.trim())) return setFormError('A valid ZIP code is required.');
    setFormError('');
    setIsValidating(true);
    try {
      const res = await fetch('/api/shipping/validate-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingAddress: {
            line1: line1.trim(),
            line2: line2.trim(),
            city: city.trim(),
            state,
            zip: zip.trim(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      if (data.reason === 'rejected') {
        setFormError("We couldn't verify that address with USPS. Please double-check it and try again.");
        return;
      }
      // verified === true → USPS confirmed it, use its standardized form.
      // verified === false ('error'/'rate_limited') or null (dormant) → USPS
      // couldn't be checked at all, so never block on that — proceed with
      // the address exactly as typed, same non-blocking rule checkout uses.
      setStandardizedAddress(data.verified === true ? data.standardized : null);
      setStep('confirm');
    } catch {
      // Network failure reaching our own backend — same non-blocking rule.
      setStandardizedAddress(null);
      setStep('confirm');
    } finally {
      setIsValidating(false);
    }
  }

  const address = standardizedAddress ?? {
    line1: line1.trim(),
    line2: line2.trim(),
    city: city.trim(),
    state,
    zip: zip.trim(),
  };

  const grandTotal = orders.reduce((sum, order) => sum + order.total + order.shippingFee, 0);

  return (
    <div className="shipping-address-overlay" onClick={handleCancel}>
      <div className="shipping-address-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Shipping Address</h2>

        {step === 'address' && (
          <form className="shipping-address-form" onSubmit={handleAddressSubmit}>
            <label className="checkout-form-field">
              <span>Address line 1</span>
              <input type="text" value={line1} onChange={(e) => setLine1(e.target.value)} autoComplete="address-line1" />
            </label>
            <label className="checkout-form-field">
              <span>Address line 2 (optional)</span>
              <input type="text" value={line2} onChange={(e) => setLine2(e.target.value)} autoComplete="address-line2" />
            </label>
            <label className="checkout-form-field">
              <span>City</span>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
            </label>
            <div className="shipping-address-row">
              <label className="checkout-form-field shipping-state-field" ref={stateFieldRef}>
                <span>State</span>
                <button
                  type="button"
                  className="shipping-state-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={isStateListOpen}
                  onClick={() => setIsStateListOpen((open) => !open)}
                  onKeyDown={(e) => e.key === 'Escape' && setIsStateListOpen(false)}
                >
                  <span className={state ? '' : 'shipping-state-placeholder'}>{state || 'Select'}</span>
                  <span className="shipping-state-caret" aria-hidden="true">▾</span>
                </button>
                {isStateListOpen && (
                  <ul className="shipping-state-list" role="listbox">
                    {US_STATES.map((s) => (
                      <li key={s.code} role="option" aria-selected={state === s.code}>
                        <button
                          type="button"
                          className={
                            'shipping-state-option' +
                            (state === s.code ? ' shipping-state-option--selected' : '')
                          }
                          onClick={() => {
                            setState(s.code);
                            setIsStateListOpen(false);
                          }}
                        >
                          {s.name} - {s.code}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </label>
              <label className="checkout-form-field">
                <span>ZIP</span>
                <input type="text" value={zip} onChange={(e) => setZip(e.target.value)} autoComplete="postal-code" />
              </label>
            </div>
            {formError && <p className="checkout-error">{formError}</p>}
            <div className="shipping-address-actions">
              <button type="button" className="shipping-address-cancel-btn" onClick={handleCancel} disabled={isValidating}>Cancel</button>
              <button type="submit" className="checkout-btn" disabled={isValidating}>
                {isValidating ? 'Checking address…' : 'Continue'}
              </button>
            </div>
          </form>
        )}

        {step === 'confirm' && (
          <>
            {orders.map((order, i) => (
              <div key={order.id}>
                {orders.length > 1 && (
                  <p className="shipping-address-order-label">Order {i + 1}</p>
                )}
                <ul className="cart-list">
                  {order.items.map((item) => (
                    <li key={item.cookie.id}>
                      <span>{item.cookie.flavor} ({item.cookie.sizeLabel}) × {item.qty}</span>
                      <span>${(item.cookie.price * item.qty).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <p className="cart-total">Subtotal: ${order.total.toFixed(2)}</p>
                <p className="cart-total">Shipping &amp; handling: ${order.shippingFee.toFixed(2)}</p>
              </div>
            ))}
            <p className="cart-total">Total: ${grandTotal.toFixed(2)}</p>
            <p className="shipping-address-subtitle">Shipping to: {formatAddress(address)}</p>
            <div className="shipping-address-actions">
              <button type="button" className="shipping-address-cancel-btn" onClick={() => setStep('address')}>Back</button>
              <button type="button" className="checkout-btn" onClick={() => onConfirm(address)}>
                Confirm &amp; Place Order
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ShippingAddressModal;
