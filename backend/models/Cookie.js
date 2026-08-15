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
  'Lemon',
  'Strawberry Cheesecake',
  'Brownie',
];

// Gluten-free/sugar-free batch prices, per dietary-restriction tier (no
// premium tier for either) — same $ regardless of which restriction.
const BATCH_PRICE_STANDARD = 45.0;
const BATCH_PRICE_SPECIAL = 90.0;

// Exception: gluten-free/sugar-free Brownie batches only yield 19 cookies
// (not the usual 24), so they're priced and weighted differently — see
// `flavorOverrides` below and the constructor's flavorOverrides lookup.
const BROWNIE_BATCH_PRICE = 76.0;
const BROWNIE_BATCH_UNITS = 19;
const BROWNIE_BATCH_NOTE = 'This batch yields 19 cookies instead of 24, so it’s priced accordingly.';
const BROWNIE_BATCH_OVERRIDE = {
  price: BROWNIE_BATCH_PRICE,
  physicalCookieUnits: BROWNIE_BATCH_UNITS,
  note: BROWNIE_BATCH_NOTE,
};

const TYPES = {
  standard: {
    prices: { single: 2.50, half_dozen: 9.0, full_dozen: 18.0 },
    flavors: STANDARD_FLAVORS,
    sizes: ['single', 'half_dozen', 'full_dozen'],
  },
  special: {
    prices: { single: 3.50, half_dozen: 15.0, full_dozen: 30.0 },
    flavors: SPECIAL_FLAVORS,
    sizes: ['single', 'half_dozen', 'full_dozen'],
  },
  premium: {
    prices: { single: 6.0, half_dozen: 30.0, full_dozen: 60.0 },
    flavors: [
      'Strawberry-Blueberry-Cheesecake Sandwich',
      'Oatmeal Cream Pie',
      'Chocolate Chip Ice Cream Sandwich',
      'M&M Ice Cream Sandwich',
      'Brownie Ice Cream Sandwich',
    ],
    sizes: ['single', 'half_dozen', 'full_dozen'],
  },
  // Gluten-free/sugar-free: same flavor lineup as standard/special, no
  // premium tier, and only ever sold in a fixed 2-dozen batch — the
  // batch-only `prices`/`sizes` here is what makes a single/half/full-dozen
  // gluten-free or sugar-free cookie impossible to construct at all (see
  // Cookie's SIZE_LABELS validation below), rather than just a UI-level
  // restriction.
  gluten_free_standard: {
    prices: { batch: BATCH_PRICE_STANDARD },
    flavors: STANDARD_FLAVORS,
    sizes: ['batch'],
  },
  gluten_free_special: {
    prices: { batch: BATCH_PRICE_SPECIAL },
    flavors: SPECIAL_FLAVORS,
    sizes: ['batch'],
    flavorOverrides: { Brownie: BROWNIE_BATCH_OVERRIDE },
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
    flavorOverrides: { Brownie: BROWNIE_BATCH_OVERRIDE },
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
};

// These flavors contain dairy/fresh fillings that need refrigeration, so they
// can only be picked up, never shipped.
export const TEMPERATURE_CONTROLLED_FLAVORS = new Set([
  'Strawberry Cheesecake',
  'Strawberry-Blueberry-Cheesecake Sandwich',
  'Oatmeal Cream Pie',
  'Chocolate Chip Ice Cream Sandwich',
  'M&M Ice Cream Sandwich',
  'Brownie Ice Cream Sandwich'
]);

export class Cookie {
  static TYPES = TYPES;

  static #nextId = 1;

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

    this.id = String(Cookie.#nextId++);
    this.type = type;
    this.flavor = flavor;
    this.is_temperature_controlled = TEMPERATURE_CONTROLLED_FLAVORS.has(flavor);
    // Staff-toggled via POST /api/products/:id/set-sold-out in index.js —
    // in-memory only, same as the rest of this stubbed PRODUCTS catalog.
    this.is_sold_out = false;

    // A handful of flavors are priced/weighed differently than the rest of
    // their type (currently just gluten-free/sugar-free Brownie, which
    // yields fewer cookies per batch) — looked up once here and reused by
    // the price getter and the physicalCookieUnits assignment below, rather
    // than re-deriving it in both places.
    const override = typeInfo.flavorOverrides?.[flavor];

    this.is_single = false;
    this.is_half_dozen = false;
    this.is_full_dozen = false;
    this.is_batch = false;
    if (size === 'single') this.is_single = true;
    else if (size === 'half_dozen') this.is_half_dozen = true;
    else if (size === 'full_dozen') this.is_full_dozen = true;
    else if (size === 'batch') {
      this.is_batch = true;
      // Bypasses Order.js's is_single/half/full-dozen fallback chain
      // entirely — see physicalCookieCount's `physicalCookieUnits !==
      // undefined` check there (the same mechanism reward bundles use).
      this.physicalCookieUnits = override?.physicalCookieUnits ?? UNITS_PER_SIZE.batch;
      this.batchNote = override?.note ?? null;
    }
  }

  // Price depends on both the type and which size flag is set, per the
  // per-type/per-size price table above — unless this flavor has its own
  // override (see flavorOverrides), which wins regardless of size.
  get price() {
    const typeInfo = TYPES[this.type];
    const overridePrice = typeInfo.flavorOverrides?.[this.flavor]?.price;
    if (overridePrice !== undefined) return overridePrice;
    const prices = typeInfo.prices;
    if (this.is_single) return prices.single;
    if (this.is_half_dozen) return prices.half_dozen;
    if (this.is_full_dozen) return prices.full_dozen;
    if (this.is_batch) return prices.batch;
    return 0;
  }

  get sizeLabel() {
    if (this.is_single) return SIZE_LABELS.single;
    if (this.is_half_dozen) return SIZE_LABELS.half_dozen;
    if (this.is_full_dozen) return SIZE_LABELS.full_dozen;
    if (this.is_batch) return SIZE_LABELS.batch;
    return null;
  }

  // price/sizeLabel are getters (not own properties), so without this they'd
  // be dropped by JSON.stringify/res.json.
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      flavor: this.flavor,
      is_temperature_controlled: this.is_temperature_controlled,
      is_sold_out: this.is_sold_out,
      is_single: this.is_single,
      is_half_dozen: this.is_half_dozen,
      is_full_dozen: this.is_full_dozen,
      is_batch: this.is_batch,
      physicalCookieUnits: this.physicalCookieUnits,
      batchNote: this.batchNote,
      price: this.price,
      sizeLabel: this.sizeLabel,
    };
  }
}
