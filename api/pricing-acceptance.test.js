import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { entitlementStore } from './_lib/entitlement.js';
import { PRICING, SKUS, formatCents } from './_lib/pricing.js';
import { FORMPREP_SKU, pricePurchase } from './_lib/checkout-pricing.js';
import { FORMS } from './_lib/catalog.js';

// Workstream 4 — pricing & entitlement acceptance verification
// (directive §5), as RETIRED by the owner decision 2026-11-05 (FINAL).
// The $1 evaluation checkout path is gone; the cases below are
// re-vehicled onto the live model (formprep + readiness) or onto
// store-created historical entitlements where the case is about
// already-paid holders:
//  - case 1: evaluation checkout → 410; a store-created PAID historical
//    evaluation entitlement still verifies via entitlement-status
//  - case 4: sequential formprep I-765 ($149) then I-589 via the first
//    token ($200 bundle remainder) totals $349, union covers both forms
//  - case 5(d)/8: an abandoned unpaid formprep checkout is VOIDED
//    (superseded) and replaced — never stacked; one live session only
//  - case 5(e): the bearer token alone is the credential — identical
//    behavior from a "different session" (different source IP/headers)
//  - case 6 (handler level): wrong-secret signature → 400; signed event
//    for an unknown session → 200, not applied, event id NOT burned
//  - case 7 (source guards): the client never grants entitlement from
//    ?checkout=success; the success URL carries the Stripe session ID,
//    never the bearer token; unknown token → 404
//  - D3 (app scope): rk_live keys are refused exactly like sk_live
//  - offer UI: the retired PRICING record is preserved (amounts as
//    history, retired: true) and the new offer surface (pricePurchase
//    + catalog levels) prices the $349 bundle correctly
// All local, injected gateway, no network, no real keys, no money.

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipCounter = 0;
const mockReq = (over = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': `10.11.0.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

let eventCounter = 0;
async function sendWebhook(event, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const res = mockRes();
  await webhookHandler(mockReq({
    rawBody: payload,
    headers: { 'x-forwarded-for': `10.11.9.${++ipCounter}`, 'stripe-signature': signStripePayload(payload, secret, ts) },
  }), res);
  return res;
}
async function paySession(entitlementId) {
  const res = await sendWebhook({
    id: `evt_acc_${++eventCounter}`,
    type: 'checkout.session.completed',
    data: { object: { id: `sess_${entitlementId}`, payment_status: 'paid' } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applied, true);
  return res;
}
/** Pay a store-created entitlement by its assigned session id. */
async function payBySession(sessionId) {
  const res = await sendWebhook({
    id: `evt_acc_${++eventCounter}`,
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, payment_status: 'paid' } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applied, true);
  return res;
}
async function checkout(body, reqOver = {}) {
  const res = mockRes();
  await checkoutHandler(mockReq({ body, ...reqOver }), res);
  return res;
}
async function buyAndPay(body) {
  const res = await checkout(body);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  await paySession(res.body.entitlementId);
  return { token: res.body.entitlementToken, id: res.body.entitlementId, checkout: res.body };
}
async function statusOf(token, reqOver = {}) {
  const res = mockRes();
  await statusHandler(mockReq({ body: { token }, ...reqOver }), res);
  return res;
}

describe('pricing acceptance — gap coverage (directive §5)', () => {
  let gatewayCalls;
  before(() => {
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    // Payment-hardening gate: paid handlers require an explicit store backend.
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_local';
    gatewayCalls = [];
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession(args) {
        gatewayCalls.push(args);
        return { id: `sess_${args.entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
  });
  after(() => { delete globalThis.__IRU_STRIPE_GATEWAY__; });

  it('case 1: the $1 evaluation checkout is retired (410) — but a store-created PAID historical evaluation entitlement still verifies', async () => {
    const before = gatewayCalls.length;
    const res = await checkout({ sku: SKUS.EVALUATION });
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.reason, 'evaluation-retired');
    assert.match(res.body.error, /retired/i);
    assert.equal(res.body.entitlementId, undefined, 'no entitlement record is created');
    assert.equal(gatewayCalls.length, before, 'no Stripe session is created');

    // Historical holder: an already-paid evaluation entitlement (as
    // it would exist from a pre-retirement purchase) still verifies
    // via entitlement-status — paid, usable, evaluation-scoped.
    const { token } = entitlementStore.create({
      sku: SKUS.EVALUATION, amountCents: 100,
      sessionId: 'sess_hist_ev_acc', scope: { kind: 'evaluation' },
    });
    const unpaid = await statusOf(token);
    assert.equal(unpaid.body.entitlement.paid, false);
    assert.equal(unpaid.body.usable, false);
    await payBySession('sess_hist_ev_acc');
    const afterPay = await statusOf(token);
    assert.equal(afterPay.body.entitlement.paid, true);
    assert.equal(afterPay.body.usable, true);
    assert.equal(afterPay.body.entitlement.scope.kind, 'evaluation');
    // (One-shot delivery + second-delivery refusal are proven handler-level
    // in evaluation-security.test.js test 2 via analyze.js mode 'limited'.)
  });

  it('case 4: sequential formprep I-765 ($149) then I-589 via the first token ($200) totals $349 and covers BOTH forms', async () => {
    const oneForm = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-765'] });
    assert.equal(oneForm.checkout.amountCents, 14900);
    const second = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-589'], entitlementToken: oneForm.token });
    assert.equal(second.checkout.amountCents, 20000, 'bundle remainder after owning I-765');
    assert.equal(second.checkout.bundleApplied, true);
    const covered = [...oneForm.checkout.scope.forms, ...second.checkout.scope.forms].sort();
    assert.deepEqual(covered, ['I-589', 'I-765'], 'resulting coverage is both forms');
    const paidChain = oneForm.checkout.amountCents + second.checkout.amountCents;
    assert.equal(paidChain, 34900, '14900 + 20000 = $349.00 total');
  });

  it('case 5(d)/8: an abandoned unpaid formprep checkout is VOIDED and replaced — only one live session; after payment a repeat is 409', async () => {
    const parent = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-765'] });
    const attempt1 = await checkout({ sku: FORMPREP_SKU, forms: ['I-589'], entitlementToken: parent.token });
    assert.equal(attempt1.statusCode, 200);
    const attempt2 = await checkout({ sku: FORMPREP_SKU, forms: ['I-589'], entitlementToken: parent.token });
    assert.equal(attempt2.statusCode, 200);
    assert.notEqual(attempt1.body.entitlementId, attempt2.body.entitlementId);
    const first = entitlementStore.getById(attempt1.body.entitlementId);
    assert.equal(first.state, 'VOID', 'the abandoned checkout entitlement is voided, not stacked');
    assert.equal(first.voidReason, 'superseded-by-new-checkout');
    const live = entitlementStore.childrenOf(parent.id)
      .filter((c) => c.sku === FORMPREP_SKU && c.state === 'RESERVED');
    assert.equal(live.length, 1, 'exactly one live (unpaid, unvoided) formprep session remains');
    assert.equal(live[0].id, attempt2.body.entitlementId);
    // After the replacement is paid, any further purchase of the same form on this parent → 409.
    await paySession(attempt2.body.entitlementId);
    const repeat = await checkout({ sku: FORMPREP_SKU, forms: ['I-589'], entitlementToken: parent.token });
    assert.equal(repeat.statusCode, 409);
    assert.equal(repeat.body.reason, 'already-purchased');
  });

  it('case 5(e): the token alone is the credential — a "different session" (new source, no shared state) behaves identically, by design', async () => {
    const oneForm = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-765'] });
    // Original "session": status lookup from one source.
    const fromOriginal = await statusOf(oneForm.token, { headers: { 'x-forwarded-for': '192.0.2.10' } });
    assert.equal(fromOriginal.statusCode, 200);
    // "Different session": a fresh lookup carrying ONLY the token, from a
    // different source address with no cookies/session state at all.
    const fromElsewhere = await statusOf(oneForm.token, { headers: { 'x-forwarded-for': '198.51.100.23' } });
    assert.equal(fromElsewhere.statusCode, 200);
    assert.deepEqual(fromElsewhere.body, fromOriginal.body, 'no IP/session binding: token-only lookup is identical');
    // The same token also works as the owned-form proof from elsewhere:
    const second = await checkout(
      { sku: FORMPREP_SKU, forms: ['I-589'], entitlementToken: oneForm.token },
      { headers: { 'x-forwarded-for': '198.51.100.24' } },
    );
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.amountCents, 20000);
  });

  it('case 6 (handler level): a webhook signed with the WRONG secret is rejected 400 and applies nothing', async () => {
    const formprep = await checkout({ sku: FORMPREP_SKU, forms: ['I-765'] });
    assert.equal(formprep.statusCode, 200);
    const res = await sendWebhook({
      id: `evt_acc_bad_${++eventCounter}`,
      type: 'checkout.session.completed',
      data: { object: { id: `sess_${formprep.body.entitlementId}`, payment_status: 'paid' } },
    }, 'whsec_attacker_controlled');
    assert.equal(res.statusCode, 400);
    const st = await statusOf(formprep.body.entitlementToken);
    assert.equal(st.body.entitlement.paid, false, 'a forged webhook never marks paid');
  });

  it('case 6 (handler level): a signed event for an unknown session does not crash, is not applied, and its event id is not burned', async () => {
    const evtId = `evt_acc_unknown_${++eventCounter}`;
    const res = await sendWebhook({
      id: evtId,
      type: 'checkout.session.completed',
      data: { object: { id: 'sess_does_not_exist', payment_status: 'paid' } },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.received, true);
    assert.equal(res.body.applied, false);
    assert.equal(entitlementStore.hasProcessedEvent(evtId), false, 'redelivery after the session exists must still be able to fulfill');
  });

  it('case 7: entitlement-status for a fabricated/unknown token is 404', async () => {
    const res = await statusOf('totally-fabricated-token-value');
    assert.equal(res.statusCode, 404);
  });

  it('D3 (app scope): restricted live keys (rk_live) are refused exactly like sk_live', async () => {
    process.env.IRU_STRIPE_KEY = 'rk_live_should_never_be_used';
    try {
      const res = await checkout({ sku: FORMPREP_SKU, forms: ['I-765'] });
      assert.equal(res.statusCode, 500);
      assert.match(res.body.error, /not authorized/);
    } finally {
      process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    }
  });
});

describe('source guards (case 7 + offer UI amounts)', () => {
  const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const checkoutSrc = readFileSync(new URL('./checkout.js', import.meta.url), 'utf8');

  it('the client never treats ?checkout=success as proof of payment', () => {
    // The client MAY read the return URL as a trigger, but it must NEVER
    // grant entitlement from URL params alone. Every grant path must go
    // through server-side verification via /api/verify-session.
    // (The Stripe return handler reads ?checkout=success only to
    // trigger a server verification; the stage is set from the server
    // response, never from the URL.)
    assert.ok(appSrc.includes('/api/entitlement-status') || appSrc.includes('/api/verify-session'), 'entitlement state comes from a server verification endpoint');
    // Anchor on the actual return handling, not the first 'checkout'
    // substring (which is the checkout-pricing import): every return
    // effect must call the server before routing on the URL param.
    const occurrences = [...appSrc.matchAll(/params\.get\('checkout'\)/g)].map((m) => m.index);
    assert.ok(occurrences.length >= 1, 'a ?checkout=success handler must exist');
    for (const idx of occurrences) {
      const snippet = appSrc.slice(Math.max(0, idx - 500), idx + 3000);
      assert.ok(snippet.includes('/api/verify-session'),
        'any ?checkout=success handling must verify via the server before routing');
    }
    // No direct URL-to-entitlement assignment: the success param must not
    // appear in a setStage('LANG') call without a server round-trip first.
    assert.ok(!/params\.get\('checkout'\)[^}]{0,400}setStage\(['"]LANG['"]\)/.test(appSrc.replace(/\s+/g, ' ')),
      'LANG stage is never set directly from the URL param');
  });

  it('the Stripe success URL carries the session ID template, never the bearer token', () => {
    const m = checkoutSrc.match(/success_url[^\n]*/);
    assert.ok(m, 'checkout.js builds a success_url');
    assert.ok(m[0].includes('session_id={CHECKOUT_SESSION_ID}'), 'success URL uses Stripe session ID template');
    assert.ok(!/token/i.test(m[0]), 'the bearer token never appears in the success URL');
  });

  it('offer UI: the retired PRICING record is preserved as history, and the new offer surface prices the $349 bundle', () => {
    // Retired record: the four B2C rows still exist with their
    // historical amounts, each flagged retired.
    assert.equal(PRICING.evaluation.chargeCents, 100);
    assert.equal(PRICING.oneForm.chargeCents, 9895);
    assert.equal(PRICING.oneForm.totalCents, 9995);
    assert.equal(PRICING.bundle.chargeCents, 14895);
    assert.equal(PRICING.bundle.totalCents, 14995);
    assert.equal(PRICING.secondForm.chargeCents, 5000);
    for (const row of Object.values(PRICING)) {
      assert.equal(row.retired, true, `${row.sku} is retired`);
    }
    assert.notEqual(formatCents(PRICING.oneForm.chargeCents), '');
    // New offer surface: catalog levels price the pair at $349, not $348.
    assert.equal(FORMS['I-765'].level, 1, 'I-765 is level 1 ($149)');
    assert.equal(FORMS['I-589'].level, 3, 'I-589 is level 3 ($249)');
    const priced = pricePurchase({ ownedForms: [], selectedForm: 'I-765', addedForm: 'I-589' });
    assert.equal(priced.ok, true);
    assert.equal(priced.totalCents, 34900, 'I-765 + I-589 bundle is $349.00');
    assert.equal(priced.bundleApplied, true);
  });
});
