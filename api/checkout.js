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
// - sku = iru-readiness ($99.95, owner-approved 2026-11-05): scope
//   { kind: 'readiness', forms: [form] } for I-589 or I-765 only. No
//   prerequisite, no prior purchase. A separate service: it never
//   discounts preparation and never counts as owning a form.
// - sku = iru-formprep: Pathway preparation purchase (owner-approved
//   pricing 2026-11-05). No $1 evaluation prerequisite: Readiness is
//   a separate service and never discounts preparation.
// - RETIRED (owner decision 2026-11-05): sku = iru-evaluation,
//   iru-complete-one-form, iru-complete-bundle, iru-second-form-addon
//   are refused with HTTP 410 'evaluation-retired' before any
//   entitlement creation. Already-paid holders keep what they bought;
//   the limited evaluation stays available to them via analyze.js.
// Duplicate protection: a second PAID purchase of the same formprep
// or readiness grant on the same parent entitlement is refused (409);
// abandoned unpaid checkouts are voided and replaced, never
// double-charged.
//
// HARD GUARDS (owner authorization gates, enforced in code):
// - Live Stripe keys are REFUSED. This build is test-mode only.
// - Without configuration the endpoint reports itself unavailable.

import { entitlementStore } from './_lib/entitlement.js';
import { withDurableStore } from './_lib/withStore.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { SKUS } from './_lib/pricing.js';
import { resolveAppOrigin, checkPaywallAgreement } from './_lib/paymentConfig.js';
import { assertPaidStoreAvailable } from './_lib/paymentStore.js';
import { pricePurchase, priceReadiness, FORMPREP_SKU, READINESS_SKU } from './_lib/checkout-pricing.js';

const limiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });
const MAX_BODY_BYTES = 256 * 1024;
const MAX_INTENT_KEY_CHARS = 128;

export const SKU = SKUS.LEGACY;

/** Real Stripe call (test keys only — enforced by the handler guard). */
async function stripeCreateSession({ secretKey, amountCents, entitlementId, productName, idempotencyKey, expiresAt, origin, metadata }) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(amountCents));
  params.set('line_items[0][price_data][product_data][name]', productName || 'IRU Readiness Assessment & Form Draft');
  params.set('success_url', `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${origin}/?checkout=cancelled`);
  params.set('client_reference_id', entitlementId);
  params.set('metadata[entitlementId]', entitlementId);
  // Case identity (Pathway formprep purchases): the assessment clientKey
  // lets the return path resume the EXACT case, and `forms` records
  // which forms this session covers. Both are opaque references only.
  if (metadata && typeof metadata === 'object') {
    if (typeof metadata.clientKey === 'string' && metadata.clientKey) {
      params.set('metadata[clientKey]', metadata.clientKey);
    }
    if (typeof metadata.forms === 'string' && metadata.forms) {
      params.set('metadata[forms]', metadata.forms);
    }
  }
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

async function handler(req, res, store = entitlementStore) {
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

  const secretKey = process.env.IRU_STRIPE_KEY || '';
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

  // RETIRED (owner decision 2026-11-05): the $1 evaluation and its
  // upgrade/add-on SKUs are no longer purchasable. Refuse BEFORE any
  // entitlement creation, Stripe session creation, or prerequisite
  // check — no new entitlement record may be created for these SKUs.
  // Already-paid holders keep what they bought (verification of those
  // entitlements is unaffected).
  if (requestedSku === SKUS.EVALUATION || requestedSku === SKUS.ONE_FORM
    || requestedSku === SKUS.BUNDLE || requestedSku === SKUS.SECOND_FORM) {
    return res.status(410).json({
      error: 'This product has been retired and is no longer available for purchase.',
      reason: 'evaluation-retired',
    });
  }

  // Checkout idempotency key, parsed BEFORE plan resolution. The intent
  // block after plan resolution reuses this value.
  const intentKey = typeof body.purchaseIntentKey === 'string'
    && body.purchaseIntentKey.length > 0
    && body.purchaseIntentKey.length <= MAX_INTENT_KEY_CHARS
    ? body.purchaseIntentKey
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
  } else if (requestedSku === FORMPREP_SKU) {
    // ── Pathway form-preparation purchase (owner-approved pricing
    // 2026-11-05; Trello "IRU DIRECT TO CONSUMER PLAN" is the source
    // of truth). The customer buys preparation for 1–2 released forms
    // in one case: the selected form, optionally plus the related form
    // added from the Pathway panel. Amounts come ONLY from
    // pricePurchase() (server-side catalog levels) — client-sent
    // amounts are never read. No $1 evaluation prerequisite: Readiness
    // is a separate service and never discounts preparation.
    const forms = Array.isArray(body.forms)
      ? body.forms.filter((f) => typeof f === 'string')
      : [];
    if (forms.length < 1 || forms.length > 2) {
      return res.status(400).json({ error: 'Select one or two forms to prepare.', reason: 'forms-required' });
    }
    if (new Set(forms).size !== forms.length) {
      return res.status(400).json({ error: 'Select each form only once.', reason: 'duplicate-form' });
    }
    // Case identity: the assessment clientKey (opaque reference) is
    // carried into Stripe metadata so the return path can resume the
    // exact case. It is never trusted as proof of ownership.
    const clientKey = typeof body.clientKey === 'string'
      && body.clientKey.length > 0 && body.clientKey.length <= 128
      ? body.clientKey
      : null;
    // Derive already-owned prep forms from a verified PAID entitlement
    // token, when the buyer presents one. An absent or invalid token
    // simply means a fresh case owns nothing — it is not an error,
    // because formprep (unlike the legacy upgrade SKUs) has no
    // prerequisite purchase.
    let ownedForms = [];
    let parent = null;
    if (typeof body.entitlementToken === 'string' && body.entitlementToken) {
      const ent = store.getByToken(body.entitlementToken);
      if (ent && ent.paidAt != null && ent.state !== 'VOID' && ent.state !== 'EXPIRED'
        && ent.scope && ent.scope.kind === 'forms' && Array.isArray(ent.scope.forms)) {
        parent = ent;
        ownedForms = ent.scope.forms.filter((f) => typeof f === 'string');
      }
    }
    const priced = pricePurchase({
      ownedForms,
      selectedForm: forms[0],
      addedForm: forms[1] || null,
    });
    if (!priced.ok) {
      const status = priced.reason === 'already-owned' ? 409 : 400;
      return res.status(status).json({
        error: priced.error || 'This purchase cannot be completed.',
        reason: priced.reason || 'pricing-error',
      });
    }
    // Duplicate protection (same shape as the legacy upgrade guard):
    // a PAID formprep child of the same parent covering the same forms
    // is a conflict; abandoned unpaid ones are voided so a retry never
    // stacks charges. A purchase with no parent has no children to
    // guard — the purchase-intent key below still protects retries.
    if (parent) {
      const children = store.childrenOf(parent.id);
      const paidDup = children.find((c) => c.paidAt != null && c.sku === FORMPREP_SKU
        && c.scope && c.scope.kind === 'forms' && Array.isArray(c.scope.forms)
        && priced.forms.length === c.scope.forms.length
        && priced.forms.every((f) => c.scope.forms.includes(f)));
      if (paidDup) {
        return res.status(409).json({ error: 'This purchase has already been completed. A second charge would duplicate it.', reason: 'already-purchased' });
      }
      // DEFECT 1 ordering (2026-11-05): this sweep runs BEFORE the
      // shared purchase-intent lookup below, so it must NOT void the
      // entitlement this request's own intent key names — a retry would
      // otherwise find its original voided and mint a second payable
      // session (double-charge risk). The intent block needs the
      // original alive to decide retry (same shape) vs 409 (different
      // shape); any other unpaid RESERVED child is still superseded.
      let intentOriginalId = null;
      if (intentKey) {
        const prior = store.getIntent(intentKey);
        if (prior && prior.sku === FORMPREP_SKU && (prior.parentId || null) === parent.id) {
          intentOriginalId = prior.entitlementId;
        }
      }
      for (const c of children) {
        if (c.paidAt == null && c.sku === FORMPREP_SKU && c.state === 'RESERVED' && c.id !== intentOriginalId) {
          if (c.sessionId) supersededSessionIds.push(c.sessionId);
          store.void(c.id, 'superseded-by-new-checkout');
        }
      }
    }
    const productName = `IRU Form Preparation — ${priced.forms.join(' + ')}${priced.bundleApplied ? ' (special bundle price)' : ''}`;
    plan = {
      sku: FORMPREP_SKU,
      amountCents: priced.totalCents,
      scope: { kind: 'forms', forms: [...priced.forms] },
      parentId: parent ? parent.id : null,
      creditedCents: 0,
      totalCents: priced.totalCents,
      productName,
      priced,
      clientKey,
    };
  } else if (requestedSku === READINESS_SKU) {
    // ── Readiness purchase (owner-approved 2026-11-05, FINAL). One
    // form (I-589 or I-765 only), flat $99.95, server-side only —
    // client-sent amounts are never read. No prerequisite (no
    // evaluation, no prior purchase). Grants scope { kind: 'readiness',
    // forms: [form] } — a separate service that never discounts
    // preparation and never counts as owning a form.
    const form = typeof body.form === 'string' ? body.form : '';
    const priced = priceReadiness(form);
    if (!priced.ok) {
      return res.status(400).json({
        error: priced.error || 'This purchase cannot be completed.',
        reason: priced.reason || 'pricing-error',
      });
    }
    // Case identity: the assessment clientKey (opaque reference) is
    // carried into Stripe metadata so the return path can resume the
    // exact case. It is never trusted as proof of ownership.
    const clientKey = typeof body.clientKey === 'string'
      && body.clientKey.length > 0 && body.clientKey.length <= 128
      ? body.clientKey
      : null;
    // Duplicate protection: a PAID readiness entitlement for the same
    // form, presented under its own token, is a conflict. A readiness
    // token for the OTHER form is not a duplicate — each form needs
    // its own readiness purchase.
    if (typeof body.entitlementToken === 'string' && body.entitlementToken) {
      const ent = store.getByToken(body.entitlementToken);
      if (ent && ent.paidAt != null && ent.state !== 'VOID' && ent.state !== 'EXPIRED'
        && ent.scope && ent.scope.kind === 'readiness' && Array.isArray(ent.scope.forms)
        && ent.scope.forms.includes(form)) {
        return res.status(409).json({ error: 'This purchase has already been completed. A second charge would duplicate it.', reason: 'already-purchased' });
      }
    }
    plan = {
      sku: READINESS_SKU,
      amountCents: priced.totalCents,
      scope: { kind: 'readiness', forms: [form] },
      parentId: null,
      creditedCents: 0,
      totalCents: priced.totalCents,
      productName: `IRU Readiness — ${form}`,
      clientKey,
    };
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
  const planFormId = plan.scope && plan.scope.kind === 'forms' && Array.isArray(plan.scope.forms) && plan.scope.forms.length === 1
    ? plan.scope.forms[0]
    : null;
  // Formprep purchases cover 1–2 forms and readiness exactly 1: the
  // intent record must name the exact form set, or two different
  // purchases sharing one intent key would falsely match. Legacy SKUs
  // keep their existing formId-only comparison (their saved intents
  // have no `forms` field).
  const planIsFormprep = plan.sku === FORMPREP_SKU;
  const planIsReadiness = plan.sku === READINESS_SKU;
  const planFormsKey = (planIsFormprep || planIsReadiness)
    ? JSON.stringify([...(plan.scope.forms || [])].sort())
    : null;
  if (intentKey) {
    const prior = store.getIntent(intentKey);
    if (prior) {
      const priorEnt = store.getById(prior.entitlementId);
      const priorFormsKey = prior.forms ? JSON.stringify([...prior.forms].sort()) : null;
      const formsMatch = planFormsKey === null || priorFormsKey === planFormsKey;
      if (priorEnt && priorEnt.state === 'RESERVED' && priorEnt.paidAt == null
        && prior.sku === plan.sku && (prior.formId || null) === planFormId
        && (prior.parentId || null) === (plan.parentId || null) && formsMatch) {
        return res.status(200).json({
          ok: true, retried: true,
          checkoutUrl: prior.checkoutUrl,
          entitlementId: prior.entitlementId,
          sku: prior.sku, scope: plan.scope,
          amountCents: prior.amountCents,
          creditedCents: plan.creditedCents,
          totalCents: prior.totalCents,
          currency: 'usd', mode: 'test',
          ...(plan.priced ? { lines: plan.priced.lines, bundleApplied: plan.priced.bundleApplied, forms: plan.priced.forms } : {}),
        });
      }
      if (priorEnt && priorEnt.state === 'RESERVED' && priorEnt.paidAt == null) {
        return res.status(409).json({ error: 'This purchase request conflicts with an earlier one using the same reference.', reason: 'intent-conflict' });
      }
      // Stale intent (void, expired, paid, or consumed original):
      // drop it and mint a fresh checkout below.
      store.deleteIntent(intentKey);
    }
  }

  const { entitlement, token } = store.create({
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
      session = await gateway.createCheckoutSession({
        amountCents: plan.amountCents, entitlementId: entitlement.id, sku: plan.sku,
        idempotencyKey, expiresAt,
        ...(plan.clientKey ? { clientKey: plan.clientKey } : {}),
        ...((planIsFormprep || planIsReadiness) ? { forms: [...(plan.scope.forms || [])] } : {}),
      });
    } else {
      // Real Stripe path only: the origin is validated here, fail
      // closed — there is no localhost fallback anywhere in this file.
      const origin = resolveAppOrigin();
      if (!origin.ok) {
        store.void(entitlement.id, 'checkout-origin-invalid');
        return res.status(503).json({ error: 'Checkout is not configured.' });
      }
      session = await stripeCreateSession({
        secretKey, amountCents: plan.amountCents, entitlementId: entitlement.id,
        productName: plan.productName, idempotencyKey, expiresAt, origin: origin.origin,
        metadata: {
          ...(plan.clientKey ? { clientKey: plan.clientKey } : {}),
          ...((planIsFormprep || planIsReadiness) ? { forms: [...(plan.scope.forms || [])].join(',') } : {}),
        },
      });
    }
    store.attachSession(entitlement.id, session.id);
    if (intentKey) {
      store.saveIntent(intentKey, {
        entitlementId: entitlement.id, sessionId: session.id, sku: plan.sku,
        formId: planFormId, parentId: plan.parentId || null,
        checkoutUrl: session.url, amountCents: plan.amountCents, totalCents: plan.totalCents,
        ...((planIsFormprep || planIsReadiness) ? { forms: [...(plan.scope.forms || [])] } : {}),
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
      ...(plan.priced ? { lines: plan.priced.lines, bundleApplied: plan.priced.bundleApplied, forms: plan.priced.forms } : {}),
    });
  } catch (err) {
    store.void(entitlement.id, 'checkout-session-failed');
    console.error('[iru] checkout creation failed:', err && err.message ? err.message : err);
    return res.status(502).json({ error: 'Checkout unavailable. Please try again later.' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Raw handler for unit tests (singleton default). Vercel serves the
// durable-wrapped default: load → restore → run → save (CAS).
export { handler };
export default withDurableStore(handler);
