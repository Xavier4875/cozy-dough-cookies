import { UNITS_PER_SIZE } from '../constants.js';

const STANDARD_FLAVORS = [
  'Chocolate Chip',
  'M&M',
  'Monster',
  'Butter',
  'Peanut Butter',
  'Snickerdoodle',
  'Oatmeal',
  'Oatmeal Raisin',
  'Butterscotch',
  'Oatmeal Scotchies',
];

const SPECIAL_FLAVORS = [
  'Strawberry Cheesecake',
  'Brownie',
];

// Gluten-free/sugar-free batch prices, per dietary-restriction tier (no
// premium tier for either) — same $ regardless of which restriction. A batch
// yields about 29 cookies (UNITS_PER_SIZE.batch), the same for every flavor.
const BATCH_PRICE_STANDARD = 80.0;
const BATCH_PRICE_SPECIAL = 95.0;

const TYPES = {
  standard: {
    prices: { single: 2.0, half_dozen: 12.0, full_dozen: 24.0 },
    flavors: STANDARD_FLAVORS,
    sizes: ['single', 'half_dozen', 'full_dozen'],
  },
  special: {
    prices: { single: 3.0, half_dozen: 18.0, full_dozen: 36.0 },
    flavors: SPECIAL_FLAVORS,
    sizes: ['single', 'half_dozen', 'full_dozen'],
  },
  premium: {
    prices: { single: 7.0, half_dozen: 42.0, full_dozen: 84.0 },
    flavors: ['Oatmeal Cream Pie'],
    sizes: ['single', 'half_dozen', 'full_dozen'],
  },
  // Cozy Rolls: sold only as a set of four, in the menu's own "Cozy Rolls"
  // section (see COOKIE_SIZES in frontend/src/constants.js) — rolls don't fit
  // the single/half/full-dozen sizing. Always needs refrigeration, so it's
  // pickup only.
  cozy_rolls: {
    prices: { cozy_rolls: 32.0 },
    flavors: ['Cozy Rolls'],
    sizes: ['cozy_rolls'],
    temperatureControlled: true,
    // Shows the size next to the name on the menu card: "Cozy Rolls (Set of 4)".
    showSizeOnMenu: true,
    // Shows each card's own price instead of a shared "$X each" tier heading.
    priceOnCard: true,
  },
  // Cozy Dough Bucket: one product per standard flavor (so each flavor is its
  // own cart line / order item with no special cart logic), but the menu
  // shows them as a single "Cozy Dough Bucket" card with a flavor-picker
  // popup — see BucketsGrid.jsx and BucketFlavorModal.jsx. Whole type is
  // temperature-controlled, since that's a property of a bucket rather than of
  // any one flavor.
  //
  // `pickerTitle` is what makes a type display that way: the menu shows one
  // picker card per type that has it, with this text as the card's title,
  // instead of one card per product.
  bucket: {
    prices: { bucket: 55.0 },
    flavors: STANDARD_FLAVORS,
    sizes: ['bucket'],
    temperatureControlled: true,
    pickerTitle: 'Cozy Dough Bucket',
    // Everywhere an item is named ("<flavor> (<size>)" in the cart,
    // receipts, order history, Sales...), a bucket reads as "Cozy Dough
    // Bucket (<its flavor>)" — see `flavor`/`sizeLabel` on Cookie below.
    displayName: 'Cozy Dough Bucket',
    menuSection: 'buckets',
  },
  // Gluten-free / sugar-free Cozy Dough Buckets: identical to the bucket above
  // in every way except price. Their type names start with gluten_free /
  // sugar_free on purpose, so everything keyed off that — the "GF"/"SF"
  // marker next to the name and the 48-hour notice for those orders (see
  // isDietaryRestrictedType) — applies to them automatically. They keep the
  // plain "Cozy Dough Bucket" name; the marker supplies the rest.
  gluten_free_bucket: {
    prices: { bucket: 65.0 },
    flavors: STANDARD_FLAVORS,
    sizes: ['bucket'],
    temperatureControlled: true,
    pickerTitle: 'Gluten-Free Cozy Dough Bucket',
    displayName: 'Cozy Dough Bucket',
    menuSection: 'buckets',
  },
  sugar_free_bucket: {
    prices: { bucket: 65.0 },
    flavors: STANDARD_FLAVORS,
    sizes: ['bucket'],
    temperatureControlled: true,
    pickerTitle: 'Sugar-Free Cozy Dough Bucket',
    displayName: 'Cozy Dough Bucket',
    menuSection: 'buckets',
  },
  // Gluten-free/sugar-free: same flavor lineup as standard/special, no
  // premium tier, and only ever sold as a whole batch. The batch-only `sizes`
  // here is what the PRODUCTS catalog in index.js is built from, and checkout
  // only accepts products that exist in that catalog — so a gluten-free or
  // sugar-free single/half/full dozen can't be ordered even by a hand-crafted
  // request, not just hidden in the UI.
  gluten_free_standard: {
    prices: { batch: BATCH_PRICE_STANDARD },
    flavors: STANDARD_FLAVORS,
    sizes: ['batch'],
  },
  gluten_free_special: {
    prices: { batch: BATCH_PRICE_SPECIAL },
    flavors: SPECIAL_FLAVORS,
    sizes: ['batch'],
  },
  sugar_free_standard: {
    prices: { batch: BATCH_PRICE_STANDARD },
    flavors: STANDARD_FLAVORS,
    sizes: ['batch'],
  },
  sugar_free_special: {
    prices: { batch: BATCH_PRICE_SPECIAL },
    flavors: SPECIAL_FLAVORS,
    sizes: ['batch'],
  },
};

// Used by Order.js's requiresExtendedPickupNotice and by the staff
// confirm-pickup endpoint in index.js (which works off a persisted order
// record, not a live Cookie instance) — one shared definition of "is this
// item gluten-free/sugar-free" for both.
export function isDietaryRestrictedType(type) {
  return type?.startsWith('gluten_free') || type?.startsWith('sugar_free');
}

// Same marker shown on the frontend (menu/cart/checkout — see dietaryMarker
// in frontend/src/constants.js), reused server-side for order-confirmation
// emails (see buildOrderTableHtml/buildOrderTableText in email/format.js).
export function dietaryMarker(type) {
  if (type?.startsWith('gluten_free')) return 'GF';
  if (type?.startsWith('sugar_free')) return 'SF';
  return null;
}

const SIZE_LABELS = {
  single: 'Single',
  half_dozen: 'Half Dozen',
  full_dozen: 'Full Dozen',
  batch: 'Batch',
  cozy_rolls: 'Set of 4',
  // Only a validity key — a bucket's displayed size is its flavor (see the
  // sizeLabel getter), so this text is never shown.
  bucket: 'Bucket',
};

// These flavors contain dairy/fresh fillings that need refrigeration, so they
// can only be picked up, never shipped.
export const TEMPERATURE_CONTROLLED_FLAVORS = new Set([
  'Strawberry Cheesecake',
  'Oatmeal Cream Pie',
]);

export class Cookie {
  static TYPES = TYPES;

  // A product's id is derived from what it *is* (type + flavor + size), never
  // from where it happens to fall in the catalog. A positional counter used to
  // stand in here, which meant adding, removing or reordering any product
  // renumbered everything after it — so a cart or open browser tab holding
  // ids from before a deploy would silently resolve to different products
  // afterward. With this, an id keeps meaning the same product for as long as
  // that product exists (and simply stops resolving if it's removed).
  // URL-safe on purpose: it's used in /api/products/:id/set-sold-out.
  static idFor(type, flavor, size) {
    const slug = flavor
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${type}:${slug}:${size}`;
  }

  constructor(type, flavor, size) {
    const typeInfo = TYPES[type];
    if (!typeInfo) {
      throw new Error(`Unknown cookie type: ${type}`);
    }
    if (!typeInfo.flavors.includes(flavor)) {
      throw new Error(`"${flavor}" is not a valid ${type} flavor.`);
    }
    if (!SIZE_LABELS[size]) {
      throw new Error(`Unknown cookie size: ${size}`);
    }

    this.id = Cookie.idFor(type, flavor, size);
    this.type = type;
    // `flavor` is the item's display name (the real flavor for ordinary
    // cookies); `baseFlavor` always holds the actual flavor, which only
    // differs for buckets — see the bucket type's displayName above.
    this.flavor = typeInfo.displayName ?? flavor;
    this.baseFlavor = flavor;
    // True for all three bucket types. The menu's "Buckets" section then
    // shows only the regular one — the gluten-free/sugar-free buckets are
    // placed on their own tabs, by type name (see menuCategoryOf in
    // frontend/src/constants.js and MenuContent.jsx).
    this.is_in_buckets = typeInfo.menuSection === 'buckets';
    this.is_temperature_controlled =
      TEMPERATURE_CONTROLLED_FLAVORS.has(flavor) || typeInfo.temperatureControlled === true;
    // Staff-toggled via POST /api/products/:id/set-sold-out in index.js —
    // lives only on this in-memory catalog entry, so it resets to false
    // whenever the backend restarts.
    this.is_sold_out = false;

    this.is_single = false;
    this.is_half_dozen = false;
    this.is_full_dozen = false;
    this.is_batch = false;
    this.is_bucket = false;
    this.is_cozy_rolls = false;
    this.showSizeOnMenu = typeInfo.showSizeOnMenu === true;
    // How the menu draws this product (see the type definitions above): a
    // price on its own card, and/or grouped into a flavor-picker card.
    this.priceOnCard = typeInfo.priceOnCard === true;
    this.pickerTitle = typeInfo.pickerTitle ?? null;
    if (size === 'single') this.is_single = true;
    else if (size === 'half_dozen') this.is_half_dozen = true;
    else if (size === 'full_dozen') this.is_full_dozen = true;
    else if (size === 'batch') {
      this.is_batch = true;
      // Bypasses Order.js's is_single/half/full-dozen fallback chain
      // entirely — see physicalCookieCount's `physicalCookieUnits !==
      // undefined` check there (the same mechanism reward bundles use).
      this.physicalCookieUnits = UNITS_PER_SIZE.batch;
    } else if (size === 'cozy_rolls') {
      // No physicalCookieUnits: a set of rolls is its own item, not
      // individual cookies, so it stays out of every cookie-count tally.
      this.is_cozy_rolls = true;
    } else if (size === 'bucket') {
      // Deliberately no physicalCookieUnits: a bucket is its own item, not
      // individual cookies, so it stays out of every cookie-count tally
      // (shipping box size — moot, it's pickup-only — and the Sales page's
      // cookies-per-flavor ranking). It still counts normally as an item.
      this.is_bucket = true;
    }
  }

  // Price depends on both the type and which size flag is set, per the
  // per-type/per-size price table above.
  get price() {
    const prices = TYPES[this.type].prices;
    if (this.is_single) return prices.single;
    if (this.is_half_dozen) return prices.half_dozen;
    if (this.is_full_dozen) return prices.full_dozen;
    if (this.is_batch) return prices.batch;
    if (this.is_bucket) return prices.bucket;
    if (this.is_cozy_rolls) return prices.cozy_rolls;
    return 0;
  }

  get sizeLabel() {
    if (this.is_single) return SIZE_LABELS.single;
    if (this.is_half_dozen) return SIZE_LABELS.half_dozen;
    if (this.is_full_dozen) return SIZE_LABELS.full_dozen;
    if (this.is_batch) return SIZE_LABELS.batch;
    // A bucket's "size" detail is its flavor, so it reads "Cozy Dough Bucket
    // (Monster)" wherever flavor + sizeLabel are shown together.
    if (this.is_bucket) return this.baseFlavor;
    if (this.is_cozy_rolls) return SIZE_LABELS.cozy_rolls;
    return null;
  }

  // price/sizeLabel are getters (not own properties), so without this they'd
  // be dropped by JSON.stringify/res.json.
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      flavor: this.flavor,
      baseFlavor: this.baseFlavor,
      is_temperature_controlled: this.is_temperature_controlled,
      is_sold_out: this.is_sold_out,
      is_single: this.is_single,
      is_half_dozen: this.is_half_dozen,
      is_full_dozen: this.is_full_dozen,
      is_batch: this.is_batch,
      is_bucket: this.is_bucket,
      is_cozy_rolls: this.is_cozy_rolls,
      menuSizeNote: this.showSizeOnMenu ? this.sizeLabel : null,
      priceOnCard: this.priceOnCard,
      pickerTitle: this.pickerTitle,
      is_in_buckets: this.is_in_buckets,
      physicalCookieUnits: this.physicalCookieUnits,
      price: this.price,
      sizeLabel: this.sizeLabel,
    };
  }
}
