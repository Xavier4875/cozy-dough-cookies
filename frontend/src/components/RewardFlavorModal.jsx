import { useEffect, useState } from 'react';
import './RewardFlavorModal.css';
// The green + and red − are the menu's own stepper buttons (.stepper-btn,
// .stepper-qty), so they look and behave the same here as on the menu.
import './CookieGrid.css';

// A reward's cookies are split into portions (reward.flavorSlots of them, each
// reward.slotCookies cookies — see backend/rewards/catalog.js) and every
// portion gets a flavor. A flavor can take several portions but never less
// than one, which is what makes "at least six cookies of each flavor you pick"
// true, and why a reward can have at most as many flavors as it has portions:
//   single / half dozen  -> 1 portion  -> one flavor (radio buttons)
//   dozen                -> 2 portions -> up to 2 flavors
//   two dozen            -> 4 portions -> up to 4 flavors
//   three dozen          -> 6 portions -> up to 6 flavors, and so on.
// With more than one portion the customer adds cookies to flavors six at a
// time until the whole reward is accounted for; onConfirm receives one flavor
// per portion (a flavor repeats once for each portion it was given).
function RewardFlavorModal({ isOpen, reward, flavorOptions = [], onCancel, onConfirm }) {
  // Portions given to each flavor so far, e.g. { 'Chocolate Chip': 2, Oatmeal: 1 }.
  const [counts, setCounts] = useState({});

  // Resets whenever a different reward is opened, so a half-picked selection
  // from a cancelled redemption never leaks into the next one.
  useEffect(() => {
    setCounts({});
  }, [reward]);

  if (!isOpen || !reward) return null;

  const slots = reward.flavorSlots;
  const chosen = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const remaining = slots - chosen;
  // A type with a single flavor (Premium) has nothing to split, so all of it is
  // that flavor without asking.
  const soleFlavor = slots > 1 && flavorOptions.length === 1 ? flavorOptions[0].flavor : null;
  const complete = soleFlavor !== null || remaining === 0;

  function pickOnly(flavor) {
    setCounts({ [flavor]: 1 });
  }

  function adjust(flavor, delta) {
    setCounts((prev) => {
      const total = Object.values(prev).reduce((sum, n) => sum + n, 0);
      if (delta > 0 && total >= slots) return prev;
      const next = { ...prev };
      const n = (next[flavor] || 0) + delta;
      if (n <= 0) delete next[flavor];
      else next[flavor] = n;
      return next;
    });
  }

  function handleConfirm() {
    if (!complete) return;
    if (soleFlavor !== null) {
      onConfirm(Array(slots).fill(soleFlavor));
      return;
    }
    onConfirm(flavorOptions.flatMap((option) => Array(counts[option.flavor] || 0).fill(option.flavor)));
  }

  const tempNote = (
    <span className="reward-temp-note">Temperature Controlled: Pickup Required</span>
  );

  return (
    <div className="reward-flavor-overlay" onClick={onCancel}>
      <div className="reward-flavor-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{reward.label}</h2>
        <p className="reward-flavor-points">{reward.points.toLocaleString()} pts</p>

        {/* Only this part scrolls: the progress count and the buttons below stay in view. */}
        <div className="reward-flavor-scroll">
          {slots === 1 && (
            <fieldset className="reward-flavor-group">
              <div className="reward-flavor-options">
                {flavorOptions.map((option) => (
                  <label key={option.flavor} className="reward-flavor-option">
                    <input
                      type="radio"
                      name="reward-flavor"
                      checked={counts[option.flavor] === 1}
                      onChange={() => pickOnly(option.flavor)}
                    />
                    <span>{option.flavor}</span>
                    {option.is_temperature_controlled && tempNote}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {slots > 1 && soleFlavor !== null && (
            <p className="reward-flavor-help">
              All {reward.cookies} cookies are {soleFlavor}.
              {flavorOptions[0].is_temperature_controlled && <> {tempNote}</>}
            </p>
          )}

          {slots > 1 && soleFlavor === null && (
            <>
              <p className="reward-flavor-help">
                Choose up to {slots} flavors. Each flavor you pick must be at least {reward.slotCookies}{' '}
                cookies, so cookies are added {reward.slotCookies} at a time until all {reward.cookies}{' '}
                are chosen.
              </p>
              <div className="reward-flavor-list">
                {flavorOptions.map((option) => {
                  const n = counts[option.flavor] || 0;
                  return (
                    <div
                      key={option.flavor}
                      className={'reward-flavor-row' + (n > 0 ? ' reward-flavor-row--picked' : '')}
                    >
                      <div className="reward-flavor-row-name">
                        <span>{option.flavor}</span>
                        {option.is_temperature_controlled && tempNote}
                      </div>
                      <div className="reward-flavor-stepper">
                        <button
                          type="button"
                          className="stepper-btn stepper-btn--remove"
                          aria-label={`Remove ${reward.slotCookies} ${option.flavor} cookies`}
                          onClick={() => adjust(option.flavor, -1)}
                          disabled={n === 0}
                        >
                          −
                        </button>
                        <span
                          className="stepper-qty reward-flavor-count"
                          aria-label={`${n * reward.slotCookies} ${option.flavor} cookies`}
                        >
                          {n * reward.slotCookies}
                        </span>
                        <button
                          type="button"
                          className="stepper-btn stepper-btn--add"
                          aria-label={`Add ${reward.slotCookies} ${option.flavor} cookies`}
                          onClick={() => adjust(option.flavor, 1)}
                          disabled={remaining === 0}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="reward-flavor-footer">
          {slots > 1 && soleFlavor === null && (
            <p
              role="status"
              className={'reward-flavor-counter' + (complete ? ' reward-flavor-counter--done' : '')}
            >
              {chosen * reward.slotCookies} of {reward.cookies} cookies chosen
            </p>
          )}
          <div className="reward-flavor-actions">
            <button type="button" className="reward-flavor-cancel-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="checkout-btn" onClick={handleConfirm} disabled={!complete}>
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RewardFlavorModal;
