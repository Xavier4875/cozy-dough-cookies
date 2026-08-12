import { loadStripe } from '@stripe/stripe-js';

// Loaded once at module scope, not per-render — loadStripe() returns the
// same cached promise on every call, so this matches how auth/cognito.js
// sets up its User Pool once rather than re-creating it per component.
export const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
