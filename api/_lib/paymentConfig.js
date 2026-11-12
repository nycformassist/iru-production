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
 * Stripe secret-key retrieval + live-key guard (Carbon Pass 1,
 * finding 18). Every paid-path endpoint must use this — never read
 * the Stripe env vars or check a key prefix inline, or the guards
 * drift apart again (checkout blocked `sk_live`/`rk_live` while
 * verify-session only blocked `sk_live_` and read a key checkout
 * ignored). Source order is fixed: IRU_STRIPE_KEY first, then
 * STRIPE_SECRET_KEY. This build is test-mode only: any live key
 * (standard `sk_live*` or restricted `rk_live*`) is refused.
 */
export function getStripeSecretKey(env = process.env) {
  return env.IRU_STRIPE_KEY || env.STRIPE_SECRET_KEY || '';
}

export function isLiveStripeKey(key) {
  return typeof key === 'string'
    && (key.startsWith('sk_live') || key.startsWith('rk_live'));
}

/**
 * Returns { ok: true, secretKey } for a usable test-mode key, or
 * { ok: false, reason } where reason is 'missing-key' or
 * 'live-key-refused'. Callers map the failure to their own status
 * code/message; the guard itself is identical everywhere.
 */
export function getTestStripeSecretKey(env = process.env) {
  const secretKey = getStripeSecretKey(env);
  if (!secretKey) return { ok: false, reason: 'missing-key' };
  if (isLiveStripeKey(secretKey)) return { ok: false, reason: 'live-key-refused' };
  return { ok: true, secretKey };
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

/**
 * Defense-in-depth cross-checks of a Stripe checkout session against
 * the persisted entitlement record (moved here from api/webhook.js,
 * Carbon Pass 2, finding M-7, so /api/verify-session runs the identical
 * checks before granting instead of only the webhook doing so). Only
 * fields Stripe actually sent are checked — an absent field is not a
 * mismatch (older payload shapes). Returns null when everything
 * present matches, else a mismatch object for adjudicateMismatch().
 */
export function checkSessionAgainstRecord(session, record) {
  if (session.amount_total !== undefined && session.amount_total !== null
    && Number(session.amount_total) !== record.amountCents) {
    return { type: 'amount-mismatch', reason: 'amount-mismatch', amountCents: Number(session.amount_total), currency: session.currency || null, details: { expectedCents: record.amountCents } };
  }
  if (session.currency !== undefined && session.currency !== null
    && String(session.currency).toLowerCase() !== String(record.currency || 'usd').toLowerCase()) {
    return { type: 'currency-mismatch', reason: 'currency-mismatch', amountCents: session.amount_total ?? null, currency: session.currency, details: { expectedCurrency: record.currency } };
  }
  const metaId = session.metadata && session.metadata.entitlementId;
  if (metaId !== undefined && metaId !== null && metaId !== record.id) {
    return { type: 'session-identity-mismatch', reason: 'session-identity-mismatch', details: { field: 'metadata.entitlementId' } };
  }
  if (session.client_reference_id !== undefined && session.client_reference_id !== null
    && session.client_reference_id !== record.id) {
    return { type: 'session-identity-mismatch', reason: 'session-identity-mismatch', details: { field: 'client_reference_id' } };
  }
  return null;
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
