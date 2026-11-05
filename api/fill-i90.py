"""Vercel Python serverless: fill I-90 from Tier1Fact JSON."""
import json, fitz, os, sys
import urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))  # _python is sibling
from http.server import BaseHTTPRequestHandler
TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), '../public/forms/i-90.pdf')

# ── Paid-access gate (owner directive 2026-11-05) ──
# Duplicate of the canonical helper in api_server.py (same repo):
# this file is a standalone Vercel Python serverless function and
# cannot import the JS entitlement store, so the bearer token is
# verified by HTTP POST to the deployment's own /api/entitlement-status
# endpoint (IRU_ENTITLEMENT_STATUS_URL override, else
# https://<request host>/api/entitlement-status). Applied ONLY when
# PAYWALL_ENABLED === 'true'. FAIL CLOSED: a missing token, an
# unpaid/wrong-scope entitlement, or ANY verification failure denies
# access with 402. Stdlib only (urllib), 3s timeout, no tokens or
# secrets in logs.
# NOTE: this path is implemented but CANNOT be proven live from the
# dev VM — it needs a Preview deploy plus a shared (non-in-memory)
# entitlement store.
FORM_ID = 'I-90'

def _entitlement_status_url(host):
    override = os.environ.get('IRU_ENTITLEMENT_STATUS_URL')
    if override:
        return override
    if host:
        return 'https://%s/api/entitlement-status' % host
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
        if os.environ.get('PAYWALL_ENABLED') == 'true':
            allowed, reason = _check_paid_access(
                self.headers.get('x-entitlement-token'), FORM_ID,
                _entitlement_status_url(self.headers.get('host')))
            if not allowed:
                self.send_response(402)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'A paid entitlement covering this form is required.', 'reason': reason}).encode())
                return
        try:
            length = int(self.headers.get('content-length', 0))
            body = json.loads(self.rfile.read(length))
            facts = body.get('facts', {})
            from _python.i90_full_binder import build_i90_full_plan as build_i90_plan
            from _python.binder import apply_fill
            import tempfile
            plan, review = build_i90_plan(facts)
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp_path = tmp.name
            filled, errors = apply_fill(TEMPLATE_PATH, tmp_path, plan)
            with open(tmp_path, 'rb') as f:
                pdf_bytes = f.read()
            os.unlink(tmp_path)
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', 'attachment; filename="i90-draft.pdf"')
            self.send_header('X-Fields-Filled', str(filled))
            self.send_header('X-Review-Items', str(len(review)))
            self.end_headers()
            self.wfile.write(pdf_bytes)
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
