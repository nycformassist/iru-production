// api/recover.js — Buyer token recovery via email (Phase 2, D1).
//
// DISABLED until email delivery is wired (Carbon Pass 1, finding 14):
// returning a freshly minted bearer token in the response of an
// unauthenticated email lookup lets anyone who knows a buyer's email
// hijack their paid entitlement and lock the buyer out. This endpoint
// therefore returns 503 'recovery-unavailable' unless BOTH conditions
// hold: (a) an email provider is wired in lib/recoveryDelivery.js
// (today it is a stub that always reports 'not-configured'), and
// (b) the owner explicitly enables it with IRU_RECOVERY_EMAIL_ENABLED
// ='true'. When enabled, the token is delivered ONLY by email — it is
// never returned in the HTTP response. If delivery fails after a token
// is reissued, the previous token is restored, so a failed delivery
// never locks the buyer out. No token is minted, invalidated,
// or looked up while the endpoint is gated.
//
// Commerce/case separation: this endpoint touches commerce records only.
// It never reads or writes immigration case data.

import { entitlementStore } from './_lib/entitlement.js';
import { withDurableStore } from './_lib/withStore.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { assertPaidStoreAvailable } from './_lib/paymentStore.js';
import { deliverRecoveryToken } from './_lib/recoveryDelivery.js';

const limiter = createLimiter({ capacity: 5, windowMs: 15 * 60 * 1000 });

export async function handler(req, res, store = entitlementStore) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  const storeGate = assertPaidStoreAvailable();
  if (!storeGate.ok) {
    return res.status(503).json({ error: 'Recovery is not configured.' });
  }
  // Recovery is unavailable until email delivery is wired AND
  // explicitly enabled. Never mint, invalidate, or return a token
  // from an unauthenticated email lookup (finding 14).
  if (process.env.IRU_RECOVERY_EMAIL_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Recovery is unavailable.', reason: 'recovery-unavailable' });
  }
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  const result = store.reissueToken({ email });
  if (!result.ok) {
    // Do not distinguish "unknown email" from "not paid" — same response,
    // so an attacker cannot enumerate purchases by email.
    return res.status(404).json({ error: 'No purchase found for that email.' });
  }
  // Deliver the token by email ONLY. It is never returned in the
  // response: an unauthenticated caller must not receive a bearer
  // token for an email address they merely typed in.
  // If delivery fails, the reissue is rolled back first: the new
  // token never reached the buyer, so the token they already hold
  // must keep working. Without the rollback, one POST from anyone
  // who knows a buyer's email would lock the buyer out.
  try {
    const delivered = await deliverRecoveryToken({ email, token: result.token });
    if (!delivered || delivered.ok !== true) {
      restorePreviousToken(store, result);
      return res.status(503).json({ error: 'Recovery is unavailable.', reason: 'recovery-unavailable' });
    }
  } catch {
    restorePreviousToken(store, result);
    return res.status(503).json({ error: 'Recovery is unavailable.', reason: 'recovery-unavailable' });
  }
  return res.status(200).json({ ok: true, delivered: true });
}

// Best-effort rollback of a reissue whose delivery failed: re-point
// the entitlement at the token the buyer already holds. A restore
// failure must not change the 503 response — the buyer keeps the new
// (undelivered) token state only if the store itself cannot restore,
// which is a store defect, not a delivery outcome.
function restorePreviousToken(store, result) {
  try {
    if (result && result.entitlementId && result.previousTokenHash
      && store && typeof store.restoreToken === 'function') {
      store.restoreToken({ entitlementId: result.entitlementId, tokenHash: result.previousTokenHash });
    }
  } catch {
    // Restore is best-effort; the 503 below stands either way.
  }
}

export default withDurableStore(handler);
