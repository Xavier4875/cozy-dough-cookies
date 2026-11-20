import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { buildBillingDetails } from '../stripe/billingDetails.js';
import { PAYMENT_ELEMENT_OPTIONS } from '../stripe/paymentElementOptions.js';

// Rendered inside an <Elements> provider (see CheckoutForm.jsx) — useStripe/
// useElements only work as descendants of that provider, which is why this
// can't just be inlined into CheckoutForm alongside the clientSecret fetch.
// `contact` is who is paying ({ firstName, lastName, email }), from the checkout step.
function StripePaymentForm({ amount, contact, onSuccess, onBack, submitting }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  // redirect: 'if_required' keeps this a single-page flow for card payments
  // (the overwhelming case here) — Stripe only falls back to a full-page
  // redirect for the rare payment method or 3D Secure flow that genuinely
  // needs one.
  //
  // The customer's name and email go along as billing details so Stripe's fraud
  // check has something to go on (see stripe/billingDetails.js). Anything the
  // payment form collects itself overrides these, so a card, Apple Pay and Google
  // Pay all behave exactly as before; this only adds information.
  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError('');
    setPaying(true);
    const billingDetails = buildBillingDetails(contact);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      ...(Object.keys(billingDetails).length > 0 && {
        confirmParams: { payment_method_data: { billing_details: billingDetails } },
      }),
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

      <PaymentElement options={PAYMENT_ELEMENT_OPTIONS} />

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
