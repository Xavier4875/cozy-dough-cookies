import { useRef } from 'react';
import { useCart } from '../context/useCart.js';
import CookieGrid from '../components/CookieGrid.jsx';
import OrderSwitcher from '../components/OrderSwitcher.jsx';
import Mascot from '../components/Mascot.jsx';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import { useScrollSpy } from '../hooks/useScrollSpy.js';
import './Menu.css';

const SIZES = [
  { key: 'single', flag: 'is_single', label: 'Singles' },
  { key: 'half_dozen', flag: 'is_half_dozen', label: 'Half Dozens' },
  { key: 'full_dozen', flag: 'is_full_dozen', label: 'Full Dozens' },
];
const SIZE_KEYS = SIZES.map((size) => size.key);

function Menu() {
  const { products, addCookieToActiveOrder, removeCookieFromActiveOrder, qtyInActiveOrder } =
    useCart();
  const sectionRefs = useRef({});
  const sizeNavRef = useRef(null);
  const menuHeaderRef = useRef(null);

  // Publishes the menu header's real rendered height so size-nav (stacked
  // sticky below it) can offset by the right amount on any screen size.
  usePublishHeight(menuHeaderRef, '--menu-header-height');

  // Publishes size-nav's own height too, so .size-section's scroll-margin-top
  // (used by scrollIntoView to decide where to stop) reserves exactly the
  // same space the scroll-spy's "stickyBottom" threshold uses — if these
  // drift apart, a click scrolls to a resting spot the scroll-spy doesn't
  // yet consider "arrived," and the button won't highlight until you scroll
  // a little further.
  usePublishHeight(sizeNavRef, '--size-nav-height');

  const { activeKey: activeSize, scrollToKey: scrollToSize } = useScrollSpy({
    sectionRefs,
    stickyBoundaryRef: sizeNavRef,
    keys: SIZE_KEYS,
  });

  return (
    <div className="menu-page">
      <div className="page-mascot">
        <Mascot />
      </div>

      <div className="menu-header" ref={menuHeaderRef}>
        <h1>Menu</h1>
        <OrderSwitcher />
      </div>

      <div className="size-nav" ref={sizeNavRef}>
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

export default Menu;
