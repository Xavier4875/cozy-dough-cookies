import { addRewardsPoints } from '../db/customersRepo.js';

// In-memory only, lost on restart — same tradeoff as shipping/retryQueue.js.
// Earning points is a best-effort perk that must never block or fail the
// order itself, but a transient DynamoDB write failure shouldn't just be
// silently dropped forever either: this gives it a few automatic follow-up
// attempts, spaced out, before finally giving up.
const RETRY_DELAY_MS = 5000;
const MAX_ATTEMPTS = 5;

// `onGiveUp` runs if every attempt fails, so the caller can undo any record it
// made of points that, in the end, were never awarded (see /api/checkout, which
// notes each order's share of the points on the order itself).
export function enqueue(customerId, points, onGiveUp, attempt = 1) {
  setTimeout(() => attemptEarn(customerId, points, onGiveUp, attempt), RETRY_DELAY_MS);
}

async function attemptEarn(customerId, points, onGiveUp, attempt) {
  try {
    await addRewardsPoints(customerId, points);
  } catch (err) {
    console.error(`Retry ${attempt}/${MAX_ATTEMPTS} failed to award ${points} rewards points to ${customerId}:`, err);
    if (attempt < MAX_ATTEMPTS) {
      enqueue(customerId, points, onGiveUp, attempt + 1);
    } else {
      console.error(`Giving up awarding ${points} rewards points to ${customerId} after ${MAX_ATTEMPTS} attempts.`);
      try {
        await onGiveUp?.();
      } catch (cleanupErr) {
        console.error('Cleanup after giving up on awarding points also failed:', cleanupErr);
      }
    }
  }
}
