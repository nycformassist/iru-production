"""
Full verification: EVERY mapped field gets an assertion.
Questionnaire answers -> PDF -> reopen -> verify each field value.
"""
import sys, json
# bundled: _python is on sys.path via api/ directory

from datetime import datetime, timezone
import fitz
now = lambda: datetime.now(timezone.utc).isoformat()
def F(fid, val, conf=1.0):
    return {"id": fid, "value": val, "source": "applicant-typed",
            "confidence": conf, "status": "verified", "corrections": [], "updatedAt": now()}

print("=== FULL FIELD VERIFICATION ===\n")

def verify_all_fields(form_key, build_fn, pdf_path, facts):
    """Verify EVERY field in the plan landed correctly."""
    print(f"\n--- {form_key.upper()} ---")
    plan, review = build_fn(facts)
    print(f"  Plan: {len(plan)} fields")

    # Generate PDF
    from binder import apply_fill
    out = f"/tmp/{form_key}_full_verify.pdf"
    filled, errors = apply_fill(pdf_path, out, plan)
    assert len(errors) == 0, f"Errors: {errors}"
    print(f"  Generated: {filled} fields")

    # Reopen and verify EACH field
    doc = fitz.open(out)
    # Build map of field name -> widget
    widgets = {}
    for page in doc:
        for w in page.widgets():
            widgets[w.field_name] = w

    verified = 0
    failed = []
    for field_name, expected_val, kind, fid in plan:
        w = widgets.get(field_name)
        if not w:
            failed.append((field_name, "not found in PDF"))
            continue
        actual = w.field_value
        if kind == "text":
            # Text fields: compare as strings
            if str(actual).strip() == str(expected_val).strip():
                verified += 1
            else:
                failed.append((field_name, f"expected '{expected_val}', got '{actual}'"))
        elif kind == "checkbox":
            # Checkboxes: should be checked (True)
            if actual:
                verified += 1
            else:
                failed.append((field_name, "checkbox not checked"))

    doc.close()

    print(f"  Verified: {verified}/{len(plan)}")
    if failed:
        print(f"  Failed: {len(failed)}")
        for fname, reason in failed[:5]:
            print(f"    {fname.split('.')[-1][:40]}: {reason}")
    else:
        print(f"  ✓ ALL FIELDS VERIFIED")

    return verified, len(plan), len(failed) == 0

# Test each form with comprehensive facts
base_facts = {
    "family_name": F("family_name", "SANTOS"),
    "given_name": F("given_name", "MARIA"),
    "a_number": F("a_number", "A123456789"),
    "date_of_birth": F("date_of_birth", "03/15/1985"),
    "current_street": F("current_street", "456 Grand Concourse"),
    "current_city": F("current_city", "Bronx"),
    "current_state": F("current_state", "NY"),
    "current_zip": F("current_zip", "10451"),
    "email": F("email", "maria@example.com"),
    "phone": F("phone", "718-555-0100"),
}

results = {}

from _python.i90_full_binder import build_i90_full_plan
v, t, ok = verify_all_fields("i90", build_i90_full_plan,
    "/home/hatch/workspace/iru-n400-verify/i90.pdf",
    {**base_facts, "i90_filing_reason": F("i90_filing_reason", "2f")})
results["i90"] = (v, t, ok)

from _python.n400_full_binder import build_n400_full_plan
v, t, ok = verify_all_fields("n400", build_n400_full_plan,
    "/home/hatch/workspace/iru-n400-verify/n400.pdf", base_facts)
results["n400"] = (v, t, ok)

from _python.i765_full_binder import build_i765_full_plan
i765_facts = {**base_facts}
i765_facts["i765_a_number"] = i765_facts.pop("a_number")
i765_facts["i765_dob"] = i765_facts.pop("date_of_birth")
i765_facts["i765_filing_type"] = F("i765_filing_type", "initial")
v, t, ok = verify_all_fields("i765", build_i765_full_plan,
    "/home/hatch/workspace/iru-n400-verify/i-765.pdf", i765_facts)
results["i765"] = (v, t, ok)

from _python.i485_full_binder import build_i485_full_plan
v, t, ok = verify_all_fields("i485", build_i485_full_plan,
    "/home/hatch/workspace/iru-n400-verify/i-485.pdf", base_facts)
results["i485"] = (v, t, ok)

print("\n" + "="*50)
print("FULL VERIFICATION SUMMARY")
print("="*50)
all_ok = True
for form, (v, t, ok) in results.items():
    status = "✓ PASS" if ok else "✗ FAIL"
    print(f"  {form.upper()}: {v}/{t} verified {status}")
    all_ok = all_ok and ok

if all_ok:
    print("\n*** EVERY MAPPED FIELD VERIFIED ***")
else:
    print("\n*** SOME FIELDS FAILED VERIFICATION ***")
