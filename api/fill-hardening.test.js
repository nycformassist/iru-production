/**
 * api/fill-hardening.test.js — Fill-path hardening tests (2026-11-12).
 *
 * Covers four gaps found on the IRU institutional branch:
 *  D. api/_python/cross_form_registries.py was dead code (nothing
 *     referenced it; its i130 loaders would raise FileNotFoundError)
 *     and was deleted — assert nothing references it and it is gone.
 *  E. (a) The reuse generator mapped semantic `city` onto the N-400
 *     ethnicity checkboxes P7_Line1_Ethnicity[0..1] ('city' matched
 *     inside 'ethnicity'). The two entries were removed from
 *     n400_generated.json and the generator was fixed; assert the
 *     file has no city->checkbox entry, the generator no longer emits
 *     one (its fresh output reproduces the edited file exactly), and
 *     bind() still refuses text into a checkbox-kind entry.
 *     (b) api/_python/i485_part9_pairs.json was an empty list no
 *     mechanism ever loaded (the I-485 binder loads
 *     i485_yesno_pairs.json) and was deleted — assert it is gone
 *     and unreferenced.
 *  F. fill.py _entitlement_status_url() now rejects credential-bearing
 *     IRU_APP_ORIGIN values, mirroring the JS resolveAppOrigin() in
 *     api/_lib/paymentConfig.js (fail closed: None, never
 *     strip-and-proceed).
 *  J. The fill.py stderr log line ("[fill] apply_fill errors (N): …")
 *     is exercised end-to-end through the real handler over real
 *     sockets: a malformed (list-valued) city fact makes apply_fill
 *     fail on the city widgets, so the line must fire and
 *     X-Fill-Errors must be > 0 — while a clean fill stays at 0
 *     with no log line.
 *
 * Python drivers follow the api/adversarial-security.test.js pattern
 * (embedded driver, real fill.py handler, real sockets). They need a
 * Python with PyMuPDF: IRU_TEST_PYTHON override, else the repo's dev
 * venv (~/workspace/ocr-spike-env/bin/python), else `python3`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(REPO_ROOT, 'api');

function resolveTestPython() {
  if (process.env.IRU_TEST_PYTHON) return process.env.IRU_TEST_PYTHON;
  const venv = path.join(process.env.HOME || '', 'workspace', 'ocr-spike-env', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return 'python3';
}

function runDriver(driverSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iru-fill-hardening-'));
  try {
    const driverPath = path.join(dir, 'driver.py');
    fs.writeFileSync(driverPath, driverSource);
    const python = resolveTestPython();
    let out;
    try {
      out = execFileSync(python, [driverPath, REPO_ROOT], {
        encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      assert.fail(`fill-hardening driver failed (python=${python}): ${e.message}\nstdout: ${e.stdout || ''}\nstderr: ${e.stderr || ''}`);
    }
    const r = JSON.parse(out);
    assert.equal(r.error, undefined, `fill-hardening driver error: ${r.error}`);
    return r;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── shared: reference scan (D, E(b)) ─────────────────────────────────────

/** Walk source dirs (test files excluded — they name the deleted files
 *  in their own assertions) and return files containing `needle`. */
function filesReferencing(needle) {
  const hits = [];
  const roots = ['api/_python', 'api/_lib', 'scripts'].map((d) => path.join(REPO_ROOT, d));
  const srcRoot = path.join(REPO_ROOT, 'src');
  if (fs.existsSync(srcRoot)) roots.push(srcRoot);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
        walk(p);
      } else if (/\.(py|js|mjs|json)$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
        if (fs.readFileSync(p, 'utf8').includes(needle)) hits.push(path.relative(REPO_ROOT, p));
      }
    }
  }
  for (const root of roots) if (fs.existsSync(root)) walk(root);
  return hits;
}

// ── D: dead module deleted ───────────────────────────────────────────────

describe('D. cross_form_registries.py is deleted and unreferenced', () => {
  it('the module file is gone and no source file references it', () => {
    assert.equal(
      fs.existsSync(path.join(API_DIR, '_python', 'cross_form_registries.py')),
      false, 'api/_python/cross_form_registries.py should be deleted',
    );
    assert.deepEqual(
      filesReferencing('cross_form_registries'), [],
      'no source file may import or reference cross_form_registries',
    );
  });
});

// ── E: generator misclassification + empty pairs file ────────────────────

const LEGIT_CITY_FIELDS = [
  'P4_Line3_CityTown3[0]',
  'P4_Line3_CityTown2[0]',
  'P4_Line3_CityTown1[0]',
  'P4_Line1_City[0]',
  'P5_Line1b_City[0]',
  'P7_City3[0]',
  'P7_City2[0]',
  'P7_City1[0]',
];

describe('E(a). n400_generated.json: no city semantic on a checkbox', () => {
  it('the two Ethnicity city entries are gone; every legitimate city text field stays', () => {
    const gen = JSON.parse(fs.readFileSync(path.join(API_DIR, '_python', 'n400_generated.json'), 'utf8'));
    const entries = [...(gen.address || []), ...(gen.identity || [])];
    const cityCheckbox = entries.filter((e) => e.semantic === 'city' && e.type === 'CheckBox');
    assert.deepEqual(cityCheckbox, [], 'no city semantic may map to a CheckBox field');
    const fields = new Set(entries.map((e) => e.field));
    assert.equal(fields.has('P7_Line1_Ethnicity[0]'), false);
    assert.equal(fields.has('P7_Line1_Ethnicity[1]'), false);
    for (const f of LEGIT_CITY_FIELDS) {
      assert.equal(fields.has(f), true, `legitimate city text field ${f} must be kept`);
    }
    const cityText = entries.filter((e) => e.semantic === 'city' && e.type === 'Text');
    assert.equal(cityText.length, LEGIT_CITY_FIELDS.length);
  });
});

describe('E(b). i485_part9_pairs.json is deleted and unreferenced', () => {
  it('the empty pairs file is gone and no source file references it', () => {
    assert.equal(
      fs.existsSync(path.join(API_DIR, '_python', 'i485_part9_pairs.json')),
      false, 'api/_python/i485_part9_pairs.json should be deleted (empty, never loaded)',
    );
    assert.deepEqual(
      filesReferencing('i485_part9_pairs'), [],
      'no source file may reference i485_part9_pairs',
    );
  });
});

// Driver for E(a)-generator + F: pure function calls, no HTTP server.
const PURE_DRIVER = `
import json, os, sys

REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, 'api'))
sys.path.insert(0, os.path.join(REPO, 'scripts'))
os.chdir(REPO)

for _k in ('IRU_ENTITLEMENT_STATUS_URL', 'IRU_APP_ORIGIN', 'VERCEL_URL', 'PAYWALL_ENABLED'):
    os.environ.pop(_k, None)

results = {}

# --- E(a): fixed generator output vs the edited n400_generated.json ---
import reuse_generator as rg
fresh = rg.generate_address_mappings('n400')
current = json.load(open(os.path.join(REPO, 'api', '_python', 'n400_generated.json')))['address']
to_trip = lambda es: {(e['field'], e['semantic'], e['type']) for e in es}
results['generator'] = {
    'fresh_city_checkbox': [e['field'] for e in fresh if e['semantic'] == 'city' and e['type'] == 'CheckBox'],
    'fresh_ethnicity': [e['field'] for e in fresh if 'Ethnicity' in e['field']],
    'fresh_equals_current': to_trip(fresh) == to_trip(current),
    'fresh_count': len(fresh),
    'current_count': len(current),
}

# --- E(a): city fills only text fields; bind() refuses checkbox kind ---
from _python import n400_full_binder
from _python.binder import bind
plan, _review = n400_full_binder.build_n400_full_plan({
    'family_name': 'Test', 'given_name': 'Test',
    'current_city': 'Springfield', 'current_street': '1 Main St',
})
city_plan = [p for p in plan if p[3] == 'current_city']
ethnicity_plan = [p for p in plan if 'Ethnicity' in p[0]]
results['binder'] = {
    'city_plan_fields': [p[0] for p in city_plan],
    'city_plan_kinds': sorted({p[2] for p in city_plan}),
    'city_plan_values': sorted({str(p[1]) for p in city_plan}),
    'ethnicity_plan': ethnicity_plan,
}
# Direct bind() check: a checkbox-kind registry entry never fills.
_bplan, _breview = bind(
    {'x': {'kind': 'checkbox',
           'field': 'form1[0].#subform[2].P7_Line1_Ethnicity[0]', 'required': False}},
    {'x': {'value': 'Springfield', 'confidence': 1.0, 'status': 'ok', 'source': 'test'}})
results['bind_refuses_checkbox'] = {
    'plan': _bplan,
    'review_reasons': [r.get('reason') for r in _breview],
}

# --- F: _entitlement_status_url() credential rejection ---
import fill as fillmod
def url_with(env):
    for _k in ('IRU_ENTITLEMENT_STATUS_URL', 'IRU_APP_ORIGIN', 'VERCEL_URL'):
        os.environ.pop(_k, None)
    os.environ.update(env)
    return fillmod._entitlement_status_url()
results['origin'] = {
    'clean': url_with({'IRU_APP_ORIGIN': 'https://app.example.com'}),
    'trailing_slash': url_with({'IRU_APP_ORIGIN': 'https://app.example.com/'}),
    'credential': url_with({'IRU_APP_ORIGIN': 'https://user:pass@app.example.com'}),
    'username_only': url_with({'IRU_APP_ORIGIN': 'https://user@app.example.com'}),
    'none_set': url_with({}),
}

print(json.dumps(results))
`;

describe('E(a). generator no longer emits city onto a checkbox; city fills text only', () => {
  it('fresh generator output has no city->CheckBox and reproduces the edited file; the binder never plans the Ethnicity boxes', () => {
    const r = runDriver(PURE_DRIVER);
    assert.deepEqual(r.generator.fresh_city_checkbox, []);
    assert.deepEqual(r.generator.fresh_ethnicity, []);
    assert.equal(
      r.generator.fresh_equals_current, true,
      `fixed generator must reproduce edited n400_generated.json exactly (fresh=${r.generator.fresh_count}, current=${r.generator.current_count})`,
    );
    assert.ok(r.binder.city_plan_fields.length > 0, 'city fact must still fill text fields');
    assert.deepEqual(r.binder.city_plan_kinds, ['text']);
    assert.deepEqual(r.binder.city_plan_values, ['Springfield']);
    assert.deepEqual(r.binder.ethnicity_plan, [], 'city must never plan the Ethnicity checkboxes');
    assert.deepEqual(r.bind_refuses_checkbox.plan, []);
    assert.deepEqual(r.bind_refuses_checkbox.review_reasons, ['unsupported-kind']);
  });
});

describe('F. _entitlement_status_url() rejects credential-bearing origins', () => {
  it('user:pass and username-only origins return None; a clean origin still resolves', () => {
    const r = runDriver(PURE_DRIVER);
    assert.equal(r.origin.clean, 'https://app.example.com/api/entitlement-status');
    assert.equal(r.origin.trailing_slash, 'https://app.example.com/api/entitlement-status');
    assert.equal(r.origin.credential, null);
    assert.equal(r.origin.username_only, null);
    assert.equal(r.origin.none_set, null);
  });
});

// ── J: stderr log line end-to-end ─────────────────────────────────────────

const FILL_DRIVER = `
import contextlib, io, json, os, sys, threading, time
from http.server import ThreadingHTTPServer
import http.client

try:
    import fitz  # noqa: F401  (fill.py imports it at module level)
except ImportError:
    print(json.dumps({'error': 'fitz (PyMuPDF) not available in this python'}))
    sys.exit(2)

REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, 'api'))
os.chdir(REPO)

for _k in ('IRU_ENTITLEMENT_STATUS_URL', 'IRU_APP_ORIGIN', 'VERCEL_URL', 'PAYWALL_ENABLED'):
    os.environ.pop(_k, None)

import fill as fillmod
from _python.binder import apply_fill

srv = ThreadingHTTPServer(('127.0.0.1', 0), fillmod.handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

def post(body_dict):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=60)
    raw = json.dumps(body_dict).encode()
    conn.request('POST', '/api/fill?form=n400', body=raw,
                 headers={'Content-Type': 'application/json'})
    resp = conn.getresponse()
    data = resp.read()
    headers = {'x-fill-errors': resp.getheader('X-Fill-Errors'),
               'x-fields-filled': resp.getheader('X-Fields-Filled'),
               'content-type': resp.getheader('Content-Type')}
    conn.close()
    return resp.status, headers, len(data)

results = {}

# Control: clean string city -> no errors, no log line.
buf1 = io.StringIO()
with contextlib.redirect_stderr(buf1):
    st1, h1, n1 = post({'facts': {'family_name': 'Test', 'given_name': 'Test',
                                 'current_city': 'Springfield', 'current_street': '1 Main St'}})
    time.sleep(0.3)
results['control'] = {'status': st1, 'headers': h1, 'pdf_bytes': n1, 'stderr': buf1.getvalue()}

# Malformed fact: list-valued city -> apply_fill fails on the city
# widgets, so the handler must log the line and report X-Fill-Errors > 0.
buf2 = io.StringIO()
with contextlib.redirect_stderr(buf2):
    st2, h2, n2 = post({'facts': {'family_name': 'Test', 'given_name': 'Test',
                                 'current_city': ['Springfield'], 'current_street': '1 Main St'}})
    time.sleep(0.3)
results['malformed'] = {'status': st2, 'headers': h2, 'pdf_bytes': n2, 'stderr': buf2.getvalue()}

srv.shutdown()

# The task's example error class, at the apply_fill level: a plan entry
# for a field that does not exist in the template.
filled3, errors3 = apply_fill(
    os.path.join(REPO, 'public', 'forms', 'n-400.pdf'),
    os.path.join(os.environ.get('TMPDIR', '/tmp'), 'fill-hardening-bogus.pdf'),
    [('NO_SUCH_FIELD_XYZ[0]', 'x', 'text', 'bogus')])
results['bogus_field'] = {'filled': filled3, 'errors': errors3}

print(json.dumps(results))
`;

describe('J. fill.py stderr log line fires end-to-end with X-Fill-Errors > 0', () => {
  it('malformed (list-valued) city fact: 200 + PDF, X-Fill-Errors > 0, "[fill] apply_fill errors" on stderr; clean fill stays silent', () => {
    const r = runDriver(FILL_DRIVER);

    // Control: a clean fill produces no errors and no log line.
    assert.equal(r.control.status, 200);
    assert.equal(r.control.headers['content-type'], 'application/pdf');
    assert.ok(r.control.pdf_bytes > 1000, `expected a filled PDF, got ${r.control.pdf_bytes} bytes`);
    assert.equal(r.control.headers['x-fill-errors'], '0');
    assert.doesNotMatch(r.control.stderr, /\[fill\] apply_fill errors/);

    // Malformed fill: still 200 + PDF, but errors are surfaced.
    assert.equal(r.malformed.status, 200);
    assert.equal(r.malformed.headers['content-type'], 'application/pdf');
    assert.ok(r.malformed.pdf_bytes > 1000);
    const errCount = Number(r.malformed.headers['x-fill-errors']);
    assert.ok(Number.isInteger(errCount) && errCount > 0,
      `expected X-Fill-Errors > 0, got ${r.malformed.headers['x-fill-errors']}`);
    assert.match(
      r.malformed.stderr,
      new RegExp(`\\[fill\\] apply_fill errors \\(${errCount}\\):`),
      `stderr must carry the log line with the same count; stderr was: ${r.malformed.stderr}`,
    );
    // The line names fields only — never the PII value.
    assert.match(r.malformed.stderr, /P4_Line3_CityTown1\[0\]/);
    assert.doesNotMatch(r.malformed.stderr, /Springfield/);

    // The example error class: a plan entry for a missing field.
    assert.equal(r.bogus_field.filled, 0);
    assert.equal(r.bogus_field.errors.length, 1);
    assert.match(r.bogus_field.errors[0], /field not found in PDF/);
  });
});
