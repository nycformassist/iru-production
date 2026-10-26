import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import checkoutHandler from './checkout.js';
import webhookHandler from './webhook.js';
import statusHandler from './entitlement-status.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { entitlementStore, createEntitlementStore } from './_lib/entitlement.js';
import { PRICING, SKUS, buildOffer, formatCents } from './_lib/pricing.js';

// B2C pricing directive (2026-10-21) — tests 3, 4, 5, 6 and the scoped
// entitlement semantics beneath them. All local, injected gateway, no
// network, no real keys, no money.

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
async function paySession(entitlementId) {
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
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applied, true);
  return res;
}

async function checkout(body) {
  const res = mockRes();
  await checkoutHandler(mockReq({ body }), res);
  return res;
}

/** Buy a SKU and pay for it via a signed webhook. Returns the grant. */
async function buyAndPay(body) {
  const res = await checkout(body);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  await paySession(res.body.entitlementId);
  return { token: res.body.entitlementToken, id: res.body.entitlementId, checkout: res.body };
}

describe('B2C pricing structure (owner-set, server-enforced)', () => {
  before(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    // Payment-hardening gate: paid handlers require an explicit store backend.
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_local';
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession({ entitlementId }) {
        return { id: `sess_${entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
  });
  after(() => { delete globalThis.__IRU_STRIPE_GATEWAY__; });

  it('the offer shows both options, exact totals, and the bundle saving — never two forms for $99.95', () => {
    const offer = buildOffer();
    assert.equal(offer.evaluation.chargeCents, 100);
    const [one, bundle] = offer.options;
    assert.equal(one.totalCents, 9995);
    assert.equal(one.afterEvaluationChargeCents, 9895);
    assert.match(one.formsIncluded, /exactly one form/i);
    assert.equal(bundle.totalCents, 12995);
    assert.equal(bundle.afterEvaluationChargeCents, 12895);
    assert.match(bundle.savingsNote, /\$69\.95/);
    assert.equal(formatCents(PRICING.bundle.separateTotalCents), '$199.90');
    // The bundle must never be represented as two forms for $99.95:
    assert.notEqual(bundle.totalCents, one.totalCents);
    assert.match(bundle.formsIncluded, /both forms/i);
  });

  it('test 3: one-form checkout totals $99.95 with the $1 evaluation credited', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    assert.equal(evaluation.checkout.amountCents, 100);
    assert.equal(evaluation.checkout.totalCents, 100);

    const res = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 9895, 'upgrade charge is $98.95');
    assert.equal(res.body.creditedCents, 100, '$1 evaluation credited');
    assert.equal(res.body.totalCents, 9995, 'buyer total is exactly $99.95');
    assert.deepEqual(res.body.scope, { kind: 'forms', forms: ['I-589'] });
  });

  it('test 4: bundle checkout totals $129.95 with the $1 evaluation credited', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const res = await checkout({ sku: SKUS.BUNDLE, entitlementToken: evaluation.token });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 12895, 'upgrade charge is $128.95');
    assert.equal(res.body.creditedCents, 100);
    assert.equal(res.body.totalCents, 12995, 'buyer total is exactly $129.95');
    assert.deepEqual(res.body.scope, { kind: 'forms', forms: ['I-589', 'I-765'] });
  });

  it('test 5: second-form add-on after a one-form purchase charges exactly $30 and covers the other form', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const oneForm = await buyAndPay({ sku: SKUS.ONE_FORM, formId: 'I-765', entitlementToken: evaluation.token });
    const res = await checkout({ sku: SKUS.SECOND_FORM, entitlementToken: oneForm.token });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 3000, 'add-on charge is exactly $30.00');
    assert.equal(res.body.totalCents, 12995, 'total paid becomes $129.95');
    assert.deepEqual(res.body.scope, { kind: 'forms', forms: ['I-589'] }, 'add-on covers the form NOT already owned');
  });

  it('test 6: client-sent amounts are ignored — the server charges the pricing table', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const res = await checkout({
      sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token,
      amountCents: 1, totalCents: 1, creditedCents: 99999,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 9895);
    assert.equal(res.body.totalCents, 9995);
    assert.equal(res.body.creditedCents, 100);
  });

  it('test 6: upgrades require a PAID evaluation — unpaid, forged, or missing proof is refused', async () => {
    // Unpaid evaluation (checkout created, webhook never fired):
    const unpaid = await checkout({ sku: SKUS.EVALUATION });
    assert.equal(unpaid.statusCode, 200);
    const res1 = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: unpaid.body.entitlementToken });
    assert.equal(res1.statusCode, 402);
    // Forged token:
    const res2 = await checkout({ sku: SKUS.BUNDLE, entitlementToken: 'forged-token-value' });
    assert.equal(res2.statusCode, 402);
    // No token at all:
    const res3 = await checkout({ sku: SKUS.BUNDLE });
    assert.equal(res3.statusCode, 402);
    // A FORM entitlement cannot serve as the evaluation prerequisite:
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const oneForm = await buyAndPay({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token });
    const res4 = await checkout({ sku: SKUS.BUNDLE, entitlementToken: oneForm.token });
    assert.equal(res4.statusCode, 402);
  });

  it('test 6: a paid upgrade cannot be duplicated; an abandoned checkout can be retried', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    await buyAndPay({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token });
    const dup = await checkout({ sku: SKUS.BUNDLE, entitlementToken: evaluation.token });
    assert.equal(dup.statusCode, 409, 'a second paid upgrade on the same evaluation is refused');
    const dup2 = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-765', entitlementToken: evaluation.token });
    assert.equal(dup2.statusCode, 409);

    const evaluation2 = await buyAndPay({ sku: SKUS.EVALUATION });
    const attempt1 = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation2.token });
    assert.equal(attempt1.statusCode, 200); // never paid — abandoned
    const attempt2 = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation2.token });
    assert.equal(attempt2.statusCode, 200, 'retrying an unpaid checkout is allowed');
    assert.notEqual(attempt1.body.entitlementId, attempt2.body.entitlementId);
  });

  it('test 6: the add-on requires a one-form purchase — an evaluation alone does not qualify', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const res = await checkout({ sku: SKUS.SECOND_FORM, entitlementToken: evaluation.token });
    assert.equal(res.statusCode, 402);
  });

  it('one-form checkout requires naming exactly one supported form', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const noForm = await checkout({ sku: SKUS.ONE_FORM, entitlementToken: evaluation.token });
    assert.equal(noForm.statusCode, 400);
    const badForm = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-999', entitlementToken: evaluation.token });
    assert.equal(badForm.statusCode, 400);
  });

  it('status reports scope, credit, totals, and per-form delivery state', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const bundle = await buyAndPay({ sku: SKUS.BUNDLE, entitlementToken: evaluation.token });
    const st = mockRes();
    await statusHandler(mockReq({ body: { token: bundle.token } }), st);
    assert.equal(st.statusCode, 200);
    assert.equal(st.body.usable, true);
    assert.deepEqual(st.body.entitlement.scope, { kind: 'forms', forms: ['I-589', 'I-765'] });
    assert.equal(st.body.entitlement.totalCents, 12995);
    assert.equal(st.body.entitlement.creditedCents, 100);
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
    const { token } = store.create({ sku: SKUS.BUNDLE, amountCents: 12895, sessionId: 's_bundle', scope: { kind: 'forms', forms: ['I-589', 'I-765'] } });
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
