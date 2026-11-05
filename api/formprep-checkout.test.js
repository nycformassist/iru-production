import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementStore } from './_lib/entitlement.js';
import { verifyStripeSignature, signStripePayload } from './_lib/stripewebhook.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';

// Pathway formprep checkout (owner-approved pricing 2026-11-05).
// Server-side pricing only: the client never sets the amount.
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
  headers: { 'x-forwarded-for': `10.9.1.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

describe('formprep checkout (iru-formprep SKU)', () => {
  let savedEnv;
  let capturedSessions;
  before(() => {
    savedEnv = { ...process.env };
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_formprep_local';
    process.env.IRU_ASSESSMENT_PRICE_CENTS = '4995';
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

  it('I-765 + I-589 together charges the $349 bundle, not $348', async () => {
    const store = freshStore();
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-765', 'I-589'],
      clientKey: 'case-123', purchaseIntentKey: 'intent-bundle-1',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 34900);
    assert.equal(res.body.totalCents, 34900);
    assert.equal(res.body.bundleApplied, true);
    assert.deepEqual(res.body.scope, { kind: 'forms', forms: ['I-765', 'I-589'] });
    assert.deepEqual(res.body.forms, ['I-765', 'I-589']);
    assert.equal(res.body.lines.length, 2);
    assert.equal(res.body.lines.reduce((s, l) => s + l.finalCents, 0), 34900);
    // Case identity travels to the Stripe session.
    assert.equal(capturedSessions.length, 1);
    assert.equal(capturedSessions[0].clientKey, 'case-123');
    assert.deepEqual(capturedSessions[0].forms, ['I-765', 'I-589']);
    assert.equal(capturedSessions[0].amountCents, 34900);
  });

  it('I-589 + I-765 in the other order is the same $349 bundle', async () => {
    const store = freshStore();
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-589', 'I-765'],
      purchaseIntentKey: 'intent-bundle-2',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 34900);
    assert.equal(res.body.bundleApplied, true);
  });

  it('I-130 + I-485: first full price, second regular less $50', async () => {
    const store = freshStore();
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-130', 'I-485'],
      purchaseIntentKey: 'intent-130-485',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 39800);
    assert.equal(res.body.bundleApplied, false);
    assert.deepEqual(res.body.lines.map((l) => [l.form, l.finalCents, l.kind]), [
      ['I-130', 19900, 'first'],
      ['I-485', 19900, 'additional'],
    ]);
  });

  it('single form alone charges its regular price', async () => {
    const store = freshStore();
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-765'],
      purchaseIntentKey: 'intent-single',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 14900);
    assert.equal(res.body.bundleApplied, false);
  });

  it('owned I-765 + add I-589 charges the bundle remainder ($200)', async () => {
    const store = freshStore();
    // Paid one-form parent entitlement for I-765.
    const { entitlement, token } = store.create({
      sku: 'iru-complete-one-form', amountCents: 9895,
      scope: { kind: 'forms', forms: ['I-765'] },
    });
    store.attachSession(entitlement.id, 'sess_parent_765');
    assert.equal(store.markPaidBySession('sess_parent_765', 'evt_parent').applied, true);
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-589'],
      entitlementToken: token, purchaseIntentKey: 'intent-add-589',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 20000);
    assert.equal(res.body.bundleApplied, true);
    assert.deepEqual(res.body.forms, ['I-589']);
    // Child is linked to the parent case.
    const child = store.getById(res.body.entitlementId);
    assert.equal(child.parentId, entitlement.id);
  });

  it('owned I-589 + add I-765 charges the bundle remainder ($100)', async () => {
    const store = freshStore();
    const { entitlement, token } = store.create({
      sku: 'iru-complete-one-form', amountCents: 9895,
      scope: { kind: 'forms', forms: ['I-589'] },
    });
    store.attachSession(entitlement.id, 'sess_parent_589');
    assert.equal(store.markPaidBySession('sess_parent_589', 'evt_parent').applied, true);
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-765'],
      entitlementToken: token, purchaseIntentKey: 'intent-add-765',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 10000);
    assert.equal(res.body.bundleApplied, true);
  });

  it('a second purchase of an owned form is refused (409)', async () => {
    const store = freshStore();
    const { entitlement, token } = store.create({
      sku: 'iru-complete-one-form', amountCents: 9895,
      scope: { kind: 'forms', forms: ['I-765'] },
    });
    store.attachSession(entitlement.id, 'sess_p2');
    store.markPaidBySession('sess_p2', 'evt_p2');
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-765'],
      entitlementToken: token, purchaseIntentKey: 'intent-dup',
    }, store);
    assert.equal(res.statusCode, 409);
    // Nothing new to buy: the pricing layer refuses first, before the
    // duplicate-purchase guard (which covers re-buying a paid child).
    assert.equal(res.body.reason, 'already-owned');
  });

  it('I-360 is never purchasable', async () => {
    const store = freshStore();
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-360'],
      purchaseIntentKey: 'intent-360',
    }, store);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.reason, 'form-not-available');
  });

  it('client-sent amounts are ignored — the server prices from the catalog', async () => {
    const store = freshStore();
    const res = await buy({
      sku: 'iru-formprep', forms: ['I-765', 'I-589'],
      amountCents: 1, totalCents: 1,
      purchaseIntentKey: 'intent-tamper',
    }, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 34900);
  });

  it('same intent key + same forms replays the original session; different forms conflict', async () => {
    const store = freshStore();
    const first = await buy({
      sku: 'iru-formprep', forms: ['I-765', 'I-589'],
      purchaseIntentKey: 'intent-replay',
    }, store);
    assert.equal(first.statusCode, 200);
    const replay = await buy({
      sku: 'iru-formprep', forms: ['I-765', 'I-589'],
      purchaseIntentKey: 'intent-replay',
    }, store);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.retried, true);
    assert.equal(replay.body.checkoutUrl, first.body.checkoutUrl);
    assert.equal(replay.body.entitlementId, first.body.entitlementId);
    // Same key, different purchase shape: conflict, no second session.
    const conflict = await buy({
      sku: 'iru-formprep', forms: ['I-130', 'I-485'],
      purchaseIntentKey: 'intent-replay',
    }, store);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.reason, 'intent-conflict');
  });

  it('live Stripe keys are refused', async () => {
    const store = freshStore();
    const saved = process.env.IRU_STRIPE_KEY;
    process.env.IRU_STRIPE_KEY = 'sk_live_FORBIDDEN';
    try {
      const res = await buy({
        sku: 'iru-formprep', forms: ['I-765'],
        purchaseIntentKey: 'intent-live',
      }, store);
      assert.equal(res.statusCode, 500);
    } finally {
      process.env.IRU_STRIPE_KEY = saved;
    }
  });

  it('full flow: bundle checkout → webhook marks paid → both forms usable under one case', async () => {
    const store = freshStore();
    const coRes = await buy({
      sku: 'iru-formprep', forms: ['I-765', 'I-589'],
      clientKey: 'case-flow-1', purchaseIntentKey: 'intent-flow',
    }, store);
    assert.equal(coRes.statusCode, 200);
    const { entitlementToken, entitlementId } = coRes.body;

    const st1 = mockRes();
    await statusHandler(mockReq({ body: { token: entitlementToken } }), st1, store);
    assert.equal(st1.body.usable, false);

    const payload = JSON.stringify({
      id: 'evt_flow_formprep', type: 'checkout.session.completed',
      data: { object: { id: `sess_${entitlementId}` } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const whRes = mockRes();
    await webhookHandler(mockReq({
      rawBody: payload,
      headers: { 'x-forwarded-for': '10.9.9.7', 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
    }), whRes, store);
    assert.equal(whRes.statusCode, 200);
    assert.equal(whRes.body.applied, true);

    const st2 = mockRes();
    await statusHandler(mockReq({ body: { token: entitlementToken } }), st2, store);
    assert.equal(st2.body.usable, true);
    assert.deepEqual(st2.body.entitlement.scope, { kind: 'forms', forms: ['I-765', 'I-589'] });
    assert.equal(st2.body.entitlement.amountCents, 34900);
  });
});
