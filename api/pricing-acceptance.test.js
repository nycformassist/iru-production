import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { entitlementStore } from './_lib/entitlement.js';
import { PRICING, SKUS, formatCents } from './_lib/pricing.js';

// Workstream 4 — pricing & entitlement acceptance verification
// (directive §5). Fills the gaps NOT already proven by
// b2c-pricing.test.js / payment-flow.test.js / evaluation-security.test.js:
//  - case 1: evaluation checkout carries evaluation scope + $1.00 exactly
//  - case 4: add-on union coverage = both forms; paid chain totals $149.95
//  - case 5(d)/8: an abandoned unpaid upgrade checkout is VOIDED
//    (superseded) and replaced — never stacked; one live session only
//  - case 5(e): the bearer token alone is the credential — identical
//    behavior from a "different session" (different source IP/headers)
//  - case 6 (handler level): wrong-secret signature → 400; signed event
//    for an unknown session → 200, not applied, event id NOT burned
//  - case 7 (source guards): the client never grants entitlement from
//    ?checkout=success; the success URL carries the Stripe session ID,
//    never the bearer token; unknown token → 404
//  - D3 (app scope): rk_live keys are refused exactly like sk_live
//  - offer UI: every PRICING field the offer buttons reference exists
//    and formats to a non-empty amount (amount due must be visible)
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
  before(() => {
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
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

  it('case 1: the $1 evaluation checkout is evaluation-scoped and pays to a paid evaluation entitlement', async () => {
    const res = await checkout({ sku: SKUS.EVALUATION });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 100);
    assert.equal(res.body.totalCents, 100);
    assert.deepEqual(res.body.scope, { kind: 'evaluation' });
    const before = await statusOf(res.body.entitlementToken);
    assert.equal(before.body.entitlement.paid, false);
    assert.equal(before.body.usable, false);
    await paySession(res.body.entitlementId);
    const afterPay = await statusOf(res.body.entitlementToken);
    assert.equal(afterPay.body.entitlement.paid, true);
    assert.equal(afterPay.body.usable, true);
    assert.equal(afterPay.body.entitlement.scope.kind, 'evaluation');
    // (One-shot delivery + second-delivery refusal are proven handler-level
    // in evaluation-security.test.js test 2 via analyze.js mode 'limited'.)
  });

  it('case 4: one-form + add-on union covers BOTH forms and the paid chain totals exactly $149.95', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const oneForm = await buyAndPay({ sku: SKUS.ONE_FORM, formId: 'I-765', entitlementToken: evaluation.token });
    const addon = await buyAndPay({ sku: SKUS.SECOND_FORM, entitlementToken: oneForm.token });
    assert.equal(addon.checkout.amountCents, 5000);
    const covered = [...oneForm.checkout.scope.forms, ...addon.checkout.scope.forms].sort();
    assert.deepEqual(covered, ['I-589', 'I-765'], 'resulting coverage is both forms');
    const paidChain = evaluation.checkout.amountCents + oneForm.checkout.amountCents + addon.checkout.amountCents;
    assert.equal(paidChain, 14995, '100 + 9895 + 5000 = $149.95 total');
    assert.equal(addon.checkout.totalCents, 14995);
  });

  it('case 5(d)/8: an abandoned unpaid upgrade checkout is VOIDED and replaced — only one live session; after payment a repeat is 409', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const attempt1 = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token });
    assert.equal(attempt1.statusCode, 200);
    const attempt2 = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token });
    assert.equal(attempt2.statusCode, 200);
    assert.notEqual(attempt1.body.entitlementId, attempt2.body.entitlementId);
    const first = entitlementStore.getById(attempt1.body.entitlementId);
    assert.equal(first.state, 'VOID', 'the abandoned checkout entitlement is voided, not stacked');
    assert.equal(first.voidReason, 'superseded-by-new-checkout');
    const live = entitlementStore.childrenOf(evaluation.id)
      .filter((c) => c.sku === SKUS.ONE_FORM && c.state === 'RESERVED');
    assert.equal(live.length, 1, 'exactly one live (unpaid, unvoided) upgrade session remains');
    assert.equal(live[0].id, attempt2.body.entitlementId);
    // After the replacement is paid, any further upgrade on this parent → 409.
    await paySession(attempt2.body.entitlementId);
    const repeat = await checkout({ sku: SKUS.ONE_FORM, formId: 'I-765', entitlementToken: evaluation.token });
    assert.equal(repeat.statusCode, 409);
    assert.equal(repeat.body.reason, 'already-purchased');
  });

  it('case 5(e): the token alone is the credential — a "different session" (new source, no shared state) behaves identically, by design', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    // Original "session": status lookup from one source.
    const fromOriginal = await statusOf(evaluation.token, { headers: { 'x-forwarded-for': '192.0.2.10' } });
    assert.equal(fromOriginal.statusCode, 200);
    // "Different session": a fresh lookup carrying ONLY the token, from a
    // different source address with no cookies/session state at all.
    const fromElsewhere = await statusOf(evaluation.token, { headers: { 'x-forwarded-for': '198.51.100.23' } });
    assert.equal(fromElsewhere.statusCode, 200);
    assert.deepEqual(fromElsewhere.body, fromOriginal.body, 'no IP/session binding: token-only lookup is identical');
    // The same token also works as the upgrade prerequisite from elsewhere:
    const upgrade = await checkout(
      { sku: SKUS.BUNDLE, entitlementToken: evaluation.token },
      { headers: { 'x-forwarded-for': '198.51.100.24' } },
    );
    assert.equal(upgrade.statusCode, 200);
    assert.equal(upgrade.body.amountCents, 14895);
  });

  it('case 6 (handler level): a webhook signed with the WRONG secret is rejected 400 and applies nothing', async () => {
    const evaluation = await checkout({ sku: SKUS.EVALUATION });
    const res = await sendWebhook({
      id: `evt_acc_bad_${++eventCounter}`,
      type: 'checkout.session.completed',
      data: { object: { id: `sess_${evaluation.body.entitlementId}`, payment_status: 'paid' } },
    }, 'whsec_attacker_controlled');
    assert.equal(res.statusCode, 400);
    const st = await statusOf(evaluation.body.entitlementToken);
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
      const res = await checkout({ sku: SKUS.EVALUATION });
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
    // through server-side verification via /api/entitlement-status.
    // (Phase 2: the Stripe return handler reads ?checkout=success only to
    // trigger a server verification; the stage is set from the server
    // response, never from the URL.)
    assert.ok(appSrc.includes('/api/entitlement-status') || appSrc.includes('/api/verify-session'), 'entitlement state comes from a server verification endpoint');
    // No direct URL-to-entitlement assignment: the success param must not
    // appear in a setStage/setPurchaseState call without a fetch first.
    const urlReadIdx = appSrc.indexOf('checkout');
    if (urlReadIdx !== -1) {
      const snippet = appSrc.slice(Math.max(0, urlReadIdx - 2000), urlReadIdx + 2000);
      assert.ok(snippet.includes('/api/entitlement-status') || snippet.includes('/api/verify-session'),
        'any ?checkout=success handling must verify via the server before routing');
      assert.ok(!/setStage\(['"]LANG['"]\)[^}]*checkout/.test(snippet.replace(/\s+/g, ' ')),
        'LANG stage is never set directly from the URL param');
    }
  });

  it('the Stripe success URL carries the session ID template, never the bearer token', () => {
    const m = checkoutSrc.match(/success_url[^\n]*/);
    assert.ok(m, 'checkout.js builds a success_url');
    assert.ok(m[0].includes('session_id={CHECKOUT_SESSION_ID}'), 'success URL uses Stripe session ID template');
    assert.ok(!/token/i.test(m[0]), 'the bearer token never appears in the success URL');
  });

  it('offer UI: every PRICING field the offer buttons reference exists and formats to a visible amount', () => {
    const refs = [...appSrc.matchAll(/PRICING\.(oneForm|bundle|secondForm)\.(\w+)/g)]
      .map((mm) => [mm[1], mm[2]]);
    assert.ok(refs.length >= 3, 'offer buttons reference PRICING amounts');
    for (const [row, field] of refs) {
      assert.ok(field in PRICING[row], `PRICING.${row}.${field} must exist (else the button renders a blank amount)`);
      assert.notEqual(formatCents(PRICING[row][field]), '', `PRICING.${row}.${field} must format to a non-empty amount`);
    }
    // The amount due after the $1 credit is the charge itself:
    assert.equal(PRICING.oneForm.chargeCents, 9895);
    assert.equal(PRICING.bundle.chargeCents, 14895);
  });
});
