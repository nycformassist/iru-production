// api/webhook.js — Stripe webhook receiver (directive §11).
//
// The ONLY component allowed to mark an entitlement paid. Verifies the
// Stripe signature over the RAW body before trusting any field.
// Idempotent: duplicate/replayed events are acknowledged, not reapplied.
//
// Deployment note: the host must deliver the raw request body
// (req.rawBody or a string body). If a platform parses JSON first, the
// re-serialized fallback below may fail verification — the endpoint then
// rejects with 400 rather than trusting an unverifiable event.

import { entitlementStore } from './lib/entitlement.js';
import { verifyStripeSignature } from './lib/stripewebhook.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) {
    return res.status(500).json({ error: 'Webhook is not configured.' });
  }
  const rawBody = typeof req.rawBody === 'string'
    ? req.rawBody
    : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
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

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data && event.data.object ? event.data.object : {};
    const sessionId = session.id;
    if (!sessionId) return res.status(400).json({ error: 'Missing session id.' });
    // Stripe can complete a session UNPAID for delayed payment methods.
    // An unpaid completion never marks an entitlement paid; the later
    // checkout.session.async_payment_succeeded event does.
    if (event.type === 'checkout.session.completed'
      && session.payment_status
      && session.payment_status !== 'paid'
      && session.payment_status !== 'no_payment_required') {
      console.log(`[iru] webhook checkout.session.completed (unpaid): session recorded, not marked paid`);
      return res.status(200).json({ received: true, applied: false, reason: 'session-not-paid' });
    }
    const result = entitlementStore.markPaidBySession(sessionId, event.id);
    // Audit log: ids and outcome only — never amounts-account linkage beyond the session.
    console.log(`[iru] webhook ${event.type}: applied=${result.applied} duplicate=${!!result.duplicate}${result.reason ? ` reason=${result.reason}` : ''}`);
    return res.status(200).json({ received: true, applied: result.applied, duplicate: !!result.duplicate });
  }

  return res.status(200).json({ received: true, ignored: true });
}
