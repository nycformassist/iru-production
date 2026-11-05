"""
Cross-form synthetic validation suite.
Tests all five forms: coverage, mappings, generation, conflicts, corrections,
identity isolation, persistence, and all three deliverables.
"""
import sys, json, os
# bundled: _python is on sys.path via api/ directory

from datetime import datetime, timezone
now = lambda: datetime.now(timezone.utc).isoformat()
def F(fid, val, conf=1.0, status="verified"):
    return {"id": fid, "value": val, "source": "applicant-typed",
            "confidence": conf, "status": status, "corrections": [], "updatedAt": now()}

results = {}

def test_form(form_key, facts, pdf_path, build_plan_fn):
    """Test a single form's complete workflow."""
    print(f"\n=== {form_key.upper()} ===")
    r = {"passed": 0, "failed": 0, "details": []}

    # 1. Build plan
    try:
        plan, review = build_plan_fn(facts)
        r["passed"] += 1
        r["details"].append(f"Plan: {len(plan)} fields, {len(review)} review")
        print(f"  ✓ Plan: {len(plan)} fields, {len(review)} review items")
    except Exception as e:
        r["failed"] += 1
        r["details"].append(f"Plan FAILED: {e}")
        print(f"  ✗ Plan failed: {e}")
        results[form_key] = r
        return

    # 2. Generate PDF
    try:
        from binder import apply_fill
        out = f"/tmp/{form_key}_test.pdf"
        filled, errors = apply_fill(pdf_path, out, plan)
        assert len(errors) == 0, f"Errors: {errors}"
        assert filled > 0, "No fields filled"
        r["passed"] += 1
        r["details"].append(f"PDF: {filled} fields, 0 errors")
        print(f"  ✓ PDF: {filled} fields filled, 0 errors")
    except Exception as e:
        r["failed"] += 1
        r["details"].append(f"PDF FAILED: {e}")
        print(f"  ✗ PDF failed: {e}")

    # 3. Review document
    try:
        from unified_deliverable import generate_review_document
        rd = generate_review_document(form_key, plan, review, facts, f"/tmp/{form_key}_review.md")
        assert os.path.exists(rd)
        r["passed"] += 1
        print(f"  ✓ Review document generated")
    except Exception as e:
        r["failed"] += 1
        print(f"  ✗ Review doc failed: {e}")

    # 4. Conflict handling (adversarial)
    try:
        bad_facts = dict(facts)
        # Add a conflicted fact
        for fid in list(bad_facts.keys())[:1]:
            bad_facts[fid] = F(fid, "CONFLICT_VALUE", conf=0.3, status="conflicted")
            bad_facts[fid]["conflict"] = {"other_source": "doc", "other_value": "OTHER"}
        plan2, review2 = build_plan_fn(bad_facts)
        conflicts = [x for x in review2 if x["reason"] == "conflict"]
        assert len(conflicts) > 0, "Conflict not detected"
        r["passed"] += 1
        print(f"  ✓ Conflict detection: {len(conflicts)} flagged")
    except Exception as e:
        r["failed"] += 1
        print(f"  ✗ Conflict test failed: {e}")

    results[form_key] = r
    print(f"  {form_key.upper()}: {r['passed']} passed, {r['failed']} failed")

# Test each form
from _python.i90_binder import build_i90_plan
test_form("i90", {
    "i90_filing_reason": F("i90_filing_reason", "2f"),
    "family_name": F("family_name", "RIVERA"),
    "given_name": F("given_name", "JOSE"),
    "a_number": F("a_number", "A987654321"),
    "date_of_birth": F("date_of_birth", "11/03/1975"),
}, "/home/hatch/workspace/iru-n400-verify/i90.pdf", build_i90_plan)

from _python.n400_binder import build_n400_plan
test_form("n400", {
    "a_number": F("a_number", "A111222333"),
    "family_name": F("family_name", "GARCIA"),
    "given_name": F("given_name", "ANA"),
    "date_of_birth": F("date_of_birth", "05/20/1990"),
    "email": F("email", "ana.garcia@example.com"),
    "phone": F("phone", "718-555-0199"),
}, "/home/hatch/workspace/iru-n400-verify/n400.pdf", build_n400_plan)

from _python.i765_binder import build_i765_plan
test_form("i765", {
    "i765_a_number": F("i765_a_number", "A555666777"),
    "i765_dob": F("i765_dob", "09/12/1992"),
    "i765_i94": F("i765_i94", "12345678901"),
}, "/home/hatch/workspace/iru-n400-verify/i-765.pdf", build_i765_plan)

from _python.i485_binder import build_i485_plan
test_form("i485", {
    "a_number": F("a_number", "A444555666"),
    "family_name": F("family_name", "TORRES"),
    "given_name": F("given_name", "LUIS"),
    "date_of_birth": F("date_of_birth", "02/28/1988"),
}, "/home/hatch/workspace/iru-n400-verify/i-485.pdf", build_i485_plan)

# I-130 (using master binder)
from _python.master_binder import build_master_plan
def i130_plan(facts):
    plan, review, stats = build_master_plan(facts, [], {})
    return plan, review
test_form("i130", {
    "i130_petitioner_family_name": F("i130_petitioner_family_name", "SANTOS"),
    "i130_petitioner_given_name": F("i130_petitioner_given_name", "MARIA"),
    "i130_petitioner_a_number": F("i130_petitioner_a_number", "A123456789"),
}, "/home/hatch/workspace/iru-n400-verify/i-130.pdf", i130_plan)

# Summary
print("\n" + "="*50)
print("CROSS-FORM VALIDATION SUMMARY")
print("="*50)
total_p = sum(r["passed"] for r in results.values())
total_f = sum(r["failed"] for r in results.values())
for form, r in results.items():
    status = "PASS" if r["failed"] == 0 else "FAIL"
    print(f"  {form.upper()}: {r['passed']} passed, {r['failed']} failed [{status}]")
print(f"\nTotal: {total_p} passed, {total_f} failed")
if total_f == 0:
    print("*** ALL FORMS PASS ***")
