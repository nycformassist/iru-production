// api/checkout.js — Test-mode checkout creation (directive §10/§11;
// B2C pricing directive 2026-10-21).
//
// Creates a RESERVED entitlement and a Stripe Checkout session bound to
// it. Payment is confirmed ONLY by the signed webhook (api/webhook.js) —
// never by a browser redirect.
//
// B2C structure (lib/pricing.js — owner-set, enforced HERE server-side;
// any amount sent by the client is ignored):
// - No `sku` in the request → the pre-B2C legacy product, priced from
//   the server environment (IRU_ASSESSMENT_PRICE_CENTS), unchanged.
// - sku = evaluation ($1.00): scope { kind: 'evaluation' }.
// - sku = one-form ($98.95 after the $1 credit; $99.95 total): requires
//   the buyer's PAID evaluation entitlement token as proof of the
//   credit; scope = exactly the selected form (I-589 XOR I-765).
// - sku = bundle ($128.95 after credit; $129.95 total): same credit
//   requirement; scope = both forms.
// - sku = second-form add-on ($30.00): requires a PAID one-form
//   entitlement token; scope = the OTHER form; buyer's total becomes
//   $129.95.
// Duplicate protection: a second PAID upgrade on the same parent
// entitlement is refused (409); abandoned unpaid upgrade checkouts are
// voided and replaced, never double-charged.
//
// HARD GUARDS (owner authorization gates, enforced in code):
// - Live Stripe keys are REFUSED. This build is test-mode only.
// - Without configuration the endpoint reports itself unavailable.

import { entitlementStore } from './lib/entitlement.js';
import { createLimiter, clientIp } from './lib/ratelimit.js';
import { PRICING, SKUS, FORM_IDS } from './lib/pricing.js';
import { getFormEntry } from './lib/forms/registry.js';

const limiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });

export const SKU = SKUS.LEGACY;

function appOrigin() {
  return process.env.IRU_APP_ORIGIN || 'http://localhost:5173';
}

/** Real Stripe call (test keys only — enforced by the handler guard). */
async function stripeCreateSession({ secretKey, amountCents, entitlementId, productName }) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(amountCents));
  params.set('line_items[0][price_data][product_data][name]', productName || 'IRU Readiness Assessment & Form Draft');
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

/**
 * Verify a prerequisite entitlement from the buyer's token. A purchased
 * entitlement proves itself by having been marked paid by the webhook —
 * whether it is still RESERVED (unused) or already CONSUMED (e.g. the
 * evaluation was delivered) — and by matching the required scope kind.
 * Client-supplied claims about prior payments are never trusted.
 */
function verifyPrerequisite(token, { kind, formsCount = null }) {
  if (!token || typeof token !== 'string') return null;
  const ent = entitlementStore.getByToken(token);
  if (!ent || !ent.paidAt) return null;
  if (ent.state === 'VOID' || ent.state === 'EXPIRED') return null;
  if (!ent.scope || ent.scope.kind !== kind) return null;
  if (formsCount !== null) {
    const forms = Array.isArray(ent.scope.forms) ? ent.scope.forms : [];
    if (forms.length !== formsCount) return null;
  }
  return ent;
}

/**
 * Duplicate-upgrade protection: refuse when a PAID child of the same
 * upgrade family already exists; void abandoned unpaid attempts of the
 * same SKU so a retry never stacks charges.
 */
function guardDuplicateUpgrade(parent, sku) {
  const children = entitlementStore.childrenOf(parent.id);
  const paidUpgrade = children.find((c) => c.paidAt
    && (c.sku === SKUS.ONE_FORM || c.sku === SKUS.BUNDLE || c.sku === SKUS.SECOND_FORM));
  if (paidUpgrade) return { conflict: true };
  for (const c of children) {
    if (!c.paidAt && c.sku === sku && c.state === 'RESERVED') {
      entitlementStore.void(c.id, 'superseded-by-new-checkout');
    }
  }
  return { conflict: false };
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

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  if (!body) return res.status(400).json({ error: 'Invalid submission.' });
  const requestedSku = typeof body.sku === 'string' ? body.sku : '';

  // ── Resolve what is being bought — amounts come ONLY from the
  // server-side pricing table (or, for the legacy product, the server
  // environment). Client-sent amounts are never read.
  let plan = null;
  if (!requestedSku || requestedSku === SKUS.LEGACY) {
    const amountCents = Number(process.env.IRU_ASSESSMENT_PRICE_CENTS || '');
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return res.status(503).json({ error: 'Checkout is not configured.' });
    }
    plan = { sku: SKUS.LEGACY, amountCents, scope: null, parentId: null, creditedCents: 0, totalCents: amountCents, productName: 'IRU Readiness Assessment & Form Draft' };
  } else if (requestedSku === SKUS.EVALUATION) {
    const row = PRICING.evaluation;
    plan = { sku: row.sku, amountCents: row.chargeCents, scope: { kind: 'evaluation' }, parentId: null, creditedCents: 0, totalCents: row.totalCents, productName: row.name };
  } else if (requestedSku === SKUS.ONE_FORM || requestedSku === SKUS.BUNDLE) {
    const parent = verifyPrerequisite(body.entitlementToken, { kind: 'evaluation' });
    if (!parent) {
      return res.status(402).json({ error: 'The $1 evaluation purchase is required first — its payment is credited toward this total.', reason: 'evaluation-required' });
    }
    if (guardDuplicateUpgrade(parent, requestedSku).conflict) {
      return res.status(409).json({ error: 'This purchase has already been completed. A second charge would duplicate it.', reason: 'already-purchased' });
    }
    if (requestedSku === SKUS.ONE_FORM) {
      const formId = typeof body.formId === 'string' ? body.formId : '';
      if (!FORM_IDS.includes(formId) || !getFormEntry(formId)) {
        return res.status(400).json({ error: 'Select exactly one form: Form I-589 or Form I-765.', reason: 'form-required' });
      }
      const row = PRICING.oneForm;
      plan = { sku: row.sku, amountCents: row.chargeCents, scope: { kind: 'forms', forms: [formId] }, parentId: parent.id, creditedCents: row.creditedCents, totalCents: row.totalCents, productName: `${row.name} (${formId})` };
    } else {
      const row = PRICING.bundle;
      plan = { sku: row.sku, amountCents: row.chargeCents, scope: { kind: 'forms', forms: [...FORM_IDS] }, parentId: parent.id, creditedCents: row.creditedCents, totalCents: row.totalCents, productName: row.name };
    }
  } else if (requestedSku === SKUS.SECOND_FORM) {
    const parent = verifyPrerequisite(body.entitlementToken, { kind: 'forms', formsCount: 1 });
    if (!parent) {
      return res.status(402).json({ error: 'The second-form add-on requires your completed one-form purchase.', reason: 'one-form-required' });
    }
    if (guardDuplicateUpgrade(parent, requestedSku).conflict) {
      return res.status(409).json({ error: 'This purchase has already been completed. A second charge would duplicate it.', reason: 'already-purchased' });
    }
    const owned = parent.scope.forms[0];
    const other = FORM_IDS.find((f) => f !== owned);
    const row = PRICING.secondForm;
    plan = { sku: row.sku, amountCents: row.chargeCents, scope: { kind: 'forms', forms: [other] }, parentId: parent.id, creditedCents: 0, totalCents: row.totalCents, productName: `${row.name} (${other})` };
  } else {
    return res.status(400).json({ error: 'Unknown product.', reason: 'unknown-sku' });
  }

  const { entitlement, token } = entitlementStore.create({
    sku: plan.sku,
    amountCents: plan.amountCents,
    currency: 'usd',
    scope: plan.scope,
    parentId: plan.parentId,
    creditedCents: plan.creditedCents,
    totalCents: plan.totalCents,
  });
  try {
    const gateway = globalThis.__IRU_STRIPE_GATEWAY__;
    const session = gateway && typeof gateway.createCheckoutSession === 'function'
      ? await gateway.createCheckoutSession({ amountCents: plan.amountCents, entitlementId: entitlement.id, sku: plan.sku })
      : await stripeCreateSession({ secretKey, amountCents: plan.amountCents, entitlementId: entitlement.id, productName: plan.productName });
    entitlementStore.attachSession(entitlement.id, session.id);
    // The token is the buyer's recovery credential (shown once here; the
    // client keeps it). It is stored server-side only as a SHA-256 hash.
    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      entitlementId: entitlement.id,
      entitlementToken: token,
      sku: plan.sku,
      scope: plan.scope,
      amountCents: plan.amountCents,
      creditedCents: plan.creditedCents,
      totalCents: plan.totalCents,
      currency: 'usd',
      mode: 'test',
    });
  } catch (err) {
    entitlementStore.void(entitlement.id, 'checkout-session-failed');
    console.error('[iru] checkout creation failed:', err && err.message ? err.message : err);
    return res.status(502).json({ error: 'Checkout unavailable. Please try again later.' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
