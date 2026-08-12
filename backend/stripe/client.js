import Stripe from 'stripe';

// Constructed lazily, not at module load — same reasoning as
// middleware/auth.js's getVerifier(): validating STRIPE_SECRET_KEY eagerly
// would crash the whole server at import time if it's still the .env.example
// placeholder, before anyone's actually tried to check out.
let stripeClient = null;

export function getStripeClient() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key === 'sk_test_replace_me') {
      throw new Error('STRIPE_SECRET_KEY is not configured.');
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}
