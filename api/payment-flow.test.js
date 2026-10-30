import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementStore } from './_lib/entitlement.js';
import { verifyStripeSignature, signStripePayload } from './_lib/stripewebhook.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';
import { entitlementStore } from './_lib/entitlement.js';
import { createFactRecord, upsertFact } from './_lib/facts.js';

// Directive §15 payment tests — all local, test-mode semantics only.
// The Stripe gateway is injected; no network, no real keys, no money.

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipCounter = 0;
// Unique IP per request: the rate limiter's bucket map is module-shared,
// so tests must not collide in one bucket (production IPs differ per buyer).
const mockReq = (over = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': `10.9.0.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

describe('entitlement state machine', () => {
  it('RESERVED → paid → CONSUMED exactly once; replayed consumption refused', () => {
    let t = 1_000_000;
    const store = createEntitlementStore(() => t);
    const { entitlement, token } = store.create({ sku: 'x', amountCents: 100, sessionId: 'sess_1' });
    assert.equal(entitlement.state, 'RESERVED');
    assert.equal(store.peekByToken(token).ok, false); // not paid yet
    const paid = store.markPaidBySession('sess_1', 'evt_1');
    assert.equal(paid.applied, true);
    assert.equal(store.peekByToken(token).ok, true);
    const consumed = store.consumeByToken(token);
    assert.equal(consumed.ok, true);
    assert.equal(store.consumeByToken(token).ok, false); // no double consumption
    assert.equal(store.consumeByToken(token).reason, 'already-consumed');
  });

  it('duplicate webhook events are idempotent', () => {
    const store = createEntitlementStore(() => 5_000);
    store.create({ sku: 'x', amountCents: 100, sessionId: 'sess_2' });
    assert.equal(store.markPaidBySession('sess_2', 'evt_dup').applied, true);
    const again = store.markPaidBySession('sess_2', 'evt_dup');
    assert.equal(again.applied, false);
    assert.equal(again.duplicate, true);
  });

  it('unpaid entitlements expire after the TTL; paid ones after the claim window', () => {
    let t = 0;
    const store = createEntitlementStore(() => t);
    const a = store.create({ sku: 'x', amountCents: 1, sessionId: 's_a', ttlMs: 1000 });
    t = 2000;
    assert.equal(store.getById(a.entitlement.id).state, 'EXPIRED');
    let t2 = 0;
    const store2 = createEntitlementStore(() => t2);
    const b = store2.create({ sku: 'x', amountCents: 1, sessionId: 's_b', ttlMs: 1000, claimWindowMs: 5000 });
    store2.markPaidBySession('s_b', 'e1');
    t2 = 6000;
    assert.equal(store2.getById(b.entitlement.id).state, 'EXPIRED');
    assert.equal(store2.consumeByToken(b.token).ok, false);
  });

  it('an event for an unknown session is NOT burned — redelivery after attach still fulfills', () => {
    const store = createEntitlementStore(() => 7_000);
    const { entitlement } = store.create({ sku: 'x', amountCents: 100 });
    const early = store.markPaidBySession('sess_late', 'evt_late');
    assert.equal(early.applied, false);
    assert.equal(early.reason, 'unknown-session');
    assert.equal(store.hasProcessedEvent('evt_late'), false);
    store.attachSession(entitlement.id, 'sess_late');
    const redelivered = store.markPaidBySession('sess_late', 'evt_late');
    assert.equal(redelivered.applied, true);
  });

  it('unknown/forged tokens never resolve', () => {
    const store = createEntitlementStore();
    assert.equal(store.getByToken('forged-token'), null);
    assert.equal(store.consumeByToken('forged-token').ok, false);
  });
});

describe('webhook signature verification', () => {
  const secret = 'whsec_test_local';
  const payload = JSON.stringify({ id: 'evt_9', type: 'checkout.session.completed', data: { object: { id: 'sess_9' } } });

  it('accepts a correctly signed, fresh payload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = signStripePayload(payload, secret, ts);
    assert.equal(verifyStripeSignature(payload, header, secret).ok, true);
  });

  it('rejects tampered payloads, wrong secrets, and stale timestamps (replay)', () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = signStripePayload(payload, secret, ts);
    assert.equal(verifyStripeSignature(payload + ' ', header, secret).ok, false);
    assert.equal(verifyStripeSignature(payload, header, 'whsec_other').ok, false);
    const stale = signStripePayload(payload, secret, ts - 3600);
    assert.equal(verifyStripeSignature(payload, stale, secret).ok, false);
  });
});

const T0 = '2026-10-21T00:00:00.000Z';

describe('checkout → webhook → status → delivery flow (handlers, injected gateway)', () => {
  let savedEnv;
  before(() => {
    savedEnv = { ...process.env };
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    // Payment-hardening gate: paid handlers require an explicit store backend.
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_local';
    process.env.IRU_ASSESSMENT_PRICE_CENTS = '4995';
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

  it('full purchase-to-delivery path works and cannot be consumed twice', async () => {
    // 1. Checkout creates a RESERVED entitlement + session.
    const coRes = mockRes();
    await checkoutHandler(mockReq(), coRes);
    assert.equal(coRes.statusCode, 200);
    const { entitlementToken, entitlementId } = coRes.body;
    assert.ok(entitlementToken);

    // 2. Before payment, status says not usable.
    const st1 = mockRes();
    await statusHandler(mockReq({ body: { token: entitlementToken } }), st1);
    assert.equal(st1.body.usable, false);

    // 3. Signed webhook marks it paid — the redirect alone proves nothing.
    const payload = JSON.stringify({ id: 'evt_flow', type: 'checkout.session.completed', data: { object: { id: `sess_${entitlementId}` } } });
    const ts = Math.floor(Date.now() / 1000);
    const whRes = mockRes();
    await webhookHandler(mockReq({
      rawBody: payload,
      headers: { 'x-forwarded-for': '10.9.9.1', 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
    }), whRes);
    assert.equal(whRes.statusCode, 200);
    assert.equal(whRes.body.applied, true);

    // 4. Duplicate webhook delivery is acknowledged, not reapplied.
    const wh2 = mockRes();
    await webhookHandler(mockReq({
      rawBody: payload,
      headers: { 'x-forwarded-for': '10.9.9.1', 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
    }), wh2);
    assert.equal(wh2.body.duplicate, true);

    // 5. Status now usable (recovery path for an interrupted buyer).
    const st2 = mockRes();
    await statusHandler(mockReq({ body: { token: entitlementToken } }), st2);
    assert.equal(st2.body.usable, true);

    // 6. Delivery consumes exactly once.
    const peek = entitlementStore.peekByToken(entitlementToken);
    assert.equal(peek.ok, true);
    assert.equal(entitlementStore.consumeByToken(entitlementToken).ok, true);
    assert.equal(entitlementStore.consumeByToken(entitlementToken).ok, false);
  });

  it('an UNPAID session completion never marks paid; the async success event does', async () => {
    const coRes = mockRes();
    await checkoutHandler(mockReq(), coRes);
    assert.equal(coRes.statusCode, 200);
    const { entitlementToken, entitlementId } = coRes.body;
    const sendEvent = async (evt) => {
      const payload = JSON.stringify(evt);
      const ts = Math.floor(Date.now() / 1000);
      const res = mockRes();
      await webhookHandler(mockReq({
        rawBody: payload,
        headers: { 'x-forwarded-for': '10.9.9.2', 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
      }), res);
      return res;
    };
    const unpaid = await sendEvent({ id: 'evt_unpaid', type: 'checkout.session.completed', data: { object: { id: `sess_${entitlementId}`, payment_status: 'unpaid' } } });
    assert.equal(unpaid.statusCode, 200);
    assert.equal(unpaid.body.applied, false);
    assert.equal(entitlementStore.peekByToken(entitlementToken).ok, false);
    const succeeded = await sendEvent({ id: 'evt_async_ok', type: 'checkout.session.async_payment_succeeded', data: { object: { id: `sess_${entitlementId}`, payment_status: 'paid' } } });
    assert.equal(succeeded.body.applied, true);
    assert.equal(entitlementStore.peekByToken(entitlementToken).ok, true);
  });

  it('an unsigned webhook is rejected and changes nothing', async () => {
    const payload = JSON.stringify({ id: 'evt_evil', type: 'checkout.session.completed', data: { object: { id: 'sess_nope' } } });
    const res = mockRes();
    await webhookHandler(mockReq({ rawBody: payload, headers: {} }), res);
    assert.equal(res.statusCode, 400);
  });

  it('live Stripe keys are refused — test mode only', async () => {
    process.env.IRU_STRIPE_KEY = 'sk_live_should_never_be_used';
    const res = mockRes();
    await checkoutHandler(mockReq(), res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /not authorized/);
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
  });

  it('no price is available when the server env does not configure one', async () => {
    delete process.env.IRU_ASSESSMENT_PRICE_CENTS;
    const res = mockRes();
    await checkoutHandler(mockReq(), res);
    assert.equal(res.statusCode, 503);
    process.env.IRU_ASSESSMENT_PRICE_CENTS = '4995';
  });
});

describe('paywall gate on form generation (§11 no double consumption)', () => {
  it('with PAYWALL_ENABLED, generation requires a paid entitlement and consumes it once', async () => {
    process.env.PAYWALL_ENABLED = 'true';
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    process.env.IRU_ASSESSMENT_PRICE_CENTS = '4995';
    // Payment-hardening gate: paid handlers require an explicit store backend.
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession({ entitlementId }) {
        return { id: `sess_gate_${entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
    try {
      const { default: generateHandler } = await import('./generate-form.js');
      const record = createFactRecord(T0);
      upsertFact(record, { id: 'family_name', value: 'Testfamily', source: 'answer' }, T0);

      // No token → 402.
      const noTok = mockRes();
      await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: record } }), noTok);
      assert.equal(noTok.statusCode, 402);

      // Paid token → 200 with a PDF; second use → 402 (consumed).
      const coRes = mockRes();
      await checkoutHandler(mockReq(), coRes);
      const { entitlementToken, entitlementId } = coRes.body;
      entitlementStore.markPaidBySession(`sess_gate_${entitlementId}`, 'evt_gate');
      const okRes = mockRes();
      await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: record, entitlementToken } }), okRes);
      assert.equal(okRes.statusCode, 200);
      assert.ok(okRes.body.pdfBase64.length > 1000);
      const again = mockRes();
      await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: record, entitlementToken } }), again);
      assert.equal(again.statusCode, 402);
    } finally {
      delete process.env.PAYWALL_ENABLED;
      delete globalThis.__IRU_STRIPE_GATEWAY__;
    }
  });
});
