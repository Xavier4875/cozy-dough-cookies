import { useState } from 'react';
import ImagePlaceholder from './ImagePlaceholder.jsx';
import BucketFlavorModal from './BucketFlavorModal.jsx';
import { cookieImageFor } from '../cookieImages.js';
import './CookieGrid.css';

// One card for a flavor-picker group of products — today that's the Cozy Dough
// Buckets (regular, gluten-free and sugar-free), which are identical apart
// from name and price. Each is backed by one bucket product per standard
// flavor (see the bucket types in backend/models/Cookie.js), but those are
// never listed individually: adding one opens a flavor picker, and only a
// confirmed choice adds that flavor's product to the cart. Closing the picker
// any other way adds nothing.
function CozyDoughBucketCard({ title, bucketProducts, addCookieToActiveOrder, qtyInActiveOrder }) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const allSoldOut = bucketProducts.every((p) => p.is_sold_out);
  const inOrder = bucketProducts.reduce((sum, p) => sum + qtyInActiveOrder(p.id), 0);
  // A product's `flavor` is its display name — "Cozy Dough Bucket" for every
  // bucket type — which is also the key its photo is stored under.
  const imageSrc = cookieImageFor(bucketProducts[0].flavor);

  function handleConfirm(product) {
    addCookieToActiveOrder(product);
    setIsPickerOpen(false);
  }

  return (
    <div className={'cookie-card' + (allSoldOut ? ' cookie-card--sold-out' : '')}>
      <div className="cookie-card-body">
        {allSoldOut && <p className="cookie-sold-out-badge">Sold Out</p>}
        {imageSrc ? (
          <img src={imageSrc} alt={title} className="cookie-image" style={{ aspectRatio: '1 / 1' }} />
        ) : (
          <ImagePlaceholder label={title} aspectRatio="1 / 1" />
        )}
        <p className="cookie-flavor">{title}</p>
        <p className="cookie-price">${bucketProducts[0].price.toFixed(2)}</p>
        <p className="cookie-temp-note">Temperature Controlled: Pickup Required</p>
        {inOrder > 0 && <p className="cookie-description">In this order: {inOrder}</p>}
        <button
          type="button"
          className="add-btn bucket-add-btn"
          onClick={() => setIsPickerOpen(true)}
          disabled={allSoldOut}
          aria-label={`Add a ${title}`}
        >
          + Add
        </button>
      </div>
      <BucketFlavorModal
        isOpen={isPickerOpen}
        title={title}
        options={bucketProducts}
        onCancel={() => setIsPickerOpen(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

// The picker cards among `products`: every product type that declares a
// `pickerTitle` (see backend/models/Cookie.js) becomes one card titled with
// it, grouping that type's products behind the flavor picker. Products
// without a pickerTitle are ignored here — CookieGrid draws those — and
// nothing renders at all if there are no picker products. `heading` is an
// optional title over the cards: the Regular menu's Buckets section already
// has its own title so passes none, while the Gluten-Free/Sugar-Free tabs
// pass one.
function FlavorPickerCards({ products, heading, addCookieToActiveOrder, qtyInActiveOrder }) {
  const groups = [];
  for (const product of products) {
    if (!product.pickerTitle) continue;
    let group = groups.find((g) => g.type === product.type);
    if (!group) {
      group = { type: product.type, title: product.pickerTitle, products: [] };
      groups.push(group);
    }
    group.products.push(product);
  }
  if (groups.length === 0) return null;

  return (
    <section className="product-section product-section--bucket">
      {heading && <h3 className="product-section-title">{heading}</h3>}
      <div className="cookie-grid">
        {groups.map((group) => (
          <CozyDoughBucketCard
            key={group.type}
            title={group.title}
            bucketProducts={group.products}
            addCookieToActiveOrder={addCookieToActiveOrder}
            qtyInActiveOrder={qtyInActiveOrder}
          />
        ))}
      </div>
    </section>
  );
}

export default FlavorPickerCards;
