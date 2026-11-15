// Which card — or wallet, for Apple Pay / Google Pay — paid for a Stripe
// PaymentIntent, reduced to the few non-sensitive fields worth keeping on the
// order for staff to see: { type: 'card', brand, last4, wallet? }. Needs the
// PaymentIntent retrieved with expand: ['latest_charge'], since the payment
// method details live on the charge; without that expansion (or if the charge
// has no details) this returns undefined and the order simply records no
// method. Wallets arrive as a card with a `wallet` marker rather than as a
// separate payment method type. Raw Stripe values are stored as-is (e.g.
// 'visa', 'apple_pay') — turning them into display text is the frontend's job
// (see frontend/src/paymentMethod.js).
export function summarizePaymentMethod(paymentIntent) {
  const details = paymentIntent?.latest_charge?.payment_method_details;
  if (!details) return undefined;
  if (details.type !== 'card' || !details.card) return { type: details.type };
  const { brand, last4, wallet } = details.card;
  return { type: 'card', brand, last4, ...(wallet?.type && { wallet: wallet.type }) };
}
