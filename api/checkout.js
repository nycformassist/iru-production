// api/checkout.js — Test-mode checkout creation (directive §10/§11).
//
// Creates a RESERVED entitlement and a Stripe Checkout session bound to
// it. Payment is confirmed ONLY by the signed webhook (api/webhook.js) —
// never by a browser redirect.
//
// HARD GUARDS (owner authorization gates, enforced in code):
// - Live Stripe keys are REFUSED. This build is test-mode only.
// - No price is hardcoded: the amount comes from the server environment
//   (IRU_ASSESSMENT_PRICE_CENTS). The $49.95 figure in planning docs is
//   an UNAPPROVED hypothesis and appears nowhere in this code.
// - Without configuration the endpoint reports itself unavailable.

import { entitlementStore } from './lib/entitlement.js';
import { createLimiter, clientIp } from './lib/ratelimit.js';

const limiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });

export const SKU = 'iru-assessment-form-draft';

function appOrigin() {
  return process.env.IRU_APP_ORIGIN || 'http://localhost:5173';
}

/** Real Stripe call (test keys only — enforced by the handler guard). */
async function stripeCreateSession({ secretKey, amountCents, entitlementId }) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(amountCents));
  params.set('line_items[0][price_data][product_data][name]', 'IRU Readiness Assessment & Form Draft');
  params.set('success_url', `${appOrigin()}/?checkout=success&entitlement=${entitlementId}`);
  params.set('cancel_url', `${appOrigin()}/?checkout=cancelled`);
  params.set('client_reference_id', entitlementId);
  params.set('metadata[entitlementId]', entitlementId);
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.id || !data.url) {
    throw new Error(`stripe checkout failed (${resp.status})`);
  }
  return { id: data.id, url: data.url };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  if (!secretKey) {
    return res.status(503).json({ error: 'Checkout is not configured.' });
  }
  if (secretKey.startsWith('sk_live') || secretKey.startsWith('rk_live')) {
    // Owner gate: live payments require separate explicit authorization.
    console.error('[iru] checkout refused: live-mode Stripe key present in a test-mode-only build');
    return res.status(500).json({ error: 'Live payments are not authorized in this build.' });
  }
  const amountCents = Number(process.env.IRU_ASSESSMENT_PRICE_CENTS || '');
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(503).json({ error: 'Checkout is not configured.' });
  }

  const { entitlement, token } = entitlementStore.create({ sku: SKU, amountCents, currency: 'usd' });
  try {
    const gateway = globalThis.__IRU_STRIPE_GATEWAY__;
    const session = gateway && typeof gateway.createCheckoutSession === 'function'
      ? await gateway.createCheckoutSession({ amountCents, entitlementId: entitlement.id })
      : await stripeCreateSession({ secretKey, amountCents, entitlementId: entitlement.id });
    entitlementStore.attachSession(entitlement.id, session.id);
    // The token is the buyer's recovery credential (shown once here; the
    // client keeps it). It is stored server-side only as a SHA-256 hash.
    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      entitlementId: entitlement.id,
      entitlementToken: token,
      amountCents,
      currency: 'usd',
      mode: 'test',
    });
  } catch (err) {
    entitlementStore.void(entitlement.id, 'checkout-session-failed');
    console.error('[iru] checkout creation failed:', err && err.message ? err.message : err);
    return res.status(502).json({ error: 'Checkout unavailable. Please try again later.' });
  }
}
