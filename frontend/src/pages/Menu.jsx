import { useRef } from 'react';
import MenuContent from '../components/MenuContent.jsx';
import OrderSwitcher from '../components/OrderSwitcher.jsx';
import Mascot from '../components/Mascot.jsx';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import './Menu.css';

// The desktop menu page: title and order switcher side by side, then the
// shared MenuContent (tabs and products). MobileMenu is the phone layout.
function Menu() {
  const menuHeaderRef = useRef(null);

  // Publishes the menu header's real rendered height so size-nav (stacked
  // sticky below it) can offset by the right amount on any screen size.
  usePublishHeight(menuHeaderRef, '--menu-header-height');

  return (
    <div className="menu-page">
      <div className="page-mascot">
        <Mascot />
      </div>

      <div className="menu-header" ref={menuHeaderRef}>
        <h1>Menu</h1>
        <OrderSwitcher />
      </div>

      <MenuContent sizeNavClassName="size-nav" />
    </div>
  );
}

export default Menu;
