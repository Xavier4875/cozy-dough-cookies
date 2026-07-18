import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import './DeleteAccountModal.css';

const CONFIRM_PHRASE = 'permanently delete account';

function DeleteAccountModal() {
  const { isDeleteAccountOpen, closeDeleteAccount, deleteAccount, error } = useAuth();
  const navigate = useNavigate();

  // 'warn' -> 'type': the initial warning, then the typed-phrase gate.
  const [step, setStep] = useState('warn');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isDeleteAccountOpen) return null;

  function handleClose() {
    setStep('warn');
    setTypedPhrase('');
    setFormError('');
    closeDeleteAccount();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (typedPhrase.trim().toLowerCase() !== CONFIRM_PHRASE) {
      setFormError(`Type "${CONFIRM_PHRASE}" exactly to confirm.`);
      return;
    }
    setFormError('');
    setSubmitting(true);
    const ok = await deleteAccount();
    setSubmitting(false);
    if (ok) {
      // deleteAccount() already cleared the signed-in user and closed this
      // modal on success — just leave whatever account-only page they were
      // on (Rewards/Order History would otherwise sit there showing a
      // sign-in prompt for an account that no longer exists).
      navigate('/');
    }
  }

  return (
    <div className="delete-account-overlay" onClick={handleClose}>
      <div className="delete-account-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Delete My Account</h2>

        {step === 'warn' ? (
          <>
            <p>
              Are you sure you&apos;d like to delete your account? All rewards points and order
              history will be permanently lost.
            </p>
            <div className="delete-account-actions">
              <button className="delete-account-cancel-btn" onClick={handleClose}>
                Cancel
              </button>
              <button className="delete-account-confirm-btn" onClick={() => setStep('type')}>
                Yes
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p>
              Type <strong>{CONFIRM_PHRASE}</strong> below and press Enter to permanently delete
              your account.
            </p>
            <input
              type="text"
              className="delete-account-input"
              value={typedPhrase}
              onChange={(e) => setTypedPhrase(e.target.value)}
              autoFocus
            />
            {(formError || error) && <p className="checkout-error">{formError || error}</p>}
            <div className="delete-account-actions">
              <button type="button" className="delete-account-cancel-btn" onClick={handleClose}>
                Cancel
              </button>
              <button type="submit" className="delete-account-confirm-btn" disabled={submitting}>
                {submitting ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default DeleteAccountModal;
