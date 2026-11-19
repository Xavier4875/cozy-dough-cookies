import './RewardTag.css';

// The label under a redeemed reward's name — in the cart, the checkout steps,
// Order Tracking and My Orders — so it is clear the item was paid for with
// points, not dollars. (The emails carry the same wording; see
// backend/email/format.js.)
function RewardTag() {
  return <span className="reward-tag">Redeemed with points</span>;
}

export default RewardTag;
