import enjoyingACookie from '../assets/mascot/enjoying_a_cookie.png';
import bakingCookies from '../assets/mascot/baking_cookies.png';
import drinkingHotChocolate from '../assets/mascot/drinking_hot_chocolate.png';
import goingForAStroll from '../assets/mascot/going_for_a_stroll.png';
import roastingMarshmallow from '../assets/mascot/roasting_marshmallow.png';

export const MASCOT_IMAGES = [
  enjoyingACookie,
  bakingCookies,
  drinkingHotChocolate,
  goingForAStroll,
  roastingMarshmallow,
];

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

let deck = shuffle(MASCOT_IMAGES);
let pointer = 0;

// Draws the next mascot pose from a shuffled deck shared across the whole
// app — every pose appears once before any repeats, rather than plain
// per-call randomness (which could show the same pose twice in a row).
export function nextMascotImage() {
  if (pointer >= deck.length) {
    const previousLast = deck[deck.length - 1];
    const reshuffled = shuffle(MASCOT_IMAGES);
    if (reshuffled[0] === previousLast) {
      const swapWith = 1 + Math.floor(Math.random() * (reshuffled.length - 1));
      [reshuffled[0], reshuffled[swapWith]] = [reshuffled[swapWith], reshuffled[0]];
    }
    deck = reshuffled;
    pointer = 0;
  }
  const image = deck[pointer];
  pointer += 1;
  return image;
}
