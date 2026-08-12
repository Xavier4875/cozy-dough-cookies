import { useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useAuth } from '../context/useAuth.js';
import PickupScheduleModal from './PickupScheduleModal.jsx';
import ShippingAddressModal from './ShippingAddressModal.jsx';
import StripePaymentForm from './StripePaymentForm.jsx';
import { stripePromise } from '../stripe/client.js';
import { EMAIL_RE } from '../constants.js';
import './CheckoutForm.css';

function CheckoutForm({ onSubmit, onCreatePaymentIntent, onCancel, submitting, error, pickupOnly, orders = [] }) {
  const { isAuthenticated, user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState('pickup');
  const [formError, setFormError] = useState('');
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);

  // Set once fulfillment is confirmed (see handlePickupConfirm/
  // handleAddressConfirm) — from then on this form shows Stripe's payment
  // step instead of the contact/fulfillment fields, until the customer pays
  // (see startPayment/handlePaymentSuccess) or backs out of it.
  const [paymentStep, setPaymentStep] = useState('idle'); // 'idle' | 'creating' | 'ready'
  const [pendingDetails, setPendingDetails] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentIntentId, setPaymentIntentId] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [surchargeEnabled, setSurchargeEnabled] = useState(false);
  const [paymentError, setPaymentError] = useState('');

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

  // Fulfillment is confirmed at this point, but onSubmit (the actual
  // checkout call) doesn't fire yet — payment has to happen first. Creates
  // a Stripe PaymentIntent for the server-computed total, then shows the
  // Payment Element (see the 'ready' branch in the render below) instead of
  // calling onSubmit directly.
  async function startPayment(details) {
    setPendingDetails(details);
    setPaymentStep('creating');
    setPaymentError('');
    try {
      const result = await onCreatePaymentIntent(details);
      setClientSecret(result.clientSecret);
      setPaymentIntentId(result.paymentIntentId);
      setPaymentAmount(result.amount);
      setSurchargeEnabled(Boolean(result.surchargeEnabled));
      setPaymentStep('ready');
    } catch (err) {
      setPaymentError(err.message || 'Failed to start payment.');
      setPaymentStep('idle');
    }
  }

  // Called once Stripe confirms the charge actually succeeded — only now
  // does the real checkout request go out, carrying the paymentIntentId the
  // backend re-verifies (status + amount) before ever persisting an order.
  function handlePaymentSuccess(paymentIntentId) {
    onSubmit({ ...pendingDetails, paymentIntentId });
  }

  function handlePaymentBack() {
    setPaymentStep('idle');
    setClientSecret(null);
  }

  function handlePickupConfirm(pickupDate, pickupTime) {
    setIsScheduleOpen(false);
    startPayment({
      contact: resolveContact(),
      fulfillment: { method: 'pickup', pickupDate, pickupTime },
    });
  }

  function handleAddressConfirm(shippingAddress) {
    setIsAddressModalOpen(false);
    startPayment({
      contact: resolveContact(),
      fulfillment: { method: 'shipping', shippingAddress },
    });
  }

  if (paymentStep === 'creating') {
    return <p className="checkout-form-note">Preparing payment...</p>;
  }

  if (paymentStep === 'ready') {
    return (
      <Elements
        stripe={stripePromise}
        // paymentMethodCreation: 'manual' is required for the surcharge flow's
        // stripe.createPaymentMethod({elements}) call (StripePaymentForm.jsx) —
        // Stripe otherwise throws "your elements instance must be created with
        // paymentMethodCreation: 'manual'". Left out entirely when surcharging
        // is off so the plain stripe.confirmPayment() path is untouched.
        options={surchargeEnabled ? { clientSecret, paymentMethodCreation: 'manual' } : { clientSecret }}
      >
        <StripePaymentForm
          amount={paymentAmount}
          paymentIntentId={paymentIntentId}
          surchargeEnabled={surchargeEnabled}
          onSuccess={handlePaymentSuccess}
          onBack={handlePaymentBack}
          submitting={submitting}
        />
      </Elements>
    );
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

            {(formError || paymentError || error) && (
              <p className="checkout-error">{formError || paymentError || error}</p>
            )}

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
