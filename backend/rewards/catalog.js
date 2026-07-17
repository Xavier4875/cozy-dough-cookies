import { Cookie } from '../models/Cookie.js';

// 20 points per $1 of redemption value (a 5% return rate, matching the 1
// point per $1 earned on purchases) — every reward's cost is derived from
// the real menu price rather than hand-typed, so it can never drift out of
// sync with Cookie.TYPES if prices ever change.
const POINTS_PER_DOLLAR = 20;

function reward(key, type, size, qty, sizeLabel, label) {
  const price = Cookie.TYPES[type].prices[size];
  return {
    key,
    type,
    size,
    qty,
    sizeLabel,
    label,
    points: Math.round(price * qty * POINTS_PER_DOLLAR),
    // Interim simplification: a redeemed reward doesn't let the customer
    // pick a flavor yet, so we can't know which one they'll actually get.
    // Any Special/Premium reward is conservatively flagged as needing
    // refrigeration (some flavors in those tiers do); Standard never is.
    // Once flavor selection exists, this should switch to checking the real
    // per-flavor TEMPERATURE_CONTROLLED_FLAVORS set in models/Cookie.js.
    is_temperature_controlled: type !== 'standard',
  };
}

export const REWARDS_CATALOG = [
  reward('standard-single', 'standard', 'single', 1, 'Single', 'Standard Single'),
  reward('special-single', 'special', 'single', 1, 'Single', 'Special Single'),
  reward('premium-single', 'premium', 'single', 1, 'Single', 'Premium Single'),
  reward('standard-half-dozen', 'standard', 'half_dozen', 1, 'Half Dozen', 'Standard Half Dozen'),
  reward('special-half-dozen', 'special', 'half_dozen', 1, 'Half Dozen', 'Special Half Dozen'),
  reward('standard-dozen', 'standard', 'full_dozen', 1, 'Dozen', 'Standard Dozen'),
  reward('special-dozen', 'special', 'full_dozen', 1, 'Dozen', 'Special Dozen'),
  reward('premium-half-dozen', 'premium', 'half_dozen', 1, 'Half Dozen', 'Premium Half Dozen'),
  reward('standard-2dozen', 'standard', 'full_dozen', 2, 'Two Dozen', 'Two Dozen Standard'),
  reward('standard-3dozen', 'standard', 'full_dozen', 3, 'Three Dozen', 'Three Dozen Standard'),
  reward('premium-dozen', 'premium', 'full_dozen', 1, 'Dozen', 'Premium Dozen'),
  reward('special-2dozen', 'special', 'full_dozen', 2, 'Two Dozen', 'Two Dozen Special'),
  reward('standard-4dozen', 'standard', 'full_dozen', 4, 'Four Dozen', 'Four Dozen Standard'),
  reward('special-3dozen', 'special', 'full_dozen', 3, 'Three Dozen', 'Three Dozen Special'),
  reward('special-4dozen', 'special', 'full_dozen', 4, 'Four Dozen', 'Four Dozen Special'),
  reward('premium-2dozen', 'premium', 'full_dozen', 2, 'Two Dozen', 'Two Dozen Premium'),
];

export function getReward(key) {
  return REWARDS_CATALOG.find((r) => r.key === key) ?? null;
}
