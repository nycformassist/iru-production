import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { entitlementStore, createEntitlementStore } from './_lib/entitlement.js';
import { PRICING, SKUS, buildOffer, formatCents } from './_lib/pricing.js';
import { FORMPREP_SKU } from './_lib/checkout-pricing.js';

// B2C pricing directive (2026-10-21) as RETIRED by the owner decision
// 2026-11-05 (FINAL): the $1 evaluation and its upgrade/add-on SKUs
// are no longer purchasable. This file now proves:
//  - the retired PRICING record is preserved (amounts as history) and
//    the offer surface reports retired: true everywhere
//  - evaluation / one-form / bundle / second-form checkout → 410
//    'evaluation-retired' with NO entitlement or Stripe session created
//  - formprep works with NO evaluation prerequisite (the live model)
//  - store-level scoped-entitlement semantics (unchanged — these do
//    not go through checkout and stay valid as written)
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
  headers: { 'x-forwarded-for': `10.7.0.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

let eventCounter = 0;
async function paySession(entitlementId, store) {
  const payload = JSON.stringify({
    id: `evt_b2c_${++eventCounter}`,
    type: 'checkout.session.completed',
    data: { object: { id: `sess_${entitlementId}`, payment_status: 'paid' } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const res = mockRes();
  await webhookHandler(mockReq({
    rawBody: payload,
    headers: { 'x-forwarded-for': `10.7.9.${++ipCounter}`, 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
  }), res, store);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applied, true);
  return res;
}

async function checkout(body, store) {
  const res = mockRes();
  await checkoutHandler(mockReq({ body }), res, store);
  return res;
}

/** Buy a SKU and pay for it via a signed webhook. Returns the grant. */
async function buyAndPay(body, store) {
  const res = await checkout(body, store);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  await paySession(res.body.entitlementId, store);
  return { token: res.body.entitlementToken, id: res.body.entitlementId, checkout: res.body };
}

describe('B2C pricing structure — RETIRED 2026-11-05 (owner decision, FINAL)', () => {
  let capturedSessions;
  before(() => {
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    // Payment-hardening gate: paid handlers require an explicit store backend.
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_local';
    capturedSessions = [];
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession(args) {
        capturedSessions.push(args);
        return { id: `sess_${args.entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
  });
  after(() => { delete globalThis.__IRU_STRIPE_GATEWAY__; });

  it('the retired offer record preserves the historical amounts and reports retired: true everywhere', () => {
    const offer = buildOffer();
    assert.equal(offer.retired, true, 'the offer itself is retired');
    assert.equal(offer.evaluation.retired, true);
    assert.equal(offer.evaluation.chargeCents, 100);
    const [one, bundle] = offer.options;
    assert.equal(one.retired, true);
    assert.equal(one.totalCents, 9995);
    assert.equal(one.afterEvaluationChargeCents, 9895);
    assert.match(one.formsIncluded, /exactly one form/i);
    assert.equal(bundle.retired, true);
    assert.equal(bundle.totalCents, 14995);
    assert.equal(bundle.afterEvaluationChargeCents, 14895);
    assert.match(bundle.savingsNote, /\$49\.95/);
    assert.equal(formatCents(PRICING.bundle.separateTotalCents), '$199.90');
    // The bundle must never be represented as two forms for $99.95:
    assert.notEqual(bundle.totalCents, one.totalCents);
    assert.match(bundle.formsIncluded, /both forms/i);
    assert.equal(offer.secondFormAddon.retired, true);
    assert.equal(offer.secondFormAddon.chargeCents, 5000);
    // The PRICING table rows themselves carry the retired flag and
    // keep their historical amounts untouched.
    for (const row of Object.values(PRICING)) {
      assert.equal(row.retired, true, `${row.sku} is retired`);
    }
    assert.equal(PRICING.evaluation.chargeCents, 100);
    assert.equal(PRICING.oneForm.totalCents, 9995);
    assert.equal(PRICING.bundle.totalCents, 14995);
    assert.equal(PRICING.secondForm.chargeCents, 5000);
  });

  it('retired SKUs are refused 410 evaluation-retired — no entitlement, no Stripe session', async () => {
    const cases = [
      { sku: SKUS.EVALUATION },
      { sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: 'any-token' },
      { sku: SKUS.BUNDLE, entitlementToken: 'any-token' },
      { sku: SKUS.SECOND_FORM, entitlementToken: 'any-token' },
    ];
    for (const body of cases) {
      const store = createEntitlementStore();
      const before = capturedSessions.length;
      const res = await checkout(body, store);
      assert.equal(res.statusCode, 410, `${body.sku} must be refused`);
      assert.equal(res.body.reason, 'evaluation-retired');
      assert.match(res.body.error, /retired/i);
      // No entitlement record and no Stripe session were created: the
      // 410 returns before store.create / gateway invocation, so the
      // response carries no entitlement id or token and the gateway
      // saw no new session.
      assert.equal(res.body.entitlementId, undefined);
      assert.equal(res.body.entitlementToken, undefined);
      assert.equal(capturedSessions.length, before, 'no Stripe session created for a retired SKU');
    }
  });

  it('a paid historical evaluation token does NOT resurrect the retired upgrade path', async () => {
    const store = createEntitlementStore();
    const { token } = store.create({
      sku: SKUS.EVALUATION, amountCents: 100, sessionId: 's_hist_b2c',
      scope: { kind: 'evaluation' },
    });
    assert.equal(store.markPaidBySession('s_hist_b2c', 'evt_hist_b2c').applied, true);
    const before = capturedSessions.length;
    const res = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: token }, store);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.reason, 'evaluation-retired');
    assert.equal(capturedSessions.length, before);
  });

  it('formprep works with NO evaluation prerequisite — I-765 then I-589 totals $349', async () => {
    const oneForm = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-765'] });
    assert.equal(oneForm.checkout.amountCents, 14900, 'I-765 prep is $149 with no prior purchase');
    assert.equal(oneForm.checkout.creditedCents, 0, 'no $1 credit in the live model');
    assert.deepEqual(oneForm.checkout.scope, { kind: 'forms', forms: ['I-765'] });

    const res = await checkout({ sku: FORMPREP_SKU, forms: ['I-589'], entitlementToken: oneForm.token });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 20000, 'bundle remainder after owning I-765 is $200');
    assert.equal(res.body.bundleApplied, true);
    assert.deepEqual(res.body.scope, { kind: 'forms', forms: ['I-589'] });
    assert.equal(oneForm.checkout.amountCents + res.body.amountCents, 34900, 'sequential chain totals $349');
  });

  it('client-sent amounts are ignored — the server charges the pricing table (formprep)', async () => {
    const res = await checkout({
      sku: FORMPREP_SKU, forms: ['I-765', 'I-589'],
      amountCents: 1, totalCents: 1, creditedCents: 99999,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 34900);
    assert.equal(res.body.totalCents, 34900);
    assert.equal(res.body.creditedCents, 0);
  });

  it('status reports scope, totals, and per-form delivery state (formprep bundle)', async () => {
    const bundle = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-589', 'I-765'] });
    const st = mockRes();
    await statusHandler(mockReq({ body: { token: bundle.token } }), st);
    assert.equal(st.statusCode, 200);
    assert.equal(st.body.usable, true);
    assert.deepEqual(st.body.entitlement.scope, { kind: 'forms', forms: ['I-589', 'I-765'] });
    assert.equal(st.body.entitlement.totalCents, 34900);
    assert.equal(st.body.entitlement.creditedCents, 0);
    // Deliver one form: still usable for the other; then exhausted.
    assert.equal(entitlementStore.consumeForForm(bundle.token, 'I-589').ok, true);
    const st2 = mockRes();
    await statusHandler(mockReq({ body: { token: bundle.token } }), st2);
    assert.equal(st2.body.usable, true);
    assert.deepEqual(st2.body.entitlement.consumedForms, ['I-589']);
    assert.equal(entitlementStore.consumeForForm(bundle.token, 'I-765').ok, true);
    const st3 = mockRes();
    await statusHandler(mockReq({ body: { token: bundle.token } }), st3);
    assert.equal(st3.body.usable, false);
  });
});

describe('scoped entitlement semantics (store level)', () => {
  it('a bundle delivers each covered form once; the wrong form and replays are refused', () => {
    const store = createEntitlementStore(() => 42_000);
    const { token } = store.create({ sku: SKUS.BUNDLE, amountCents: 14895, sessionId: 's_bundle', scope: { kind: 'forms', forms: ['I-589', 'I-765'] } });
    assert.equal(store.peekForForm(token, 'I-589').ok, false, 'unpaid cannot be used');
    store.markPaidBySession('s_bundle', 'evt_bundle');
    assert.equal(store.peekForForm(token, 'I-589').ok, true);
    assert.equal(store.peekForForm(token, 'I-765').ok, true);
    assert.equal(store.consumeForForm(token, 'I-589').ok, true);
    assert.equal(store.consumeForForm(token, 'I-589').reason, 'form-already-delivered');
    assert.equal(store.peekForForm(token, 'I-765').ok, true, 'the other form remains deliverable');
    assert.equal(store.consumeForForm(token, 'I-765').ok, true);
    assert.equal(store.peekForForm(token, 'I-765').reason, 'state-CONSUMED');
  });

  it('an evaluation entitlement never authorizes a form, and a form entitlement never authorizes the evaluation', () => {
    const store = createEntitlementStore(() => 43_000);
    const ev = store.create({ sku: SKUS.EVALUATION, amountCents: 100, sessionId: 's_ev', scope: { kind: 'evaluation' } });
    store.markPaidBySession('s_ev', 'evt_ev');
    assert.equal(store.peekForEvaluation(ev.token).ok, true);
    assert.equal(store.peekForForm(ev.token, 'I-589').reason, 'scope-mismatch');
    const form = store.create({ sku: SKUS.ONE_FORM, amountCents: 9895, sessionId: 's_f', scope: { kind: 'forms', forms: ['I-589'] } });
    store.markPaidBySession('s_f', 'evt_f');
    assert.equal(store.peekForEvaluation(form.token).reason, 'scope-mismatch');
    assert.equal(store.peekForForm(form.token, 'I-765').reason, 'form-not-covered');
  });

  it('legacy (null-scope) entitlements keep whole-token, any-form semantics', () => {
    const store = createEntitlementStore(() => 44_000);
    const { token } = store.create({ sku: SKUS.LEGACY, amountCents: 4995, sessionId: 's_leg' });
    store.markPaidBySession('s_leg', 'evt_leg');
    assert.equal(store.peekForForm(token, 'I-765').ok, true);
    assert.equal(store.consumeForForm(token, 'I-765').ok, true);
    assert.equal(store.peekForForm(token, 'I-765').reason, 'state-CONSUMED');
  });
});
