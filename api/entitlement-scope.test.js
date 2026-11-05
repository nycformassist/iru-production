import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementStore } from './_lib/entitlement.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';
import { READINESS_SKU, FORMPREP_SKU } from './_lib/checkout-pricing.js';

// Entitlement scope enforcement (owner decision 2026-11-05).
// Scopes are exact and non-transferable:
//   readiness { kind: 'readiness', forms: [F] } — one form, readiness only
//   preparation { kind: 'forms', forms: [...] } — exactly those forms
//   evaluation { kind: 'evaluation' } — historical holders only
// A token for one scope never satisfies another product, one form never
// covers another, and a refresh/revisit with a fabricated or unpaid
// token buys nothing. Proven through the real purchase path
// (checkout → signed webhook → status/peek), not just store construction.
// All local, test-mode semantics only — Stripe gateway is injected;
// no network, no real keys, no money.

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
  headers: { 'x-forwarded-for': `10.9.3.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

let eventCounter = 0;
async function paySession(entitlementId, store) {
  const payload = JSON.stringify({
    id: `evt_scope_${++eventCounter}`,
    type: 'checkout.session.completed',
    data: { object: { id: `sess_${entitlementId}`, payment_status: 'paid' } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const res = mockRes();
  await webhookHandler(mockReq({
    rawBody: payload,
    headers: { 'x-forwarded-for': `10.9.9.${++ipCounter}`, 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
  }), res, store);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applied, true);
  return res;
}
async function buyAndPay(body, store) {
  const res = mockRes();
  await checkoutHandler(mockReq({ body }), res, store);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  await paySession(res.body.entitlementId, store);
  return { token: res.body.entitlementToken, id: res.body.entitlementId, checkout: res.body };
}
async function statusOf(token, store) {
  const res = mockRes();
  await statusHandler(mockReq({ body: { token } }), res, store);
  return res;
}

describe('entitlement scoping (checkout + status level)', () => {
  let savedEnv;
  before(() => {
    savedEnv = { ...process.env };
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_scope_local';
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession({ entitlementId }) {
        return { id: `sess_${entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
  });
  after(() => {
    process.env = savedEnv;
    delete globalThis.__IRU_STRIPE_GATEWAY__;
  });

  const freshStore = () => createEntitlementStore();

  it('(a) readiness ≠ prep: a paid readiness token for I-765 does NOT satisfy a preparation requirement', async () => {
    const store = freshStore();
    const readiness = await buyAndPay({ sku: READINESS_SKU, form: 'I-765' }, store);
    assert.equal(readiness.checkout.amountCents, 9995);
    // Status shows the readiness scope, usable as readiness.
    const st = await statusOf(readiness.token, store);
    assert.equal(st.statusCode, 200);
    assert.equal(st.body.usable, true);
    assert.equal(st.body.entitlement.scope.kind, 'readiness');
    assert.deepEqual(st.body.entitlement.scope.forms, ['I-765']);
    // But the form-generation gate refuses it: readiness is not prep.
    const peek = store.peekForForm(readiness.token, 'I-765');
    assert.equal(peek.ok, false);
    assert.equal(peek.reason, 'scope-mismatch', 'a readiness token never authorizes form preparation');
    // And it never authorizes the limited evaluation either.
    assert.equal(store.peekForEvaluation(readiness.token).reason, 'scope-mismatch');
  });

  it('(b) one form ≠ another: a paid formprep token for I-765 covers I-765 but NOT I-589', async () => {
    const store = freshStore();
    const prep = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-765'] }, store);
    assert.equal(prep.checkout.amountCents, 14900);
    const st = await statusOf(prep.token, store);
    assert.equal(st.body.usable, true);
    assert.deepEqual(st.body.entitlement.scope, { kind: 'forms', forms: ['I-765'] });
    assert.equal(store.peekForForm(prep.token, 'I-765').ok, true, 'the purchased form is covered');
    const other = store.peekForForm(prep.token, 'I-589');
    assert.equal(other.ok, false);
    assert.equal(other.reason, 'form-not-covered', 'the unpurchased form is not covered');
  });

  it('(c) bundle = exactly two forms: a paid formprep token for I-589+I-765 covers both and NOT I-130', async () => {
    const store = freshStore();
    const bundle = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-589', 'I-765'] }, store);
    assert.equal(bundle.checkout.amountCents, 34900);
    const st = await statusOf(bundle.token, store);
    assert.equal(st.body.usable, true);
    assert.deepEqual(st.body.entitlement.scope, { kind: 'forms', forms: ['I-589', 'I-765'] });
    assert.equal(store.peekForForm(bundle.token, 'I-589').ok, true);
    assert.equal(store.peekForForm(bundle.token, 'I-765').ok, true);
    const outside = store.peekForForm(bundle.token, 'I-130');
    assert.equal(outside.ok, false);
    assert.equal(outside.reason, 'form-not-covered', 'the bundle covers exactly its two forms');
  });

  it('(d) refresh/revisit cannot bypass: fabricated tokens 404, unpaid tokens are unusable, wrong-scope tokens stay unusable', async () => {
    const store = freshStore();
    // Fabricated token: nothing to find.
    const forged = await statusOf('totally-fabricated-token-value', store);
    assert.equal(forged.statusCode, 404);
    // Unpaid (RESERVED, never paid) token: found, but paid:false and unusable.
    const unpaidRes = mockRes();
    await checkoutHandler(mockReq({ body: { sku: FORMPREP_SKU, forms: ['I-765'] } }), unpaidRes, store);
    assert.equal(unpaidRes.statusCode, 200);
    const unpaid = await statusOf(unpaidRes.body.entitlementToken, store);
    assert.equal(unpaid.statusCode, 200);
    assert.equal(unpaid.body.entitlement.paid, false);
    assert.equal(unpaid.body.usable, false, 'an unpaid checkout grants nothing on revisit');
    assert.equal(store.peekForForm(unpaidRes.body.entitlementToken, 'I-765').reason, 'not-paid');
    // Wrong-scope token: a paid formprep token is unusable for the
    // limited evaluation, and vice versa.
    const prep = await buyAndPay({ sku: FORMPREP_SKU, forms: ['I-765'] }, store);
    assert.equal(store.peekForEvaluation(prep.token).reason, 'scope-mismatch');
    const readiness = await buyAndPay({ sku: READINESS_SKU, form: 'I-765' }, store);
    assert.equal(store.peekForEvaluation(readiness.token).reason, 'scope-mismatch');
    assert.equal(store.peekForForm(readiness.token, 'I-765').reason, 'scope-mismatch');
  });
});
