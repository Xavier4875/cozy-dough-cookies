import { useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import './CheckoutForm.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CheckoutForm({ onSubmit, onCancel, submitting, error, pickupOnly }) {
  const { isAuthenticated, user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState('pickup');
  const [shippingAddress, setShippingAddress] = useState('');
  const [formError, setFormError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();

    // Signed-in customers already have this on file (from the Cognito
    // token) — only guests, who have no stored account, need to type it in.
    if (!isAuthenticated) {
      if (!firstName.trim()) return setFormError('First name is required.');
      if (!lastName.trim()) return setFormError('Last name is required.');
      if (!EMAIL_RE.test(email.trim())) return setFormError('A valid email is required.');
    }
    if (!pickupOnly && method === 'shipping' && !shippingAddress.trim()) {
      return setFormError('Shipping address is required for shipping orders.');
    }

    setFormError('');
    onSubmit({
      contact: isAuthenticated
        ? { firstName: user.firstName, lastName: user.lastName, email: user.email }
        : { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() },
      fulfillment:
        !pickupOnly && method === 'shipping'
          ? { method: 'shipping', shippingAddress: shippingAddress.trim() }
          : { method: 'pickup' },
    });
  }

  return (
    <form className="checkout-form" onSubmit={handleSubmit}>
      <h3 className="cart-section-title">Contact &amp; fulfillment</h3>

      {!isAuthenticated && (
        <>
          <label className="checkout-form-field">
            <span>First name</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
            />
          </label>

          <label className="checkout-form-field">
            <span>Last name</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          </label>

          <label className="checkout-form-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
        </>
      )}

      <div className="checkout-form-field">
        <span>Fulfillment</span>
        {pickupOnly ? (
          <p className="checkout-form-note">
            Pickup only — this order contains temperature-controlled items that can&apos;t be
            shipped.
          </p>
        ) : (
          <div className="checkout-form-radios">
            <label>
              <input
                type="radio"
                name="fulfillment-method"
                value="pickup"
                checked={method === 'pickup'}
                onChange={() => setMethod('pickup')}
              />
              Pickup
            </label>
            <label>
              <input
                type="radio"
                name="fulfillment-method"
                value="shipping"
                checked={method === 'shipping'}
                onChange={() => setMethod('shipping')}
              />
              Shipping
            </label>
          </div>
        )}
      </div>

      {!pickupOnly && method === 'shipping' && (
        <label className="checkout-form-field">
          <span>Shipping address</span>
          <textarea
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            rows={2}
            autoComplete="street-address"
          />
        </label>
      )}

      {(formError || error) && <p className="checkout-error">{formError || error}</p>}

      <div className="checkout-form-actions">
        <button type="button" className="checkout-form-cancel" onClick={onCancel}>
          Back
        </button>
        <button type="submit" className="checkout-btn" disabled={submitting}>
          {submitting ? 'Placing order...' : 'Place order'}
        </button>
      </div>
    </form>
  );
}

export default CheckoutForm;
