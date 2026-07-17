import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import './AccountDrawerContent.css';

// The actual account menu, with no knowledge of whether it's rendered
// inside a right-side drawer (desktop) or a bottom sheet (mobile) — those
// shells just wrap this in different positioning/animation chrome, same
// split as CartDrawerContent.
function AccountDrawerContent() {
  const { user, closeAccount, signOut } = useAuth();

  return (
    <>
      <div className="account-drawer-header">
        <h2>Hi {user.firstName}!</h2>
        <button
          className="account-drawer-close"
          onClick={closeAccount}
          aria-label="Close account menu"
        >
          ×
        </button>
      </div>

      <nav className="account-drawer-nav">
        <Link to="/rewards" className="account-drawer-link" onClick={closeAccount}>
          Rewards
        </Link>
        <Link
          to="/delete-account"
          className="account-drawer-link account-drawer-link--danger"
          onClick={closeAccount}
        >
          Delete My Account
        </Link>
      </nav>

      <button className="checkout-btn" onClick={signOut}>
        Sign Out
      </button>
    </>
  );
}

export default AccountDrawerContent;
