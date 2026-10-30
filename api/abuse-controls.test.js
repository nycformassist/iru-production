import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import reviewHandler from './review-image.js';
import generateHandler from './generate-form.js';
import { handler as checkoutHandler } from './checkout.js';
import analyzeHandler from './analyze.js';
import { handler as statusHandler } from './entitlement-status.js';
import { entitlementStore } from './_lib/entitlement.js';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import { sanitizeAnswers } from './_lib/privacy.js';

// Workstream 5 — anti-abuse audit (directive §6). Synthetic requests
// only: stubbed Stripe gateway / vision client / AI client, no network,
// no real keys, no money.
//
// Control summary proven here (see WS5 report for the full table):
// - Every handler except webhook is per-IP rate-limited (webhook is
//   Stripe-signature gated instead — see payment-flow/pricing tests).
// - Body caps: analyze 32KB, generate-form 256KB, review-image 6MB body
//   / 4MB decoded, checkout 256KB (added in this workstream — the
//   endpoint previously parsed unbounded bodies).
// - Rate-limit buckets are per-endpoint AND per-IP: exhausting one
//   endpoint or one IP never drains another.
// - clientIp() keys on the first x-forwarded-for hop — a documented
//   platform assumption (Vercel sets that header), not a defect.
//
// Limiter state: handlers keep module-level limiter singletons with no
// reset export, so — following payment-flow.test.js — every scenario
// below uses its own dedicated source IP.

const T0 = '2026-10-21T00:00:00.000Z';
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GOOD_REVIEW = {
  documentCategory: 'utility bill', legibility: 'legible',
  fieldsVisible: ['name'], appearsComplete: 'yes', inconsistencies: [],
  relatedReadinessItem: 'none', limitations: [],
};
const GOOD_ASSESSMENT = {
  readinessSummary: 'ok', factsProvided: [], missingInformation: [],
  contradictions: [], inferences: [], suggestedQuestions: [],
  uncertaintyNotes: [], notLegalAdvice: 'Not legal advice.', evidenceGaps: [],
};

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {}, chunks: [],
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    write(s) { this.chunks.push(s); },
    end() { this.ended = true; },
    send(b) { this.sent = b; return this; },
  };
}
const reqFrom = (ip, over = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': ip },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

function baseRecord() {
  const r = createFactRecord(T0);
  const put = (id, value) => upsertFact(r, { id, value, source: 'answer' }, T0);
  put('family_name', 'Testfamily'); put('given_name', 'Testgiven');
  put('date_of_birth', '1990-05-17'); put('gender', 'female');
  put('marital_status', 'married'); put('citizenship', 'Testlandia');
  put('country_of_birth', 'Testlandia'); put('city_of_birth', 'Test City');
  put('mailing_street', '123 Test Street'); put('mailing_city', 'Bronx');
  put('mailing_region', 'NY'); put('mailing_postal_code', '10451');
  put('application_reason', 'initial');
  return r;
}

let savedEnv;
before(() => {
  savedEnv = { ...process.env };
  process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
  process.env.IRU_ASSESSMENT_PRICE_CENTS = '4995';
  // Payment-hardening gate: paid handlers require an explicit store backend.
  process.env.IRU_STORE_BACKEND = 'memory';
  process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
  globalThis.__IRU_STRIPE_GATEWAY__ = {
    async createCheckoutSession({ entitlementId }) {
      return { id: `sess_${entitlementId}`, url: 'https://checkout.stripe.test/pay' };
    },
  };
  globalThis.__IRU_VISION_CLIENT__ = {
    async reviewImage() { return JSON.stringify(GOOD_REVIEW); },
  };
  globalThis.__IRU_AI_CLIENT__ = {
    async *generateContentStream() { yield { text: JSON.stringify(GOOD_ASSESSMENT) }; },
  };
});
after(() => {
  process.env = savedEnv;
  delete globalThis.__IRU_STRIPE_GATEWAY__;
  delete globalThis.__IRU_VISION_CLIENT__;
  delete globalThis.__IRU_AI_CLIENT__;
});

describe('WS5 (a) rate limiters trip per-IP, per-endpoint', () => {
  it('review-image: 6th request from one IP is 429 with Retry-After; a different IP is unaffected', async () => {
    const body = { imageBase64: TINY_PNG_B64, mimeType: 'image/png' };
    for (let i = 0; i < 5; i++) {
      const res = mockRes();
      await reviewHandler(reqFrom('10.20.1.1', { body }), res);
      assert.equal(res.statusCode, 200, `request ${i + 1} within capacity 5`);
    }
    const blocked = mockRes();
    await reviewHandler(reqFrom('10.20.1.1', { body }), blocked);
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers['Retry-After']) > 0, '429 carries Retry-After');
    const other = mockRes();
    await reviewHandler(reqFrom('10.20.1.2', { body }), other);
    assert.equal(other.statusCode, 200, 'shared-IP fairness: a different IP keeps its own bucket');
  });

  it('generate-form: 6th request from one IP is 429 with Retry-After', async () => {
    const body = () => ({ formId: 'I-765', factRecord: baseRecord() });
    for (let i = 0; i < 5; i++) {
      const res = mockRes();
      await generateHandler(reqFrom('10.20.2.1', { body: body() }), res);
      assert.equal(res.statusCode, 200, `request ${i + 1} within capacity 5`);
    }
    const blocked = mockRes();
    await generateHandler(reqFrom('10.20.2.1', { body: body() }), blocked);
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers['Retry-After']) > 0);
  });

  it('per-endpoint buckets are independent: exhausting checkout does not drain generate-form or review-image for the same IP', async () => {
    const ip = '10.20.3.1';
    for (let i = 0; i < 5; i++) {
      const res = mockRes();
      await checkoutHandler(reqFrom(ip, { body: { sku: 'iru-evaluation' } }), res);
      assert.equal(res.statusCode, 200, `checkout ${i + 1} within capacity 5`);
    }
    const blockedCheckout = mockRes();
    await checkoutHandler(reqFrom(ip, { body: { sku: 'iru-evaluation' } }), blockedCheckout);
    assert.equal(blockedCheckout.statusCode, 429, 'checkout bucket for this IP is exhausted');

    const gen = mockRes();
    await generateHandler(reqFrom(ip, { body: { formId: 'I-765', factRecord: baseRecord() } }), gen);
    assert.equal(gen.statusCode, 200, 'generate-form bucket is independent of checkout');

    const rev = mockRes();
    await reviewHandler(reqFrom(ip, { body: { imageBase64: TINY_PNG_B64, mimeType: 'image/png' } }), rev);
    assert.equal(rev.statusCode, 200, 'review-image bucket is independent of checkout');
  });
});

describe('WS5 (b) malformed and oversized inputs', () => {
  it('review-image: bytes that do not match the declared image MIME are refused 400', async () => {
    const textB64 = Buffer.from('this is definitely not a PNG image at all').toString('base64');
    const asPng = mockRes();
    await reviewHandler(reqFrom('10.20.4.1', { body: { imageBase64: textB64, mimeType: 'image/png' } }), asPng);
    assert.equal(asPng.statusCode, 400);
    assert.match(asPng.body.details.join(' '), /signature does not match/);

    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]).toString('base64');
    const jpegAsPng = mockRes();
    await reviewHandler(reqFrom('10.20.4.2', { body: { imageBase64: jpegBytes, mimeType: 'image/png' } }), jpegAsPng);
    assert.equal(jpegAsPng.statusCode, 400, 'JPEG bytes declared as PNG are refused');

    const pngAsPdf = mockRes();
    await reviewHandler(reqFrom('10.20.4.3', { body: { imageBase64: TINY_PNG_B64, mimeType: 'application/pdf' } }), pngAsPdf);
    assert.equal(pngAsPdf.statusCode, 400, 'PNG bytes declared as PDF are refused (%PDF- check)');

    // Controls: correctly labeled content still passes signature checks.
    const okPng = mockRes();
    await reviewHandler(reqFrom('10.20.4.4', { body: { imageBase64: TINY_PNG_B64, mimeType: 'image/png' } }), okPng);
    assert.equal(okPng.statusCode, 200);
    const okJpeg = mockRes();
    await reviewHandler(reqFrom('10.20.4.5', { body: { imageBase64: jpegBytes, mimeType: 'image/jpeg' } }), okJpeg);
    assert.equal(okJpeg.statusCode, 200, 'JPEG bytes declared as JPEG pass');
  });

  it('review-image: base64 decoding to more than 4MB is 413', async () => {
    const big = Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64');
    const res = mockRes();
    await reviewHandler(reqFrom('10.20.5.1', { body: { imageBase64: big, mimeType: 'image/png' } }), res);
    assert.equal(res.statusCode, 413);
  });

  it('analyze: a body over the 32KB cap is 413 before any model work', async () => {
    const res = mockRes();
    await analyzeHandler(reqFrom('10.20.6.1', { body: { answers: { narrative_text: 'x'.repeat(40000) } } }), res);
    assert.equal(res.statusCode, 413);
  });

  it('generate-form: a body over the 256KB cap is 413', async () => {
    const res = mockRes();
    await generateHandler(reqFrom('10.20.7.1', {
      body: { formId: 'I-765', factRecord: baseRecord(), pad: 'x'.repeat(300 * 1024) },
    }), res);
    assert.equal(res.statusCode, 413);
  });

  it('checkout: a body over the 256KB cap is 413 (object and raw-string forms)', async () => {
    const objRes = mockRes();
    await checkoutHandler(reqFrom('10.20.8.1', { body: { sku: 'iru-evaluation', pad: 'x'.repeat(300 * 1024) } }), objRes);
    assert.equal(objRes.statusCode, 413, 'oversized object body refused (defect fixed in WS5)');
    const strRes = mockRes();
    await checkoutHandler(reqFrom('10.20.8.2', { body: JSON.stringify({ sku: 'iru-evaluation' }) + ' '.repeat(300 * 1024) }), strRes);
    assert.equal(strRes.statusCode, 413, 'oversized raw-string body refused');
    const okRes = mockRes();
    await checkoutHandler(reqFrom('10.20.8.3', { body: { sku: 'iru-evaluation' } }), okRes);
    assert.equal(okRes.statusCode, 200, 'a normal-sized checkout still succeeds');
  });
});

describe('WS5 (c) error-response hygiene', () => {
  const FORBIDDEN = ['stack', 'sk_live', 'sk_test', 'whsec', 'GEMINI', '/home', 'node_modules', 'You are a document', 'Bearer '];
  function assertClean(res, label) {
    const text = JSON.stringify(res.body || {});
    for (const bad of FORBIDDEN) {
      assert.ok(!text.includes(bad), `${label} response must not contain ${JSON.stringify(bad)}: ${text.slice(0, 200)}`);
    }
    assert.ok(res.body && typeof res.body.error === 'string', `${label} carries the standard { error } shape`);
  }

  it('400/402/404/413/429 bodies leak no internals, keys, paths, or prompt text', async () => {
    const cases = [];
    // 413 — checkout oversized
    const c413 = mockRes();
    await checkoutHandler(reqFrom('10.20.9.1', { body: { sku: 'iru-evaluation', pad: 'x'.repeat(300 * 1024) } }), c413);
    cases.push([c413, 'checkout 413']);
    // 400 — checkout unknown sku
    const c400 = mockRes();
    await checkoutHandler(reqFrom('10.20.9.2', { body: { sku: 'nope' } }), c400);
    assert.equal(c400.statusCode, 400); cases.push([c400, 'checkout 400']);
    // 400 — review-image signature mismatch
    const r400 = mockRes();
    await reviewHandler(reqFrom('10.20.9.3', {
      body: { imageBase64: Buffer.from('not an image').toString('base64'), mimeType: 'image/png' },
    }), r400);
    assert.equal(r400.statusCode, 400); cases.push([r400, 'review-image 400']);
    // 404 — entitlement-status unknown token
    const s404 = mockRes();
    await statusHandler(reqFrom('10.20.9.4', { body: { token: 'no-such-token' } }), s404);
    assert.equal(s404.statusCode, 404); cases.push([s404, 'entitlement-status 404']);
    // 402 — generate-form under the paywall with no valid entitlement
    process.env.PAYWALL_ENABLED = 'true';
    try {
      const g402 = mockRes();
      await generateHandler(reqFrom('10.20.9.5', {
        body: { formId: 'I-589', factRecord: baseRecord(), entitlementToken: 'forged' },
      }), g402);
      assert.equal(g402.statusCode, 402); cases.push([g402, 'generate-form 402']);
    } finally { delete process.env.PAYWALL_ENABLED; }
    // 429 — review-image bucket for a dedicated IP, exhausted here
    const body = { imageBase64: TINY_PNG_B64, mimeType: 'image/png' };
    for (let i = 0; i < 5; i++) {
      const warm = mockRes();
      await reviewHandler(reqFrom('10.20.9.6', { body }), warm);
      assert.equal(warm.statusCode, 200);
    }
    const r429 = mockRes();
    await reviewHandler(reqFrom('10.20.9.6', { body }), r429);
    assert.equal(r429.statusCode, 429); cases.push([r429, 'review-image 429']);

    for (const [res, label] of cases) assertClean(res, label);
  });
});

describe('WS5 (d) access isolation at the HTTP layer', () => {
  it("user B's tokens cannot peek or consume user A's form entitlement via generate-form", async () => {
    process.env.PAYWALL_ENABLED = 'true';
    try {
      // User A: paid entitlement covering I-589 ONLY.
      const a = entitlementStore.create({
        sku: 'iru-one-form', amountCents: 9895, sessionId: 'sess_ws5_a',
        scope: { kind: 'forms', forms: ['I-589'] },
      });
      entitlementStore.markPaidBySession('sess_ws5_a', 'evt_ws5_a');
      // User B: paid entitlement of the WRONG kind (evaluation scope).
      const b = entitlementStore.create({
        sku: 'iru-evaluation', amountCents: 100, sessionId: 'sess_ws5_b',
        scope: { kind: 'evaluation' },
      });
      entitlementStore.markPaidBySession('sess_ws5_b', 'evt_ws5_b');

      // B's valid token against A's covered form → 402 (scope mismatch).
      const bPeek = mockRes();
      await generateHandler(reqFrom('10.20.10.1', {
        body: { formId: 'I-589', factRecord: baseRecord(), entitlementToken: b.token },
      }), bPeek);
      assert.equal(bPeek.statusCode, 402);
      assert.equal(bPeek.body.reason, 'scope-mismatch');

      // A's own token against the form A did NOT buy → 402 (not covered).
      const aWrongForm = mockRes();
      await generateHandler(reqFrom('10.20.10.2', {
        body: { formId: 'I-765', factRecord: baseRecord(), entitlementToken: a.token },
      }), aWrongForm);
      assert.equal(aWrongForm.statusCode, 402);
      assert.equal(aWrongForm.body.reason, 'form-not-covered');

      // Neither failed attempt consumed anything: A's I-589 still delivers.
      const aOk = mockRes();
      await generateHandler(reqFrom('10.20.10.3', {
        body: { formId: 'I-589', factRecord: baseRecord(), entitlementToken: a.token },
      }), aOk);
      assert.equal(aOk.statusCode, 200, "A's entitlement is intact after B's attempts");
      // ...exactly once. A's was a SINGLE-form entitlement, so the
      // delivery exhausted it: the store flips to CONSUMED and the
      // state check (which precedes the consumed-forms check in
      // peekForForm) reports state-CONSUMED. Still a 402 refusal.
      const aAgain = mockRes();
      await generateHandler(reqFrom('10.20.10.4', {
        body: { formId: 'I-589', factRecord: baseRecord(), entitlementToken: a.token },
      }), aAgain);
      assert.equal(aAgain.statusCode, 402);
      assert.equal(aAgain.body.reason, 'state-CONSUMED');

      // The form-already-delivered reason is the BUNDLE case: one form
      // delivered, the entitlement still RESERVED for the other form.
      const bundle = entitlementStore.create({
        sku: 'iru-bundle', amountCents: 14895, sessionId: 'sess_ws5_bundle',
        scope: { kind: 'forms', forms: ['I-589', 'I-765'] },
      });
      entitlementStore.markPaidBySession('sess_ws5_bundle', 'evt_ws5_bundle');
      const firstUse = mockRes();
      await generateHandler(reqFrom('10.20.10.5', {
        body: { formId: 'I-589', factRecord: baseRecord(), entitlementToken: bundle.token },
      }), firstUse);
      assert.equal(firstUse.statusCode, 200);
      const repeatUse = mockRes();
      await generateHandler(reqFrom('10.20.10.6', {
        body: { formId: 'I-589', factRecord: baseRecord(), entitlementToken: bundle.token },
      }), repeatUse);
      assert.equal(repeatUse.statusCode, 402);
      assert.equal(repeatUse.body.reason, 'form-already-delivered');
      const otherForm = mockRes();
      await generateHandler(reqFrom('10.20.10.7', {
        body: { formId: 'I-765', factRecord: baseRecord(), entitlementToken: bundle.token },
      }), otherForm);
      assert.equal(otherForm.statusCode, 200, 'the undelivered bundle form remains usable');
    } finally { delete process.env.PAYWALL_ENABLED; }
  });

  it('analyze accepts answers with no postal code anywhere (sanitizer never requires one)', async () => {
    const clean = sanitizeAnswers({ country_of_origin: 'Testlandia', case_type: 'asylum', has_passport: 'yes' });
    assert.equal(clean.ok, true);
    assert.ok(!('zip_code' in clean.answers), 'zip_code is not even an allowlisted analyze field');
    const res = mockRes();
    await analyzeHandler(reqFrom('10.20.11.1', {
      body: { answers: { country_of_origin: 'Testlandia', case_type: 'asylum', has_passport: 'yes' }, lang: 'EN' },
    }), res);
    const events = res.chunks.join('').split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    assert.ok(events.some((e) => e.type === 'done'), 'analysis completes with no postal code supplied');
  });
});
