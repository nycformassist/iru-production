// api/webhook.js — Stripe webhook receiver (directive §11).
//
// The ONLY component allowed to mark an entitlement paid. Verifies the
// Stripe signature over the RAW body before trusting any field.
// Idempotent: duplicate/replayed events are acknowledged, not reapplied.
//
// Serverless raw-body contract (payment-hardening directive 2026-10-24):
// - This module declares `config.api.bodyParser = false` so runtimes
//   that honor it (Next.js-style) deliver the raw body. On plain Vercel
//   Node functions the handler additionally accepts req.rawBody or a
//   string body; a JSON-parsed object body is re-serialized ONLY as a
//   fallback, and if that re-serialization does not verify, the event
//   is rejected with 400 rather than trusted. The first real Stripe
//   test-mode delivery must confirm raw-body delivery — mocked tests
//   inject rawBody and do NOT prove the platform path (see the report).
// - Events are burned ONLY once adjudicated (applied, duplicate, or
//   exception). A 503 (storage unavailable) or an unknown session never
//   burns an event, so Stripe redelivery still fulfills.
// - Defense-in-depth cross-checks (amount, currency, session identity,
//   payment status) run before any grant. A mismatch becomes a durable,
//   observable exception — never a grant, never silent (see
//   docs/PAYMENT_EXCEPTIONS_PROCEDURE.md). No refund is issued
//   automatically; no unearned entitlement is granted.
// - Body cap (256 KB, same as checkout/generate-form) and a generous
//   per-IP rate limit (120/min) protect the endpoint without breaking
//   legitimate deliveries: Stripe retries on 429/5xx and processing is
//   idempotent, so a throttled delivery is redelivered, not lost.

import { entitlementStore } from './_lib/entitlement.js';
import { verifyStripeSignature } from './_lib/stripewebhook.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { assertPaidStoreAvailable } from './_lib/paymentStore.js';

export const config = { api: { bodyParser: false } };

const limiter = createLimiter({ capacity: 120, windowMs: 60 * 1000 });
const MAX_BODY_BYTES = 256 * 1024;

function rawBodyOf(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body || {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rawBody = rawBodyOf(req);
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large.' });
  }
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) {
    return res.status(500).json({ error: 'Webhook is not configured.' });
  }
  const signature = req.headers && (req.headers['stripe-signature'] || req.headers['Stripe-Signature']);

  const verified = verifyStripeSignature(rawBody, signature, secret);
  if (!verified.ok) {
    console.error(`[iru] webhook rejected: ${verified.error}`);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid payload.' });
  }

  // Storage gate: a 503 here must NOT burn the event — Stripe retries
  // and the redelivery still fulfills once storage is available.
  const storeGate = assertPaidStoreAvailable();
  if (!storeGate.ok) {
    return res.status(503).json({ error: 'Webhook is not configured.' });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data && event.data.object ? event.data.object : {};
    const sessionId = session.id;
    if (!sessionId) return res.status(400).json({ error: 'Missing session id.' });
    // Stripe can complete a session UNPAID for delayed payment methods.
    // An unpaid completion never marks an entitlement paid; the later
    // checkout.session.async_payment_succeeded event does. Unpaid
    // events are NOT burned, so the later success still applies.
    if (session.payment_status
      && session.payment_status !== 'paid'
      && session.payment_status !== 'no_payment_required') {
      console.log(`[iru] webhook ${event.type} (unpaid): session recorded, not marked paid`);
      return res.status(200).json({ received: true, applied: false, reason: 'session-not-paid' });
    }
    // Defense-in-depth cross-checks against the persisted record,
    // before any grant. A mismatch is adjudicated as an exception
    // (event burned, grant refused, money flagged for manual refund).
    const record = entitlementStore.getSessionRecord(sessionId);
    if (!record) {
      return res.status(200).json({ received: true, applied: false, reason: 'unknown-session' });
    }
    if (event.id && entitlementStore.hasProcessedEvent(event.id)) {
      return res.status(200).json({ received: true, applied: false, duplicate: true });
    }
    const mismatch = checkSessionAgainstRecord(session, record);
    if (mismatch) {
      const adjudicated = entitlementStore.adjudicateMismatch(sessionId, event.id, mismatch);
      console.log(`[iru] webhook ${event.type}: mismatch ${mismatch.reason} -> exception ${adjudicated.exception ? adjudicated.exception.id : 'n/a'}`);
      return res.status(200).json({ received: true, applied: false, exception: true, exceptionId: adjudicated.exception ? adjudicated.exception.id : null, reason: mismatch.reason });
    }
    const result = entitlementStore.markPaidBySession(sessionId, event.id);
    // Audit log: ids and outcome only — never amounts-account linkage beyond the session.
    console.log(`[iru] webhook ${event.type}: applied=${result.applied} duplicate=${!!result.duplicate}${result.reason ? ` reason=${result.reason}` : ''}${result.lateFulfilled ? ' late-fulfilled' : ''}${result.exception ? ` exception=${result.exception.id}` : ''}`);
    return res.status(200).json({
      received: true,
      applied: result.applied,
      duplicate: !!result.duplicate,
      ...(result.lateFulfilled ? { lateFulfilled: true } : {}),
      ...(result.exception ? { exception: true, exceptionId: result.exception.id, reason: result.reason } : {}),
    });
  }

  // Failed / abandoned checkouts (defect-closure directive 2026-10-23,
  // Priority 6): previously these events were ignored and the
  // entitlement dangled as RESERVED until its TTL lapsed.
  if (event.type === 'checkout.session.expired') {
    const session = event.data && event.data.object ? event.data.object : {};
    if (!session.id) return res.status(400).json({ error: 'Missing session id.' });
    // An expired session can never be paid: resolve the entitlement
    // terminally (VOID) so the buyer can start a clean checkout.
    const result = entitlementStore.voidByExpiredSession(session.id, event.id);
    console.log(`[iru] webhook checkout.session.expired: applied=${result.applied} duplicate=${!!result.duplicate}${result.reason ? ` reason=${result.reason}` : ''}`);
    return res.status(200).json({ received: true, applied: result.applied, duplicate: !!result.duplicate });
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data && event.data.object ? event.data.object : {};
    if (!session.id) return res.status(400).json({ error: 'Missing session id.' });
    // A failed delayed payment does NOT end the entitlement: the buyer
    // may retry on the same session and a later success must still
    // mark it paid. The failure is recorded for audit only.
    const result = entitlementStore.notePaymentFailedBySession(session.id, event.id);
    console.log(`[iru] webhook checkout.session.async_payment_failed: recorded=${result.applied} duplicate=${!!result.duplicate}${result.reason ? ` reason=${result.reason}` : ''}`);
    return res.status(200).json({ received: true, applied: result.applied, duplicate: !!result.duplicate });
  }

  return res.status(200).json({ received: true, ignored: true });
}

/**
 * Defense-in-depth checks. Only fields Stripe actually sent are
 * checked — an absent field is not a mismatch (older payload shapes).
 * Returns null when everything present matches, else a mismatch object
 * for adjudicateMismatch().
 */
function checkSessionAgainstRecord(session, record) {
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
