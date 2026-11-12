// api/verify-session.js — Standard Stripe return verification (hybrid).
//
// The client returns from Stripe with ?checkout=success&session_id=cs_xxx.
// This endpoint asks Stripe directly whether that session is paid. If so,
// it marks the pre-created entitlement paid via the store's native flow
// (same as the webhook) and returns the entitlement details.
//
// Why this exists: the webhook marks entitlements paid asynchronously, and
// the buyer often returns before it runs. Instead of polling or depending
// on localStorage, the server verifies authoritatively with Stripe.

import { entitlementStore } from './_lib/entitlement.js';
import { withDurableStore } from './_lib/withStore.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { assertPaidStoreAvailable } from './_lib/paymentStore.js';
import { getTestStripeSecretKey, checkSessionAgainstRecord } from './_lib/paymentConfig.js';

const limiter = createLimiter({ capacity: 10, windowMs: 10 * 60 * 1000 });

async function stripeGetSession(secretKey, sessionId) {
  const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!resp.ok) return null;
  return resp.json().catch(() => null);
}

async function handler(req, res, store = entitlementStore) {
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
    return res.status(503).json({ error: 'Verification is not configured.' });
  }
  // Centralized Stripe key guard (lib/paymentConfig.js): identical
  // retrieval + live-key rejection as checkout.js (blocks sk_live*
  // AND rk_live*; falls back to STRIPE_SECRET_KEY the same way).
  // Test-mode only — a live or missing key means "not configured".
  const keyGate = getTestStripeSecretKey();
  if (!keyGate.ok) {
    return res.status(503).json({ error: 'Verification is not configured.' });
  }
  const secretKey = keyGate.secretKey;
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'Invalid session.' });
  }

  // Ask Stripe directly — authoritative, no webhook race.
  const session = await stripeGetSession(secretKey, sessionId);
  if (!session) {
    return res.status(502).json({ error: 'Could not verify payment. Please try again.' });
  }
  if (session.payment_status !== 'paid') {
    return res.status(402).json({ ok: false, paymentStatus: session.payment_status });
  }

  // Defense-in-depth cross-checks (Carbon Pass 2, finding M-7):
  // identical to api/webhook.js — amount, currency, and session
  // identity are verified against the persisted record BEFORE any
  // grant. A mismatch is adjudicated as an exception (grant refused,
  // money flagged for manual review), never a grant; an unknown
  // session is not granted either. Previously this endpoint marked
  // paid as soon as Stripe said 'paid', so a mismatch granted the
  // entitlement here and the later webhook saw it as a duplicate.
  const record = store.getSessionRecord(session.id);
  if (!record) {
    return res.status(200).json({ ok: false, paid: false, reason: 'unknown-session' });
  }
  const mismatch = checkSessionAgainstRecord(session, record);
  if (mismatch) {
    const adjudicated = store.adjudicateMismatch(session.id, 'verify-session:' + session.id, mismatch);
    console.log(`[iru] verify-session: mismatch ${mismatch.reason} -> exception ${adjudicated.exception ? adjudicated.exception.id : 'n/a'}`);
    return res.status(200).json({ ok: false, paid: false, exception: true, exceptionId: adjudicated.exception ? adjudicated.exception.id : null, reason: mismatch.reason });
  }

  // Mark the pre-created entitlement paid (idempotent — webhook is a no-op after this).
  const result = store.markPaidBySession(session.id, 'verify-session:' + session.id);

  // Return the entitlement details so the client can route correctly.
  // The client already has the bearer token from the checkout response.
  const ent = result && result.entitlement ? result.entitlement : null;
  const view = ent ? store.publicView(ent) : null;

  // Register the recovery identity so "recover access" can find this
  // purchase by email. Stripe provides the customer email on the session.
  // Stored as SHA-256 hash only — the raw email never touches the store.
  if (ent && session.customer_details && session.customer_details.email) {
    store.registerRecoveryIdentity({
      entitlementId: ent.id,
      email: session.customer_details.email,
    });
  }

  return res.status(200).json({
    ok: true,
    paid: true,
    entitlement: view,
    // Fallback: SKU from Stripe metadata if we couldn't load the entitlement.
    sku: (view && view.sku) || (session.metadata && session.metadata.sku) || null,
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export { handler };
export default withDurableStore(handler);
