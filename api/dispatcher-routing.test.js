/**
 * api/dispatcher-routing.test.js — Dispatcher routing (Vercel Hobby
 * 12-function consolidation, 2026-11-12).
 *
 * api/staff.js serves GET /api/org-info and POST /api/send-report
 * (rewritten to /api/staff?route=...); api/assessment.js serves POST
 * /api/assessment-save and POST /api/assessment-resume (rewritten to
 * /api/assessment?route=...). These tests prove the dispatchers route
 * each original URL to the correct handler with the same behavior —
 * the full mechanics of each handler are covered by
 * api/institutional-mode.test.js (send-report / org-info) and
 * api/access-gates.test.js (assessment save/resume).
 *
 * An unknown or missing ?route= is a 404 (the route does not exist),
 * never a fallback to a handler.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import staffHandler from './staff.js';
import assessmentHandler from './assessment.js';
import { resetServerModeCache } from './_lib/server-mode.js';
import { createEntitlementStore } from './_lib/entitlement.js';

function asInstitutional() {
  process.env.IRU_SERVER_MODE = 'institutional';
  resetServerModeCache();
}

function asConsumer() {
  delete process.env.IRU_SERVER_MODE;
  resetServerModeCache();
}

let ipCounter = 0;
const nextIp = () => `10.8.0.${++ipCounter}`;

function mockRes() {
  return {
    statusCode: 200, headers: {}, jsonBody: null, ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(o) { this.jsonBody = o; this.ended = true; return this; },
    end() { this.ended = true; },
  };
}

const mockReq = ({ method = 'POST', ip = nextIp(), body = {}, query = {}, headers = {} } = {}) => ({
  method,
  headers: { 'x-forwarded-for': ip, ...headers },
  socket: { remoteAddress: ip },
  body,
  query,
});

// ── staff dispatcher ───────────────────────────────────────────────────
describe('staff dispatcher (/api/staff?route=...)', () => {
  let savedResendKey;
  beforeEach(() => {
    asInstitutional();
    savedResendKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    if (savedResendKey !== undefined) process.env.RESEND_API_KEY = savedResendKey;
    else delete process.env.RESEND_API_KEY;
    asConsumer();
  });

  it('routes GET ?route=org-info to the org-info handler (200, test org listed)', async () => {
    const res = mockRes();
    await staffHandler(mockReq({ method: 'GET', query: { route: 'org-info' } }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.jsonBody));
    assert.equal(res.jsonBody.length, 1);
    assert.equal(res.jsonBody[0].slug, 'test');
    assert.equal(res.jsonBody[0].orgName, 'Test organization');
    assert.equal(res.jsonBody[0].configured, true);
    // No email addresses are ever returned.
    assert.equal('staffEmail' in res.jsonBody[0], false);
  });

  it('routes POST ?route=org-info to the org-info handler (405, GET only)', async () => {
    const res = mockRes();
    await staffHandler(mockReq({ method: 'POST', query: { route: 'org-info' } }), res);
    assert.equal(res.statusCode, 405);
  });

  it('routes POST ?route=send-report to the send-report handler (503 not-configured without RESEND_API_KEY)', async () => {
    const res = mockRes();
    await staffHandler(mockReq({
      query: { route: 'send-report' },
      body: {
        org: 'test',
        formNumber: 'I-765',
        participantName: 'Dispatcher Test',
        report: { formNumber: 'I-765', participantName: 'Dispatcher Test', overallScore: 0.8, steps: [], questions: [], answers: {} },
      },
    }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.jsonBody.reason, 'not-configured');
  });

  it('send-report route stays institutional-only through the dispatcher (consumer mode → 404)', async () => {
    asConsumer();
    const res = mockRes();
    await staffHandler(mockReq({
      query: { route: 'send-report' },
      body: { org: 'test', formNumber: 'I-765', report: {} },
    }), res);
    assert.equal(res.statusCode, 404);
  });

  it('unknown ?route= is a 404, never a fallback to a handler', async () => {
    const res = mockRes();
    await staffHandler(mockReq({ query: { route: 'bogus' } }), res);
    assert.equal(res.statusCode, 404);
  });

  it('missing ?route= is a 404', async () => {
    const res = mockRes();
    await staffHandler(mockReq({}), res);
    assert.equal(res.statusCode, 404);
  });
});

// ── assessment dispatcher ──────────────────────────────────────────────
describe('assessment dispatcher (/api/assessment?route=...)', () => {
  const CLIENT_KEY = 'dispatcher-test-key';
  const VALID_HASH = 'a'.repeat(64);
  const clientKeyHash = crypto.createHash('sha256').update(CLIENT_KEY).digest('hex');

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

  beforeEach(() => {
    process.env.PAYWALL_ENABLED = 'false';
    globalThis.__IRU_ASSESSMENT_DB__ = fakeSaveDb();
  });
  afterEach(() => {
    delete process.env.PAYWALL_ENABLED;
    delete globalThis.__IRU_ASSESSMENT_DB__;
  });

  it('routes POST ?route=save to the save handler (201)', async () => {
    const store = createEntitlementStore();
    const res = mockRes();
    await assessmentHandler(mockReq({
      query: { route: 'save' },
      body: { clientKeyHash: VALID_HASH, form_id: 'i765', facts: {}, progress: {} },
    }), res, store);
    assert.equal(res.statusCode, 201);
    assert.equal(res.jsonBody.token, 'save-token-1');
  });

  it('routes POST ?route=resume to the resume handler (200)', async () => {
    globalThis.__IRU_ASSESSMENT_DB__ = fakeResumeDb();
    const store = createEntitlementStore();
    const res = mockRes();
    await assessmentHandler(mockReq({
      query: { route: 'resume' },
      body: { token: 'resume-token-1', clientKey: CLIENT_KEY },
    }), res, store);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.form_id, 'i765');
    assert.deepEqual(res.jsonBody.facts, { a: 1 });
  });

  it('unknown ?route= is a 404, never a fallback to a handler', async () => {
    const store = createEntitlementStore();
    const res = mockRes();
    await assessmentHandler(mockReq({ query: { route: 'bogus' }, body: {} }), res, store);
    assert.equal(res.statusCode, 404);
  });

  it('missing ?route= is a 404', async () => {
    const store = createEntitlementStore();
    const res = mockRes();
    await assessmentHandler(mockReq({ body: {} }), res, store);
    assert.equal(res.statusCode, 404);
  });
});
