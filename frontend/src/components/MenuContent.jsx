import { useEffect, useRef, useState } from 'react';
import { useCart } from '../context/useCart.js';
import { useAuth } from '../context/useAuth.js';
import CookieGrid from './CookieGrid.jsx';
import FlavorPickerCards from './BucketsGrid.jsx';
import { usePublishHeight } from '../hooks/usePublishHeight.js';
import { useScrollSpy } from '../hooks/useScrollSpy.js';
import {
  COOKIE_SIZES as SIZES,
  MENU_CATEGORIES,
  DIETARY_CATEGORIES,
  menuCategoryOf,
} from '../constants.js';

const SIZE_KEYS = SIZES.map((size) => size.key);

// Everything below the page header on the menu, shared by the desktop Menu
// and the phone MobileMenu (which differ only in the page's own layout):
// the Regular / Gluten-Free / Sugar-Free tabs and, under each, the products.
// `sizeNavClassName` is the one thing that differs — the class the section
// nav bar carries in each layout.
//
// The products themselves are drawn from data the backend sends, not from
// anything named here: a type flagged with a `pickerTitle` gets a flavor-
// picker card, one flagged `priceOnCard` shows prices on its cards, and any
// other type just gets a section of cards.
function MenuContent({ sizeNavClassName = 'size-nav' }) {
  const { products } = useCart();
  const [activeCategory, setActiveCategory] = useState('regular');
  const sectionRefs = useRef({});
  const sizeNavRef = useRef(null);

  // Publishes size-nav's own height so .size-section's scroll-margin-top
  // (used by scrollIntoView to decide where to stop) reserves exactly the
  // same space the scroll-spy's "stickyBottom" threshold uses — if these
  // drift apart, a click scrolls to a resting spot the scroll-spy doesn't
  // yet consider "arrived," and the button won't highlight until you scroll
  // a little further. (The page publishes the menu header's height too.)
  usePublishHeight(sizeNavRef, '--size-nav-height');

  const { activeKey: activeSize, scrollToKey: scrollToSize } = useScrollSpy({
    sectionRefs,
    stickyBoundaryRef: sizeNavRef,
    keys: SIZE_KEYS,
  });

  // The Regular tab lays products out by COOKIE_SIZES section, so a product
  // that matches none of them has nowhere to appear. (Gluten-free/sugar-free
  // products can't go missing this way — every one of them is drawn.) Say so
  // while developing rather than letting it quietly vanish.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const unplaced = products.filter(
      (p) => menuCategoryOf(p.type) === 'regular' && !SIZES.some((size) => p[size.flag])
    );
    if (unplaced.length > 0) {
      console.warn(
        `${unplaced.length} product(s) match no menu section and won't be shown — add a section to COOKIE_SIZES in constants.js:`,
        unplaced.map((p) => p.id)
      );
    }
  }, [products]);

  const regularProducts = products.filter((p) => menuCategoryOf(p.type) === 'regular');
  const dietary = DIETARY_CATEGORIES[activeCategory];

  return (
    <>
      <div className="menu-category-tabs">
        {MENU_CATEGORIES.map((category) => (
          <button
            key={category.key}
            className={
              'menu-category-tab' +
              (activeCategory === category.key ? ' menu-category-tab--active' : '')
            }
            onClick={() => setActiveCategory(category.key)}
          >
            {category.label}
          </button>
        ))}
      </div>

      {activeCategory === 'regular' ? (
        <>
          <div className={sizeNavClassName} ref={sizeNavRef}>
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
              <ProductArea products={regularProducts.filter((p) => p[size.flag])} />
            </section>
          ))}
        </>
      ) : (
        <>
          <p className="menu-batch-note">{dietary.batchNote}</p>
          <ProductArea
            products={products.filter((p) => menuCategoryOf(p.type) === activeCategory)}
            typeOrder={dietary.typeOrder}
            typeLabels={dietary.typeLabels}
            priceUnitLabel="per batch"
            pickerHeading={dietary.pickerHeading}
          />
        </>
      )}
    </>
  );
}

// One block of products: the ordinary cards first, then any flavor-picker
// cards. The optional props are CookieGrid's own, passed straight through.
function ProductArea({ products, typeOrder, typeLabels, priceUnitLabel, pickerHeading }) {
  const {
    addCookieToActiveOrder,
    removeCookieFromActiveOrder,
    qtyInActiveOrder,
    setProductSoldOut,
  } = useCart();
  const { isAuthenticated, user } = useAuth();
  const isStaff = isAuthenticated && user.role === 'staff';

  return (
    <>
      <CookieGrid
        products={products.filter((p) => !p.pickerTitle)}
        typeOrder={typeOrder}
        typeLabels={typeLabels}
        priceUnitLabel={priceUnitLabel}
        addCookieToActiveOrder={addCookieToActiveOrder}
        removeCookieFromActiveOrder={removeCookieFromActiveOrder}
        qtyInActiveOrder={qtyInActiveOrder}
        isStaff={isStaff}
        onSetSoldOut={setProductSoldOut}
      />
      <FlavorPickerCards
        products={products}
        heading={pickerHeading}
        addCookieToActiveOrder={addCookieToActiveOrder}
        qtyInActiveOrder={qtyInActiveOrder}
      />
    </>
  );
}

export default MenuContent;
