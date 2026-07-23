import { useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import PickupScheduleModal from './PickupScheduleModal.jsx';
import ShippingAddressModal from './ShippingAddressModal.jsx';
import { EMAIL_RE } from '../constants.js';
import './CheckoutForm.css';

function CheckoutForm({ onSubmit, onCancel, submitting, error, pickupOnly, orders = [] }) {
  const { isAuthenticated, user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState('pickup');
  const [formError, setFormError] = useState('');
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);

  function resolveContact() {
    // Signed-in customers already have this on file (from the Cognito
    // token) — only guests, who have no stored account, need to type it in.
    return isAuthenticated
      ? { firstName: user.firstName, lastName: user.lastName, email: user.email }
      : { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() };
  }

  function handleSubmit(e) {
    e.preventDefault();

    if (!isAuthenticated) {
      if (!firstName.trim()) return setFormError('First name is required.');
      if (!lastName.trim()) return setFormError('Last name is required.');
      if (!EMAIL_RE.test(email.trim())) return setFormError('A valid email is required.');
    }
    setFormError('');

    // Neither fulfillment method submits directly from this form — pickup
    // needs a scheduled date/time and shipping needs a structured address,
    // both collected by their own modal, whose confirm step is what actually
    // calls onSubmit (see handlePickupConfirm/handleAddressConfirm).
    if (!pickupOnly && method === 'shipping') {
      setIsAddressModalOpen(true);
      return;
    }
    setIsScheduleOpen(true);
  }

  function handlePickupConfirm(pickupDate, pickupTime, sameDay) {
    setIsScheduleOpen(false);
    onSubmit({
      contact: resolveContact(),
      // sameDay only matters to the backend's validation (it relaxes the
      // 24-hour notice floor for a pickup date that's genuinely today) —
      // it's never persisted on the order; "was this same-day" is instead
      // derived wherever pickup time is displayed by comparing pickupDate
      // to the order's own placement date.
      fulfillment: { method: 'pickup', pickupDate, pickupTime, ...(sameDay && { sameDay: true }) },
    });
  }

  function handleAddressConfirm(shippingAddress) {
    setIsAddressModalOpen(false);
    onSubmit({
      contact: resolveContact(),
      fulfillment: { method: 'shipping', shippingAddress },
    });
  }

  return (
    <>
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

      <PickupScheduleModal
        isOpen={isScheduleOpen}
        orders={orders}
        onCancel={() => setIsScheduleOpen(false)}
        onConfirm={handlePickupConfirm}
      />
      <ShippingAddressModal
        isOpen={isAddressModalOpen}
        orders={orders}
        onCancel={() => setIsAddressModalOpen(false)}
        onConfirm={handleAddressConfirm}
      />
    </>
  );
}

export default CheckoutForm;
