import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

// Rendered inside an <Elements> provider (see CheckoutForm.jsx) — useStripe/
// useElements only work as descendants of that provider, which is why this
// can't just be inlined into CheckoutForm alongside the clientSecret fetch.
function StripePaymentForm({ amount, onSuccess, onBack, submitting }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  // redirect: 'if_required' keeps this a single-page flow for card payments
  // (the overwhelming case here) — Stripe only falls back to a full-page
  // redirect for the rare payment method or 3D Secure flow that genuinely
  // needs one.
  async function handleSubmit(e) {
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

  return (
    <form className="checkout-form" onSubmit={handleSubmit}>
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
