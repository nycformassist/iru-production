"""
Local dev API server: serves /api/fill-* endpoints for Vite dev.
In production, Vercel handles these as Python serverless functions.
This server makes local dev work the same way.

Run: python3 api_server.py (port 8000)
Vite proxies /api/* -> http://localhost:8000/api/*
"""
import json
import os
import sys
import tempfile
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ── Paid-access gate (owner directive 2026-11-05) — CANONICAL copy ──
# The Python dev server cannot import the JS entitlement store, so a
# bearer token is verified by HTTP POST to the entitlement-status
# endpoint, which lives on the dev API server (port 3001, in-memory
# store) in dev and on the deployment itself on Vercel. The endpoint
# URL is IRU_ENTITLEMENT_STATUS_URL (default
# http://localhost:3001/api/entitlement-status). FAIL CLOSED when the
# paywall is on: a missing token, an unpaid/wrong-scope entitlement,
# or ANY verification failure (including the endpoint being
# unreachable) denies access with 402. Stdlib only (urllib), 3s
# timeout, no tokens or secrets in logs. The Vercel fill handler
# (api/fill.py) carries a duplicate of this helper — see the comment
# there — because it is a standalone serverless function.
ENTITLEMENT_STATUS_URL = os.environ.get(
    'IRU_ENTITLEMENT_STATUS_URL', 'http://localhost:3001/api/entitlement-status')

# Canonical form ids carried in entitlement scopes (api/_lib/catalog.js
# FORM_IDS), keyed by the dev fill-route suffix.
FORM_ID_BY_KEY = {
    'i130': 'I-130', 'i90': 'I-90', 'n400': 'N-400', 'i765': 'I-765', 'i485': 'I-485',
    'i589': 'I-589',
}

def paywall_enabled():
    """Mirror of the JS-side flag (PAYWALL_ENABLED === 'true')."""
    return os.environ.get('PAYWALL_ENABLED') == 'true'

def fetch_entitlement_status(token, url=None):
    """POST {token} to the entitlement-status endpoint. Returns the
    parsed JSON dict, or None on any transport/parse failure (fail
    closed). Accepts the live shape {ok, entitlement: {paid, scope}}
    and {ok, paid, entitlement: {scope}}. A 404 body (unknown token)
    is returned as parsed JSON; a 503 (store not configured) is a
    verification failure and returns None."""
    target = url or ENTITLEMENT_STATUS_URL
    try:
        req = urllib.request.Request(
            target,
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

def entitlement_allows(payload, form_id=None):
    """Pure allow/deny decision from an entitlement-status payload.
    Returns (allowed, reason). form_id None → any paid entitlement.
    Otherwise paid + scope kind 'forms' + forms includes form_id.
    Never raises; unknown shapes deny."""
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
    if form_id is None:
        return (True, None)
    scope = ent.get('scope') or {}
    if scope.get('kind') != 'forms':
        return (False, 'scope-mismatch')
    if form_id not in (scope.get('forms') or []):
        return (False, 'form-not-covered')
    return (True, None)

def check_paid_access(token, form_id=None, status_url=None):
    """Gate entry point. Returns (allowed, reason). Missing token,
    unpaid/wrong-scope entitlement, or any verification failure →
    (False, reason). Fail closed when the paywall is on."""
    if not token:
        return (False, 'unknown-token')
    payload = fetch_entitlement_status(token, url=status_url)
    if payload is None:
        return (False, 'verification-unavailable')
    return entitlement_allows(payload, form_id)

# Add form engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../iru-form-engine'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../iru-form-engine/intelligent'))

from binder import apply_fill

# Form configurations
FORMS = {
    'i130': {
        'binder': 'master_binder',
        'func': 'build_master_plan',
        'template': 'public/forms/i-130.pdf',
        'filename': 'i130-draft.pdf',
    },
    'i90': {
        'binder': 'i90_full_binder',
        'func': 'build_i90_full_plan',
        'template': 'public/forms/i-90.pdf',
        'filename': 'i90-draft.pdf',
    },
    'n400': {
        'binder': 'n400_full_binder',
        'func': 'build_n400_full_plan',
        'template': 'public/forms/n-400.pdf',
        'filename': 'n400-draft.pdf',
    },
    'i765': {
        'binder': 'i765_full_binder',
        'func': 'build_i765_full_plan',
        'template': 'public/forms/i-765.pdf',
        'filename': 'i765-draft.pdf',
    },
    'i485': {
        'binder': 'i485_full_binder',
        'func': 'build_i485_full_plan',
        'template': 'public/forms/i-485.pdf',
        'filename': 'i485-draft.pdf',
    },
    'i589': {
        'binder': 'i589_full_binder',
        'func': 'build_i589_full_plan',
        'template': 'public/forms/i-589.pdf',
        'filename': 'i589-draft.pdf',
    },
}

# Map UI factIds (n400_*) to binder-expected keys
# UI uses n400_ prefix for most, but binder expects unprefixed for core identity fields
FACTID_ALIASES = {
    # N-400: UI n400_* -> binder keys
    'n400_a_number': 'a_number',
    'n400_dob': 'date_of_birth',
    'n400_email': 'email',
    'n400_given_name': 'given_name',
    'n400_phone': 'phone',
    'n400_legal_name': 'family_name',  # Question ID -> factId
    # N-400: 38 expansion questions (2026-11-04) - question IDs -> factIds
    'n400_middle_name': 'middle_name',
    'n400_gender': 'gender',
    'n400_lpr_date': 'lpr_date',
    'n400_country_birth': 'country_of_birth',
    'n400_country_nationality': 'country_of_nationality',
    'n400_disability_accom': 'disability_accom',
    'n400_disability_2': 'disability_2',
    'n400_name_change': 'name_change_request',
    'n400_other_name_1': 'other_name_1',
    'n400_other_name_2': 'other_name_2',
    'n400_other_name_3': 'other_name_3',
    'n400_other_name_4': 'other_name_4',
    'n400_mailing_address': 'mailing_address',
    'n400_current_employer': 'current_employer',
    'n400_race': 'race',
    'n400_ethnicity': 'ethnicity',
    'n400_military_service': 'military_service',
    'n400_p9_nobility': 'p9_nobility',
    'n400_p9_countries': 'p9_countries',
    'n400_p9_22b': 'p9_22b',
    'n400_times_married': 'times_married',
    'n400_marital_status_detail': 'marital_status_detail',
    'n400_spouse_citizen': 'spouse_citizen',
    'n400_household': 'household',
    'n400_spouse_name': 'spouse_name',
    'n400_spouse_dob': 'spouse_dob',
    'n400_marriage_date': 'marriage_date',
    'n400_spouse_employer': 'spouse_employer',
    'n400_spouse_immig': 'spouse_immig',
    'n400_spouse_natz_when': 'spouse_natz_when',
    'n400_spouse_natz_date': 'spouse_natz_date',
    'n400_spouse_household_name': 'spouse_household_name',
    'n400_child_17a': 'child_17a',
    'n400_child_17b': 'child_17b',
    'n400_child_17c': 'child_17c',
    'n400_child_26d': 'child_26d',
    'n400_mobile': 'mobile',
    'n400_p9_22c_date': 'p9_22c_date',
    # n400_eligibility_category, n400_eye_color, etc. already match (binder expects n400_ prefix)
    # I-90: UI i90_* -> binder keys
    'i90_a_number': 'a_number',
    'i90_dob': 'date_of_birth',
    'i90_given': 'given_name',
    'i90_name': 'family_name',  # i90_name is the family name question
    'i90_middle': 'middle_name',
    'i90_address': 'current_street',
    'i90_reason': 'i90_filing_reason',
    'i90_has_card': 'i90_has_physical_card',
    'i90_card_expiry': 'i90_card_expiry_date',
    'i90_police_report': 'i90_police_report_filed',
    'i90_middle': 'middle_name',
    'i90_card_name_family': 'i90_card_family_name',
    'i90_card_name_given': 'i90_card_given_name',
    'i90_card_name_middle': 'i90_card_middle_name',
    'i90_class_admission': 'i90_class_of_admission',
    'i90_date_admission': 'i90_date_of_admission',
    'i90_mother_name': 'i90_mother_given_name',
    'i90_father_name': 'i90_father_given_name',
    'i90_visa_applied_loc': 'i90_visa_applied_location',
    'i90_visa_issued_loc': 'i90_visa_issued_location',
    'i90_destination': 'i90_destination_at_admission',
    'i90_exclusion': 'i90_exclusion_proceedings',
    'i90_abandoned': 'i90_abandoned_status',
    'i90_disability': 'i90_disability_accom',
    # I-130: UI i130_* -> binder keys (match i130_full_registry.py)
    # Question IDs -> factIds (buildFactRecord uses question IDs)
    'i130_pet_name': 'i130_petitioner_family_name',
    'i130_ben_name': 'i130_beneficiary_family_name',
    'i130_pet_family': 'i130_petitioner_family_name',
    'i130_pet_given': 'i130_petitioner_given_name',
    'i130_pet_middle': 'i130_petitioner_middle_name',
    'i130_pet_dob': 'i130_petitioner_dob',
    'i130_pet_cob': 'i130_petitioner_cob',
    'i130_pet_a_number': 'i130_petitioner_a_number',
    'i130_pet_street': 'i130_petitioner_street',
    'i130_pet_city': 'i130_petitioner_city',
    'i130_pet_state': 'i130_petitioner_state',
    'i130_pet_zip': 'i130_petitioner_zip',
    'i130_pet_country': 'i130_petitioner_country',
    # I-130: beneficiary (UI uses i130_ben_* and i130_beneficiary_*)
    'i130_ben_family': 'i130_beneficiary_family_name',
    'i130_ben_given': 'i130_beneficiary_given_name',
    'i130_ben_middle': 'i130_beneficiary_middle_name',
    'i130_ben_dob': 'i130_beneficiary_dob',
    'i130_ben_cob': 'i130_beneficiary_cob',
    'i130_ben_gender': 'i130_beneficiary_gender',
    'i130_ben_a_number': 'i130_beneficiary_a_number',
    'i130_ben_street': 'i130_beneficiary_street',
    'i130_ben_city': 'i130_beneficiary_city',
    'i130_ben_state': 'i130_beneficiary_state',
    'i130_ben_zip': 'i130_beneficiary_zip',
    'i130_ben_country': 'i130_beneficiary_country',
    # I-130 EXPANSION 2026-11-04: Part B (petitioner)
    'i130_pet_other_name': 'i130_petitioner_other_name',
    'i130_pet_middle': 'i130_petitioner_middle_name',
    'i130_pet_birth_city': 'i130_petitioner_birth_city',
    'i130_pet_birth_country': 'i130_petitioner_birth_country',
    'i130_pet_gender': 'i130_petitioner_gender',
    'i130_pet_mailing_street': 'i130_petitioner_mailing_street',
    'i130_pet_marriages': 'i130_petitioner_marriages',
    'i130_pet_marital_status': 'i130_petitioner_marital_status',
    'i130_pet_marriage_date': 'i130_petitioner_marriage_date',
    'i130_pet_marriage_place': 'i130_petitioner_marriage_place',
    'i130_pet_prior_spouse1_family': 'i130_petitioner_prior_spouse1_family',
    'i130_pet_prior_spouse1_end': 'i130_petitioner_prior_spouse1_end',
    'i130_pet_prior_spouse2_family': 'i130_petitioner_prior_spouse2_family',
    'i130_pet_prior_spouse3_family': 'i130_petitioner_prior_spouse3_family',
    'i130_pet_naturalized': 'i130_petitioner_naturalized',
    'i130_pet_cert_number': 'i130_petitioner_cert_number',
    'i130_pet_employer': 'i130_petitioner_employer',
    'i130_pet_occupation': 'i130_petitioner_occupation',
    'i130_pet_uscis_account': 'i130_petitioner_uscis_account',
    # I-130 EXPANSION 2026-11-04: Part C (beneficiary)
    'i130_ben_other_name': 'i130_beneficiary_other_name',
    'i130_ben_gender_new': 'i130_beneficiary_gender',
    'i130_ben_marital_status': 'i130_beneficiary_marital_status',
    'i130_ben_marriages': 'i130_beneficiary_marriages',
    'i130_ben_marriage_date': 'i130_beneficiary_marriage_date',
    'i130_ben_spouse_family': 'i130_beneficiary_spouse_family',
    'i130_ben_class_admission': 'i130_beneficiary_class_admission',
    'i130_ben_i94': 'i130_beneficiary_i94',
    'i130_ben_passport': 'i130_beneficiary_passport',
    'i130_ben_passport_country': 'i130_beneficiary_passport_country',
    'i130_ben_phone': 'i130_beneficiary_phone',
    'i130_ben_email': 'i130_beneficiary_email',
    'i130_ben_employer_street': 'i130_beneficiary_employer_street',
    'i130_ben_child1_family': 'i130_beneficiary_child1_family',
    'i130_ben_child1_relationship': 'i130_beneficiary_child1_relationship',
    'i130_ben_child1_dob': 'i130_beneficiary_child1_dob',
    'i130_ben_child2_family': 'i130_beneficiary_child2_family',
    'i130_ben_child2_relationship': 'i130_beneficiary_child2_relationship',
    'i130_ben_child2_dob': 'i130_beneficiary_child2_dob',
    'i130_ben_child3_family': 'i130_beneficiary_child3_family',
    'i130_ben_child3_relationship': 'i130_beneficiary_child3_relationship',
    'i130_ben_child3_dob': 'i130_beneficiary_child3_dob',
    'i130_ben_child4_family': 'i130_beneficiary_child4_family',
    'i130_ben_child4_relationship': 'i130_beneficiary_child4_relationship',
    'i130_ben_child4_dob': 'i130_beneficiary_child4_dob',
    'i130_ben_proceedings': 'i130_beneficiary_proceedings',
    'i130_ben_uscis_account': 'i130_beneficiary_uscis_account',
    # I-485: UI uses question IDs (i485_name) not factIds (family_name)
    'i485_name': 'family_name',
    # N-400 repeating groups: UI question IDs -> binder group IDs
    'n400_residence_history': 'n400_residences',
    'n400_employment_history': 'n400_employment',
    # n400_trips and n400_children already match
}

def normalize_facts(facts, aliases):
    """Translate UI factIds to binder-expected keys."""
    if not facts:
        return {}
    normalized = {}
    for k, v in facts.items():
        new_k = aliases.get(k, k)
        normalized[new_k] = v
    return normalized

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Match /api/fill-{form}
        if path.startswith('/api/fill-'):
            form_key = path.replace('/api/fill-', '')
            if form_key in FORMS:
                self.handle_fill(form_key)
                return

        # Match /api/assessment-save
        if path == '/api/assessment-save':
            self.handle_assessment_save()
            return

        # Match /api/assessment-resume
        if path == '/api/assessment-resume':
            self.handle_assessment_resume()
            return

        self.send_error(404, f"Not found: {path}")

    # In-memory assessment store (dev only; production uses Postgres)
    _assessments = {}

    def handle_assessment_save(self):
        import json, hashlib, uuid, time
        length = int(self.headers.get('content-length', 0))
        body = self.rfile.read(length) if length > 0 else b'{}'
        try:
            data = json.loads(body)
        except:
            data = {}
        
        client_key_hash = data.get('clientKeyHash', '')
        form_id = data.get('form_id', '')
        facts = data.get('facts', {})
        progress = data.get('progress', {})
        token = data.get('token')

        # Paid-access gate (owner directive 2026-11-05): when the
        # paywall is on, persistence requires any paid entitlement.
        # Fail closed: missing/invalid/unpaid token, or a verification
        # failure, denies with 402. Paywall off → unchanged.
        if paywall_enabled():
            allowed, reason = check_paid_access(
                self.headers.get('x-entitlement-token'))
            if not allowed:
                self._send_json(402, {'error': 'A paid entitlement is required to save an assessment.', 'reason': reason})
                return

        # Validate
        if not client_key_hash or len(client_key_hash) != 64:
            self._send_json(400, {'error': 'Invalid clientKeyHash'})
            return
        if form_id not in ['n400', 'i485', 'i130', 'i90', 'i765', 'i589']:
            self._send_json(400, {'error': 'Invalid form_id'})
            return
        
        if token:
            # Update existing
            if token not in self._assessments:
                self._send_json(403, {'error': 'Access denied'})
                return
            rec = self._assessments[token]
            if rec['client_key_hash'] != client_key_hash:
                self._send_json(403, {'error': 'Access denied'})
                return
            rec['facts'] = facts
            rec['progress'] = progress
            rec['updated_at'] = time.time()
            self._send_json(200, {'token': token, 'updated': True})
        else:
            # Create new
            new_token = uuid.uuid4().hex + uuid.uuid4().hex
            self._assessments[new_token] = {
                'token': new_token,
                'client_key_hash': client_key_hash,
                'form_id': form_id,
                'facts': facts,
                'progress': progress,
                'created_at': time.time(),
                'updated_at': time.time(),
            }
            self._send_json(201, {'token': new_token, 'assessment_id': new_token[:8]})
    
    def handle_assessment_resume(self):
        import json, hashlib
        length = int(self.headers.get('content-length', 0))
        body = self.rfile.read(length) if length > 0 else b'{}'
        try:
            data = json.loads(body)
        except:
            data = {}
        
        token = data.get('token', '')
        client_key = data.get('clientKey', '')

        # Paid-access gate (owner directive 2026-11-05): when the
        # paywall is on, resuming requires any paid entitlement.
        # Fail closed with 402. Paywall off → unchanged.
        if paywall_enabled():
            allowed, reason = check_paid_access(
                self.headers.get('x-entitlement-token'))
            if not allowed:
                self._send_json(402, {'error': 'A paid entitlement is required to resume an assessment.', 'reason': reason})
                return

        if not token or token not in self._assessments:
            self._send_json(404, {'error': 'Assessment not found'})
            return
        
        rec = self._assessments[token]
        # Verify hash
        computed = hashlib.sha256(client_key.encode()).hexdigest()
        if computed != rec['client_key_hash']:
            self._send_json(403, {'error': 'Access denied'})
            return
        
        self._send_json(200, {
            'form_id': rec['form_id'],
            'facts': rec['facts'],
            'progress': rec['progress'],
            'status': 'in_progress',
        })
    
    def _send_json(self, code, obj):
        import json
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_fill(self, form_key):
        # Paid-access gate (owner directive 2026-11-05): when the
        # paywall is on, filling a completed-form PDF requires a paid
        # 'forms' entitlement covering THIS form. Fail closed with 402.
        # Paywall off → unchanged.
        if paywall_enabled():
            allowed, reason = check_paid_access(
                self.headers.get('x-entitlement-token'),
                FORM_ID_BY_KEY.get(form_key))
            if not allowed:
                self._send_json(402, {'error': 'A paid entitlement covering this form is required.', 'reason': reason})
                return
        try:
            length = int(self.headers.get('content-length', 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            facts = body.get('facts', {})
            original_facts = dict(facts or {})
            # Normalize UI factIds to binder-expected keys (Case 1 fix)
            facts = normalize_facts(facts, FACTID_ALIASES)
            print(f"=== FILL {form_key} ===", flush=True)
            if form_key == 'n400':
                # Show which facts didn't map to binder keys
                orig_keys = set(original_facts.keys())
                norm_keys = set(facts.keys())
                # Binder expects these (from n400_detailed_registry + generated)
                print(f"MISSING_FACTS: {sorted(orig_keys - norm_keys)}", flush=True)
            fk = list((facts or {}).keys())
            print(f"Facts: {len(fk)}, has family_name: {'family_name' in fk}", flush=True)
            if form_key == 'n400':
                print("UI_FACT_KEYS:", sorted(fk), flush=True)
            print(f"All keys: {sorted(fk)[:20]}", flush=True)
            fam = facts.get('family_name')
            if isinstance(fam, dict):
                print(f"family_name value: {fam.get('value')}", flush=True)
            else:
                print(f"family_name raw: {fam}", flush=True)
            addresses = body.get('addresses', [])
            biographic = body.get('biographic', {})

            config = FORMS[form_key]
            # Import binder dynamically
            binder_mod = __import__(config['binder'])
            build_func = getattr(binder_mod, config['func'])

            # I-130's build_master_plan requires (auto_facts, address_facts, bio_facts)
            # and returns (plan, review, stats) - 3 values
            # Other binders accept (facts, addresses=None, biographic=None) and return 2 values
            import inspect
            sig = inspect.signature(build_func)
            params = list(sig.parameters.keys())
            if 'auto_facts' in params:
                # I-130 master binder: 3 args, 3 return values
                plan, review, _stats = build_func(facts, addresses, biographic)
            else:
                plan, review = build_func(facts, addresses, biographic)

            template_path = os.path.join(os.path.dirname(__file__), config['template'])
            if not os.path.exists(template_path):
                raise FileNotFoundError(f"Template not found: {template_path}")

            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp_path = tmp.name

            filled, errors = apply_fill(template_path, tmp_path, plan)

            with open(tmp_path, 'rb') as f:
                pdf_bytes = f.read()
            os.unlink(tmp_path)

            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', f'attachment; filename="{config["filename"]}"')
            self.send_header('X-Fields-Filled', str(filled))
            self.send_header('X-Review-Items', str(len(review)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(pdf_bytes)

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Entitlement-Token')
        self.end_headers()

    def log_message(self, format, *args):
        # Quiet logging
        pass

if __name__ == '__main__':
    port = 8000
    server = HTTPServer(('localhost', port), Handler)
    print(f"IRU API server running on http://localhost:{port}/")
    print("Endpoints: /api/fill-i130, /api/fill-i90, /api/fill-n400, /api/fill-i765, /api/fill-i485")
    server.serve_forever()
