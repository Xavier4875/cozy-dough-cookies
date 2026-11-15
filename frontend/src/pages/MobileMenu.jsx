import { useRef } from 'react';
import MenuContent from '../components/MenuContent.jsx';
import OrderSwitcher from '../components/OrderSwitcher.jsx';
import Mascot from '../components/Mascot.jsx';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import './MobileMenu.css';

// Same data/behavior as the desktop Menu, laid out for a phone: the order
// switcher stacks below the title instead of squeezing in beside it, and
// the size buttons are a single horizontally-scrollable row instead of
// wrapping onto a second line.
function MobileMenu() {
  const menuHeaderRef = useRef(null);

  usePublishHeight(menuHeaderRef, '--menu-header-height');

  return (
    <div className="mobile-menu-page">
      <div className="page-mascot">
        <Mascot />
      </div>

      <div className="mobile-menu-header" ref={menuHeaderRef}>
        <h1>Menu</h1>
        <OrderSwitcher />
      </div>

      <MenuContent sizeNavClassName="mobile-size-nav" />
    </div>
  );
}

export default MobileMenu;
