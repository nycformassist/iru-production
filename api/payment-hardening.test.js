import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementStore, entitlementStore } from './_lib/entitlement.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';

// Payment-hardening directive 2026-10-24 — reproduction + regression tests.
// All local, synthetic, test-mode semantics only. The Stripe gateway is
// injected; no network, no real keys, no money. Each test below encodes
// the FIXED behavior; run before the fix it must fail (reproduction),
// run after the fix it must pass (regression).

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipCounter = 500;
const mockReq = (over = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': `10.99.0.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

const SKUS = {
  EVALUATION: 'iru-evaluation',
  ONE_FORM: 'iru-complete-one-form',
  BUNDLE: 'iru-complete-bundle',
  SECOND_FORM: 'iru-second-form-addon',
};

let gatewayCalls;
let savedEnv;

before(() => {
  savedEnv = { ...process.env };
  process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_hardening';
  process.env.IRU_ASSESSMENT_PRICE_CENTS = '4995';
  process.env.IRU_STORE_BACKEND = 'memory';
  process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
  gatewayCalls = [];
  globalThis.__IRU_STRIPE_GATEWAY__ = {
    async createCheckoutSession(args) {
      gatewayCalls.push({ ...args });
      return { id: `sess_hd_${args.entitlementId}`, url: 'https://checkout.stripe.test/pay' };
    },
  };
});
after(() => {
  process.env = savedEnv;
  delete globalThis.__IRU_STRIPE_GATEWAY__;
  delete globalThis.__IRU_FETCH_CAPTURE__;
});

function signedWebhook(payloadObj, sessionOverrides = {}) {
  const payload = JSON.stringify(payloadObj);
  const ts = Math.floor(Date.now() / 1000);
  return {
    rawBody: payload,
    headers: {
      'x-forwarded-for': `10.99.9.${++ipCounter}`,
      'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts),
    },
  };
}

async function sendWebhook(evt, sessionOverrides = {}) {
  const res = mockRes();
  const obj = { id: evt.id, type: evt.type, data: { object: { id: evt.sessionId, ...sessionOverrides } } };
  await webhookHandler(mockReq(signedWebhook(obj)), res);
  return res;
}

describe('GAP 1 — cross-SKU concurrent-upgrade family rule (store level)', () => {
  it('paying one-form then bundle in one family grants only the first; the second becomes an exception, never a grant', () => {
    const store = createEntitlementStore(() => 100_000);
    const ev = store.create({ sku: SKUS.EVALUATION, amountCents: 100, sessionId: 'sess_ev1' });
    store.markPaidBySession('sess_ev1', 'evt_ev1');
    const one = store.create({ sku: SKUS.ONE_FORM, amountCents: 9895, sessionId: 'sess_one1', scope: { kind: 'forms', forms: ['I-589'] }, parentId: ev.entitlement.id });
    const bun = store.create({ sku: SKUS.BUNDLE, amountCents: 14895, sessionId: 'sess_bun1', scope: { kind: 'forms', forms: ['I-589', 'I-765'] }, parentId: ev.entitlement.id });
    assert.equal(store.markPaidBySession('sess_one1', 'evt_one1').applied, true);
    const second = store.markPaidBySession('sess_bun1', 'evt_bun1');
    assert.equal(second.applied, false);
    assert.ok(second.exception, 'second payment must produce a durable exception, not silent refusal');
    assert.equal(store.peekByToken(bun.token).ok, false);
    const exceptions = store.listExceptions();
    assert.equal(exceptions.length, 1);
    assert.equal(exceptions[0].entitlementId, bun.entitlement.id);
    assert.equal(exceptions[0].resolved, false);
  });

  it('paying bundle first refuses a later one-form payment in the same family', () => {
    const store = createEntitlementStore(() => 100_000);
    const ev = store.create({ sku: SKUS.EVALUATION, amountCents: 100, sessionId: 'sess_ev2' });
    store.markPaidBySession('sess_ev2', 'evt_ev2');
    const bun = store.create({ sku: SKUS.BUNDLE, amountCents: 14895, sessionId: 'sess_bun2', scope: { kind: 'forms', forms: ['I-589', 'I-765'] }, parentId: ev.entitlement.id });
    const one = store.create({ sku: SKUS.ONE_FORM, amountCents: 9895, sessionId: 'sess_one2', scope: { kind: 'forms', forms: ['I-765'] }, parentId: ev.entitlement.id });
    assert.equal(store.markPaidBySession('sess_bun2', 'evt_bun2').applied, true);
    const second = store.markPaidBySession('sess_one2', 'evt_one2');
    assert.equal(second.applied, false);
    assert.ok(second.exception);
    assert.equal(store.peekByToken(one.token).ok, false);
  });

  it('the legitimate sequence still works: one-form paid, then second-form add-on paid (transitive family)', () => {
    const store = createEntitlementStore(() => 100_000);
    const ev = store.create({ sku: SKUS.EVALUATION, amountCents: 100, sessionId: 'sess_ev3' });
    store.markPaidBySession('sess_ev3', 'evt_ev3');
    const one = store.create({ sku: SKUS.ONE_FORM, amountCents: 9895, sessionId: 'sess_one3', scope: { kind: 'forms', forms: ['I-589'] }, parentId: ev.entitlement.id });
    store.markPaidBySession('sess_one3', 'evt_one3');
    const add = store.create({ sku: SKUS.SECOND_FORM, amountCents: 5000, sessionId: 'sess_add3', scope: { kind: 'forms', forms: ['I-765'] }, parentId: one.entitlement.id });
    const paid = store.markPaidBySession('sess_add3', 'evt_add3');
    assert.equal(paid.applied, true);
    assert.equal(store.peekByToken(add.token).ok, true);
    // ...but a bundle created against the evaluation root is now refused (transitive family).
    const bun = store.create({ sku: SKUS.BUNDLE, amountCents: 14895, sessionId: 'sess_bun3', scope: { kind: 'forms', forms: ['I-589', 'I-765'] }, parentId: ev.entitlement.id });
    const refused = store.markPaidBySession('sess_bun3', 'evt_bun3');
    assert.equal(refused.applied, false);
    assert.ok(refused.exception);
  });

  it('a second second-form add-on is refused (one add-on per family)', () => {
    const store = createEntitlementStore(() => 100_000);
    const ev = store.create({ sku: SKUS.EVALUATION, amountCents: 100, sessionId: 'sess_ev4' });
    store.markPaidBySession('sess_ev4', 'evt_ev4');
    const one = store.create({ sku: SKUS.ONE_FORM, amountCents: 9895, sessionId: 'sess_one4', scope: { kind: 'forms', forms: ['I-589'] }, parentId: ev.entitlement.id });
    store.markPaidBySession('sess_one4', 'evt_one4');
    const a1 = store.create({ sku: SKUS.SECOND_FORM, amountCents: 5000, sessionId: 'sess_add4a', scope: { kind: 'forms', forms: ['I-765'] }, parentId: one.entitlement.id });
    const a2 = store.create({ sku: SKUS.SECOND_FORM, amountCents: 5000, sessionId: 'sess_add4b', scope: { kind: 'forms', forms: ['I-765'] }, parentId: one.entitlement.id });
    assert.equal(store.markPaidBySession('sess_add4a', 'evt_add4a').applied, true);
    const refused = store.markPaidBySession('sess_add4b', 'evt_add4b');
    assert.equal(refused.applied, false);
    assert.ok(refused.exception);
  });
});

describe('GAP 2 — paid-after-expiry (store level)', () => {
  it('a payment arriving after the 30-min TTL fulfills safely when the record, session and family all check out', () => {
    let t = 0;
    const store = createEntitlementStore(() => t);
    const { entitlement, token } = store.create({ sku: 'x', amountCents: 100, sessionId: 'sess_late1', ttlMs: 1000 });
    t = 5000; // past TTL: lazy expiry flips the record on read
    assert.equal(store.getById(entitlement.id).state, 'EXPIRED');
    const paid = store.markPaidBySession('sess_late1', 'evt_late1');
    assert.equal(paid.applied, true);
    assert.equal(paid.lateFulfilled, true);
    assert.equal(store.peekByToken(token).ok, true);
  });

  it('a payment arriving for a VOID record (session-expired event already resolved it) also fulfills-or-exceptions, never silently drops', () => {
    const store = createEntitlementStore(() => 100_000);
    const { entitlement } = store.create({ sku: 'x', amountCents: 100, sessionId: 'sess_void1' });
    store.voidByExpiredSession('sess_void1', 'evt_exp1');
    assert.equal(store.getById(entitlement.id).state, 'VOID');
    const paid = store.markPaidBySession('sess_void1', 'evt_paid_after_void');
    assert.equal(paid.applied, true);
    assert.equal(paid.lateFulfilled, true);
  });

  it('an already-paid record past its claim window is a duplicate, not a second grant', () => {
    let t = 0;
    const store = createEntitlementStore(() => t);
    const { entitlement, token } = store.create({ sku: 'x', amountCents: 100, sessionId: 'sess_claim1', ttlMs: 1000, claimWindowMs: 2000 });
    store.markPaidBySession('sess_claim1', 'evt_c1');
    t = 5000; // past claim window: record EXPIRED but paidAt set
    const again = store.markPaidBySession('sess_claim1', 'evt_c2');
    assert.equal(again.applied, false);
    assert.equal(again.duplicate, true);
    assert.equal(store.peekByToken(token).ok, false);
  });
});

describe('store snapshot / restore (persistence mechanism)', () => {
  it('snapshot → fresh store → restore preserves paid state, consumed forms, processed events, exceptions and intents', () => {
    const store = createEntitlementStore(() => 100_000);
    const ev = store.create({ sku: SKUS.EVALUATION, amountCents: 100, sessionId: 'sess_snap_ev' });
    store.markPaidBySession('sess_snap_ev', 'evt_snap_ev');
    const one = store.create({ sku: SKUS.ONE_FORM, amountCents: 9895, sessionId: 'sess_snap_one', scope: { kind: 'forms', forms: ['I-589'] }, parentId: ev.entitlement.id });
    store.markPaidBySession('sess_snap_one', 'evt_snap_one');
    store.consumeForForm(one.token, 'I-589');
    const bun = store.create({ sku: SKUS.BUNDLE, amountCents: 14895, sessionId: 'sess_snap_bun', scope: { kind: 'forms', forms: ['I-589', 'I-765'] }, parentId: ev.entitlement.id });
    store.markPaidBySession('sess_snap_bun', 'evt_snap_bun'); // refused → exception
    store.saveIntent('intent-snap', { entitlementId: one.entitlement.id, sessionId: 'sess_snap_one', sku: SKUS.ONE_FORM, checkoutUrl: 'https://checkout.stripe.test/pay' });
    const snap = store.snapshot();
    const restored = createEntitlementStore(() => 100_000);
    restored.restore(snap);
    assert.equal(restored.peekByToken(one.token).ok, false); // consumed already
    assert.equal(restored.getByToken(ev.token).paidAt !== null, true);
    assert.equal(restored.hasProcessedEvent('evt_snap_one'), true);
    assert.equal(restored.hasProcessedEvent('evt_snap_bun'), true);
    assert.equal(restored.listExceptions().length, 1);
    assert.equal(restored.getIntent('intent-snap').entitlementId, one.entitlement.id);
    // A replayed event against the restored store is still a duplicate.
    assert.equal(restored.markPaidBySession('sess_snap_one', 'evt_snap_one').duplicate, true);
  });
});

describe('GAP 3 — checkout idempotency (handler level, injected gateway)', () => {
  it('the same purchase-intent key twice returns the original session; the gateway is called once', async () => {
    const before = gatewayCalls.length;
    const r1 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, purchaseIntentKey: 'intent-dedupe-1' } }), r1);
    assert.equal(r1.statusCode, 200);
    const r2 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, purchaseIntentKey: 'intent-dedupe-1' } }), r2);
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.body.entitlementId, r1.body.entitlementId);
    assert.equal(r2.body.checkoutUrl, r1.body.checkoutUrl);
    assert.equal(gatewayCalls.length, before + 1);
    // The token is issued exactly once: a retry does not re-issue the credential.
    assert.equal(r2.body.entitlementToken, undefined);
  });

  it('the same intent key with a different SKU is a conflict, not a second purchase', async () => {
    const r1 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, purchaseIntentKey: 'intent-conflict-1' } }), r1);
    assert.equal(r1.statusCode, 200);
    const r2 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.LEGACY, purchaseIntentKey: 'intent-conflict-1' } }), r2);
    assert.equal(r2.statusCode, 409);
  });

  it('a voided/expired intent goes stale: retrying the key mints a fresh checkout', async () => {
    const r1 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, purchaseIntentKey: 'intent-stale-1' } }), r1);
    assert.equal(r1.statusCode, 200);
    entitlementStore.void(r1.body.entitlementId, 'test-stale');
    const r2 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, purchaseIntentKey: 'intent-stale-1' } }), r2);
    assert.equal(r2.statusCode, 200);
    assert.notEqual(r2.body.entitlementId, r1.body.entitlementId);
    assert.ok(r2.body.entitlementToken);
  });

  it('Stripe idempotency keys are stable per logical purchase, and sessions carry an expiry', async () => {
    const r1 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, purchaseIntentKey: 'intent-stripekey-1' } }), r1);
    assert.equal(r1.statusCode, 200);
    const first = gatewayCalls[gatewayCalls.length - 1];
    assert.ok(first.idempotencyKey, 'gateway must receive a Stripe idempotency key');
    assert.ok(first.expiresAt, 'gateway must receive a session expiry');
    // ~30 minutes from now, in unix seconds.
    const nowSec = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(first.expiresAt - (nowSec + 1800)) < 120);
    const r2 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, purchaseIntentKey: 'intent-stripekey-1' } }), r2);
    assert.equal(r2.statusCode, 200);
    // No second gateway call, so the same Stripe key would be reused on any real retry.
    assert.equal(gatewayCalls[gatewayCalls.length - 1], first);
  });

  it('a checkout without an intent key still gets a stable per-entitlement Stripe key', async () => {
    const before = gatewayCalls.length;
    const r1 = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), r1);
    assert.equal(r1.statusCode, 200);
    const call = gatewayCalls[before];
    assert.equal(call.idempotencyKey, `iru-checkout-${r1.body.entitlementId}`);
  });
});

describe('webhook defense-in-depth (handler level)', () => {
  it('an amount mismatch becomes a durable exception — never a grant, never silent', async () => {
    const co = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), co);
    assert.equal(co.statusCode, 200);
    const sessId = `sess_hd_${co.body.entitlementId}`;
    const res = await sendWebhook({ id: 'evt_amt_bad', type: 'checkout.session.completed', sessionId: sessId }, { payment_status: 'paid', amount_total: 999999, currency: 'usd' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.applied, false);
    assert.ok(res.body.exception, 'mismatch must surface as an exception');
    assert.equal(entitlementStore.peekByToken(co.body.entitlementToken).ok, false);
    // Redelivery of the adjudicated event is a duplicate, not a second chance to grant.
    const again = await sendWebhook({ id: 'evt_amt_bad', type: 'checkout.session.completed', sessionId: sessId }, { payment_status: 'paid', amount_total: 999999, currency: 'usd' });
    assert.equal(again.body.duplicate, true);
    assert.equal(entitlementStore.peekByToken(co.body.entitlementToken).ok, false);
  });

  it('a currency mismatch and a metadata identity mismatch are likewise exceptions', async () => {
    const co = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), co);
    const sessId = `sess_hd_${co.body.entitlementId}`;
    const cur = await sendWebhook({ id: 'evt_cur_bad', type: 'checkout.session.completed', sessionId: sessId }, { payment_status: 'paid', amount_total: 100, currency: 'eur' });
    assert.equal(cur.body.applied, false);
    assert.ok(cur.body.exception);
    const meta = await sendWebhook({ id: 'evt_meta_bad', type: 'checkout.session.completed', sessionId: sessId }, { payment_status: 'paid', amount_total: 100, currency: 'usd', metadata: { entitlementId: 'ent_somebody_else' } });
    assert.equal(meta.body.applied, false);
    assert.ok(meta.body.exception);
    assert.equal(entitlementStore.peekByToken(co.body.entitlementToken).ok, false);
  });

  it('async_payment_succeeded with a non-paid status does not grant and does not burn the event', async () => {
    const co = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), co);
    const sessId = `sess_hd_${co.body.entitlementId}`;
    const unpaid = await sendWebhook({ id: 'evt_async_unpaid', type: 'checkout.session.async_payment_succeeded', sessionId: sessId }, { payment_status: 'unpaid', amount_total: 100, currency: 'usd' });
    assert.equal(unpaid.statusCode, 200);
    assert.equal(unpaid.body.applied, false);
    assert.equal(entitlementStore.peekByToken(co.body.entitlementToken).ok, false);
    const paid = await sendWebhook({ id: 'evt_async_unpaid', type: 'checkout.session.async_payment_succeeded', sessionId: sessId }, { payment_status: 'paid', amount_total: 100, currency: 'usd' });
    assert.equal(paid.body.applied, true);
  });

  it('a paid event for an expired session fulfills late at the webhook layer (with matching amount)', async () => {
    const store = entitlementStore;
    const { entitlement, token } = store.create({ sku: 'x', amountCents: 100, sessionId: 'sess_hd_late' });
    // Force expiry: mutate the LIVE record (create() returns a copy) so
    // its deadline is in the past when the webhook arrives.
    const live = store.getById(entitlement.id);
    live.ttlMs = 1000;
    live.createdAt = Date.now() - 60_000;
    const res = await sendWebhook({ id: 'evt_hd_late', type: 'checkout.session.completed', sessionId: 'sess_hd_late' }, { payment_status: 'paid', amount_total: 100, currency: 'usd' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.applied, true);
    assert.equal(res.body.lateFulfilled, true);
    assert.equal(store.peekByToken(token).ok, true);
  });

  it('a parsed-JSON body whose re-serialization differs is rejected, not trusted', async () => {
    // Signature computed over key order B,A; the object is built A,B.
    const payloadStr = JSON.stringify({ b: 2, a: 1, id: 'evt_reorder', type: 'checkout.session.completed', data: { object: { id: 'sess_nope' } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = signStripePayload(payloadStr, process.env.STRIPE_WEBHOOK_SECRET, ts);
    const res = mockRes();
    const parsed = { a: 1, b: 2, id: 'evt_reorder', type: 'checkout.session.completed', data: { object: { id: 'sess_nope' } } };
    await webhookHandler(mockReq({ body: parsed, headers: { 'x-forwarded-for': '10.99.8.1', 'stripe-signature': sig } }), res);
    assert.equal(res.statusCode, 400);
  });

  it('webhook bodies are capped: an oversized body is refused before verification', async () => {
    const big = 'x'.repeat(300 * 1024);
    const res = mockRes();
    await webhookHandler(mockReq({ rawBody: big, headers: { 'x-forwarded-for': '10.99.8.2', 'stripe-signature': 't=1,v1=deadbeef' } }), res);
    assert.equal(res.statusCode, 413);
  });

  it('the webhook module declares bodyParser:false for the serverless runtime', async () => {
    const mod = await import('./webhook.js');
    assert.equal(mod.config && mod.config.api && mod.config.api.bodyParser, false);
  });
});

describe('fail-closed configuration', () => {
  it('checkout refuses paid creation when no durable backend is configured (and the gate is explicit)', async () => {
    const saved = { backend: process.env.IRU_STORE_BACKEND, allow: process.env.IRU_ALLOW_EPHEMERAL_STORE };
    try {
      delete process.env.IRU_STORE_BACKEND;
      delete process.env.IRU_ALLOW_EPHEMERAL_STORE;
      const res = mockRes();
      await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), res);
      assert.equal(res.statusCode, 503);
    } finally {
      process.env.IRU_STORE_BACKEND = saved.backend;
      process.env.IRU_ALLOW_EPHEMERAL_STORE = saved.allow;
    }
  });

  it('a webhook that cannot reach storage returns 503 and does NOT burn the event; a later retry applies', async () => {
    const co = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), co);
    const sessId = `sess_hd_${co.body.entitlementId}`;
    const saved = { backend: process.env.IRU_STORE_BACKEND, allow: process.env.IRU_ALLOW_EPHEMERAL_STORE };
    try {
      process.env.IRU_STORE_BACKEND = 'postgres'; // provisioned-backend name, not configured here
      delete process.env.IRU_ALLOW_EPHEMERAL_STORE;
      const blocked = await sendWebhook({ id: 'evt_gate_retry', type: 'checkout.session.completed', sessionId: sessId }, { payment_status: 'paid', amount_total: 100, currency: 'usd' });
      assert.equal(blocked.statusCode, 503);
    } finally {
      process.env.IRU_STORE_BACKEND = saved.backend;
      process.env.IRU_ALLOW_EPHEMERAL_STORE = saved.allow;
    }
    const retried = await sendWebhook({ id: 'evt_gate_retry', type: 'checkout.session.completed', sessionId: sessId }, { payment_status: 'paid', amount_total: 100, currency: 'usd' });
    assert.equal(retried.body.applied, true);
  });

  it('entitlement-status refuses lookups when no backend is configured', async () => {
    const saved = { backend: process.env.IRU_STORE_BACKEND, allow: process.env.IRU_ALLOW_EPHEMERAL_STORE };
    try {
      delete process.env.IRU_STORE_BACKEND;
      delete process.env.IRU_ALLOW_EPHEMERAL_STORE;
      const res = mockRes();
      await statusHandler(mockReq({ body: { token: 'whatever' } }), res);
      assert.equal(res.statusCode, 503);
    } finally {
      process.env.IRU_STORE_BACKEND = saved.backend;
      process.env.IRU_ALLOW_EPHEMERAL_STORE = saved.allow;
    }
  });

  it('paywall flag disagreement is refused, not silent', async () => {
    // Server flag is OFF in this file (PAYWALL_ENABLED unset); a client built with it ON disagrees.
    const res = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, paywallClientEnabled: true } }), res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /paywall/i);
    const ok = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION, paywallClientEnabled: false } }), ok);
    assert.equal(ok.statusCode, 200);
  });

  it('origin validation: unset, malformed, and bare-localhost origins fail closed; explicit local allowance works', async () => {
    const mod = await import('./_lib/paymentConfig.js');
    assert.equal(mod.resolveAppOrigin({}).ok, false); // unset
    assert.equal(mod.resolveAppOrigin({ IRU_APP_ORIGIN: 'not a url' }).ok, false);
    assert.equal(mod.resolveAppOrigin({ IRU_APP_ORIGIN: 'ftp://example.com' }).ok, false);
    assert.equal(mod.resolveAppOrigin({ IRU_APP_ORIGIN: 'https://user:pass@example.com' }).ok, false);
    assert.equal(mod.resolveAppOrigin({ IRU_APP_ORIGIN: 'http://localhost:5173' }).ok, false);
    assert.equal(mod.resolveAppOrigin({ IRU_APP_ORIGIN: 'http://localhost:5173', IRU_ALLOW_LOCAL_ORIGIN: 'true' }).ok, true);
    assert.equal(mod.resolveAppOrigin({ IRU_APP_ORIGIN: 'https://iru.example.org' }).ok, true);
  });

  it('the real Stripe path never calls Stripe when the origin is unset (no localhost fallback)', async () => {
    const savedGateway = globalThis.__IRU_STRIPE_GATEWAY__;
    const savedOrigin = process.env.IRU_APP_ORIGIN;
    const savedAllow = process.env.IRU_ALLOW_LOCAL_ORIGIN;
    const savedKey = process.env.IRU_STRIPE_KEY;
    try {
      delete globalThis.__IRU_STRIPE_GATEWAY__;
      delete process.env.IRU_APP_ORIGIN;
      delete process.env.IRU_ALLOW_LOCAL_ORIGIN;
      process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
      let fetchCalled = false;
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({ id: 'sess_never', url: 'https://x' }) }; };
      try {
        const res = mockRes();
        await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), res);
        assert.equal(res.statusCode, 503);
        assert.equal(fetchCalled, false);
      } finally {
        globalThis.fetch = realFetch;
      }
    } finally {
      globalThis.__IRU_STRIPE_GATEWAY__ = savedGateway;
      if (savedOrigin !== undefined) process.env.IRU_APP_ORIGIN = savedOrigin; else delete process.env.IRU_APP_ORIGIN;
      if (savedAllow !== undefined) process.env.IRU_ALLOW_LOCAL_ORIGIN = savedAllow; else delete process.env.IRU_ALLOW_LOCAL_ORIGIN;
      process.env.IRU_STRIPE_KEY = savedKey;
    }
  });
});

describe('provider interface (paymentStore)', () => {
  it('backend selection is explicit: memory requires the ephemeral allowance; postgres needs IRU_DB_URL; unset is unavailable', async () => {
    const mod = await import('./_lib/paymentStore.js');
    assert.equal(mod.resolvePaymentBackend({ IRU_STORE_BACKEND: 'memory', IRU_ALLOW_EPHEMERAL_STORE: 'true' }).kind, 'memory');
    assert.equal(mod.resolvePaymentBackend({ IRU_STORE_BACKEND: 'memory', IRU_ALLOW_EPHEMERAL_STORE: 'true' }).durable, false);
    assert.equal(mod.resolvePaymentBackend({ IRU_STORE_BACKEND: 'memory' }).available, false);
    // Phase 1: the Postgres snapshot backend is implemented; it is
    // available exactly when a database URL is configured.
    const pg = mod.resolvePaymentBackend({ IRU_STORE_BACKEND: 'postgres', IRU_DB_URL: 'postgres://x' });
    assert.equal(pg.available, true);
    assert.equal(pg.durable, true);
    const pgNoUrl = mod.resolvePaymentBackend({ IRU_STORE_BACKEND: 'postgres' });
    assert.equal(pgNoUrl.available, false);
    assert.match(pgNoUrl.reason, /IRU_DB_URL/);
    assert.equal(mod.resolvePaymentBackend({}).available, false);
  });

  it('a versioned snapshot backend rejects stale writes (CAS) so two instances cannot both commit', async () => {
    const mod = await import('./_lib/paymentStore.js');
    const backend = mod.createMemorySnapshotBackend();
    const first = await backend.save({ version: 0, records: { a: 1 } }, 0);
    assert.equal(first.ok, true);
    assert.equal(first.version, 1);
    const stale = await backend.save({ version: 0, records: { a: 2 } }, 0);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'version-conflict');
    assert.equal((await backend.load()).snapshot.records.a, 1);
  });
});
