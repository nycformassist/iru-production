/**
 * lib/ratelimit.js — Best-effort per-IP token bucket for serverless functions.
 *
 * Serverless instances do not share memory, so this is per-instance
 * protection against casual abuse and cost amplification — not a
 * distributed rate limiter. Documented limitation, not a claim.
 */

const buckets = new Map();

export function createLimiter({ capacity = 10, windowMs = 10 * 60 * 1000 } = {}) {
  return {
    capacity,
    windowMs,
    /**
     * Returns { allowed, retryAfterMs }. Never throws.
     */
    check(key) {
      try {
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || now >= b.resetAt) {
          b = { tokens: capacity, resetAt: now + windowMs };
          buckets.set(key, b);
        }
        if (b.tokens > 0) {
          b.tokens -= 1;
          return { allowed: true, retryAfterMs: 0 };
        }
        return { allowed: false, retryAfterMs: Math.max(0, b.resetAt - now) };
      } catch {
        // Fail open on limiter errors — never block legitimate traffic
        // because the limiter itself broke.
        return { allowed: true, retryAfterMs: 0 };
      }
    },
    /** Test hook: clear all buckets. */
    _reset() { buckets.clear(); },
  };
}

export function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
