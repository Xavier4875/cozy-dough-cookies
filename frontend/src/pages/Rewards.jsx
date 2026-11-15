import { useState } from 'react';
import { useCart } from '../context/useCart.js';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import ImagePlaceholder from '../components/ImagePlaceholder.jsx';
import RewardFlavorModal from '../components/RewardFlavorModal.jsx';
import { rewardImageFor } from '../rewardImages.js';
import './Rewards.css';

// Point-cost bands the rewards page groups its cards into (costs come from
// backend/rewards/catalog.js) — every reward lands in exactly one tier, with
// no overlap or gap between them (a band with no rewards is skipped). If menu
// prices change enough to shift the costs, revisit these boundaries so the
// bands still split the rewards sensibly.
// Deliberately no hardcoded label here — it's derived below from the rewards
// actually in each tier (e.g. "50 – 75 pts"), so the displayed range can't go
// stale the way a fixed string would as prices change.
const TIERS = [
  { min: 0, max: 120 },
  { min: 121, max: 360 },
  { min: 361, max: 720 },
  { min: 721, max: 1440 },
  { min: 1441, max: Infinity },
];

function Rewards() {
  const { isAuthenticated } = useAuth();
  const { products, rewardsCatalog, activeOrder, availableRewardsPoints, redeemReward } = useCart();
  const [selectedReward, setSelectedReward] = useState(null);

  const flavorOptions = selectedReward
    ? products
        .filter((p) => p.type === selectedReward.type && p.is_single)
        .map((p) => ({ flavor: p.flavor, is_temperature_controlled: p.is_temperature_controlled }))
    : [];

  function handleFlavorsConfirmed(flavors) {
    redeemReward(selectedReward, flavors);
    setSelectedReward(null);
  }

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
        const lowest = tierRewards[0].points;
        const highest = tierRewards[tierRewards.length - 1].points;
        const label = lowest === highest ? `${lowest} pts` : `${lowest} – ${highest} pts`;
        return (
          <section key={tier.min} className="rewards-tier">
            <h2 className="rewards-tier-title">{label}</h2>
            <div className="rewards-grid">
              {tierRewards.map((reward) => {
                const redeemed = isRedeemed(reward);
                const canAfford = availableRewardsPoints >= reward.points;
                const imageSrc = rewardImageFor(reward.key);
                return (
                  <div key={reward.key} className="reward-card">
                    {imageSrc ? (
                      <img src={imageSrc} alt={reward.label} className="reward-image" />
                    ) : (
                      <ImagePlaceholder label={reward.label} aspectRatio="1 / 1" />
                    )}
                    <p className="reward-label">{reward.label}</p>
                    <p className="reward-points">{reward.points} pts</p>
                    {reward.is_temperature_controlled && (
                      <p className="reward-temp-note">Temperature Controlled: Pickup Required</p>
                    )}
                    <button
                      className={
                        'reward-redeem-btn' + (redeemed ? ' reward-redeem-btn--redeemed' : '')
                      }
                      onClick={() => setSelectedReward(reward)}
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

      <RewardFlavorModal
        isOpen={selectedReward !== null}
        reward={selectedReward}
        flavorOptions={flavorOptions}
        onCancel={() => setSelectedReward(null)}
        onConfirm={handleFlavorsConfirmed}
      />
    </div>
  );
}

export default Rewards;
