"""
Comprehensive validation: tests ACTUAL coverage, not just cores.
Exercises representative cases across all five forms.
"""
import sys, json, os
# bundled: _python is on sys.path via api/ directory

from datetime import datetime, timezone
now = lambda: datetime.now(timezone.utc).isoformat()
def F(fid, val, conf=1.0, status="verified", source="applicant-typed"):
    return {"id": fid, "value": val, "source": source,
            "confidence": conf, "status": status, "corrections": [], "updatedAt": now()}

print("=== COMPREHENSIVE FIVE-FORM VALIDATION ===\n")
results = {}

def test_comprehensive(form_key, build_fn, pdf_path, facts, expected_min):
    """Test with comprehensive facts, verify actual field coverage."""
    print(f"\n--- {form_key.upper()} ---")
    r = {"passed": 0, "failed": 0}

    # 1. Build plan with comprehensive facts
    plan, review = build_fn(facts)
    print(f"  Plan: {len(plan)} fields")
    if len(plan) >= expected_min:
        print(f"  ✓ Meets minimum coverage ({expected_min})")
        r["passed"] += 1
    else:
        print(f"  ✗ Below minimum ({expected_min})")
        r["failed"] += 1

    # 2. Generate PDF and verify fields actually populated
    from binder import apply_fill
    out = f"/tmp/{form_key}_comp.pdf"
    filled, errors = apply_fill(pdf_path, out, plan)
    if len(errors) == 0 and filled == len(plan):
        print(f"  ✓ PDF: {filled} fields, 0 errors")
        r["passed"] += 1
    else:
        print(f"  ✗ PDF: {filled}/{len(plan)}, {len(errors)} errors")
        r["failed"] += 1

    # 3. Verify populated values (spot check)
    import fitz
    doc = fitz.open(out)
    verified = 0
    for field_name, expected_val, kind, fid in plan[:5]:  # Check first 5
        # Find the widget and check its value
        for page in doc:
            for w in page.widgets():
                if w.field_name == field_name:
                    actual = w.field_value
                    # For text fields, check value matches (checkboxes are bool)
                    if kind == "text" and str(actual) == str(expected_val):
                        verified += 1
                    elif kind == "checkbox" and actual:
                        verified += 1
                    break
    doc.close()
    if verified > 0:
        print(f"  ✓ Values verified: {verified}/5 spot-checked")
        r["passed"] += 1
    else:
        print(f"  ✗ No values verified")
        r["failed"] += 1

    # 4. Review document
    from unified_deliverable import generate_review_document
    rd = generate_review_document(form_key, plan, review, facts, f"/tmp/{form_key}_comp_review.md")
    if os.path.exists(rd):
        print(f"  ✓ Review document")
        r["passed"] += 1
    else:
        r["failed"] += 1

    results[form_key] = r
    print(f"  {form_key.upper()}: {r['passed']}/4 passed")

# Comprehensive facts (shared + form-specific)
base = {
    "family_name": F("family_name", "SANTOS"),
    "given_name": F("given_name", "MARIA"),
    "a_number": F("a_number", "A123456789"),
    "date_of_birth": F("date_of_birth", "03/15/1985"),
    "current_street": F("current_street", "456 Grand Concourse"),
    "current_city": F("current_city", "Bronx"),
    "current_state": F("current_state", "NY"),
    "current_zip": F("current_zip", "10451"),
    "current_country": F("current_country", "USA"),
    "email": F("email", "maria.santos@example.com"),
    "phone": F("phone", "718-555-0100"),
}

from _python.i90_full_binder import build_i90_full_plan
test_comprehensive("i90", build_i90_full_plan,
    "/home/hatch/workspace/iru-n400-verify/i90.pdf",
    {**base, "i90_filing_reason": F("i90_filing_reason", "2f")}, 20)

from _python.n400_full_binder import build_n400_full_plan
test_comprehensive("n400", build_n400_full_plan,
    "/home/hatch/workspace/iru-n400-verify/n400.pdf", base, 30)

from _python.i765_full_binder import build_i765_full_plan
i765_facts = {**base, "i765_a_number": base["a_number"], "i765_dob": base["date_of_birth"]}
del i765_facts["a_number"]; del i765_facts["date_of_birth"]
test_comprehensive("i765", build_i765_full_plan,
    "/home/hatch/workspace/iru-n400-verify/i-765.pdf", i765_facts, 15)

from _python.i485_full_binder import build_i485_full_plan
test_comprehensive("i485", build_i485_full_plan,
    "/home/hatch/workspace/iru-n400-verify/i-485.pdf", base, 50)

from _python.master_binder import build_master_plan
def i130_fn(facts):
    p, r, _ = build_master_plan(facts, [], {})
    return p, r
i130_facts = {
    "i130_petitioner_family_name": F("i130_petitioner_family_name", "SANTOS"),
    "i130_petitioner_given_name": F("i130_petitioner_given_name", "MARIA"),
    "i130_petitioner_a_number": F("i130_petitioner_a_number", "A123456789"),
}
test_comprehensive("i130", i130_fn,
    "/home/hatch/workspace/iru-n400-verify/i-130.pdf", i130_facts, 3)

print("\n" + "="*50)
print("COMPREHENSIVE SUMMARY")
print("="*50)
total_p = sum(r["passed"] for r in results.values())
total_t = sum(r["passed"] + r["failed"] for r in results.values())
for f, r in results.items():
    print(f"  {f.upper()}: {r['passed']}/4")
print(f"\nTotal: {total_p}/{total_t}")
if total_p == total_t:
    print("*** ALL COMPREHENSIVE TESTS PASS ***")
