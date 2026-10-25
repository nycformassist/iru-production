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

import { entitlementStore } from './_lib/entitlement.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { PRICING, SKUS, FORM_IDS } from './_lib/pricing.js';
import { getFormEntry } from './_lib/forms/registry.js';
import { resolveAppOrigin, checkPaywallAgreement } from './_lib/paymentConfig.js';
import { assertPaidStoreAvailable } from './_lib/paymentStore.js';

const limiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });
const MAX_BODY_BYTES = 256 * 1024;
const MAX_INTENT_KEY_CHARS = 128;

export const SKU = SKUS.LEGACY;

/** Real Stripe call (test keys only — enforced by the handler guard). */
async function stripeCreateSession({ secretKey, amountCents, entitlementId, productName, idempotencyKey, expiresAt, origin }) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(amountCents));
  params.set('line_items[0][price_data][product_data][name]', productName || 'IRU Readiness Assessment & Form Draft');
  params.set('success_url', `${origin}/?checkout=success&entitlement=${entitlementId}`);
  params.set('cancel_url', `${origin}/?checkout=cancelled`);
  params.set('client_reference_id', entitlementId);
  params.set('metadata[entitlementId]', entitlementId);
  if (expiresAt) params.set('expires_at', String(expiresAt));
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.id || !data.url) {
    throw new Error(`stripe checkout failed (${resp.status})`);
  }
  return { id: data.id, url: data.url };
}

/** Real Stripe session expiration (test keys only — enforced by the handler guard). */
async function stripeExpireSession({ secretKey, sessionId }) {
  const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!resp.ok) {
    throw new Error(`stripe session expire failed (${resp.status})`);
  }
  return resp.json().catch(() => ({}));
}

/**
 * Best-effort expiration of Stripe sessions superseded by a newer
 * checkout. Failure-tolerant by design: every failure is logged and
 * swallowed — it never undoes the local void, the family rule, or
 * late-payment adjudication. Only sessions voided by this request's
 * guard sweep are attempted (unpaid RESERVED children only — never
 * paid or consumed sessions). When an injected gateway provides
 * expireCheckoutSession it is used (mocked tests); otherwise the real
 * Stripe call is used; a gateway without an expire method is a no-op.
 * Sessions expired lazily (TTL read paths) or already expired at Stripe
 * (checkout.session.expired) are NOT attempted here: lazy expiry must
 * stay side-effect free, and an already-expired session needs nothing.
 */
async function expireSupersededSessions(sessionIds, secretKey) {
  const gateway = globalThis.__IRU_STRIPE_GATEWAY__;
  for (const sessionId of sessionIds) {
    if (!sessionId) continue;
    try {
      if (gateway && typeof gateway.expireCheckoutSession === 'function') {
        await gateway.expireCheckoutSession({ sessionId });
      } else if (!gateway) {
        await stripeExpireSession({ secretKey, sessionId });
      }
    } catch (err) {
      console.error('[iru] superseded session expiration failed (continuing):', err && err.message ? err.message : err);
    }
  }
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
  if (!ent || ent.paidAt == null) return null;
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
 * same SKU so a retry never stacks charges. Returns the Stripe session
 * ids of the children voided by this call, so the handler can
 * best-effort expire them at Stripe (see expireSupersededSessions).
 *
 * excludeEntitlementId (defect-closure 2026-10-24): the purchase-intent
 * retry fix. The guard runs during plan resolution, BEFORE the intent
 * block below; without the exclusion it voids the intent's own
 * original, the intent then reads as stale, and the retry mints a
 * second payable session. Exempting that one entitlement from the
 * void sweep — and nothing else — lets a valid matching intent resolve
 * to its original session. The paid-conflict check and the void sweep
 * for other abandoned attempts are unchanged.
 */
function guardDuplicateUpgrade(parent, sku, excludeEntitlementId) {
  const children = entitlementStore.childrenOf(parent.id);
  const paidUpgrade = children.find((c) => c.paidAt != null
    && (c.sku === SKUS.ONE_FORM || c.sku === SKUS.BUNDLE || c.sku === SKUS.SECOND_FORM));
  if (paidUpgrade) return { conflict: true, supersededSessionIds: [] };
  const supersededSessionIds = [];
  for (const c of children) {
    if (c.paidAt == null && c.sku === sku && c.state === 'RESERVED' && c.id !== excludeEntitlementId) {
      if (c.sessionId) supersededSessionIds.push(c.sessionId);
      entitlementStore.void(c.id, 'superseded-by-new-checkout');
    }
  }
  return { conflict: false, supersededSessionIds };
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

  // Body-size cap before parsing trust (same 256KB guard as
  // generate-form.js — WS5 anti-abuse audit: this endpoint previously
  // parsed unbounded bodies).
  const rawBody = req.body;
  const bodySize = typeof rawBody === 'string' ? Buffer.byteLength(rawBody) : JSON.stringify(rawBody || {}).length;
  if (bodySize > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large.' });
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
  // Paywall flags must not disagree silently (client build flag vs
  // server flag). A request that declares no flag is an old client and
  // passes; current builds always declare (see lib/paymentConfig.js).
  const agreement = checkPaywallAgreement(body);
  if (!agreement.ok) {
    return res.status(503).json({ error: 'Paywall configuration mismatch. Please reload and try again.', reason: 'paywall-mismatch' });
  }
  // Fail closed when no durable backend is configured: never create a
  // paid purchase state the app cannot persist (see lib/paymentStore.js).
  const storeGate = assertPaidStoreAvailable();
  if (!storeGate.ok) {
    return res.status(503).json({ error: 'Checkout is not configured.' });
  }
  const requestedSku = typeof body.sku === 'string' ? body.sku : '';

  // Checkout idempotency key, parsed BEFORE plan resolution so the
  // duplicate-upgrade guard can exempt the intent's own entitlement
  // from its void sweep (see guardDuplicateUpgrade). The intent block
  // after plan resolution reuses this value.
  const intentKey = typeof body.purchaseIntentKey === 'string'
    && body.purchaseIntentKey.length > 0
    && body.purchaseIntentKey.length <= MAX_INTENT_KEY_CHARS
    ? body.purchaseIntentKey
    : null;
  const intentEntitlementId = intentKey
    ? (entitlementStore.getIntent(intentKey)?.entitlementId || null)
    : null;
  // Stripe session ids voided by this request's guard sweep, for
  // best-effort expiration after plan resolution.
  let supersededSessionIds = [];

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
    const guard = guardDuplicateUpgrade(parent, requestedSku, intentEntitlementId);
    supersededSessionIds = guard.supersededSessionIds;
    if (guard.conflict) {
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
    const guard = guardDuplicateUpgrade(parent, requestedSku, intentEntitlementId);
    supersededSessionIds = guard.supersededSessionIds;
    if (guard.conflict) {
      return res.status(409).json({ error: 'This purchase has already been completed. A second charge would duplicate it.', reason: 'already-purchased' });
    }
    const owned = parent.scope.forms[0];
    const other = FORM_IDS.find((f) => f !== owned);
    const row = PRICING.secondForm;
    plan = { sku: row.sku, amountCents: row.chargeCents, scope: { kind: 'forms', forms: [other] }, parentId: parent.id, creditedCents: 0, totalCents: row.totalCents, productName: `${row.name} (${other})` };
  } else {
    return res.status(400).json({ error: 'Unknown product.', reason: 'unknown-sku' });
  }

  // Best-effort Stripe expiration for sessions superseded by this
  // request's guard sweep (never for paid/consumed sessions — the sweep
  // only voids unpaid RESERVED children). Failure-tolerant: a failed
  // expiration never undoes the local void, the family rule, or
  // late-payment adjudication; paying a superseded session later still
  // fulfills late or becomes an exception exactly as before.
  if (supersededSessionIds.length > 0) {
    await expireSupersededSessions(supersededSessionIds, secretKey);
  }

  // Checkout idempotency: a client-generated purchase-intent key names
  // ONE logical purchase. A retry with the same key, sku, form and
  // parent returns the original session instead of minting a second
  // payable obligation; the same key with a different purchase shape
  // is a conflict. The raw token is issued exactly once (first
  // response only) — a retry returns the session URL + entitlement id
  // but never the token, because the server keeps only its hash.
  // Intent keys must be client-generated random values; the key itself
  // is a bearer reference to the checkout, never to the entitlement.
  // (intentKey was parsed before plan resolution for the guard
  // exclusion; see above.)
  const planFormId = plan.scope && plan.scope.kind === 'forms' && Array.isArray(plan.scope.forms) && plan.scope.forms.length === 1
    ? plan.scope.forms[0]
    : null;
  if (intentKey) {
    const prior = entitlementStore.getIntent(intentKey);
    if (prior) {
      const priorEnt = entitlementStore.getById(prior.entitlementId);
      if (priorEnt && priorEnt.state === 'RESERVED' && priorEnt.paidAt == null
        && prior.sku === plan.sku && (prior.formId || null) === planFormId
        && (prior.parentId || null) === (plan.parentId || null)) {
        return res.status(200).json({
          ok: true, retried: true,
          checkoutUrl: prior.checkoutUrl,
          entitlementId: prior.entitlementId,
          sku: prior.sku, scope: plan.scope,
          amountCents: prior.amountCents,
          creditedCents: plan.creditedCents,
          totalCents: prior.totalCents,
          currency: 'usd', mode: 'test',
        });
      }
      if (priorEnt && priorEnt.state === 'RESERVED' && priorEnt.paidAt == null) {
        return res.status(409).json({ error: 'This purchase request conflicts with an earlier one using the same reference.', reason: 'intent-conflict' });
      }
      // Stale intent (void, expired, paid, or consumed original):
      // drop it and mint a fresh checkout below.
      entitlementStore.deleteIntent(intentKey);
    }
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
  // Stripe requires expires_at to be at least 30 minutes after SESSION
  // CREATION (not entitlement creation). The previous code used
  // entitlement.createdAt + 30 min, which is always under 30 minutes
  // out by the time Stripe receives the request (creation strictly
  // precedes the call, and the value is floored to seconds). Compute
  // from the Stripe call time with headroom (~31 minutes). The small
  // overhang past the local 30-min TTL is covered by late fulfillment:
  // a verified payment for an expired/voided unpaid record fulfills
  // late with a fresh claim window (see lib/entitlement.js).
  // NOTE: this validates application-generated parameters only; a real
  // Stripe test-mode call is still required to prove platform
  // acceptance of the value.
  // Use a stable Stripe idempotency key tied to the logical purchase
  // (the intent key when the client supplied one, else the entitlement
  // id) so a retried Stripe call cannot create a second session for
  // one purchase.
  const STRIPE_EXPIRES_HEADROOM_MS = 31 * 60 * 1000;
  const stripeCallStartedAt = Date.now();
  const expiresAt = Math.floor((stripeCallStartedAt + STRIPE_EXPIRES_HEADROOM_MS) / 1000);
  const idempotencyKey = intentKey ? `iru-intent-${intentKey}` : `iru-checkout-${entitlement.id}`;
  try {
    const gateway = globalThis.__IRU_STRIPE_GATEWAY__;
    let session;
    if (gateway && typeof gateway.createCheckoutSession === 'function') {
      session = await gateway.createCheckoutSession({ amountCents: plan.amountCents, entitlementId: entitlement.id, sku: plan.sku, idempotencyKey, expiresAt });
    } else {
      // Real Stripe path only: the origin is validated here, fail
      // closed — there is no localhost fallback anywhere in this file.
      const origin = resolveAppOrigin();
      if (!origin.ok) {
        entitlementStore.void(entitlement.id, 'checkout-origin-invalid');
        return res.status(503).json({ error: 'Checkout is not configured.' });
      }
      session = await stripeCreateSession({ secretKey, amountCents: plan.amountCents, entitlementId: entitlement.id, productName: plan.productName, idempotencyKey, expiresAt, origin: origin.origin });
    }
    entitlementStore.attachSession(entitlement.id, session.id);
    if (intentKey) {
      entitlementStore.saveIntent(intentKey, {
        entitlementId: entitlement.id, sessionId: session.id, sku: plan.sku,
        formId: planFormId, parentId: plan.parentId || null,
        checkoutUrl: session.url, amountCents: plan.amountCents, totalCents: plan.totalCents,
      });
    }
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
