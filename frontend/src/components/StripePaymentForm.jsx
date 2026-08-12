import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// Rendered inside an <Elements> provider (see CheckoutForm.jsx) — useStripe/
// useElements only work as descendants of that provider, which is why this
// can't just be inlined into CheckoutForm alongside the clientSecret fetch.
function StripePaymentForm({ amount, paymentIntentId, surchargeEnabled, onSuccess, onBack, submitting }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  // Set once a card has been previewed and a real surcharge applies to it —
  // card-network rules require disclosing this before the charge happens,
  // with a way to cancel or pick a different card (this view's own "Back").
  const [surchargeDisclosure, setSurchargeDisclosure] = useState(null);

  // Resolves whatever /api/checkout/confirm-payment reported — either
  // already succeeded, or needing a 3D Secure challenge completed in-page
  // (payment_method_types is card-only, so handleNextAction never redirects
  // away from the page here).
  async function finishConfirmedPayment(result) {
    if (result.status === 'succeeded') {
      onSuccess(paymentIntentId);
      return;
    }
    if (result.status === 'requires_action') {
      const { error: actionError, paymentIntent } = await stripe.handleNextAction({
        clientSecret: result.clientSecret,
      });
      if (actionError) {
        setError(actionError.message || 'Payment failed. Please try again.');
        setPaying(false);
        return;
      }
      if (paymentIntent?.status === 'succeeded') {
        onSuccess(paymentIntentId);
        return;
      }
    }
    setError('Payment could not be completed. Please try again.');
    setPaying(false);
  }

  async function confirmPayment(paymentMethodId) {
    setPaying(true);
    setError('');
    try {
      const result = await postJson('/api/checkout/confirm-payment', { paymentIntentId, paymentMethodId });
      await finishConfirmedPayment(result);
    } catch (err) {
      setError(err.message);
      setPaying(false);
    }
  }

  // Card-surcharge flow: collect the card details without confirming yet,
  // ask the server whether this specific card can be surcharged (Stripe's
  // surcharging feature excludes debit/prepaid for us), then either show the
  // required pre-payment disclosure or — when there's nothing to disclose —
  // go straight to confirming.
  async function handleSurchargeAwarePay(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError('');
    setPaying(true);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || 'Please check your payment details.');
      setPaying(false);
      return;
    }
    const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({ elements });
    if (pmError) {
      setError(pmError.message || 'Payment failed. Please try again.');
      setPaying(false);
      return;
    }

    try {
      const preview = await postJson('/api/checkout/surcharge-preview', {
        paymentIntentId,
        paymentMethodId: paymentMethod.id,
      });
      if (preview.surchargeAmount > 0) {
        setSurchargeDisclosure({ ...preview, paymentMethodId: paymentMethod.id });
        setPaying(false);
        return;
      }
    } catch (err) {
      setError(err.message);
      setPaying(false);
      return;
    }
    await confirmPayment(paymentMethod.id);
  }

  // Original single-call flow — unchanged, used whenever surcharging is off.
  // redirect: 'if_required' keeps this a single-page flow for card payments
  // (the overwhelming case here) — Stripe only falls back to a full-page
  // redirect for the rare payment method or 3D Secure flow that genuinely
  // needs one.
  async function handlePlainPay(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError('');
    setPaying(true);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    if (confirmError) {
      setError(confirmError.message || 'Payment failed. Please try again.');
      setPaying(false);
      return;
    }
    if (paymentIntent?.status === 'succeeded') {
      onSuccess(paymentIntent.id);
    } else {
      setError('Payment could not be completed. Please try again.');
      setPaying(false);
    }
  }

  if (surchargeDisclosure) {
    return (
      <div className="checkout-form">
        <h3 className="cart-section-title">Payment</h3>
        <p className="checkout-form-note">Subtotal: ${(amount / 100).toFixed(2)}</p>
        <p className="checkout-surcharge-note">
          Card surcharge (3%): ${(surchargeDisclosure.surchargeAmount / 100).toFixed(2)}
        </p>
        <p className="checkout-form-note">
          <strong>New total: ${(surchargeDisclosure.totalAmount / 100).toFixed(2)}</strong>
        </p>

        {error && <p className="checkout-error">{error}</p>}

        <div className="checkout-form-actions">
          <button
            type="button"
            className="checkout-form-cancel"
            onClick={() => {
              setSurchargeDisclosure(null);
              setError('');
            }}
            disabled={paying}
          >
            Back
          </button>
          <button
            type="button"
            className="checkout-btn"
            onClick={() => confirmPayment(surchargeDisclosure.paymentMethodId)}
            disabled={paying || submitting}
          >
            {paying || submitting
              ? 'Processing...'
              : `Confirm & Pay $${(surchargeDisclosure.totalAmount / 100).toFixed(2)}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="checkout-form" onSubmit={surchargeEnabled ? handleSurchargeAwarePay : handlePlainPay}>
      <h3 className="cart-section-title">Payment</h3>
      <p className="checkout-form-note">Total: ${(amount / 100).toFixed(2)}</p>

      <PaymentElement />

      {error && <p className="checkout-error">{error}</p>}

      <div className="checkout-form-actions">
        <button type="button" className="checkout-form-cancel" onClick={onBack} disabled={paying}>
          Back
        </button>
        <button type="submit" className="checkout-btn" disabled={!stripe || paying || submitting}>
          {paying || submitting ? 'Processing...' : 'Pay'}
        </button>
      </div>
    </form>
  );
}

export default StripePaymentForm;
