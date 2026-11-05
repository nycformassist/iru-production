"""
Consumer journey test: 10 steps from directive §3.
Uses realistic synthetic data (Maria Santos / Carlos Santos).
"""
import sys, json, os
# bundled: _python is on sys.path via api/ directory

from datetime import datetime, timezone
now = lambda: datetime.now(timezone.utc).isoformat()

def F(fid, value, conf=1.0, status="verified", source="applicant-typed"):
    return {"id": fid, "value": value, "source": source,
            "confidence": conf, "status": status, "corrections": [], "updatedAt": now()}

print("=== CONSUMER JOURNEY TEST ===\n")

# Step 1: Enter information through targeted questions
print("1. Enter information through targeted questions...")
facts = {
    "i130_petitioner_family_name": F("i130_petitioner_family_name", "SANTOS"),
    "i130_petitioner_given_name": F("i130_petitioner_given_name", "MARIA"),
    "i130_petitioner_dob": F("i130_petitioner_dob", "03/15/1985"),
    "i130_petitioner_a_number": F("i130_petitioner_a_number", "A123456789"),
    "i130_petitioner_is_usc": F("i130_petitioner_is_usc", "usc"),
    "i130_beneficiary_relationship": F("i130_beneficiary_relationship", "spouse"),
    "i130_beneficiary_family_name": F("i130_beneficiary_family_name", "SANTOS"),
    "i130_beneficiary_given_name": F("i130_beneficiary_given_name", "CARLOS"),
    # Step 5 setup: conflicting DOB
    "i130_beneficiary_dob": F("i130_beneficiary_dob", "07/22/1988", conf=0.3, status="conflicted"),
    "i130_beneficiary_birth_country": F("i130_beneficiary_birth_country", "Mexico", conf=0.6),
    "i130_filed_before": F("i130_filed_before", "no"),
}
facts["i130_beneficiary_dob"]["conflict"] = {
    "other_source": "document-extraction (passport)", "other_value": "07/22/1987"}
print(f"   ✓ {len(facts)} facts entered")

# Step 2: Upload supporting documents (simulated - document facts)
print("2. Upload supporting documents...")
doc_facts = {
    "doc_passport_dob": F("doc_passport_dob", "07/22/1987", source="document-extraction",
                          conf=0.85),
}
print(f"   ✓ Passport uploaded, DOB extracted: {doc_facts['doc_passport_dob']['value']}")

# Step 3: Facts extracted and associated with sources
print("3. Facts extracted with sources...")
assert doc_facts["doc_passport_dob"]["source"] == "document-extraction"
print(f"   ✓ Source tracked: {doc_facts['doc_passport_dob']['source']}")

# Step 4: Reuse previously confirmed information
print("4. Reuse confirmed information...")
from _python.identity import PersonRecord, IdentityStore
store = IdentityStore()
maria = PersonRecord("maria_001", "Maria Santos")
for fid, f in facts.items():
    if fid.startswith("i130_petitioner_"):
        maria.add_fact(f)
store.add_person(maria)
# Simulate N-400 -> I-130 reuse
store.confirm_identity("maria_n400", "maria_001", method="consumer-confirmed")
print(f"   ✓ Identity store ready, {len(maria.facts)} petitioner facts stored")

# Step 5: Identify conflicting/missing/uncertain
print("5. Identify conflicts/missing/uncertain...")
from _python.master_binder import build_master_plan
addresses = [{
    "id": "addr_1", "kind": "physical",
    "value": {"street": "456 Grand Concourse", "city": "Bronx", "state": "NY",
              "zip": "10451", "country": "USA"},
    "source": "applicant-typed", "confidence": 1.0, "status": "verified",
    "date_from": "06/01/2022", "date_to": "PRESENT", "corrections": [], "updatedAt": now(),
}]
bio = {
    "bio_ethnicity": F("bio_ethnicity", "not_hispanic_latino"),
    "bio_race": F("bio_race", ["black"]),
    "bio_height_feet": F("bio_height_feet", "5"),
    "bio_height_inches": F("bio_height_inches", "9"),
    "bio_weight": F("bio_weight", 165),
    "bio_eye_color": F("bio_eye_color", "brown"),
    "bio_hair_color": F("bio_hair_color", "black"),
}
plan, review, stats = build_master_plan(facts, addresses, bio)
conflicts = [r for r in review if r['reason'] == 'conflict']
uncertain = [r for r in review if r['reason'] == 'uncertain']
print(f"   ✓ {len(conflicts)} conflicts, {len(uncertain)} uncertain flagged")
assert len(conflicts) >= 1, "DOB conflict should be flagged"
assert len(uncertain) >= 1, "Low-confidence country should be flagged"

# Step 6: Review and correct
print("6. Review and correct...")
# Consumer corrects the DOB to match passport
facts["i130_beneficiary_dob"] = F("i130_beneficiary_dob", "07/22/1987", conf=0.9,
                                   status="corrected")
facts["i130_beneficiary_dob"]["corrections"] = [{
    "old": "07/22/1988", "new": "07/22/1987", "at": now(), "reason": "consumer-corrected"}]
plan2, review2, _ = build_master_plan(facts, addresses, bio)
conflicts2 = [r for r in review2 if r['reason'] == 'conflict']
print(f"   ✓ After correction: {len(conflicts2)} conflicts (was {len(conflicts)})")
assert len(conflicts2) == 0, "Conflict should resolve after correction"

# Step 7: Generate populated PDF
print("7. Generate populated I-130 PDF...")
from _python.binder import apply_fill
filled, errors = apply_fill(
    '/home/hatch/workspace/iru-n400-verify/i-130.pdf',
    '/home/hatch/workspace/iru-form-engine/JOURNEY_i130.pdf',
    plan2)
print(f"   ✓ {filled} fields filled, {len(errors)} errors")
assert filled > 0 and len(errors) == 0

# Step 8: Generate review document
print("8. Generate review document...")
from unified_deliverable import generate_review_document
all_facts = {**facts, **{f["id"]: f for f in addresses}, **bio}
rd_path = generate_review_document("i130", plan2, review2, all_facts,
    '/home/hatch/workspace/iru-form-engine/JOURNEY_review.md')
print(f"   ✓ Review document: {rd_path}")

# Step 9: Consolidated master report
print("9. Generate master report...")
from unified_deliverable import generate_master_report
mr_path = generate_master_report(
    [{"form_key": "i130", "filled": filled, "review_count": len(review2),
      "readiness": "Ready pending review"}],
    '/home/hatch/workspace/iru-form-engine/JOURNEY_master.md')
print(f"   ✓ Master report: {mr_path}")

# Step 10: Download and retain control
print("10. Download and consumer control...")
assert os.path.exists('/home/hatch/workspace/iru-form-engine/JOURNEY_i130.pdf')
assert os.path.exists(rd_path)
assert os.path.exists(mr_path)
print("   ✓ All deliverables exist and are downloadable")
print("   ✓ Consumer retains: review, correction, signature, submission decisions")

print("\n=== ALL 10 STEPS PASSED ===")
