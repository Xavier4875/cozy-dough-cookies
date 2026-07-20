import { useRef } from 'react';
import { useCart } from '../context/useCart.js';
import CookieGrid from '../components/CookieGrid.jsx';
import OrderSwitcher from '../components/OrderSwitcher.jsx';
import Mascot from '../components/Mascot.jsx';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import { useScrollSpy } from '../hooks/useScrollSpy.js';
import { COOKIE_SIZES as SIZES } from '../constants.js';
import './MobileMenu.css';

const SIZE_KEYS = SIZES.map((size) => size.key);

// Same data/behavior as the desktop Menu, laid out for a phone: the order
// switcher stacks below the title instead of squeezing in beside it, and
// the size buttons are a single horizontally-scrollable row instead of
// wrapping onto a second line.
function MobileMenu() {
  const { products, addCookieToActiveOrder, removeCookieFromActiveOrder, qtyInActiveOrder } =
    useCart();
  const sectionRefs = useRef({});
  const sizeNavRef = useRef(null);
  const menuHeaderRef = useRef(null);

  usePublishHeight(menuHeaderRef, '--menu-header-height');
  usePublishHeight(sizeNavRef, '--size-nav-height');

  const { activeKey: activeSize, scrollToKey: scrollToSize } = useScrollSpy({
    sectionRefs,
    stickyBoundaryRef: sizeNavRef,
    keys: SIZE_KEYS,
  });

  return (
    <div className="mobile-menu-page">
      <div className="page-mascot">
        <Mascot />
      </div>

      <div className="mobile-menu-header" ref={menuHeaderRef}>
        <h1>Menu</h1>
        <OrderSwitcher />
      </div>

      <div className="mobile-size-nav" ref={sizeNavRef}>
        {SIZES.map((size) => (
          <button
            key={size.key}
            className={
              'size-nav-btn' + (activeSize === size.key ? ' size-nav-btn--active' : '')
            }
            onClick={() => scrollToSize(size.key)}
          >
            {size.label}
          </button>
        ))}
      </div>

      {SIZES.map((size) => (
        <section
          key={size.key}
          ref={(el) => (sectionRefs.current[size.key] = el)}
          className="size-section"
        >
          <h2 className="size-section-title">{size.label}</h2>
          <CookieGrid
            products={products.filter((p) => p[size.flag])}
            addCookieToActiveOrder={addCookieToActiveOrder}
            removeCookieFromActiveOrder={removeCookieFromActiveOrder}
            qtyInActiveOrder={qtyInActiveOrder}
          />
        </section>
      ))}
    </div>
  );
}

export default MobileMenu;
