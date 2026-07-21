const TYPES = {
  standard: {
    prices: { single: 2.50, half_dozen: 9.0, full_dozen: 18.0 },
    flavors: [
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
    ],
  },
  special: {
    prices: { single: 3.50, half_dozen: 15.0, full_dozen: 30.0 },
    flavors: [
      'Lemon',
      'White Chocolate Raspberry',
      'Strawberry Cheesecake',
      'Brownie',
    ],
  },
  premium: {
    prices: { single: 6.0, half_dozen: 30.0, full_dozen: 60.0 },
    flavors: [
      'Strawberry-Blueberry-Cheesecake Sandwich',
      'Oatmeal Cream Pie',
    ],
  },
};

const SIZE_LABELS = {
  single: 'Single',
  half_dozen: 'Half Dozen',
  full_dozen: 'Full Dozen',
};

// These flavors contain dairy/fresh fillings that need refrigeration, so they
// can only be picked up, never shipped.
export const TEMPERATURE_CONTROLLED_FLAVORS = new Set([
  'Strawberry Cheesecake',
  'Strawberry-Blueberry-Cheesecake Sandwich',
  'Oatmeal Cream Pie',
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

    this.is_single = false;
    this.is_half_dozen = false;
    this.is_full_dozen = false;
    if (size === 'single') this.is_single = true;
    else if (size === 'half_dozen') this.is_half_dozen = true;
    else if (size === 'full_dozen') this.is_full_dozen = true;
  }

  // Price depends on both the type and which size flag is set, per the
  // per-type/per-size price table above.
  get price() {
    const prices = TYPES[this.type].prices;
    if (this.is_single) return prices.single;
    if (this.is_half_dozen) return prices.half_dozen;
    if (this.is_full_dozen) return prices.full_dozen;
    return 0;
  }

  get sizeLabel() {
    if (this.is_single) return SIZE_LABELS.single;
    if (this.is_half_dozen) return SIZE_LABELS.half_dozen;
    if (this.is_full_dozen) return SIZE_LABELS.full_dozen;
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
      is_single: this.is_single,
      is_half_dozen: this.is_half_dozen,
      is_full_dozen: this.is_full_dozen,
      price: this.price,
      sizeLabel: this.sizeLabel,
    };
  }
}
