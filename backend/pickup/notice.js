// The pickup notice a customer must agree to before a pickup order can be placed
// (the "Please read before placing your order" box and its "I understand"
// checkbox on the last step of PickupScheduleModal.jsx).
//
// Every pickup order is saved with `pickupNotice: { version, acknowledgedAt }`:
// which version of this notice the customer agreed to, and when the server
// accepted the order carrying that agreement. This file is the record of what
// each version SAID, so an order can always be matched to the exact words.
//
// To change the wording:
//   1. Add a NEW entry to PICKUP_NOTICES below. Never edit or delete an old one:
//      orders already placed point at it.
//   2. Point PICKUP_NOTICE_VERSION at the new entry, and set the same version in
//      frontend/src/constants.js (the browser sends it; the server refuses any
//      other value, so a stale browser tab can't agree to wording it never saw).
//   3. Update PickupScheduleModal.jsx to show the same words, plus the Pickup
//      rules on the Policy page and the note in the receipt email.

export const PICKUP_NOTICE_VERSION = '2026-11-19';

export const PICKUP_NOTICES = {
  '2026-11-19': {
    heading: 'Please read before placing your order',
    paragraphs: [
      "The pickup time you chose is a request. We'll email you as soon as it's confirmed, so please wait for that confirmation before coming to pick up your order. Thank you!",
      "Once your time is confirmed, please pick up your order or contact us within 24 hours of the scheduled pickup time. If it hasn't been picked up and we haven't heard from you by then, the order will be forfeited with no refund. We'd hate for that to happen, so just reach out if your plans change!",
    ],
    checkbox: 'I understand the pickup notice above.',
  },
};
