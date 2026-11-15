import { cookieImageFor } from './cookieImages.js';

// Maps a reward's key (see backend/rewards/catalog.js) to its photo, for the
// Rewards page. Rewards with no photo yet fall back to
// components/ImagePlaceholder.jsx. Two sources, tried in this order:
//   1. a photo of its own in src/reward-images/ (REWARD_KEY_TO_FILENAME) —
//      cut out on a white background, cropped square, about 768px or smaller,
//      saved as JPEG, same as the menu's;
//   2. a menu photo it shares (REWARD_KEY_TO_MENU_PHOTO), named by the
//      product name it's stored under in cookieImages.js — the same file, so
//      it stays in step if that photo is ever replaced.
const images = import.meta.glob('./reward-images/*', { eager: true, import: 'default' });

const REWARD_KEY_TO_FILENAME = {
  'standard-single': 'standard-single.jpg',
  'special-single': 'special-single.jpg',
  'standard-half-dozen': 'standard-half-dozen.jpg',
  'special-half-dozen': 'special-half-dozen.jpg',
  'standard-dozen': 'standard-dozen.jpg',
  'special-dozen': 'special-dozen.jpg',
  'premium-half-dozen': 'premium-half-dozen.jpg',
  'standard-3dozen': 'standard-3dozen.jpg',
  'standard-2dozen': 'standard-2dozen.jpg',
  'special-2dozen': 'special-2dozen.jpg',
  'premium-dozen': 'premium-dozen.jpg',
  'standard-4dozen': 'standard-4dozen.jpg',
  'special-3dozen': 'special-3dozen.jpg',
  'special-4dozen': 'special-4dozen.jpg',
  'premium-2dozen': 'premium-2dozen.jpg',
};

const REWARD_KEY_TO_MENU_PHOTO = {
  'premium-single': 'Oatmeal Cream Pie',
};

export function rewardImageFor(key) {
  const filename = REWARD_KEY_TO_FILENAME[key];
  if (filename) return images[`./reward-images/${filename}`];
  const menuPhoto = REWARD_KEY_TO_MENU_PHOTO[key];
  return menuPhoto ? cookieImageFor(menuPhoto) : undefined;
}
