import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementStore, entitlementStore } from './_lib/entitlement.js';
import { handler as checkoutHandler } from './checkout.js';

// Payment defect closure directive 2026-10-24 — regression tests for:
//  (1) upgrade purchase-intent retry ordering (guard voided the intent's
//      own original before the intent lookup, so a retry minted a second
//      payable session);
//  (2) Stripe Checkout expires_at below the 30-minute minimum (it was
//      computed from entitlement creation, not from session creation);
//  (3) best-effort expiration of superseded Stripe sessions (mocked).
// All local, synthetic, test-mode semantics only. The Stripe gateway is
// injected; no network, no real keys, no money. Mocks prove application
// behavior only — never real Stripe platform acceptance.
//
// Vehicle note (2026-11-05): these tests drove the retired $1-evaluation
// upgrade SKUs (iru-evaluation → iru-complete-one-form / bundle /
// second-form-addon). The retired SKUs now 410, so the vehicle is the
// current purchase path: a paid iru-formprep parent (I-589, $249) with
// formprep add-on purchases under it. The mechanics under test — intent
// retry ordering, void/replace, superseded-session expiration — live in
// the formprep branch in the same shape and are SKU-agnostic.

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipCounter = 700;
const mockReq = (over = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': `10.99.3.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

const FORMPREP_SKU = 'iru-formprep';
const READINESS_SKU = 'iru-readiness';

let gatewayCalls;
let expireCalls;
let expireMode; // 'ok' | 'throw'
let savedEnv;

before(() => {
  savedEnv = { ...process.env };
  process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_defect_closure';
  process.env.IRU_STORE_BACKEND = 'memory';
  process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
  gatewayCalls = [];
  expireCalls = [];
  expireMode = 'ok';
  globalThis.__IRU_STRIPE_GATEWAY__ = {
    async createCheckoutSession(args) {
      const id = `sess_dc_${args.entitlementId}`;
      gatewayCalls.push({ ...args, sessionId: id, gatewayReceivedAtMs: Date.now() });
      return { id, url: 'https://checkout.stripe.test/pay' };
    },
    async expireCheckoutSession({ sessionId }) {
      expireCalls.push(sessionId);
      if (expireMode === 'throw') throw new Error('stripe: session already complete');
      return { id: sessionId, status: 'expired' };
    },
  };
});
after(() => {
  process.env = savedEnv;
  delete globalThis.__IRU_STRIPE_GATEWAY__;
});

function lastSessionId() {
  return gatewayCalls[gatewayCalls.length - 1].sessionId;
}

async function createPaidFormprep() {
  const r = mockRes();
  await checkoutHandler(mockReq({ body: { sku: FORMPREP_SKU, forms: ['I-589'] } }), r);
  assert.equal(r.statusCode, 200);
  const paid = entitlementStore.markPaidBySession(lastSessionId(), `evt_dc_parent_${r.body.entitlementId}`);
  assert.equal(paid.applied, true);
  return { entitlementId: r.body.entitlementId, token: r.body.entitlementToken };
}

async function payEntitlement(entitlementId, eventSuffix) {
  const ent = entitlementStore.getById(entitlementId);
  const sessionId = ent.sessionId || lastSessionId();
  return entitlementStore.markPaidBySession(sessionId, `evt_dc_${eventSuffix}`);
}

async function upgradeCheckout(body) {
  const r = mockRes();
  await checkoutHandler(mockReq({ body }), r);
  return r;
}

describe('DEFECT 1 — upgrade purchase-intent retry ordering', () => {
  it('one-form upgrade retry returns the original session; gateway called once; token issued once', async () => {
    const ev = await createPaidFormprep();
    const before = gatewayCalls.length;
    const body = { sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token, purchaseIntentKey: 'dc-intent-oneform-1' };
    const r1 = await upgradeCheckout(body);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.amountCents, 10000, 'I-765 completes the I-589+I-765 pair at the $349 bundle remainder');
    assert.ok(r1.body.entitlementToken, 'first response issues the token');
    const r2 = await upgradeCheckout(body);
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.body.entitlementId, r1.body.entitlementId, 'retry returns the ORIGINAL entitlement');
    assert.equal(r2.body.checkoutUrl, r1.body.checkoutUrl, 'retry returns the ORIGINAL session URL');
    assert.equal(r2.body.retried, true, 'retry response indicates a successful retry');
    assert.equal(r2.body.entitlementToken, undefined, 'token is NOT reissued on retry');
    assert.equal(gatewayCalls.length, before + 1, 'exactly ONE gateway session for the logical purchase');
    assert.equal(entitlementStore.getById(r1.body.entitlementId).state, 'RESERVED', 'original stays RESERVED');
  });

  it('bundle upgrade retry returns the original session', async () => {
    const before = gatewayCalls.length;
    const body = { sku: FORMPREP_SKU, forms: ['I-589', 'I-765'], purchaseIntentKey: 'dc-intent-bundle-1' };
    const r1 = await upgradeCheckout(body);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.amountCents, 34900, 'the two-form bundle is the fixed $349');
    const r2 = await upgradeCheckout(body);
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.body.entitlementId, r1.body.entitlementId);
    assert.equal(r2.body.retried, true);
    assert.equal(r2.body.entitlementToken, undefined);
    assert.equal(gatewayCalls.length, before + 1);
  });

  it('second-form upgrade retry returns the original session', async () => {
    const ev = await createPaidFormprep();
    const one = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
    assert.equal(one.statusCode, 200);
    const paidOne = await payEntitlement(one.body.entitlementId, `one_${one.body.entitlementId}`);
    assert.equal(paidOne.applied, true);
    const before = gatewayCalls.length;
    // A second add-on purchase under the paid I-765 child (I-130 at the
    // $50 additional-form discount) with an intent key; the retry must
    // return the original session, not mint a second one.
    const body = { sku: FORMPREP_SKU, forms: ['I-130'], entitlementToken: one.body.entitlementToken, purchaseIntentKey: 'dc-intent-second-1' };
    const r1 = await upgradeCheckout(body);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.amountCents, 14900, 'I-130 as an additional form is regular $199 less $50');
    const r2 = await upgradeCheckout(body);
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.body.entitlementId, r1.body.entitlementId);
    assert.equal(r2.body.retried, true);
    assert.equal(r2.body.entitlementToken, undefined);
    assert.equal(gatewayCalls.length, before + 1);
  });

  it('cancel-and-reclick with a fresh key after abandonment still replaces, and the stale key then mints fresh', async () => {
    const ev = await createPaidFormprep();
    const key = 'dc-intent-cancel-1';
    const body = { sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token, purchaseIntentKey: key };
    const r1 = await upgradeCheckout(body);
    assert.equal(r1.statusCode, 200);
    // Buyer abandons, then starts again WITHOUT the key: the guard voids
    // the abandoned attempt (replacement behavior, unchanged).
    const r2 = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
    assert.equal(r2.statusCode, 200);
    assert.notEqual(r2.body.entitlementId, r1.body.entitlementId);
    assert.equal(entitlementStore.getById(r1.body.entitlementId).state, 'VOID');
    // Reclicking with the old key now finds a stale intent and mints fresh.
    const r3 = await upgradeCheckout(body);
    assert.equal(r3.statusCode, 200);
    assert.notEqual(r3.body.entitlementId, r1.body.entitlementId);
    assert.ok(r3.body.entitlementToken, 'stale intent mints a fresh checkout with a token');
  });

  it('same intent key with a different purchase shape returns 409 (upgrade variant) and preserves the original', async () => {
    const ev = await createPaidFormprep();
    const key = 'dc-intent-shape-1';
    const r1 = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token, purchaseIntentKey: key });
    assert.equal(r1.statusCode, 200);
    // Same key, different form set (adds I-130): the shape conflict must
    // 409 before any new session is created.
    const r2 = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765', 'I-130'], entitlementToken: ev.token, purchaseIntentKey: key });
    assert.equal(r2.statusCode, 409);
    assert.equal(entitlementStore.getById(r1.body.entitlementId).state, 'RESERVED', '409 path must not void the original');
  });

  it('stale upgrade intent (voided original) mints a fresh checkout', async () => {
    const ev = await createPaidFormprep();
    const key = 'dc-intent-stale-upgrade-1';
    const r1 = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token, purchaseIntentKey: key });
    assert.equal(r1.statusCode, 200);
    entitlementStore.void(r1.body.entitlementId, 'test-stale');
    const r2 = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token, purchaseIntentKey: key });
    assert.equal(r2.statusCode, 200);
    assert.notEqual(r2.body.entitlementId, r1.body.entitlementId);
    assert.ok(r2.body.entitlementToken);
  });

  it('superseded-session scenario: paying the old session grants late; paying the new session becomes a family exception', async () => {
    const ev = await createPaidFormprep();
    const a = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
    assert.equal(a.statusCode, 200);
    const sessionA = lastSessionId();
    const b = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
    assert.equal(b.statusCode, 200);
    assert.equal(entitlementStore.getById(a.body.entitlementId).state, 'VOID', 'new checkout supersedes the old one');
    const sessionB = lastSessionId();
    const payA = entitlementStore.markPaidBySession(sessionA, `evt_dc_superseded_${a.body.entitlementId}`);
    assert.equal(payA.applied, true, 'paying the superseded session still fulfills late');
    assert.equal(payA.lateFulfilled, true);
    const payB = entitlementStore.markPaidBySession(sessionB, `evt_dc_superseded_${b.body.entitlementId}`);
    assert.equal(payB.applied, false, 'second grant in the family is refused');
    assert.equal(payB.reason, 'family-already-paid');
    assert.ok(payB.exception, 'refused grant becomes a durable exception, never a silent money-keep');
  });
});

describe('DEFECT 2 — expires_at measured against Stripe-call time', () => {
  it('expires_at is at least 30 minutes after the gateway receives the request, with a sane upper bound', async () => {
    const r = mockRes();
    await checkoutHandler(mockReq({ body: { sku: READINESS_SKU, form: 'I-589', purchaseIntentKey: 'dc-expires-1' } }), r);
    assert.equal(r.statusCode, 200);
    const call = gatewayCalls[gatewayCalls.length - 1];
    const lifetimeMs = call.expiresAt * 1000 - call.gatewayReceivedAtMs;
    assert.ok(lifetimeMs >= 30 * 60 * 1000, `expiry must be >= 30 min after session creation, got ${lifetimeMs} ms`);
    assert.ok(lifetimeMs <= 32 * 60 * 1000, `expiry must have a sane upper bound, got ${lifetimeMs} ms`);
    const createdAtMs = entitlementStore.getById(r.body.entitlementId).createdAt;
    assert.ok(call.expiresAt * 1000 >= createdAtMs + 30 * 60 * 1000, 'expiry must also cover the local TTL deadline');
  });

  it('the Stripe-expiry overhang past the local TTL is covered by late fulfillment', async () => {
    // Controllable clock: entitlement created at T with a 30-min local
    // TTL; the Stripe session expires at T + 31 min (handler formula).
    // A payment at T + 30.5 min is past the local TTL but before the
    // Stripe expiry — it must fulfill late, not drop.
    let nowMs = Date.now();
    const store = createEntitlementStore(() => nowMs);
    const { entitlement } = store.create({
      sku: FORMPREP_SKU, amountCents: 24900, currency: 'usd',
      sessionId: 'sess_dc_overhang', ttlMs: 30 * 60 * 1000,
      scope: { kind: 'forms', forms: ['I-589'] },
    });
    assert.equal(entitlement.state, 'RESERVED');
    const stripeExpiryMs = entitlement.createdAt + 31 * 60 * 1000;
    nowMs = entitlement.createdAt + 30 * 60 * 1000 + 30 * 1000; // T + 30.5 min
    assert.ok(nowMs < stripeExpiryMs, 'payment lands inside the overhang window');
    const paid = store.markPaidBySession('sess_dc_overhang', 'evt_dc_overhang');
    assert.equal(paid.applied, true, 'overhang payment fulfills late');
    assert.equal(paid.lateFulfilled, true);
  });
});

describe('SECTION 3 — superseded-session expiration (mocked gateway)', () => {
  it('a superseded session is expired at Stripe when a newer checkout replaces it', async () => {
    const ev = await createPaidFormprep();
    const before = expireCalls.length;
    const a = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
    assert.equal(a.statusCode, 200);
    const sessionA = lastSessionId();
    const b = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
    assert.equal(b.statusCode, 200);
    assert.deepEqual(expireCalls.slice(before), [sessionA], 'exactly the superseded session is expired');
  });

  it('already-completed session: expiration failure is swallowed; checkout still succeeds and local state stands', async () => {
    const ev = await createPaidFormprep();
    expireMode = 'throw';
    try {
      const a = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
      assert.equal(a.statusCode, 200);
      const b = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
      assert.equal(b.statusCode, 200, 'expiration failure must not fail the checkout');
      assert.equal(entitlementStore.getById(a.body.entitlementId).state, 'VOID', 'local void stands regardless');
      assert.equal(entitlementStore.getById(b.body.entitlementId).state, 'RESERVED');
    } finally {
      expireMode = 'ok';
    }
  });

  it('expiration API failure does not break late payment of the superseded session', async () => {
    const ev = await createPaidFormprep();
    expireMode = 'throw';
    try {
      const a = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
      assert.equal(a.statusCode, 200);
      const sessionA = lastSessionId();
      const b = await upgradeCheckout({ sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token });
      assert.equal(b.statusCode, 200);
      const payA = entitlementStore.markPaidBySession(sessionA, `evt_dc_expfail_${a.body.entitlementId}`);
      assert.equal(payA.applied, true, 'failed expiration must not undo late-payment adjudication');
      assert.equal(payA.lateFulfilled, true);
    } finally {
      expireMode = 'ok';
    }
  });

  it('the retried original is never expired', async () => {
    const ev = await createPaidFormprep();
    const before = expireCalls.length;
    const body = { sku: FORMPREP_SKU, forms: ['I-765'], entitlementToken: ev.token, purchaseIntentKey: 'dc-intent-noexpire-1' };
    const r1 = await upgradeCheckout(body);
    assert.equal(r1.statusCode, 200);
    const session1 = lastSessionId();
    const r2 = await upgradeCheckout(body);
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.body.retried, true);
    assert.ok(!expireCalls.slice(before).includes(session1), 'a retried original must not be expired');
    assert.equal(expireCalls.length, before, 'no sweep ran on a pure retry');
  });
});
