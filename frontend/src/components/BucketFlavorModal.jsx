import { useEffect, useRef, useState } from 'react';
import './BucketFlavorModal.css';

// Everything inside the dialog that Tab can land on.
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]';

// Flavor picker for a Cozy Dough Bucket (regular, gluten-free or sugar-free —
// `title` says which). `options` is the per-flavor bucket
// products (see the `bucket` type in backend/models/Cookie.js) — picking one
// and confirming hands that exact product back to onConfirm, which is what
// gets added to the cart. Any way of closing it (Cancel, clicking outside,
// Escape) goes through onCancel and adds nothing.
//
// Keyboard and screen-reader behavior: opening it moves focus onto the dialog
// itself (so the title is announced), Tab and Shift+Tab cycle within it rather
// than reaching the menu behind the overlay, and closing it — by any route,
// including adding to the cart — puts focus back on whatever opened it.
function BucketFlavorModal({ isOpen, title, options = [], onCancel, onConfirm }) {
  const [selectedId, setSelectedId] = useState(null);
  const dialogRef = useRef(null);
  // Always the latest onCancel, without making the key listener below depend
  // on it — callers pass a fresh inline function every render, which would
  // otherwise tear the listener down and re-add it each time.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  // Starts blank every time it opens, so a half-made choice from a cancelled
  // attempt never carries over.
  useEffect(() => {
    if (isOpen) setSelectedId(null);
  }, [isOpen]);

  // Move focus in on open, and back to the opener on close. The opener is read
  // before focus moves; the cleanup runs when the dialog closes (or unmounts),
  // and skips the restore if the opener is gone or was never a real control
  // (e.g. Safari doesn't focus a button when it's clicked).
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll(FOCUSABLE)];
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active) || active === dialog) {
        // Focus is on the dialog itself (where it starts) or somehow outside it:
        // pull it onto the first control going forward, the last going back.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  function handleConfirm() {
    const chosen = options.find((p) => p.id === selectedId);
    if (chosen) onConfirm(chosen);
  }

  return (
    <div className="bucket-flavor-overlay" onClick={onCancel}>
      <div
        className="bucket-flavor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bucket-flavor-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="bucket-flavor-close" onClick={onCancel} aria-label="Close">
          ×
        </button>
        <h2 id="bucket-flavor-title">Choose your flavor</h2>
        <p className="bucket-flavor-subtitle">{title}</p>

        <div className="bucket-flavor-options">
          {options.map((p) => (
            <label
              key={p.id}
              className={'bucket-flavor-option' + (p.is_sold_out ? ' bucket-flavor-option--sold-out' : '')}
            >
              <input
                type="radio"
                name="bucket-flavor"
                checked={selectedId === p.id}
                onChange={() => setSelectedId(p.id)}
                disabled={p.is_sold_out}
              />
              <span>{p.baseFlavor}</span>
              {p.is_sold_out && <span className="bucket-flavor-sold-out">Sold out</span>}
            </label>
          ))}
        </div>

        <div className="bucket-flavor-actions">
          <button type="button" className="bucket-flavor-cancel-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="checkout-btn" onClick={handleConfirm} disabled={!selectedId}>
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

export default BucketFlavorModal;
