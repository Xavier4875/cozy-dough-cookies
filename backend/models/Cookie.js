const TYPES = {
  standard: {
    price: 2.0,
    flavors: [
      'Chocolate Chip',
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
    price: 3.0,
    flavors: [
      'Lemon',
      'White Chocolate Raspberry',
      'Strawberry Cheesecake',
      'Brownie',
    ],
  },
  premium: {
    price: 6.0,
    flavors: [
      'Strawberry-Blueberry-Cheesecake Sandwich',
      'Oatmeal Cream Pie',
    ],
  },
};

export class Cookie {
  static TYPES = TYPES;

  static #nextId = 1;

  constructor(type, flavor) {
    const typeInfo = TYPES[type];
    if (!typeInfo) {
      throw new Error(`Unknown cookie type: ${type}`);
    }
    if (!typeInfo.flavors.includes(flavor)) {
      throw new Error(`"${flavor}" is not a valid ${type} flavor.`);
    }

    this.id = String(Cookie.#nextId++);
    this.type = type;
    this.flavor = flavor;
    this.price = typeInfo.price;
  }
}
