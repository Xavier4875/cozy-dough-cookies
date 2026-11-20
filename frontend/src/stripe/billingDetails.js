// What we tell Stripe about the person paying, beyond what the payment form collects itself
// (card number, expiry, CVC, country and ZIP).
//
// Stripe's fraud check (Radar) weighs who is paying: a payment that arrives with no name and
// no email looks anonymous, and a new account has little history to offset that. The name and
// the email are the ones the customer gave us at checkout (a guest's email has already been
// verified with a code; a signed-in customer's comes from their account).
//
// They are sent as the payment's `billing_details`. Stripe merges these with whatever the
// payment form collects, and anything the form collects itself (for example the name a wallet
// such as Apple Pay or Google Pay supplies) wins over what is passed here, so this can only
// add information, never replace it. It does NOT make Stripe send its own receipt (that would
// need `receipt_email`, which we deliberately do not set: our own receipt email is the one
// customers get).
//
// Returns only the pieces that exist, so an empty name or email is never sent as a blank.
export function buildBillingDetails(contact) {
  const name = [contact?.firstName, contact?.lastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const email = String(contact?.email ?? '').trim();
  return { ...(name && { name }), ...(email && { email }) };
}
