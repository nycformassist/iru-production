"""Vercel Python serverless: fill any Tier 1 form from Tier1Fact JSON.

Single function for all six forms. The five near-identical fill-*.py
files were consolidated because Vercel's Hobby plan caps a deployment
at 12 serverless functions and the five fill files plus the other
handlers exceeded it (16 functions). The form is selected by:
  1. ?form=<key> query param (set by the vercel.json rewrites that map
     the legacy /api/fill-<key> URLs to /api/fill?form=<key>),
  2. a /api/fill-<key> path suffix, or
  3. a `form` field in the JSON body.
Form keys: i765, i90, n400, i130, i485, i589. The legacy /api/fill-<key>
URLs keep working via the rewrites; no client change was needed.
"""
import json, fitz, os, sys, traceback
import urllib.request, urllib.error
import urllib.parse
sys.path.insert(0, os.path.dirname(__file__))  # _python is sibling
from http.server import BaseHTTPRequestHandler

# form key -> (FORM_ID, template file, download filename,
#              binder module, build function name)
FORMS = {
    'i765': ('I-765', 'i-765.pdf', 'i765-draft.pdf',
             '_python.i765_full_binder', 'build_i765_full_plan'),
    'i90': ('I-90', 'i-90.pdf', 'i90-draft.pdf',
            '_python.i90_full_binder', 'build_i90_full_plan'),
    'n400': ('N-400', 'n-400.pdf', 'n400-draft.pdf',
             '_python.n400_full_binder', 'build_n400_full_plan'),
    'i485': ('I-485', 'i-485.pdf', 'i485-draft.pdf',
             '_python.i485_full_binder', 'build_i485_full_plan'),
    'i589': ('I-589', 'i-589.pdf', 'i589-draft.pdf',
             '_python.i589_full_binder', 'build_i589_full_plan'),
    # I-130 uses the master binder: build_master_plan(facts, addresses,
    # biographic) -> (plan, review, stats). All other forms use
    # build_<form>_full_plan(facts) -> (plan, review).
    'i130': ('I-130', 'i-130.pdf', 'i130-draft.pdf',
             '_python.master_binder', 'build_master_plan'),
}


def _resolve_form(path, body):
    """Return the form key from query, path suffix, or body — else None."""
    parsed = urllib.parse.urlparse(path or '')
    query = urllib.parse.parse_qs(parsed.query)
    form = (query.get('form') or [None])[0]
    if form in FORMS:
        return form
    if parsed.path.startswith('/api/fill-'):
        suffix = parsed.path[len('/api/fill-'):].split('/')[0].split('?')[0]
        if suffix in FORMS:
            return suffix
    if isinstance(body, dict) and body.get('form') in FORMS:
        return body['form']
    return None

# ── Paid-access gate (owner directive 2026-11-05) ──
# Duplicate of the canonical helper in api_server.py (same repo):
# this file is a standalone Vercel Python serverless function and
# cannot import the JS entitlement store, so the bearer token is
# verified by HTTP POST to the deployment's own /api/entitlement-status
# endpoint (IRU_ENTITLEMENT_STATUS_URL override, else the authoritative
# app origin from IRU_APP_ORIGIN / VERCEL_URL). Applied ONLY when
# PAYWALL_ENABLED === 'true'. FAIL CLOSED: a missing token, an
# unpaid/wrong-scope entitlement, or ANY verification failure denies
# access with 402. Stdlib only (urllib), 3s timeout, no tokens or
# secrets in logs.
# NOTE: this path is implemented but CANNOT be proven live from the
# dev VM — it needs a Preview deploy plus a shared (non-in-memory)
# entitlement store.
# HOST HEADER (Carbon Pass 1, finding 13): the verification URL is
# NEVER built from the request Host header — that header is
# attacker-controlled, and the user's bearer token is sent to the
# resulting URL, so a spoofed Host could exfiltrate the token or
# point verification at a fake entitlement server that always says
# "paid". The origin comes only from server-side env vars:
# IRU_APP_ORIGIN (explicit, preferred — same var the JS payment
# config uses) or Vercel's automatic VERCEL_URL (set by the platform
# on every deployment, never by the client). If neither is set the
# URL is None and verification fails closed (402).

# Maximum request body accepted (finding 12): an unbounded
# content-length read allows memory-exhaustion DoS. 1 MiB is far
# above any legitimate Tier 1 facts payload.
MAX_BODY_BYTES = 1024 * 1024

def _entitlement_status_url():
    override = os.environ.get('IRU_ENTITLEMENT_STATUS_URL')
    if override:
        return override
    origin = os.environ.get('IRU_APP_ORIGIN')
    if origin:
        origin = origin.strip().rstrip('/')
        if origin.startswith('https://') or origin.startswith('http://'):
            # Credential-bearing origin fails closed, mirroring the JS
            # resolveAppOrigin() in api/_lib/paymentConfig.js: a URL
            # with a username/password is rejected outright — never
            # stripped-and-proceeded-with, so no credential can leak
            # into the verification request (2026-11-12 hardening).
            parsed = urllib.parse.urlparse(origin)
            if parsed.username or parsed.password:
                return None
            return origin + '/api/entitlement-status'
        return None
    vercel_url = os.environ.get('VERCEL_URL')
    if vercel_url:
        return 'https://%s/api/entitlement-status' % vercel_url.strip().rstrip('/')
    return None

def _fetch_entitlement_status(token, url):
    if not url:
        return None
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps({'token': token}).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST')
        with urllib.request.urlopen(req, timeout=3) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 503:
            return None
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            return None
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None

def _entitlement_allows(payload, form_id):
    if not isinstance(payload, dict):
        return (False, 'verification-unavailable')
    ent = payload.get('entitlement')
    if not isinstance(ent, dict):
        return (False, 'unknown-token')
    paid = payload.get('paid')
    if paid is None:
        paid = ent.get('paid')
    if not paid:
        return (False, 'not-paid')
    scope = ent.get('scope') or {}
    if scope.get('kind') != 'forms':
        return (False, 'scope-mismatch')
    if form_id not in (scope.get('forms') or []):
        return (False, 'form-not-covered')
    return (True, None)

def _check_paid_access(token, form_id, status_url):
    if not token:
        return (False, 'unknown-token')
    payload = _fetch_entitlement_status(token, status_url)
    if payload is None:
        return (False, 'verification-unavailable')
    return _entitlement_allows(payload, form_id)

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        # Bounded body read (finding 12): reject oversized
        # content-length BEFORE reading anything into memory.
        try:
            _length = int(self.headers.get('content-length') or 0)
        except (TypeError, ValueError):
            _length = 0
        if _length > MAX_BODY_BYTES:
            self.send_response(413)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Request too large.'}).encode())
            return
        try:
            length = int(self.headers.get('content-length', 0))
            raw = self.rfile.read(length) if length > 0 else b'{}'
            body = json.loads(raw)
        except Exception:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Invalid JSON body'}).encode())
            return
        form_key = _resolve_form(self.path, body)
        if not form_key:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Unknown form. Use ?form=i765|i90|n400|i130|i485|i589'}).encode())
            return
        form_id, template_file, download_name, binder_module, build_fn = FORMS[form_key]
        template_path = os.path.join(os.path.dirname(__file__), '../public/forms', template_file)
        # TEST BYPASS (Preview only, owner-authorized 2026-11-05, REMOVE BEFORE SIGN-OFF):
        # if the request carries x-test-bypass matching the IRU_TEST_BYPASS_TOKEN
        # env var (set on Preview only, never Production), skip the paid-access
        # gate so the binder/template path can be proven without a Stripe purchase.
        # No token is hardcoded here; with the env var unset the bypass is inert.
        _bypass_token = os.environ.get('IRU_TEST_BYPASS_TOKEN')
        _test_bypass = bool(_bypass_token) and self.headers.get('x-test-bypass') == _bypass_token
        # INSTITUTIONAL MODE: the organization holds access, so the
        # consumer paid-access gate is skipped. Mode is read from
        # api/build-mode.json (generated at build time from the branch
        # ref; the `institutional` branch resolves to institutional).
        # Fail closed: if the file is missing/unreadable, the gate
        # stays enforced.
        _institutional_mode = False
        try:
            with open(os.path.join(os.path.dirname(__file__), 'build-mode.json'), 'r', encoding='utf-8') as _f:
                _institutional_mode = json.load(_f).get('mode') == 'institutional'
        except Exception:
            _institutional_mode = False
        if os.environ.get('PAYWALL_ENABLED') == 'true' and not _test_bypass and not _institutional_mode:
            allowed, reason = _check_paid_access(
                self.headers.get('x-entitlement-token'), form_id,
                _entitlement_status_url())
            if not allowed:
                self.send_response(402)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'A paid entitlement covering this form is required.', 'reason': reason}).encode())
                return
        # Tempfile lifecycle (finding 12): the temp PDF is always
        # unlinked, even when the binder or the fill raises — the
        # finally below runs on every path out of this block.
        tmp_path = None
        try:
            facts = body.get('facts', {})
            from _python.binder import apply_fill
            import tempfile
            import importlib
            binder = importlib.import_module(binder_module)
            build = getattr(binder, build_fn)
            if form_key == 'i130':
                plan, review, _stats = build(
                    facts, body.get('addresses', []), body.get('biographic', {}))
            else:
                plan, review = build(facts)
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp_path = tmp.name
            filled, errors = apply_fill(template_path, tmp_path, plan)
            # M-8: surface apply_fill errors instead of discarding them.
            # Log field names only (never PII values) server-side and
            # expose the count so silent mapping failures are visible.
            if errors:
                sys.stderr.write("[fill] apply_fill errors (%d): %s\n" % (
                    len(errors), "; ".join(e.split(": ", 1)[0] for e in errors)))
            with open(tmp_path, 'rb') as f: pdf_bytes = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', 'attachment; filename="%s"' % download_name)
            self.send_header('X-Fields-Filled', str(filled))
            self.send_header('X-Fill-Errors', str(len(errors)))
            self.send_header('X-Review-Items', str(len(review)))
            self.end_headers()
            self.wfile.write(pdf_bytes)
        except Exception:
            # Log the detail server-side only; the client gets a
            # generic message — never str(e), which can leak file
            # paths, library internals, or data fragments.
            traceback.print_exc()
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Form generation failed."}).encode())
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
