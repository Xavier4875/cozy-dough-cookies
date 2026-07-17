import { useAuth } from '../context/useAuth.js';
import AccountDrawerContent from './AccountDrawerContent.jsx';
import './AccountDrawer.css';

function AccountDrawer() {
  const { isAccountOpen, closeAccount } = useAuth();

  if (!isAccountOpen) return null;

  return (
    <div className="account-drawer-overlay" onClick={closeAccount}>
      <aside className="account-drawer" onClick={(e) => e.stopPropagation()}>
        <AccountDrawerContent />
      </aside>
    </div>
  );
}

export default AccountDrawer;
