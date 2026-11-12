/**
 * api/access-gates.test.js — Paid-access gates (owner directive 2026-11-05).
 *
 * Covers the server-side gates added for the paid consumer workflow:
 * - peekForReadiness / peekForAssessment (api/_lib/entitlement.js)
 * - POST /api/analyze full path: READINESS entitlement only
 *   (readiness ≠ prep is an explicit owner rule — a prep token 402s)
 * - POST /api/review-image: readiness OR prep (peekForAssessment)
 * - POST /api/assessment-save and /api/assessment-resume (Node
 *   handlers): any paid entitlement
 *
 * NOT covered here (already covered, do not duplicate):
 * - POST /api/generate-form gate → api/evaluation-security.test.js
 *   (no token 402, evaluation token 402, wrong-form 402, replay 402)
 * - mode:'limited' behavior → api/evaluation-security.test.js
 *
 * Handlers are called directly with an injected fresh store (3rd arg).
 * Env: IRU_STORE_BACKEND/IRU_ALLOW_EPHEMERAL_STORE are not needed
 * here because no handler under test consults the durable-store gate;
 * PAYWALL_ENABLED is set explicitly per describe ('true' for gate
 * tests, 'false' for paywall-off tests).
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createEntitlementStore } from './_lib/entitlement.js';
import analyzeHandler from './analyze.js';
import reviewHandler from './review-image.js';
import { saveHandler } from './assessment.js';
import { resumeHandler } from './assessment.js';

const GOOD_ASSESSMENT = {
  readinessSummary: 'ok', factsProvided: [], missingInformation: [],
  contradictions: [], inferences: [], suggestedQuestions: [],
  uncertaintyNotes: [], notLegalAdvice: 'Not legal advice.', evidenceGaps: [],
};

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const GOOD_REVIEW = {
  documentCategory: 'utility bill',
  legibility: 'legible',
  fieldsVisible: ['name', 'address', 'date'],
  appearsComplete: 'yes',
  inconsistencies: [],
  relatedReadinessItem: 'has_lease',
  limitations: ['Image is low resolution in one corner.'],
};

let ipCounter = 0;
const nextIp = () => `10.9.0.${++ipCounter}`;

function mockRes() {
  return {
    statusCode: 200, headers: {}, chunks: [], ended: false, jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(o) { this.jsonBody = o; this.ended = true; return this; },
    write(s) { this.chunks.push(s); },
    end() { this.ended = true; },
  };
}

const mockReq = ({ body = {}, headers = {}, ip = nextIp() } = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': ip, ...headers },
  body,
  socket: { remoteAddress: ip },
});

function sseEvents(res) {
  return res.chunks
    .join('')
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

let tokenSeq = 0;
function paidToken(store, scope) {
  const n = ++tokenSeq;
  const sku = scope.kind === 'readiness' ? 'iru-readiness'
    : scope.kind === 'forms' ? 'iru-formprep' : 'iru-evaluation';
  const { token } = store.create({
    sku, amountCents: 9995, scope, sessionId: `sess_gate_${n}`,
  });
  const marked = store.markPaidBySession(`sess_gate_${n}`, `evt_gate_${n}`);
  assert.equal(marked.applied, true, JSON.stringify(marked));
  return token;
}
function unpaidToken(store, scope) {
  const n = ++tokenSeq;
  return store.create({
    sku: 'iru-readiness', amountCents: 9995, scope, sessionId: `sess_gate_u${n}`,
  }).token;
}

const READINESS_589 = { kind: 'readiness', forms: ['I-589'] };
const READINESS_765 = { kind: 'readiness', forms: ['I-765'] };
const PREP_589 = { kind: 'forms', forms: ['I-589'] };
const PREP_765 = { kind: 'forms', forms: ['I-765'] };
const EVALUATION = { kind: 'evaluation' };

describe('peekForReadiness / peekForAssessment (store-level, fresh store)', () => {
  it('readiness token covers its form, not another form', () => {
    const store = createEntitlementStore();
    const token = paidToken(store, READINESS_589);
    assert.equal(store.peekForReadiness(token, 'I-589').ok, true);
    const other = store.peekForReadiness(token, 'I-765');
    assert.equal(other.ok, false);
    assert.equal(other.reason, 'form-not-covered');
  });

  it('peekForForm on a readiness token is a scope-mismatch', () => {
    const store = createEntitlementStore();
    const token = paidToken(store, READINESS_589);
    const peek = store.peekForForm(token, 'I-589');
    assert.equal(peek.ok, false);
    assert.equal(peek.reason, 'scope-mismatch');
  });

  it('prep token does not satisfy peekForReadiness', () => {
    const store = createEntitlementStore();
    const token = paidToken(store, PREP_589);
    const peek = store.peekForReadiness(token, 'I-589');
    assert.equal(peek.ok, false);
    assert.equal(peek.reason, 'scope-mismatch');
  });

  it('evaluation token does not satisfy peekForReadiness', () => {
    const store = createEntitlementStore();
    const token = paidToken(store, EVALUATION);
    const peek = store.peekForReadiness(token, 'I-589');
    assert.equal(peek.ok, false);
    assert.equal(peek.reason, 'scope-mismatch');
  });

  it('peekForAssessment accepts prep (via forms) or readiness (via readiness)', () => {
    const store = createEntitlementStore();
    const prep = paidToken(store, PREP_765);
    const prepPeek = store.peekForAssessment(prep, 'I-765');
    assert.equal(prepPeek.ok, true);
    assert.equal(prepPeek.via, 'forms');
    const ready = paidToken(store, READINESS_765);
    const readyPeek = store.peekForAssessment(ready, 'I-765');
    assert.equal(readyPeek.ok, true);
    assert.equal(readyPeek.via, 'readiness');
  });

  it('peekForAssessment fails with the peekForForm reason when the token is paid', () => {
    const store = createEntitlementStore();
    const prepOther = paidToken(store, PREP_589);
    const a = store.peekForAssessment(prepOther, 'I-765');
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'form-not-covered');
    const readyOther = paidToken(store, READINESS_765);
    const b = store.peekForAssessment(readyOther, 'I-589');
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'scope-mismatch');
    const evalToken = paidToken(store, EVALUATION);
    const c = store.peekForAssessment(evalToken, 'I-589');
    assert.equal(c.ok, false);
    assert.equal(c.reason, 'scope-mismatch');
  });

  it('peekForAssessment fails with the token reason when the token itself is bad', () => {
    const store = createEntitlementStore();
    assert.equal(store.peekForAssessment('no-such-token', 'I-589').reason, 'unknown-token');
    assert.equal(store.peekForReadiness('no-such-token', 'I-589').reason, 'unknown-token');
    const unpaid = unpaidToken(store, READINESS_589);
    assert.equal(store.peekForAssessment(unpaid, 'I-589').reason, 'not-paid');
    assert.equal(store.peekForReadiness(unpaid, 'I-589').reason, 'not-paid');
  });

  it('readiness peek does not consume: the token stays usable', () => {
    const store = createEntitlementStore();
    const token = paidToken(store, READINESS_589);
    assert.equal(store.peekForReadiness(token, 'I-589').ok, true);
    assert.equal(store.peekForReadiness(token, 'I-589').ok, true);
    assert.equal(store.getByToken(token).state, 'RESERVED');
  });
});

describe('analyze full-path gate — paywall ON (readiness only)', () => {
  before(() => {
    process.env.PAYWALL_ENABLED = 'true';
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() {
        yield { text: JSON.stringify(GOOD_ASSESSMENT) };
      },
    };
  });
  after(() => {
    delete process.env.PAYWALL_ENABLED;
    delete globalThis.__IRU_AI_CLIENT__;
  });

  const analyzeBody = (over = {}) => ({
    answers: { country_of_origin: 'Haiti', case_type: 'asylum' },
    formId: 'I-589',
    ...over,
  });

  it('no token → 402 unknown-token', async () => {
    const store = createEntitlementStore();
    const res = mockRes();
    await analyzeHandler(mockReq({ body: analyzeBody() }), res, store);
    assert.equal(res.statusCode, 402);
    assert.equal(res.jsonBody.reason, 'unknown-token');
  });

  it('valid readiness token for the form → passes the gate (200, done event)', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, READINESS_589);
    const res = mockRes();
    await analyzeHandler(mockReq({
      body: analyzeBody(),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 200);
    const done = sseEvents(res).find((e) => e.type === 'done');
    assert.ok(done, 'done event emitted');
    assert.equal(done.assessment.readinessSummary, 'ok');
  });

  it('valid PAID PREP token → 402 scope-mismatch (readiness ≠ prep)', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, PREP_589);
    const res = mockRes();
    await analyzeHandler(mockReq({
      body: analyzeBody(),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 402);
    assert.equal(res.jsonBody.reason, 'scope-mismatch');
  });

  it('readiness token for another form → 402 form-not-covered', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, READINESS_765);
    const res = mockRes();
    await analyzeHandler(mockReq({
      body: analyzeBody(),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 402);
    assert.equal(res.jsonBody.reason, 'form-not-covered');
  });

  it('readiness token with no formId → passes the gate (scope-agnostic fallback)', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, READINESS_589);
    const res = mockRes();
    await analyzeHandler(mockReq({
      body: analyzeBody({ formId: undefined }),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 200);
    assert.ok(sseEvents(res).find((e) => e.type === 'done'));
  });

  it('prep token with no formId → 402 scope-mismatch (fallback is readiness-only)', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, PREP_589);
    const res = mockRes();
    await analyzeHandler(mockReq({
      body: analyzeBody({ formId: undefined }),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 402);
    assert.equal(res.jsonBody.reason, 'scope-mismatch');
  });

  it('unpaid readiness token → 402 not-paid', async () => {
    const store = createEntitlementStore();
    const token = unpaidToken(store, READINESS_589);
    const res = mockRes();
    await analyzeHandler(mockReq({
      body: analyzeBody(),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 402);
    assert.equal(res.jsonBody.reason, 'not-paid');
  });
});

describe('analyze full-path gate — paywall OFF (unchanged behavior)', () => {
  before(() => {
    process.env.PAYWALL_ENABLED = 'false';
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() {
        yield { text: JSON.stringify(GOOD_ASSESSMENT) };
      },
    };
  });
  after(() => {
    delete process.env.PAYWALL_ENABLED;
    delete globalThis.__IRU_AI_CLIENT__;
  });

  it('no token → no gate 402 (full assessment runs)', async () => {
    const store = createEntitlementStore();
    const res = mockRes();
    await analyzeHandler(mockReq({
      body: {
        answers: { country_of_origin: 'Haiti', case_type: 'asylum' },
        formId: 'I-589',
      },
    }), res, store);
    assert.equal(res.statusCode, 200);
    assert.ok(sseEvents(res).find((e) => e.type === 'done'));
  });
});

describe('review-image gate — paywall ON (readiness OR prep)', () => {
  before(() => {
    process.env.PAYWALL_ENABLED = 'true';
    globalThis.__IRU_VISION_CLIENT__ = {
      async reviewImage() {
        return JSON.stringify(GOOD_REVIEW);
      },
    };
  });
  after(() => {
    delete process.env.PAYWALL_ENABLED;
    delete globalThis.__IRU_VISION_CLIENT__;
  });

  const imageBody = (over = {}) => ({
    imageBase64: TINY_PNG_B64, mimeType: 'image/png',
    relatedEvidenceKey: 'has_lease', lang: 'EN', formId: 'I-765',
    ...over,
  });

  it('no token → 402 unknown-token', async () => {
    const store = createEntitlementStore();
    const res = mockRes();
    await reviewHandler(mockReq({ body: imageBody() }), res, store);
    assert.equal(res.statusCode, 402);
    assert.equal(res.jsonBody.reason, 'unknown-token');
  });

  it('valid prep token for the form → passes the gate (200)', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, PREP_765);
    const res = mockRes();
    await reviewHandler(mockReq({
      body: imageBody(),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
  });

  it('valid readiness token for the form → passes the gate (200)', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, READINESS_765);
    const res = mockRes();
    await reviewHandler(mockReq({
      body: imageBody(),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
  });

  it('prep token for another form → 402 form-not-covered', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, PREP_589);
    const res = mockRes();
    await reviewHandler(mockReq({
      body: imageBody(),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 402);
    assert.equal(res.jsonBody.reason, 'form-not-covered');
  });

  it('prep token with no formId → passes the gate (scope-agnostic fallback)', async () => {
    const store = createEntitlementStore();
    const token = paidToken(store, PREP_765);
    const res = mockRes();
    await reviewHandler(mockReq({
      body: imageBody({ formId: undefined }),
      headers: { 'x-entitlement-token': token },
    }), res, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
  });
});

describe('review-image gate — paywall OFF (unchanged behavior)', () => {
  before(() => {
    process.env.PAYWALL_ENABLED = 'false';
    globalThis.__IRU_VISION_CLIENT__ = {
      async reviewImage() {
        return JSON.stringify(GOOD_REVIEW);
      },
    };
  });
  after(() => {
    delete process.env.PAYWALL_ENABLED;
    delete globalThis.__IRU_VISION_CLIENT__;
  });

  it('no token → no gate 402 (review runs)', async () => {
    const store = createEntitlementStore();
    const res = mockRes();
    await reviewHandler(mockReq({
      body: {
        imageBase64: TINY_PNG_B64, mimeType: 'image/png',
        relatedEvidenceKey: 'has_lease', lang: 'EN',
      },
    }), res, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
  });
});

describe('assessment-save / assessment-resume gates', () => {
  const CLIENT_KEY = 'test-client-key';
  const clientKeyHash = crypto.createHash('sha256').update(CLIENT_KEY).digest('hex');
  const VALID_HASH = 'a'.repeat(64);

  function fakeSaveDb() {
    return {
      async query(sql) {
        if (/INSERT INTO assessments/.test(sql)) {
          return { rows: [{ token: 'save-token-1', id: 'assess-1', created_at: '2026-11-05T00:00:00.000Z' }] };
        }
        if (/UPDATE assessments SET facts/.test(sql)) {
          return { rows: [{ token: 'save-token-1', id: 'assess-1', updated_at: '2026-11-05T00:00:00.000Z' }] };
        }
        return { rows: [] };
      },
    };
  }
  function fakeResumeDb() {
    return {
      async query(sql) {
        if (/SELECT id, form_id/.test(sql)) {
          return {
            rows: [{
              id: 'assess-1', form_id: 'i765', facts: { a: 1 }, progress: { step: 2 },
              status: 'in_progress', updated_at: '2026-11-05T00:00:00.000Z',
              expires_at: new Date(Date.now() + 3600e3).toISOString(),
              client_key_hash: clientKeyHash,
            }],
          };
        }
        return { rows: [] };
      },
    };
  }

  describe('paywall ON (any paid entitlement)', () => {
    before(() => { process.env.PAYWALL_ENABLED = 'true'; });
    after(() => { delete process.env.PAYWALL_ENABLED; });
    beforeEach(() => {
      globalThis.__IRU_ASSESSMENT_DB__ = fakeSaveDb();
    });
    afterEach(() => { delete globalThis.__IRU_ASSESSMENT_DB__; });

    it('save with no token → 402 unknown-token', async () => {
      const store = createEntitlementStore();
      const res = mockRes();
      await saveHandler(mockReq({
        body: { clientKeyHash: VALID_HASH, form_id: 'i765', facts: {}, progress: {} },
      }), res, store);
      assert.equal(res.statusCode, 402);
      assert.equal(res.jsonBody.reason, 'unknown-token');
    });

    it('save with valid paid token → proceeds (201, save mechanics unchanged)', async () => {
      const store = createEntitlementStore();
      const token = paidToken(store, READINESS_765);
      const res = mockRes();
      await saveHandler(mockReq({
        body: { clientKeyHash: VALID_HASH, form_id: 'i765', facts: {}, progress: {} },
        headers: { 'x-entitlement-token': token },
      }), res, store);
      assert.equal(res.statusCode, 201);
      assert.equal(res.jsonBody.token, 'save-token-1');
    });

    it('save with unpaid token → 402 not-paid', async () => {
      const store = createEntitlementStore();
      const token = unpaidToken(store, READINESS_765);
      const res = mockRes();
      await saveHandler(mockReq({
        body: { clientKeyHash: VALID_HASH, form_id: 'i765', facts: {}, progress: {} },
        headers: { 'x-entitlement-token': token },
      }), res, store);
      assert.equal(res.statusCode, 402);
      assert.equal(res.jsonBody.reason, 'not-paid');
    });

    it('resume with no token → 402 unknown-token', async () => {
      const store = createEntitlementStore();
      const res = mockRes();
      await resumeHandler(mockReq({
        body: { token: 'resume-token-1', clientKey: CLIENT_KEY },
      }), res, store);
      assert.equal(res.statusCode, 402);
      assert.equal(res.jsonBody.reason, 'unknown-token');
    });

    it('resume with valid paid token → proceeds (200, resume mechanics unchanged)', async () => {
      const store = createEntitlementStore();
      const token = paidToken(store, PREP_765);
      globalThis.__IRU_ASSESSMENT_DB__ = fakeResumeDb();
      const res = mockRes();
      await resumeHandler(mockReq({
        body: { token: 'resume-token-1', clientKey: CLIENT_KEY },
        headers: { 'x-entitlement-token': token },
      }), res, store);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.form_id, 'i765');
      assert.deepEqual(res.jsonBody.facts, { a: 1 });
    });
  });

  describe('paywall OFF (unchanged behavior)', () => {
    before(() => { process.env.PAYWALL_ENABLED = 'false'; });
    after(() => { delete process.env.PAYWALL_ENABLED; });
    beforeEach(() => {
      globalThis.__IRU_ASSESSMENT_DB__ = fakeSaveDb();
    });
    afterEach(() => { delete globalThis.__IRU_ASSESSMENT_DB__; });

    it('save with no token → no gate 402 (201)', async () => {
      const store = createEntitlementStore();
      const res = mockRes();
      await saveHandler(mockReq({
        body: { clientKeyHash: VALID_HASH, form_id: 'i765', facts: {}, progress: {} },
      }), res, store);
      assert.equal(res.statusCode, 201);
    });

    it('resume with no token → no gate 402 (200)', async () => {
      const store = createEntitlementStore();
      globalThis.__IRU_ASSESSMENT_DB__ = fakeResumeDb();
      const res = mockRes();
      await resumeHandler(mockReq({
        body: { token: 'resume-token-1', clientKey: CLIENT_KEY },
      }), res, store);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.form_id, 'i765');
    });
  });
});
