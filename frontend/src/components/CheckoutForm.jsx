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

  // Guest-only email verification. `verifiedEmail` is the exact (lowercased)
  // address a code was successfully confirmed for — editing the email field
  // afterward no longer matches it, so submitting sends a fresh code rather
  // than trusting a verification that belonged to a different address.
  const [emailStep, setEmailStep] = useState('entry'); // 'entry' | 'code'
  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifyNote, setVerifyNote] = useState('');
  const [verifySubmitting, setVerifySubmitting] = useState(false);

  function resolveContact() {
    // Signed-in customers already have this on file (from the Cognito
    // token) — only guests, who have no stored account, need to type it in.
    return isAuthenticated
      ? { firstName: user.firstName, lastName: user.lastName, email: user.email }
      : { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() };
  }

  function proceedToFulfillment() {
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

  async function sendVerificationCode() {
    setVerifySubmitting(true);
    setFormError('');
    try {
      const res = await fetch('/api/email-verification/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to send verification code.');
        return;
      }
      setCode('');
      setVerifyError('');
      setVerifyNote('');
      setEmailStep('code');
    } catch {
      setFormError('Failed to send verification code. Please try again.');
    } finally {
      setVerifySubmitting(false);
    }
  }

  async function handleResendCode() {
    setVerifySubmitting(true);
    setVerifyError('');
    setVerifyNote('');
    try {
      const res = await fetch('/api/email-verification/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data.error || 'Failed to resend code.');
        return;
      }
      setVerifyNote('Code resent.');
    } catch {
      setVerifyError('Failed to resend code. Please try again.');
    } finally {
      setVerifySubmitting(false);
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault();
    if (!code.trim()) return setVerifyError('Confirmation code is required.');
    setVerifyError('');
    setVerifySubmitting(true);
    try {
      const res = await fetch('/api/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data.error || 'Incorrect code.');
        return;
      }
      setVerifiedEmail(email.trim().toLowerCase());
      setEmailStep('entry');
      proceedToFulfillment();
    } catch {
      setVerifyError('Something went wrong. Please try again.');
    } finally {
      setVerifySubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!isAuthenticated) {
      if (!firstName.trim()) return setFormError('First name is required.');
      if (!lastName.trim()) return setFormError('Last name is required.');
      if (!EMAIL_RE.test(email.trim())) return setFormError('A valid email is required.');

      if (email.trim().toLowerCase() !== verifiedEmail) {
        await sendVerificationCode();
        return;
      }
    }
    setFormError('');
    proceedToFulfillment();
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
      <form className="checkout-form" onSubmit={emailStep === 'code' ? handleVerifyCode : handleSubmit}>
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
                disabled={emailStep === 'code'}
              />
            </label>

            <label className="checkout-form-field">
              <span>Last name</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                disabled={emailStep === 'code'}
              />
            </label>

            <label className="checkout-form-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={emailStep === 'code'}
              />
            </label>
          </>
        )}

        {emailStep === 'code' ? (
          <>
            <p className="checkout-form-note">
              We sent a verification code to {email.trim()}. Enter it below to continue.
            </p>
            <label className="checkout-form-field">
              <span>Confirmation code</span>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                autoFocus
              />
            </label>

            <button
              type="button"
              className="checkout-form-resend"
              onClick={handleResendCode}
              disabled={verifySubmitting}
            >
              Resend code
            </button>

            {verifyNote && <p className="checkout-form-note">{verifyNote}</p>}
            {verifyError && <p className="checkout-error">{verifyError}</p>}

            <div className="checkout-form-actions">
              <button
                type="button"
                className="checkout-form-cancel"
                onClick={() => setEmailStep('entry')}
              >
                Change email
              </button>
              <button type="submit" className="checkout-btn" disabled={verifySubmitting}>
                {verifySubmitting ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </>
        ) : (
          <>
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
              <button type="submit" className="checkout-btn" disabled={submitting || verifySubmitting}>
                {verifySubmitting ? 'Sending code...' : submitting ? 'Placing order...' : 'Place order'}
              </button>
            </div>
          </>
        )}
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
