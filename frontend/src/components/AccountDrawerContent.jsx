import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import './AccountDrawerContent.css';

// The actual account menu, with no knowledge of whether it's rendered
// inside a right-side drawer (desktop) or a bottom sheet (mobile) — those
// shells just wrap this in different positioning/animation chrome, same
// split as CartDrawerContent.
function AccountDrawerContent() {
  const { user, closeAccount, signOut, openDeleteAccount } = useAuth();

  // Delete confirmation happens in its own centered modal (DeleteAccountModal,
  // rendered at the App level so it survives this drawer closing) rather than
  // a page navigation — closing the drawer first avoids both being on screen
  // at once.
  function handleDeleteAccountClick() {
    closeAccount();
    openDeleteAccount();
  }

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
        {user.role === 'staff' ? (
          <>
            <Link to="/order-tracking" className="account-drawer-link" onClick={closeAccount}>
              Order Tracking
            </Link>
            <Link to="/sales" className="account-drawer-link" onClick={closeAccount}>
              Sales
            </Link>
          </>
        ) : (
          <Link to="/order-history" className="account-drawer-link" onClick={closeAccount}>
            My Orders
          </Link>
        )}
        <button
          className="account-drawer-link account-drawer-link--danger account-drawer-link--button"
          onClick={handleDeleteAccountClick}
        >
          Delete My Account
        </button>
      </nav>

      <button className="checkout-btn" onClick={signOut}>
        Sign Out
      </button>
    </>
  );
}

export default AccountDrawerContent;
