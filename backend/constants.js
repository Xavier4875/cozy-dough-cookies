// Shared source of truth for meaningful/business-rule constants used across
// backend/. Frontend has its own mirror at frontend/src/constants.js — the
// two runtimes are separate npm projects with no shared package, so values
// that must agree across both (shipping fees, pickup hours, EMAIL_RE, etc.)
// are duplicated here under the *same names* as a deliberate signal to keep
// them in sync, rather than scattered across models/components as before.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pickup scheduling
export const PICKUP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PICKUP_TIME_RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;
export const PICKUP_OPEN_MINUTES = 10 * 60; // 10:00am
export const PICKUP_CLOSE_MINUTES = 19 * 60; // 7:00pm
export const PICKUP_ADDRESS = '15003 S 21st St, Bellevue, NE 68123';

// Gluten-free/sugar-free batches need real lead time to bake — unlike
// regular pickup orders, which have no advance-notice floor at all (see
// validatePickupDateTime in backend/index.js).
export const PICKUP_EXTENDED_NOTICE_MS = 48 * 60 * 60 * 1000;

// Shipping address format
export const STATE_RE = /^[A-Za-z]{2}$/;
export const ZIP_RE = /^\d{5}(-\d{4})?$/;

// Shipping box-size pricing
export const SHIPPING_MEDIUM_MAX_COOKIES = 36;
export const SHIPPING_FEE_MEDIUM = 24;
export const SHIPPING_FEE_LARGE = 30;
export const UNITS_PER_SIZE = { single: 1, half_dozen: 6, full_dozen: 12, batch: 24 };

// Smallest subtotal (pre-shipping) a single order may check out with —
// equivalent to a half dozen at standard pricing.
export const MIN_ORDER_SUBTOTAL = 9;

// USPS/IP rate limiting defaults (env-overridable at each call site)
export const USPS_RATE_LIMIT_MAX_CALLS_DEFAULT = 60;
export const USPS_RATE_LIMIT_WINDOW_MS_DEFAULT = 60 * 60 * 1000;
export const IP_RATE_LIMIT_MAX_CALLS_DEFAULT = 10;
export const IP_RATE_LIMIT_WINDOW_MS_DEFAULT = 60 * 60 * 1000;

// Rewards
export const POINTS_PER_DOLLAR = 25;

// Guest checkout email verification
export const EMAIL_VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000; // time allowed to enter the code
export const EMAIL_VERIFICATION_VERIFIED_TTL_MS = 30 * 60 * 1000; // window to complete checkout after verifying
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
export const EMAIL_VERIFICATION_RATE_LIMIT_MAX_CALLS_DEFAULT = 5;
export const EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS_DEFAULT = 60 * 60 * 1000;

// Card surcharge (Stripe's public-preview surcharging feature — see
// checkSurchargeEligibility in index.js). Stripe doesn't decide the rate;
// it only validates whatever we send against card-network technical caps
// and blocks it on debit/prepaid. Gated off by ENABLE_CARD_SURCHARGE.
export const CARD_SURCHARGE_RATE = 0.03;
export const CARD_SURCHARGE_API_VERSION = '2026-03-25.preview';
