// How the payment form (Stripe's Payment Element) is set up. Kept in one place so the one
// deliberate choice below is easy to find, and to undo.
//
// GOOGLE PAY BUTTON: HIDDEN FOR NOW (since 2026-11-20).
// Stripe's fraud check (Radar) blocked every Google Pay payment made on desktop Chrome
// ("highest risk level", before the payment ever reached the card network), even though the
// same card worked through Apple Pay and when typed or autofilled into the card boxes. The
// customer just saw "Your card was declined", which looks like their bank's fault.
//
// Hiding the button costs customers nothing on desktop: Chrome still autofills their saved
// Google Pay cards into the normal card boxes, and that goes through as an ordinary card
// payment. (Whether Google Pay on an Android phone works was not tested.) Apple Pay and card
// entry are unchanged.
//
// To turn the button back on, change 'never' to 'auto' (or delete the `googlePay` line) once
// Stripe Support has explained or fixed the Radar block, then redeploy the site.
export const PAYMENT_ELEMENT_OPTIONS = {
  wallets: {
    googlePay: 'never',
  },
};
