// Shared source of truth for meaningful/business-rule constants used across
// frontend/src/. Backend has its own mirror at backend/constants.js — the
// two runtimes are separate npm projects with no shared package, so values
// that must agree across both (shipping fees, pickup hours, EMAIL_RE, etc.)
// are duplicated here under the *same names* as a deliberate signal to keep
// them in sync, rather than scattered across models/components as before.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pickup scheduling
export const PICKUP_OPEN_MINUTES = 10 * 60; // 10:00am
export const PICKUP_CLOSE_MINUTES = 19 * 60; // 7:00pm
export const PICKUP_MAX_MONTHS_AHEAD = 3;
export const PICKUP_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Gluten-free/sugar-free batches need real lead time to bake — unlike
// regular pickup orders, which have no advance-notice floor at all.
export const PICKUP_EXTENDED_NOTICE_MS = 48 * 60 * 60 * 1000;

// Shipping address format
export const ZIP_RE = /^\d{5}(-\d{4})?$/;

// 50 states + DC + USPS-served territories — all real, deliverable
// destinations (e.g. Washington DC wouldn't be enterable without it).
export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'GU', name: 'Guam' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

// Shipping box-size pricing
export const SHIPPING_MEDIUM_MAX_COOKIES = 36;
export const SHIPPING_FEE_MEDIUM = 24;
export const SHIPPING_FEE_LARGE = 30;
export const UNITS_PER_SIZE = { single: 1, half_dozen: 6, full_dozen: 12, batch: 24 };

// Smallest subtotal (pre-shipping) a single order may check out with —
// equivalent to a half dozen at standard pricing.
export const MIN_ORDER_SUBTOTAL = 9;

// Navigation tabs (shared between NavBar.jsx and MobileNavBar.jsx)
export const NAV_TABS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/menu', label: 'Menu', icon: '🍪' },
  { to: '/policy', label: 'Policy', icon: '🚚' },
  { to: '/nutrition', label: 'Nutrition', icon: '🥛' },
];

// Cookie-size taxonomy (shared between Menu.jsx and MobileMenu.jsx)
export const COOKIE_SIZES = [
  { key: 'single', flag: 'is_single', label: 'Singles' },
  { key: 'half_dozen', flag: 'is_half_dozen', label: 'Half Dozens' },
  { key: 'full_dozen', flag: 'is_full_dozen', label: 'Full Dozens' },
];

// Top-level menu category tabs (shared between Menu.jsx and MobileMenu.jsx).
// 'regular' uses the existing COOKIE_SIZES-driven layout above; the dietary
// categories are a different shape entirely — no single/half/full dozen,
// only a fixed 2-dozen batch — so they're driven by DIETARY_CATEGORIES
// instead, keyed the same way as MENU_CATEGORIES' non-'regular' keys.
export const MENU_CATEGORIES = [
  { key: 'regular', label: 'Regular' },
  { key: 'gluten_free', label: 'Gluten-Free' },
  { key: 'sugar_free', label: 'Sugar-Free' },
];

// Backend's Cookie.TYPES has a matching `${category}_standard`/
// `${category}_special` entry for each of these (no premium tier for
// either) — this is just the display-side mirror of that, same reasoning as
// COOKIE_SIZES above (no shared package between frontend/backend).
export const DIETARY_CATEGORIES = {
  gluten_free: {
    typeOrder: ['gluten_free_standard', 'gluten_free_special'],
    typeLabels: { gluten_free_standard: 'Standard', gluten_free_special: 'Special' },
  },
  sugar_free: {
    typeOrder: ['sugar_free_standard', 'sugar_free_special'],
    typeLabels: { sugar_free_standard: 'Standard', sugar_free_special: 'Special' },
  },
};

// Short marker shown next to a gluten-free/sugar-free item's flavor
// wherever it's displayed (menu, cart drawer, checkout) — derived from
// `type` rather than a separate stored flag, same source of truth as
// DIETARY_CATEGORIES above.
export function dietaryMarker(type) {
  if (type?.startsWith('gluten_free')) return 'GF';
  if (type?.startsWith('sugar_free')) return 'SF';
  return null;
}

// Cart/checkout line items show "(sizeLabel)" next to the flavor — this
// folds the dietary marker into that same parenthetical (e.g.
// "(GF, Batch)") instead of a second, separate one.
export function sizeLabelWithMarker(item) {
  const marker = dietaryMarker(item.type);
  return marker ? `${marker}, ${item.sizeLabel}` : item.sizeLabel;
}

// Cognito accounts sit in an unconfirmed limbo between signUp() and a
// successful confirmRegistration() — signing up again with that email fails
// ("already exists"), and signing in fails too ("not confirmed"), so this is
// the one thing that must survive a page reload. It deliberately holds only
// the email, never the password. Shared by SignUp.jsx and SignIn.jsx.
export const PENDING_EMAIL_KEY = 'pendingSignupEmail';
