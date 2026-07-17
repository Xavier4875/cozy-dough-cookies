import { useCart } from '../context/useCart.js';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import ImagePlaceholder from '../components/ImagePlaceholder.jsx';
import './Rewards.css';

// Tier boundaries mirror the natural gaps in the approved catalog's point
// costs (see backend/rewards/catalog.js) — every reward lands in exactly one
// tier, with no overlap or gap between them.
const TIERS = [
  { label: '40 – 120 pts', min: 0, max: 120 },
  { label: '180 – 360 pts', min: 121, max: 360 },
  { label: '600 – 720 pts', min: 361, max: 720 },
  { label: '1080 – 1440 pts', min: 721, max: 1440 },
  { label: '1800+ pts', min: 1441, max: Infinity },
];

function Rewards() {
  const { isAuthenticated } = useAuth();
  const { rewardsCatalog, activeOrder, availableRewardsPoints, redeemReward } = useCart();

  if (!isAuthenticated) {
    return (
      <div className="rewards-page">
        <div className="page-mascot">
          <Mascot />
        </div>
        <p className="rewards-signin-note">Sign in to see your rewards.</p>
      </div>
    );
  }

  // Redemption always targets the active order (the same one Menu items add
  // to), so a reward already sitting there is the one that determines the
  // card's "already redeemed" state.
  function isRedeemed(reward) {
    return activeOrder.items.some((item) => item.cookie.rewardKey === reward.key);
  }

  return (
    <div className="rewards-page">
      <div className="page-mascot">
        <Mascot />
      </div>

      <div className="rewards-balance-header">
        <p className="rewards-balance-large">{availableRewardsPoints.toLocaleString()} points</p>
      </div>

      <div className="rewards-balance-sticky">
        {availableRewardsPoints.toLocaleString()} points available
      </div>

      {TIERS.map((tier) => {
        const tierRewards = rewardsCatalog
          .filter((r) => r.points >= tier.min && r.points <= tier.max)
          .sort((a, b) => a.points - b.points);
        if (tierRewards.length === 0) return null;
        return (
          <section key={tier.label} className="rewards-tier">
            <h2 className="rewards-tier-title">{tier.label}</h2>
            <div className="rewards-grid">
              {tierRewards.map((reward) => {
                const redeemed = isRedeemed(reward);
                const canAfford = availableRewardsPoints >= reward.points;
                return (
                  <div key={reward.key} className="reward-card">
                    <ImagePlaceholder label={reward.label} aspectRatio="1 / 1" />
                    <p className="reward-label">{reward.label}</p>
                    <p className="reward-points">{reward.points} pts</p>
                    {reward.is_temperature_controlled && (
                      <p className="reward-temp-note">Temperature Controlled: Pickup Required</p>
                    )}
                    <button
                      className={
                        'reward-redeem-btn' + (redeemed ? ' reward-redeem-btn--redeemed' : '')
                      }
                      onClick={() => redeemReward(reward)}
                      disabled={redeemed || !canAfford}
                    >
                      {redeemed ? 'Redeemed ✓' : 'Redeem'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default Rewards;
