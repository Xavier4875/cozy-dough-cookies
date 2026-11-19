import { MIN_ORDER_SUBTOTAL } from '../constants.js';

// The minimum applies per order, to what the customer pays for. An order that
// redeems a reward is exempt: the customer is already spending points on it, and
// a reward is often worth less than the minimum on its own. Returns an error
// message, or null when every order is fine.
export function minimumOrderError(cart) {
  const tooSmall = cart.orders.some((order) => !order.hasReward && order.total < MIN_ORDER_SUBTOTAL);
  return tooSmall
    ? `Each order must total at least $${MIN_ORDER_SUBTOTAL.toFixed(2)}, unless it redeems a reward.`
    : null;
}

// A checkout may only redeem rewards the customer can actually afford. Checked
// before anything is charged: once a card has been charged there is no good way
// to take back a reward that couldn't be paid for, so "we'll sort the points out
// afterwards" would hand out free rewards. (The balance can legitimately be
// negative after a cancel took back points that were already spent.) Returns an
// error message, or null when the balance covers it.
export function rewardsBalanceError(pointsRequired, balance) {
  if (pointsRequired <= 0) return null;
  const have = Number.isFinite(balance) ? balance : 0;
  if (have >= pointsRequired) return null;
  return `You need ${pointsRequired} points for these rewards but have ${Math.max(have, 0)}.`;
}
