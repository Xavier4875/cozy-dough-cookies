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
export const PICKUP_MIN_NOTICE_MS = 24 * 60 * 60 * 1000;
export const PICKUP_MAX_MONTHS_AHEAD = 3;
export const PICKUP_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
export const UNITS_PER_SIZE = { single: 1, half_dozen: 6, full_dozen: 12 };

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

// Cognito accounts sit in an unconfirmed limbo between signUp() and a
// successful confirmRegistration() — signing up again with that email fails
// ("already exists"), and signing in fails too ("not confirmed"), so this is
// the one thing that must survive a page reload. It deliberately holds only
// the email, never the password. Shared by SignUp.jsx and SignIn.jsx.
export const PENDING_EMAIL_KEY = 'pendingSignupEmail';
