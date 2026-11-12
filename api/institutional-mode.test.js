/**
 * api/institutional-mode.test.js — Institutional (staff) mode server tests.
 *
 * Covers:
 * - server-mode.js: build-time mode resolution (committed default is
 *   'consumer'; fail-closed when the mode file is missing).
 * - org-staff.js: per-org staff email registry (test org routes to the
 *   owner's test address; unlisted orgs resolve to null — no real org
 *   staff address is configured during testing).
 * - send-report.js: staff delivery endpoint — method, validation,
 *   rate limit, not-configured (missing RESEND_API_KEY), registry
 *   resolution (authoritative), and the Resend call shape (browser
 *   User-Agent header, single recipient, test-mode address).
 *
 * The client (INSTITUTIONAL_MODE, StaffDashboard, Tier1Report delivery
 * section) is verified by the build + the Preview walk, not here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverBuildMode, isInstitutionalServer, resetServerModeCache } from './_lib/server-mode.js';
import { resolveOrgStaffEmail, ORG_STAFF } from './_lib/org-staff.js';
import sendReport from './send-report.js';

// The C-2 gate makes /api/send-report institutional-only. These tests
// exercise the endpoint, so they run with the IRU_SERVER_MODE override;
// the consumer-mode 404 gate is covered by its own test below.
function asInstitutional() {
  process.env.IRU_SERVER_MODE = 'institutional';
  resetServerModeCache();
}

function asConsumer() {
  delete process.env.IRU_SERVER_MODE;
  resetServerModeCache();
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return res;
}

function mockReq({ method = 'POST', ip = '10.0.0.1', body = {} } = {}) {
  return {
    method,
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    body,
  };
}

// ── server-mode ────────────────────────────────────────────────────────
test('server-mode: committed build-mode.json resolves to consumer (fail-closed default)', () => {
  assert.equal(serverBuildMode(), 'consumer');
  assert.equal(isInstitutionalServer(), false);
});

// ── org-staff registry ─────────────────────────────────────────────────
test('org-staff: test org routes to the owner test address', () => {
  assert.equal(resolveOrgStaffEmail('test'), 'healthcarebyvalentine@gmail.com');
  assert.equal(resolveOrgStaffEmail('TEST'), 'healthcarebyvalentine@gmail.com');
});

test('org-staff: unlisted orgs resolve to null (no real org staff address during testing)', () => {
  assert.equal(resolveOrgStaffEmail('bronxworks'), null);
  assert.equal(resolveOrgStaffEmail(''), null);
  assert.equal(resolveOrgStaffEmail(null), null);
  // Only the test org is listed.
  assert.deepEqual(Object.keys(ORG_STAFF), ['test']);
});

// ── send-report endpoint ───────────────────────────────────────────────
// C-2 gate: on consumer builds the endpoint does not exist (404).
test('send-report: consumer mode returns 404 (institutional-only endpoint)', async () => {
  asConsumer();
  const res = mockRes();
  await sendReport(mockReq({
    ip: '10.0.0.1',
    body: { org: 'test', formNumber: 'I-589', report: { formNumber: 'I-589', executiveSummary: 'x' } },
  }), res);
  assert.equal(res.statusCode, 404);
});

test('send-report: non-POST is rejected', async () => {
  asInstitutional();
  const res = mockRes();
  await sendReport(mockReq({ method: 'GET', ip: '10.0.0.2' }), res);
  assert.equal(res.statusCode, 405);
});

test('send-report: missing RESEND_API_KEY returns 503 not-configured (never sends without it)', async () => {
  asInstitutional();
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const res = mockRes();
    await sendReport(mockReq({
      ip: '10.0.0.3',
      body: { org: 'test', formNumber: 'I-589', report: { formNumber: 'I-589', executiveSummary: 'summary' } },
    }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.reason, 'not-configured');
  } finally {
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  }
});

test('send-report: unlisted org is rejected — no client-supplied recipient fallback', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  try {
    const res = mockRes();
    await sendReport(mockReq({
      ip: '10.0.0.4',
      body: { org: 'some-future-org', staffEmail: 'attacker@example.com', formNumber: 'I-589', report: { formNumber: 'I-589', executiveSummary: 'x' } },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /No staff delivery is configured/);
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

test('send-report: omitted org is rejected', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  try {
    const res = mockRes();
    await sendReport(mockReq({
      ip: '10.0.0.4b',
      body: { formNumber: 'I-589', report: { formNumber: 'I-589', executiveSummary: 'x' } },
    }), res);
    assert.equal(res.statusCode, 400);
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

test('send-report: missing report content is rejected', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  try {
    const res = mockRes();
    await sendReport(mockReq({
      ip: '10.0.0.5',
      body: { org: 'test', formNumber: 'I-589' },
    }), res);
    assert.equal(res.statusCode, 400);
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

test('send-report: unknown form number is rejected', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  try {
    const res = mockRes();
    await sendReport(mockReq({
      ip: '10.0.0.6',
      body: { org: 'test', formNumber: 'I-999', report: { formNumber: 'I-999', executiveSummary: 'x' } },
    }), res);
    assert.equal(res.statusCode, 400);
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

test('send-report: registry org resolves server-side and Resend is called with the test address + server-rendered HTML', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ id: 're_123' }) };
  };
  try {
    const res = mockRes();
    // Client supplies a WRONG address and raw HTML with an injection
    // attempt; the registry must win and the HTML must be rendered
    // server-side from structured data with everything escaped.
    await sendReport(mockReq({
      ip: '10.0.0.7',
      body: {
        org: 'test',
        staffEmail: 'attacker@example.com',
        participantName: 'Maria G.',
        formNumber: 'I-589',
        html: '<p>report</p><script>alert(1)</script>',
        report: {
          formNumber: 'I-589',
          formTitle: 'Application for Asylum',
          participantName: 'Maria G.',
          overallScore: 0.8,
          overallBand: 'Strong',
          executiveSummary: '<script>alert(1)</script> Mostly ready.',
          sections: [{ section: 'Identity', score: 0.9, band: 'Strong' }],
          blockers: [{ t: 'Missing <b>doc</b>', d: 'Provide it.' }],
        },
      },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, 're_123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    const sent = JSON.parse(calls[0].opts.body);
    // Registry wins over the client-supplied address.
    assert.deepEqual(sent.to, ['healthcarebyvalentine@gmail.com']);
    assert.equal(sent.from, 'IRU Intake <intake@smrgconsulting.com>');
    assert.match(sent.subject, /I-589/);
    assert.match(sent.subject, /Maria G\./);
    // Client HTML is ignored; the server rendered the structured report.
    assert.doesNotMatch(sent.html, /<p>report<\/p>/);
    assert.doesNotMatch(sent.html, /<script>/);
    assert.match(sent.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Mostly ready\./);
    assert.match(sent.html, /Missing &lt;b&gt;doc&lt;\/b&gt;/);
    assert.match(sent.html, /80% — Strong/);
    // Browser User-Agent header (Cloudflare 1010 lesson).
    assert.match(calls[0].opts.headers['User-Agent'], /Mozilla\/5\.0/);
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer re_test_key');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('send-report: unlisted org is rejected even with a valid client staff email (no fallback)', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ id: 're_456' }) };
  };
  try {
    const res = mockRes();
    await sendReport(mockReq({
      ip: '10.0.0.8',
      body: {
        org: 'some-future-org',
        staffEmail: 'healthcarebyvalentine@gmail.com',
        formNumber: 'I-765',
        report: { formNumber: 'I-765', executiveSummary: 'x' },
      },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('send-report: Resend rejection is surfaced, not rewritten into a false success', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message: 'You can only send testing emails to your own email address.' }),
  });
  try {
    const res = mockRes();
    await sendReport(mockReq({
      ip: '10.0.0.9',
      body: { org: 'test', formNumber: 'I-589', report: { formNumber: 'I-589', executiveSummary: 'x' } },
    }), res);
    assert.equal(res.statusCode, 502);
    // M-2: the raw provider message is NOT forwarded (it can disclose
    // account details in test mode). The caller gets a sanitized error
    // and the provider-rejected reason; the raw message stays in the
    // server log only.
    assert.match(res.body.error, /could not send this report/);
    assert.doesNotMatch(res.body.error, /testing emails/);
    assert.equal(res.body.reason, 'provider-rejected');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('send-report: per-IP rate limit blocks the 6th send in 10 minutes', async () => {
  asInstitutional();
  process.env.RESEND_API_KEY = 're_test_key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 're_x' }) });
  try {
    const ip = '10.0.0.10';
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = mockRes();
      await sendReport(mockReq({
        ip,
        body: { org: 'test', formNumber: 'I-589', report: { formNumber: 'I-589', executiveSummary: 'x' } },
      }), res);
      statuses.push(res.statusCode);
    }
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses[5], 429);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});
