// api/recover.js — Buyer token recovery via email (Phase 2, D1).
//
// A buyer who lost their access token submits the email used at purchase.
// The server looks up the recovery identity (email SHA-256 hash only),
// invalidates the old token, and returns a fresh one. The token travels
// in a POST body (never a URL) to keep it out of logs.
//
// Rate-limited: token guessing is throttled per source IP.
// Delivery of the token to the buyer's email is stubbed
// (see _lib/recoveryDelivery.js) until a provider is wired — the token
// is returned in the response so the client can store it immediately.
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
  // Attempt delivery (stubbed until a provider is wired); the client
  // stores the token from this response regardless.
  try { await deliverRecoveryToken({ email, token: result.token }); } catch { /* stub */ }
  return res.status(200).json({ ok: true, token: result.token });
}

export default withDurableStore(handler);
