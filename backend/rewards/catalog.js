import { Cookie } from '../models/Cookie.js';
import { POINTS_PER_DOLLAR, UNITS_PER_SIZE, MIN_COOKIES_PER_FLAVOR } from '../constants.js';

// 25 points per $1 of redemption value (POINTS_PER_DOLLAR — a 4% return rate,
// since purchases earn 1 point per $1) — every reward's cost is derived from
// the real menu price rather than hand-typed, so it can never drift out of
// sync with Cookie.TYPES if prices ever change. The one exception, per the
// owner: the standard and special singles are pinned to 50 and 75 points
// (pointsOverride below), so those two cheapest rewards keep a fixed,
// round cost even if their menu price changes.
function reward(key, type, size, qty, sizeLabel, label, pointsOverride) {
  const price = Cookie.TYPES[type].prices[size];
  // The reward's cookies are split into portions of (at most) six, and the
  // customer assigns a flavor to each portion. A flavor may take several
  // portions but can never take less than one, so every flavor in the reward
  // has at least six cookies and there can be at most `flavorSlots` of them:
  // a single and a half dozen are one portion, a dozen is two, two dozen is
  // four, three dozen is six, and so on.
  const cookies = UNITS_PER_SIZE[size] * qty;
  const slotCookies = Math.min(cookies, MIN_COOKIES_PER_FLAVOR);
  return {
    key,
    type,
    size,
    qty,
    sizeLabel,
    label,
    cookies,
    slotCookies,
    flavorSlots: cookies / slotCookies,
    points: pointsOverride ?? Math.round(price * qty * POINTS_PER_DOLLAR),
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
