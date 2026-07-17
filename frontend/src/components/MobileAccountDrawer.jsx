import { useAuth } from '../context/useAuth.js';
import AccountDrawerContent from './AccountDrawerContent.jsx';
import './MobileAccountDrawer.css';

// Same account content as the desktop AccountDrawer, in a bottom-sheet shell
// instead of a right-side panel — matches the same mobile-vs-desktop split
// used for the cart drawer.
function MobileAccountDrawer() {
  const { isAccountOpen, closeAccount } = useAuth();

  if (!isAccountOpen) return null;

  return (
    <div className="mobile-account-overlay" onClick={closeAccount}>
      <aside className="mobile-account-sheet" onClick={(e) => e.stopPropagation()}>
        <AccountDrawerContent />
      </aside>
    </div>
  );
}

export default MobileAccountDrawer;
