import { validateAddress, getRateLimitResetAt } from './usps.js';
import { updateOrderFulfillment } from '../db/ordersRepo.js';

// In-memory only — matches the OAuth token cache in usps.js. If the backend
// restarts before a queued retry fires, that retry is lost silently and the
// order just stays addressVerified: false permanently (same end state as
// today's "couldn't check it" case, just without the automatic follow-up).
// Acceptable for a single-process, low-volume shop.
let pending = []; // [{ orderIds: string[], address }]
let timerArmed = false;

// One entry can cover multiple orderIds because a single "checkout all"
// call can persist several orders sharing the same shipping address —
// retrying once and updating every affected order avoids burning multiple
// quota slots re-checking an identical address.
export function enqueue(orderIds, address) {
  pending.push({ orderIds, address });
  armTimer();
}

// Never more than one timer armed at once: every failure queued during the
// current window shares the same reset time, so new arrivals just append to
// `pending` without needing to re-schedule.
function armTimer() {
  if (timerArmed) return;
  timerArmed = true;
  setTimeout(processQueue, Math.max(getRateLimitResetAt() - Date.now(), 0));
}

async function processQueue() {
  timerArmed = false;
  const batch = pending;
  pending = [];
  for (const { orderIds, address } of batch) {
    const result = await validateAddress(address);
    if (result.verified === true) {
      for (const orderId of orderIds) {
        try {
          await updateOrderFulfillment(orderId, {
            method: 'shipping',
            shippingAddress: result.standardized,
            addressVerified: true,
          });
        } catch (err) {
          console.error(`Failed to update order ${orderId} after address re-verification:`, err);
        }
      }
    } else if (result.reason !== 'rejected') {
      // Still rate-limited, or USPS is still unreachable/erroring — retry
      // again next window. Only a definitive 'rejected' gives up for good;
      // there's no bounded retry limit otherwise (see plan's scope notes).
      pending.push({ orderIds, address });
    }
  }
  if (pending.length > 0) armTimer();
}
