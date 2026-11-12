/**
 * lib/ratelimit.js — Best-effort per-IP token bucket for serverless functions.
 *
 * Serverless instances do not share memory, so this is per-instance
 * protection against casual abuse and cost amplification — not a
 * distributed rate limiter. Documented limitation, not a claim.
 *
 * Each limiter owns its bucket map: endpoints with different capacities
 * and quotas (general traffic vs. the paid evaluation quota vs.
 * checkout) must never drain one another's allowance for the same IP.
 *
 * CLIENT-IP RULE (Carbon Pass 1, finding 15): `x-forwarded-for` is
 * client-controlled — its leftmost entry is whatever the sender wrote,
 * so trusting it lets any caller rotate identities at will. On Vercel
 * the edge sets `x-vercel-forwarded-for` to the connecting client IP;
 * prefer that. Otherwise take the RIGHTMOST `x-forwarded-for` entry:
 * each proxy appends the address it saw, so the last entry is the one
 * appended by the proxy nearest this server (the Vercel edge), not the
 * sender's spoofed first entry.
 *
 * MEMORY BOUND: the bucket map is capped at MAX_BUCKETS keys. When a
 * new key arrives at the cap, expired buckets are swept first; if the
 * map is still full the oldest bucket is evicted (Map insertion order).
 * Without this, spoofed IPs could grow the map without bound on a
 * warm instance.
 */

export const MAX_BUCKETS = 5000;

export function createLimiter({ capacity = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const buckets = new Map();
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
          if (!b) {
            // New key: enforce the memory bound before inserting.
            if (buckets.size >= MAX_BUCKETS) {
              for (const [k, v] of buckets) {
                if (now >= v.resetAt) buckets.delete(k);
              }
              if (buckets.size >= MAX_BUCKETS) {
                const oldest = buckets.keys().next().value;
                if (oldest !== undefined) buckets.delete(oldest);
              }
            }
          }
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
    /** Test hook: current bucket count. */
    _size() { return buckets.size; },
  };
}

export function clientIp(req) {
  const headers = (req && req.headers) || {};
  // Vercel edge header: set by the platform, not by the client.
  const vercelFwd = headers['x-vercel-forwarded-for'];
  if (typeof vercelFwd === 'string' && vercelFwd.length > 0) {
    return vercelFwd.split(',')[0].trim() || 'unknown';
  }
  // Otherwise the rightmost hop: the entry appended by the proxy
  // nearest this server. The leftmost entry is sender-controlled.
  const fwd = headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
