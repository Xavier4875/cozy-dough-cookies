// Maps a menu item's name (a product's `flavor` — for buckets that's "Cozy
// Dough Bucket", not the chosen flavor) to its photo in src/cookie-images/.
// Names not listed here (anything without a photo yet) fall back to
// components/ImagePlaceholder.jsx. import.meta.glob bundles every file in
// that folder whether or not it's listed below, so seasonal photos can stay
// here between seasons: they cost build size (about 1.4 MB at the moment)
// but nothing at page load, since a photo is only downloaded when shown.
const images = import.meta.glob('./cookie-images/*', { eager: true, import: 'default' });

const FLAVOR_TO_FILENAME = {
  'Chocolate Chip': 'chocolate-chip.jpg',
  'M&M': 'M&M.jpg',
  Monster: 'monster.jpg',
  Butter: 'butter.jpg',
  'Peanut Butter': 'peanut-butter.png',
  Snickerdoodle: 'Snickerdoodle.png',
  Oatmeal: 'oatmeal.jpg',
  'Oatmeal Raisin': 'oatmeal-raisin.png',
  Butterscotch: 'butterscotchies.jpg',
  'Oatmeal Scotchies': 'oatmeal-scotchies.jpg',
  'Strawberry Cheesecake': 'strawberry-cheesecake.jpg',
  Brownie: 'brownie.jpg',
  'Oatmeal Cream Pie': 'oatmeal-cream-pie.png',
  'Cozy Rolls': 'cozy-rolls.jpg',
  // One photo shared by all three Cozy Dough Bucket cards (regular, gluten-free, sugar-free).
  'Cozy Dough Bucket': 'cozy-dough-bucket.jpg',
};

export function cookieImageFor(flavor) {
  const filename = FLAVOR_TO_FILENAME[flavor];
  return filename ? images[`./cookie-images/${filename}`] : undefined;
}
