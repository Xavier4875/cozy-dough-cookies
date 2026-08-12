// Maps each cookie flavor to its photo in src/cookie-images/. Flavors not
// listed here (currently Oatmeal and White Chocolate Raspberry — no file was
// provided for either) fall back to CookieGrid's ImagePlaceholder.
const images = import.meta.glob('./cookie-images/*', { eager: true, import: 'default' });

const FLAVOR_TO_FILENAME = {
  'Chocolate Chip': 'chocolate-chip.jpg',
  'M&M': 'M&M.jpg',
  Monster: 'monster.jpg',
  Butter: 'butter.jpg',
  'Peanut Butter': 'peanut-butter.png',
  Snickerdoodle: 'Snickerdoodle.png',
  'Oatmeal Raisin': 'oatmeal-raisin.png',
  Butterscotch: 'butterscotchies.png',
  'Oatmeal Scotchies': 'oatmeal-scotchies.png',
  Lemon: 'lemon.png',
  'Strawberry Cheesecake': 'strawberry-cheesecake.png',
  Brownie: 'brownie.jpg',
  'Strawberry-Blueberry-Cheesecake Sandwich': 'strawberry-blueberry-cheesecake.png',
  'Oatmeal Cream Pie': 'oatmeal-cream-pie.png',
  'Chocolate Chip Ice Cream Sandwich': 'chocolate-chip-ice-cream-sandwich.png',
  'M&M Ice Cream Sandwich': 'M&M-ice-cream-sandwich.png',
  'Brownie Ice Cream Sandwich': 'brownie-ice-cream-sandwich.jpg',
};

export function cookieImageFor(flavor) {
  const filename = FLAVOR_TO_FILENAME[flavor];
  return filename ? images[`./cookie-images/${filename}`] : undefined;
}
