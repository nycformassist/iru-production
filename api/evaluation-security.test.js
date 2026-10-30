import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import analyzeHandler from './analyze.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import { handler as statusHandler } from './entitlement-status.js';
import generateHandler from './generate-form.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { SKUS } from './_lib/pricing.js';
import { createFactRecord, upsertFact } from './_lib/facts.js';

// B2C directive §4 — evaluation protection & endpoint authorization.
// Tests 1, 2, 7, 8, 9, 10, 11. All local with an injected gateway.

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {}, chunks: [], ended: false, jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.jsonBody = obj; this.body = obj; this.ended = true; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    write(s) { this.chunks.push(s); },
    end() { this.ended = true; },
  };
}
let ipCounter = 0;
const nextIp = () => `10.8.0.${++ipCounter}`;
const mockReq = (over = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': nextIp() },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

const ANSWERS = { country_of_origin: 'Testlandia', case_type: 'asylum', has_passport: 'no', has_i94: 'unknown', has_lease: 'yes' };

let eventCounter = 0;
async function paySession(entitlementId) {
  const payload = JSON.stringify({
    id: `evt_sec_${++eventCounter}`,
    type: 'checkout.session.completed',
    data: { object: { id: `sess_${entitlementId}`, payment_status: 'paid' } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const res = mockRes();
  await webhookHandler(mockReq({
    rawBody: payload,
    headers: { 'x-forwarded-for': nextIp(), 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
  }), res);
  assert.equal(res.body.applied, true);
}
async function buyAndPay(body) {
  const res = mockRes();
  await checkoutHandler(mockReq({ body }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  await paySession(res.body.entitlementId);
  return { token: res.body.entitlementToken, id: res.body.entitlementId };
}
async function limitedEval(token, ip) {
  const res = mockRes();
  await analyzeHandler(mockReq({
    headers: { 'x-forwarded-for': ip || nextIp(), ...(token ? { 'x-entitlement-token': token } : {}) },
    body: { mode: 'limited', answers: { ...ANSWERS } },
  }), res);
  return res;
}
function syntheticRecord() {
  const r = createFactRecord('2026-10-21T00:00:00.000Z');
  upsertFact(r, { id: 'family_name', value: 'Testfamily', source: 'answer' }, '2026-10-21T00:00:00.000Z');
  return r;
}

describe('evaluation protection (PAYWALL_ENABLED)', () => {
  before(() => {
    process.env.PAYWALL_ENABLED = 'true';
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
  after(() => {
    delete process.env.PAYWALL_ENABLED;
    delete globalThis.__IRU_STRIPE_GATEWAY__;
  });

  it('test 1: an unpaid visitor cannot access the paid evaluation', async () => {
    const noToken = await limitedEval(null);
    assert.equal(noToken.statusCode, 402);
    const forged = await limitedEval('forged-token');
    assert.equal(forged.statusCode, 402);
    // An UNPAID evaluation token does not qualify either:
    const co = mockRes();
    await checkoutHandler(mockReq({ body: { sku: SKUS.EVALUATION } }), co);
    assert.equal(co.statusCode, 200);
    const unpaid = await limitedEval(co.body.entitlementToken);
    assert.equal(unpaid.statusCode, 402);
  });

  it('test 2: a valid $1 payment grants ONLY the limited evaluation', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const res = await limitedEval(evaluation.token);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mode, 'limited');
    assert.equal(res.body.evaluation.kind, 'limited-evaluation');
    // It is a one-shot grant: a second delivery is refused.
    const again = await limitedEval(evaluation.token);
    assert.equal(again.statusCode, 402);
    // And it never authorizes a paid deliverable:
    const gen = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: syntheticRecord(), entitlementToken: evaluation.token } }), gen);
    assert.equal(gen.statusCode, 402);
  });

  it('test 8: the limited evaluation cannot retrieve full paid deliverables', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const res = await limitedEval(evaluation.token);
    assert.equal(res.statusCode, 200);
    const ev = res.body.evaluation;
    const raw = JSON.stringify(res.body);
    assert.ok(!('pdfBase64' in res.body), 'no PDF in the evaluation response');
    assert.ok(!('readinessSummary' in ev), 'no full readiness narrative');
    assert.ok(!('evidenceGaps' in ev), 'no full evidence-gap detail');
    assert.ok(!raw.includes('targetFact'), 'no per-item target facts');
    assert.ok(!raw.includes('alternatives'), 'no per-item alternatives');
    // Only broad categories: every gap entry is category-shaped.
    assert.ok(Array.isArray(ev.gapCategories) && ev.gapCategories.length >= 5);
    for (const cat of ev.gapCategories) {
      assert.deepEqual(Object.keys(cat).sort(), ['id', 'itemsNeedingAttention', 'label', 'status']);
    }
    const passport = ev.gapCategories.find((c) => c.id === 'identity-documents');
    assert.equal(passport.status, 'needs-attention'); // has_passport: 'no'
    const residence = ev.gapCategories.find((c) => c.id === 'residence-evidence');
    assert.equal(residence.status, 'accounted-for'); // has_lease: 'yes'
    // The upgrade path is part of the limited deliverable:
    assert.equal(ev.upgradeOptions.options.length, 2);
  });

  it('test 7: paid endpoints independently enforce authorization and scope', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const oneForm = await buyAndPay({ sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token });
    // The one-form (I-589) token cannot generate the OTHER form:
    const wrong = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: syntheticRecord(), entitlementToken: oneForm.token } }), wrong);
    assert.equal(wrong.statusCode, 402);
    assert.equal(wrong.body.reason, 'form-not-covered');
    // The covered form generates, exactly once:
    const okRes = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: syntheticRecord(), entitlementToken: oneForm.token } }), okRes);
    assert.equal(okRes.statusCode, 200);
    assert.ok(okRes.body.pdfBase64.length > 1000);
    const replay = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: syntheticRecord(), entitlementToken: oneForm.token } }), replay);
    assert.equal(replay.statusCode, 402);
  });

  it('test 10: cross-user access is rejected — an entitlement id alone unlocks nothing', async () => {
    const alice = await buyAndPay({ sku: SKUS.EVALUATION });
    const mallory = await buyAndPay({ sku: SKUS.EVALUATION });
    // Knowing Alice's entitlement ID (not her token) yields nothing:
    const byIdOnly = mockRes();
    await statusHandler(mockReq({ body: { entitlementId: alice.id } }), byIdOnly);
    assert.equal(byIdOnly.statusCode, 400);
    const guessed = mockRes();
    await statusHandler(mockReq({ body: { token: alice.id } }), guessed);
    assert.equal(guessed.statusCode, 404, 'an entitlement id is not a token');
    // Mallory's token returns only Mallory's entitlement:
    const own = mockRes();
    await statusHandler(mockReq({ body: { token: mallory.token } }), own);
    assert.equal(own.statusCode, 200);
    assert.equal(own.body.entitlement.id, mallory.id);
    assert.ok(!('pdfBase64' in own.body), 'status never returns generated files');
    // Generation with Mallory's evaluation token cannot touch Alice's grant:
    const gen = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: syntheticRecord(), entitlementToken: mallory.token } }), gen);
    assert.equal(gen.statusCode, 402);
  });

  it('test 11: no secrets, prompts, or internal detail appear in client responses', async () => {
    const evaluation = await buyAndPay({ sku: SKUS.EVALUATION });
    const evalRes = await limitedEval(evaluation.token);
    const statusRes = mockRes();
    await statusHandler(mockReq({ body: { token: evaluation.token } }), statusRes);
    const errRes = await limitedEval('forged');
    const secrets = ['sk_test_local_only', 'whsec_test_local', 'GEMINI_API_KEY', 'apiKey', 'tokenHash', 'signature'];
    for (const res of [evalRes, statusRes, errRes]) {
      const raw = JSON.stringify(res.body || res.jsonBody || {});
      for (const s of secrets) {
        assert.ok(!raw.includes(s), `response must not contain ${s}`);
      }
    }
  });
});

describe('evaluation quotas (paywall off — abuse controls still apply)', () => {
  it('test 9: the limited-evaluation quota throttles repeated requests from one source', async () => {
    const ip = '198.51.100.77'; // dedicated: quota is per-source
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const res = await limitedEval(null, ip);
      codes.push(res.statusCode);
    }
    assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
    assert.equal(codes[3], 429, 'the 4th rapid evaluation request is throttled');
  });

  it('test 9: checkout attempts are rate-limited per source', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession({ entitlementId }) {
        return { id: `sess_${entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
    try {
      const ip = '198.51.100.78';
      let last = null;
      for (let i = 0; i < 6; i++) {
        last = mockRes();
        await checkoutHandler(mockReq({ headers: { 'x-forwarded-for': ip }, body: { sku: SKUS.EVALUATION } }), last);
      }
      assert.equal(last.statusCode, 429);
    } finally {
      delete globalThis.__IRU_STRIPE_GATEWAY__;
    }
  });
});
