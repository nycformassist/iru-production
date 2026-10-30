/**
 * lib/paymentConfig.js — Fail-closed payment configuration.
 *
 * Rules (payment-hardening directive 2026-10-24):
 * - IRU_APP_ORIGIN has NO localhost fallback. An unset, malformed, or
 *   credential-bearing origin fails closed; a loopback origin is allowed
 *   only with the explicit IRU_ALLOW_LOCAL_ORIGIN=true opt-in (local
 *   dev/test). The origin is used only to build Stripe redirect URLs,
 *   so it is validated at the Stripe-call boundary, not at import time.
 * - Paywall flags must not disagree silently. The client declares the
 *   flag its build was compiled with (VITE_PAYWALL_ENABLED) on paid-path
 *   requests; the server compares it to PAYWALL_ENABLED and refuses
 *   (503) on mismatch. A request that does not declare a flag is
 *   allowed through — old clients cannot be detected — and that
 *   limitation is documented, not hidden. Client and server are
 *   redeployed together, so current builds always declare.
 */

export function serverPaywallOn(env = process.env) {
  return env.PAYWALL_ENABLED === 'true';
}

/**
 * Returns { ok: true, unknown?: true } or { ok: false, reason }.
 * `unknown: true` means the client did not declare a flag (old build).
 */
export function checkPaywallAgreement(body, env = process.env) {
  const client = body && typeof body.paywallClientEnabled === 'boolean'
    ? body.paywallClientEnabled
    : null;
  if (client === null) return { ok: true, unknown: true };
  if (client !== serverPaywallOn(env)) return { ok: false, reason: 'paywall-mismatch' };
  return { ok: true };
}

/** Returns { ok: true, origin } or { ok: false, reason }. */
export function resolveAppOrigin(env = process.env) {
  // Prefer explicit IRU_APP_ORIGIN; fall back to Vercel's automatic VERCEL_URL
  // (present on every deployment) so Preview doesn't need manual updates.
  const raw = env.IRU_APP_ORIGIN || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '');
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'missing-origin' };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed-origin' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsafe-origin-scheme' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'origin-with-credentials' };
  }
  if (!url.hostname) return { ok: false, reason: 'malformed-origin' };
  const host = url.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  if (isLocal && env.IRU_ALLOW_LOCAL_ORIGIN !== 'true') {
    return { ok: false, reason: 'localhost-origin-not-allowed' };
  }
  // Normalized origin only — no path, query, or fragment leaks into Stripe URLs.
  return { ok: true, origin: `${url.protocol}//${url.host}` };
}
