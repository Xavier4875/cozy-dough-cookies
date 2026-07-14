import { useState } from 'react';
import './CheckoutForm.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CheckoutForm({ onSubmit, onCancel, submitting, error }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState('pickup');
  const [shippingAddress, setShippingAddress] = useState('');
  const [formError, setFormError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();

    if (!name.trim()) return setFormError('Name is required.');
    if (!EMAIL_RE.test(email.trim())) return setFormError('A valid email is required.');
    if (!phone.trim()) return setFormError('Phone number is required.');
    if (method === 'shipping' && !shippingAddress.trim()) {
      return setFormError('Shipping address is required for shipping orders.');
    }

    setFormError('');
    onSubmit({
      contact: { name: name.trim(), email: email.trim(), phone: phone.trim() },
      fulfillment:
        method === 'shipping'
          ? { method: 'shipping', shippingAddress: shippingAddress.trim() }
          : { method: 'pickup' },
    });
  }

  return (
    <form className="checkout-form" onSubmit={handleSubmit}>
      <h3 className="cart-section-title">Contact &amp; fulfillment</h3>

      <label className="checkout-form-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
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

      <label className="checkout-form-field">
        <span>Phone</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
      </label>

      <div className="checkout-form-field">
        <span>Fulfillment</span>
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
      </div>

      {method === 'shipping' && (
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
