import { Cookie } from '../models/Cookie.js';
import { POINTS_PER_DOLLAR } from '../constants.js';

// 25 points per $1 of redemption value (a 4% return rate, matching the 1
// point per $1 earned on purchases) — every reward's cost is derived from
// the real menu price rather than hand-typed, so it can never drift out of
// sync with Cookie.TYPES if prices ever change. The one exception, per the
// owner: standard/special singles are fixed at 50/75 points rather than the
// formula (pointsOverride below) — deliberately below the 4% rate to keep
// the cheapest rewards accessible.
function reward(key, type, size, qty, sizeLabel, label, pointsOverride) {
  const price = Cookie.TYPES[type].prices[size];
  return {
    key,
    type,
    size,
    qty,
    sizeLabel,
    label,
    points: pointsOverride ?? Math.round(price * qty * POINTS_PER_DOLLAR),
    // The real menu-equivalent dollar value this reward stands in for (e.g.
    // Two Dozen Standard = $18 * 2 = $36), separate from the $0 it actually
    // charges — used so a fully-redeemed order can still count toward the
    // minimum-order-value checkout rule instead of always reading as $0.
    value: price * qty,
    // Rough, type-level badge shown on the Rewards page before a flavor is
    // even picked. The real per-flavor answer is computed at redemption time
    // (see backend/index.js's redemption fold-in, RewardFlavorModal.jsx).
    is_temperature_controlled: type !== 'standard',
  };
}

export const REWARDS_CATALOG = [
  reward('standard-single', 'standard', 'single', 1, 'Single', 'Standard Single', 50),
  reward('special-single', 'special', 'single', 1, 'Single', 'Special Single', 75),
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
