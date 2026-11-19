// Display names for the raw values Stripe reports (stored on an order's
// `payment.method` by backend/stripe/paymentMethod.js). Anything not listed
// falls back to a generic label rather than showing a raw identifier.
const CARD_BRANDS = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

const WALLETS = {
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  samsung_pay: 'Samsung Pay',
  link: 'Link',
};

// What staff see as an order's payment method, e.g. "Visa ending in 4242" or
// "Apple Pay (Mastercard ending in 4444)". `payment` is the order's stored
// payment record. Orders placed before card details were recorded still know
// they went through Stripe, just not which card; an order with no payment
// record at all says so rather than guessing — except an order that cost no
// money because it was paid for entirely in reward points, which says that.
// `order` is optional; it's only used to recognise that case.
export function describePaymentMethod(payment, order) {
  if (!payment) {
    return order?.total === 0 && order?.pointsSpent > 0 ? 'Paid with reward points' : 'Not recorded';
  }
  const method = payment.method;
  if (method?.type !== 'card') {
    return payment.provider === 'stripe' ? 'Paid through Stripe' : 'Not recorded';
  }
  const brand = CARD_BRANDS[method.brand] ?? 'Card';
  const card = method.last4 ? `${brand} ending in ${method.last4}` : brand;
  const wallet = WALLETS[method.wallet];
  return wallet ? `${wallet} (${card})` : card;
}
