import { useEffect, useRef, useState } from 'react';
import { useCart } from '../context/useCart.js';
import ImagePlaceholder from '../components/ImagePlaceholder.jsx';
import OrderSwitcher from '../components/OrderSwitcher.jsx';
import './Menu.css';

const TYPE_ORDER = ['standard', 'special', 'premium'];
const TYPE_LABELS = {
  standard: 'Standard',
  special: 'Special',
  premium: 'Premium',
};

const SIZES = [
  { key: 'single', flag: 'is_single', label: 'Singles' },
  { key: 'half_dozen', flag: 'is_half_dozen', label: 'Half Dozens' },
  { key: 'full_dozen', flag: 'is_full_dozen', label: 'Full Dozens' },
];

function CookieGrid({ products, addCookieToActiveOrder, removeCookieFromActiveOrder, qtyInActiveOrder }) {
  return TYPE_ORDER.map((type) => {
    const typeProducts = products.filter((p) => p.type === type);
    if (typeProducts.length === 0) return null;
    return (
      <section key={type} className={`product-section product-section--${type}`}>
        <h3 className="product-section-title">
          {TYPE_LABELS[type]}{' '}
          <span className="product-section-price">
            ${typeProducts[0].price.toFixed(2)} each
          </span>
        </h3>
        <div className="cookie-grid">
          {typeProducts.map((p) => {
            const qty = qtyInActiveOrder(p.id);
            return (
              <div key={p.id} className="cookie-card">
                <ImagePlaceholder label={p.flavor} aspectRatio="1 / 1" />
                <p className="cookie-flavor">{p.flavor}</p>
                <div className="cookie-stepper">
                  <button
                    className="stepper-btn stepper-btn--remove"
                    onClick={() => removeCookieFromActiveOrder(p.id)}
                    disabled={qty === 0}
                    aria-label={`Remove one ${p.flavor}`}
                  >
                    −
                  </button>
                  <span className="stepper-qty">{qty}</span>
                  <button
                    className="stepper-btn stepper-btn--add"
                    onClick={() => addCookieToActiveOrder(p)}
                    aria-label={`Add one ${p.flavor}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  });
}

function Menu() {
  const { products, addCookieToActiveOrder, removeCookieFromActiveOrder, qtyInActiveOrder } =
    useCart();
  const sectionRefs = useRef({});
  const sizeNavRef = useRef(null);
  const menuHeaderRef = useRef(null);
  const [activeSize, setActiveSize] = useState(SIZES[0].key);

  // While a click-triggered scroll is animating, the scroll-spy effect below
  // would otherwise see it pass through (and briefly highlight) whichever
  // sections lie between the old and new position. suppressSpyRef mutes the
  // scroll-spy until the scroll actually finishes; recomputeActiveRef lets
  // scrollToSize trigger one final recheck at that point without recreating
  // the scroll listener. scrollTokenRef guards against a second click
  // resolving a stale "scroll finished" callback from an earlier click.
  const suppressSpyRef = useRef(false);
  const recomputeActiveRef = useRef(() => {});
  const scrollTokenRef = useRef(0);

  function scrollToSize(key) {
    setActiveSize(key);
    suppressSpyRef.current = true;
    const token = ++scrollTokenRef.current;
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    function resume() {
      if (scrollTokenRef.current !== token) return; // superseded by a later click
      suppressSpyRef.current = false;
      recomputeActiveRef.current();
    }

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', resume, { once: true });
      return;
    }

    // Safari (pre-18.2ish) lacks scrollend — poll until scrollY holds still
    // for a few frames instead of guessing a fixed animation duration.
    let lastY = window.scrollY;
    let stableFrames = 0;
    function poll() {
      if (scrollTokenRef.current !== token) return;
      const y = window.scrollY;
      if (y === lastY) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastY = y;
      }
      if (stableFrames > 6) {
        resume();
      } else {
        requestAnimationFrame(poll);
      }
    }
    requestAnimationFrame(poll);
  }

  // Publishes the menu header's real rendered height so size-nav (stacked
  // sticky below it) can offset by the right amount on any screen size.
  useEffect(() => {
    const el = menuHeaderRef.current;
    if (!el) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        '--menu-header-height',
        `${el.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Publishes size-nav's own height too, so .size-section's scroll-margin-top
  // (used by scrollIntoView to decide where to stop) reserves exactly the
  // same space the scroll-spy's "stickyBottom" threshold below uses — if
  // these drift apart, a click scrolls to a resting spot the scroll-spy
  // doesn't yet consider "arrived," and the button won't highlight until
  // you scroll a little further.
  useEffect(() => {
    const el = sizeNavRef.current;
    if (!el) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        '--size-nav-height',
        `${el.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scroll-spy: whichever section's top has scrolled up past the bottom edge
  // of the sticky nav stack (navbar + menu header + size nav) is "current."
  // Walking sections in order and taking the last match handles the case
  // where several tops are already past the threshold.
  useEffect(() => {
    function handleScroll() {
      if (suppressSpyRef.current) return;
      const stickyBottom = sizeNavRef.current?.getBoundingClientRect().bottom ?? 0;
      let current = SIZES[0].key;
      for (const size of SIZES) {
        const el = sectionRefs.current[size.key];
        if (el && el.getBoundingClientRect().top <= stickyBottom + 1) {
          current = size.key;
        }
      }
      setActiveSize(current);
    }
    recomputeActiveRef.current = handleScroll;
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="menu-page">
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
