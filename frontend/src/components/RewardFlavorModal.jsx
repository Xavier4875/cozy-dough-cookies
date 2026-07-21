import { useEffect, useState } from 'react';
import './RewardFlavorModal.css';

// One radio-group per dozen in the reward (reward.qty), each independently
// choosing any flavor valid for the reward's type — so a Two Dozen reward
// can be two different flavors or the same flavor picked twice. Anything
// smaller than two dozen (single, half dozen, one dozen) always has
// reward.qty === 1, so this collapses to a single flavor choice with no
// special-casing needed.
function RewardFlavorModal({ isOpen, reward, flavorOptions = [], onCancel, onConfirm }) {
  const [selections, setSelections] = useState([]);

  // Resets whenever a different reward is opened, so a half-picked selection
  // from a cancelled redemption never leaks into the next one.
  useEffect(() => {
    if (reward) setSelections(Array(reward.qty).fill(null));
  }, [reward]);

  if (!isOpen || !reward) return null;

  const allSelected = selections.length === reward.qty && selections.every(Boolean);

  function selectFlavor(dozenIndex, flavor) {
    setSelections((prev) => {
      const next = [...prev];
      next[dozenIndex] = flavor;
      return next;
    });
  }

  function handleConfirm() {
    if (!allSelected) return;
    onConfirm(selections);
  }

  return (
    <div className="reward-flavor-overlay" onClick={onCancel}>
      <div className="reward-flavor-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{reward.label}</h2>
        <p className="reward-flavor-points">{reward.points.toLocaleString()} pts</p>

        {selections.map((selected, dozenIndex) => (
          <fieldset key={dozenIndex} className="reward-flavor-group">
            {reward.qty > 1 && (
              <legend className="reward-flavor-group-title">Dozen {dozenIndex + 1}</legend>
            )}
            <div className="reward-flavor-options">
              {flavorOptions.map((option) => (
                <label key={option.flavor} className="reward-flavor-option">
                  <input
                    type="radio"
                    name={`reward-flavor-${dozenIndex}`}
                    checked={selected === option.flavor}
                    onChange={() => selectFlavor(dozenIndex, option.flavor)}
                  />
                  <span>{option.flavor}</span>
                  {option.is_temperature_controlled && (
                    <span className="reward-temp-note">Temperature Controlled: Pickup Required</span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="reward-flavor-actions">
          <button type="button" className="reward-flavor-cancel-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="checkout-btn" onClick={handleConfirm} disabled={!allSelected}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default RewardFlavorModal;
