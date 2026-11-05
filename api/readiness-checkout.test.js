import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementStore } from './_lib/entitlement.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';
import { READINESS_SKU, pricePurchase } from './_lib/checkout-pricing.js';

// Readiness checkout (owner-approved pricing 2026-11-05, FINAL).
// iru-readiness: $99.95 flat for ONE of I-589 / I-765, no prerequisite,
// no prior purchase. Grants scope { kind: 'readiness', forms: [form] }.
// Readiness is a separate service: it never discounts preparation and
// never counts as owning a form.
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
  headers: { 'x-forwarded-for': `10.9.2.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

describe('readiness checkout (iru-readiness SKU)', () => {
  let savedEnv;
  let capturedSessions;
  before(() => {
    savedEnv = { ...process.env };
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_readiness_local';
    capturedSessions = [];
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession(args) {
        capturedSessions.push(args);
        return { id: `sess_${args.entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
  });
  after(() => {
    process.env = savedEnv;
    delete globalThis.__IRU_STRIPE_GATEWAY__;
  });

  const buy = async (body, store) => {
    const res = mockRes();
    await checkoutHandler(mockReq({ body }), res, store);
    return res;
  };
  const freshStore = () => createEntitlementStore();

  it('I-589 readiness charges exactly $99.95 with a readiness scope', async () => {
    const store = freshStore();
    const res = await buy({
      sku: READINESS_SKU, form: 'I-589',
      clientKey: 'case-readiness-1', purchaseIntentKey: 'intent-read-589',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sku, READINESS_SKU);
    assert.equal(res.body.amountCents, 9995);
    assert.equal(res.body.totalCents, 9995);
    assert.equal(res.body.creditedCents, 0);
    assert.deepEqual(res.body.scope, { kind: 'readiness', forms: ['I-589'] });
    assert.equal(res.body.currency, 'usd');
    // Case identity + form travel to the Stripe session.
    assert.equal(capturedSessions.length, 1);
    assert.equal(capturedSessions[0].clientKey, 'case-readiness-1');
    assert.deepEqual(capturedSessions[0].forms, ['I-589']);
    assert.equal(capturedSessions[0].amountCents, 9995);
  });

  it('I-765 readiness charges exactly $99.95', async () => {
    const store = freshStore();
    const res = await buy({ sku: READINESS_SKU, form: 'I-765' }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 9995);
    assert.equal(res.body.totalCents, 9995);
    assert.deepEqual(res.body.scope, { kind: 'readiness', forms: ['I-765'] });
  });

  it('readiness requires NO prior entitlement — no token, no evaluation, no purchase', async () => {
    const store = freshStore();
    const res = await buy({ sku: READINESS_SKU, form: 'I-589' }, store);
    assert.equal(res.statusCode, 200, 'a bare readiness purchase succeeds with no prior entitlement');
    assert.equal(res.body.amountCents, 9995);
  });

  it('I-130 readiness is refused — Readiness covers I-589 / I-765 only', async () => {
    const store = freshStore();
    const res = await buy({ sku: READINESS_SKU, form: 'I-130' }, store);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.reason, 'form-not-available');
  });

  it('I-360 readiness is refused — never priced, never available', async () => {
    const store = freshStore();
    const res = await buy({ sku: READINESS_SKU, form: 'I-360' }, store);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.reason, 'form-not-available');
  });

  it('client-sent amounts are ignored — the server charges $99.95', async () => {
    const store = freshStore();
    const res = await buy({
      sku: READINESS_SKU, form: 'I-765',
      amountCents: 1, totalCents: 1,
      purchaseIntentKey: 'intent-read-tamper',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 9995);
    assert.equal(res.body.totalCents, 9995);
  });

  it('a paid readiness entitlement does NOT count as owning the form for preparation', async () => {
    // Readiness ≠ prep: pricePurchase must charge the FULL regular
    // price, with no $50 discount and no bundle trigger, even when
    // the case holds Readiness for that form.
    const priced = pricePurchase({
      readinessForms: ['I-765'], ownedForms: [], selectedForm: 'I-765',
    });
    assert.equal(priced.ok, true);
    assert.equal(priced.totalCents, 14900, 'I-765 prep is still $149 in full');
    assert.equal(priced.bundleApplied, false, 'readiness never triggers the bundle');
    assert.equal(priced.lines[0].kind, 'first');
    assert.equal(priced.lines[0].discountCents, 0, 'readiness never discounts preparation');
    // Readiness for one form does not discount the other form either.
    const other = pricePurchase({
      readinessForms: ['I-765'], ownedForms: [], selectedForm: 'I-589',
    });
    assert.equal(other.totalCents, 24900, 'I-589 prep is still $249 in full');
  });

  it('a duplicate paid readiness purchase for the same form is refused (409); the other form is not a duplicate', async () => {
    const store = freshStore();
    const { entitlement, token } = store.create({
      sku: READINESS_SKU, amountCents: 9995, sessionId: 'sess_read_dup',
      scope: { kind: 'readiness', forms: ['I-765'] },
    });
    assert.equal(store.markPaidBySession('sess_read_dup', 'evt_read_dup').applied, true);
    assert.equal(entitlement.id.length > 0, true);

    const dup = await buy({
      sku: READINESS_SKU, form: 'I-765',
      entitlementToken: token, purchaseIntentKey: 'intent-read-dup',
    }, store);
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.body.reason, 'already-purchased');

    // The OTHER form under the same token is a separate purchase.
    const other = await buy({
      sku: READINESS_SKU, form: 'I-589',
      entitlementToken: token, purchaseIntentKey: 'intent-read-other',
    }, store);
    assert.equal(other.statusCode, 200);
    assert.equal(other.body.amountCents, 9995);
    assert.deepEqual(other.body.scope, { kind: 'readiness', forms: ['I-589'] });
  });

  it('same intent key + same form replays the original session; a different form conflicts', async () => {
    const store = freshStore();
    const first = await buy({
      sku: READINESS_SKU, form: 'I-589',
      purchaseIntentKey: 'intent-read-replay',
    }, store);
    assert.equal(first.statusCode, 200);
    const replay = await buy({
      sku: READINESS_SKU, form: 'I-589',
      purchaseIntentKey: 'intent-read-replay',
    }, store);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.retried, true);
    assert.equal(replay.body.checkoutUrl, first.body.checkoutUrl);
    assert.equal(replay.body.entitlementId, first.body.entitlementId);
    // Same key, different form: conflict, no second session.
    const conflict = await buy({
      sku: READINESS_SKU, form: 'I-765',
      purchaseIntentKey: 'intent-read-replay',
    }, store);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.reason, 'intent-conflict');
  });

  it('full flow: readiness checkout → webhook marks paid → readiness scope is usable', async () => {
    const store = freshStore();
    const coRes = await buy({
      sku: READINESS_SKU, form: 'I-589',
      clientKey: 'case-flow-read', purchaseIntentKey: 'intent-read-flow',
    }, store);
    assert.equal(coRes.statusCode, 200);
    const { entitlementToken, entitlementId } = coRes.body;

    const st1 = mockRes();
    await statusHandler(mockReq({ body: { token: entitlementToken } }), st1, store);
    assert.equal(st1.body.usable, false);

    const payload = JSON.stringify({
      id: 'evt_flow_readiness', type: 'checkout.session.completed',
      data: { object: { id: `sess_${entitlementId}` } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const whRes = mockRes();
    await webhookHandler(mockReq({
      rawBody: payload,
      headers: { 'x-forwarded-for': '10.9.9.8', 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
    }), whRes, store);
    assert.equal(whRes.statusCode, 200);
    assert.equal(whRes.body.applied, true);

    const st2 = mockRes();
    await statusHandler(mockReq({ body: { token: entitlementToken } }), st2, store);
    assert.equal(st2.body.usable, true);
    assert.deepEqual(st2.body.entitlement.scope, { kind: 'readiness', forms: ['I-589'] });
    assert.equal(st2.body.entitlement.amountCents, 9995);
  });
});
