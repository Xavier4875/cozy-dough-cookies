import { envNumber } from './usps.js';
import { IP_RATE_LIMIT_MAX_CALLS_DEFAULT, IP_RATE_LIMIT_WINDOW_MS_DEFAULT } from '../constants.js';

// Per-IP spam protection for the shipping checkout path specifically. This
// is deliberately different from usps.js's global quota limiter: that one
// stays non-blocking (a shared resource shouldn't punish innocent customers
// when it runs low), but a single IP hammering this endpoint should actually
// be turned away — that's the whole point of spam protection.
const WINDOW_MS = envNumber('IP_RATE_LIMIT_WINDOW_MS', IP_RATE_LIMIT_WINDOW_MS_DEFAULT);
const MAX_CALLS = envNumber('IP_RATE_LIMIT_MAX_CALLS', IP_RATE_LIMIT_MAX_CALLS_DEFAULT);
// How often to sweep out stale entries, so an IP that never comes back
// doesn't sit in memory forever over a long-running process's lifetime.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const requestsByIp = new Map(); // ip -> { count, windowStart }

export function checkIpRateLimit(ip) {
  const now = Date.now();
  const entry = requestsByIp.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    requestsByIp.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MAX_CALLS) return false;
  entry.count++;
  return true;
}

// unref() so this timer alone never keeps the process alive (e.g. in a
// short-lived script or test run).
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestsByIp) {
    if (now - entry.windowStart >= WINDOW_MS) requestsByIp.delete(ip);
  }
}, SWEEP_INTERVAL_MS).unref();
