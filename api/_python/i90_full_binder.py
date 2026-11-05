"""
I-90 comprehensive binder: uses generated mappings from I-130 intelligence.
Implements the full 64 generated mappings (address + identity) plus form-specific.
"""
import json
import os
import sys
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from binder import bind

# Load generated mappings
_gen = json.load(open(os.path.join(_HERE, 'i90_generated.json')))
_fields = json.load(open(os.path.join(_HERE, 'i90_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}
_type_map = {f['short']: f['type'] for f in _fields}

def _semantic_to_fact(semantic, form_prefix=""):
    """Map semantic field type to Tier 1 fact ID."""
    mapping = {
        'family_name': 'family_name',
        'given_name': 'given_name',
        'middle_name': 'middle_name',
        'date_of_birth': 'date_of_birth',
        'a_number': 'a_number',
        'street': 'current_street',
        'city': 'current_city',
        'state': 'current_state',
        'zip': 'current_zip',
        'postal_code': 'current_postal',
        'province': 'current_province',
        'country': 'current_country',
        'unit': 'current_unit',
        'in_care_of': 'current_care_of',
    }
    return mapping.get(semantic, f"{form_prefix}_{semantic}")

def build_i90_full_plan(facts, addresses=None, biographic=None):
    """
    Build comprehensive fill plan for I-90.
    Uses generated mappings + form-specific logic.
    """
    registry = {}

    # 1. Generated address mappings
    for m in _gen['address']:
        fact_id = _semantic_to_fact(m['semantic'])
        # Only include if we have the fact or it's a standard address fact
        registry[f"gen_addr_{m['field']}"] = {
            "fact": fact_id,
            "field": m['full_name'],
            "kind": "checkbox" if m['type'] == 'CheckBox' else "text",
            "required": False,
            "generated": True,
        }

    # 2. Generated identity mappings
    for m in _gen['identity']:
        fact_id = _semantic_to_fact(m['semantic'])
        registry[f"gen_id_{m['field']}"] = {
            "fact": fact_id,
            "field": m['full_name'],
            "kind": "checkbox" if m['type'] == 'CheckBox' else "text",
            "required": False,
            "generated": True,
        }

    # 3. Form-specific: filing reason checkboxes (from detailed registry)
    detailed = json.load(open(os.path.join(_HERE, 'i90_detailed_registry.json')))
    for val, short in detailed["i90_filing_reason"].items():
        registry[f"i90_reason_{val}"] = {
            "fact": "i90_filing_reason",
            "field": _name_map[short],
            "kind": "checkbox",
            "expected_value": val,
            "form_specific": True,
        }

    # 4. Expansion fields (2026-11-04): text fields
    _expansion_text = {
        "middle_name": "form1[0].#subform[0].P1_Line3c_MiddleName[0]",
        "i90_uscis_account": "form1[0].#subform[0].P1_Line2_AcctIdentifier[0]",
        "i90_card_family_name": "form1[0].#subform[0].P1_Line5a_FamilyName[0]",
        "i90_card_given_name": "form1[0].#subform[0].P1_Line5b_GivenName[0]",
        "i90_card_middle_name": "form1[0].#subform[0].P1_Line5c_MiddleName[0]",
        "i90_physical_street": "form1[0].#subform[0].P1_Line7a_StreetNumberName[0]",
        "i90_physical_city": "form1[0].#subform[0].P1_Line7c_CityOrTown[0]",
        "i90_physical_state": "form1[0].#subform[0].P1_Line7d_State[0]",
        "i90_physical_zip": "form1[0].#subform[0].P1_Line7e_ZipCode[0]",
        "i90_physical_country": "form1[0].#subform[0].P1_Line7h_Country[0]",
        "i90_class_of_admission": "form1[0].#subform[1].P1_Line14_ClassOfAdmission[0]",
        "i90_date_of_admission": "form1[0].#subform[1].P1_Line15_DateOfAdmission[0]",
        "i90_mother_given_name": "form1[0].#subform[1].P1_Line12_MotherGivenName[0]",
        "i90_father_given_name": "form1[0].#subform[1].P1_Line13_FatherGivenName[0]",
        "i90_visa_applied_location": "form1[0].#subform[2].P3_Line1_LocationAppliedVisa[0]",
        "i90_visa_issued_location": "form1[0].#subform[2].P3_Line2_LocationIssuedVisa[0]",
        "i90_destination_at_admission": "form1[0].#subform[2].P3_Line3a_Destination[0]",
        "i90_daytime_phone": "form1[0].#subform[3].P5_Line3_DaytimePhoneNumber[0]",
        "i90_mobile_phone": "form1[0].#subform[3].P5_Line4_MobilePhoneNumber[0]",
        "i90_email": "form1[0].#subform[3].P5_Line5_EmailAddress[0]",
        "i90_contact_language": "form1[0].#subform[3].P5_Line1b_Language[0]",
        "i90_disability_detail": "form1[0].#subform[2].P4_Line1a_AccomodationRequested[0]",
        "i90_weight": "form1[0].#subform[2].P3_Line9_HeightInches1[0]",
    }
    for fid, field in _expansion_text.items():
        registry[f"exp_{fid}"] = {
            "fact": fid,
            "field": field,
            "kind": "text",
            "required": False,
            "expansion": True,
        }

    # 5. Expansion: radio/checkbox pairs (value -> field)
    _expansion_pairs = [
        # (fact_id, value, full_field_name)
        ("i90_gender", "male", "form1[0].#subform[1].P1_Line8_male[0]"),
        ("i90_gender", "female", "form1[0].#subform[1].P1_Line8_female[0]"),
        ("i90_ethnicity", "not_hispanic", "form1[0].#subform[2].P3_checkbox4[0]"),
        ("i90_ethnicity", "hispanic", "form1[0].#subform[2].P3_checkbox4[1]"),
        ("i90_race", "white", "form1[0].#subform[2].P3_checkbox7_White[0]"),
        ("i90_race", "black", "form1[0].#subform[2].P3_checkbox7_Black[0]"),
        ("i90_race", "asian", "form1[0].#subform[2].P3_checkbox7_Asian[0]"),
        ("i90_race", "indian", "form1[0].#subform[2].P3_checkbox7_Indian[0]"),
        ("i90_race", "hawaiian", "form1[0].#subform[2].P3_checkbox7_Hawaiian[0]"),
        ("i90_disability_accom", "yes", "form1[0].#subform[2].P4_checkbox1[0]"),
        ("i90_disability_accom", "no", "form1[0].#subform[2].P4_checkbox1[1]"),
        ("i90_name_changed", "yes", "form1[0].#subform[1].P2_checkbox1[0]"),
        ("i90_name_changed", "no", "form1[0].#subform[1].P2_checkbox1[1]"),
        ("i90_name_changed", "na", "form1[0].#subform[1].P2_checkbox1[2]"),
        ("i90_exclusion_proceedings", "no", "form1[0].#subform[2].P3_checkbox5[0]"),
        ("i90_exclusion_proceedings", "yes", "form1[0].#subform[2].P3_checkbox5[1]"),
        ("i90_abandoned_status", "no", "form1[0].#subform[2].P3_checkbox6[0]"),
        ("i90_abandoned_status", "yes", "form1[0].#subform[2].P3_checkbox6[1]"),
        # Eye color (order from form: Black, Brown, Maroon, Pink, Hazel, Green, Blue, Gray, Unknown/Other)
        ("i90_eye_color", "black", "form1[0].#subform[2].P3_checkbox10[0]"),
        ("i90_eye_color", "brown", "form1[0].#subform[2].P3_checkbox10[1]"),
        ("i90_eye_color", "maroon", "form1[0].#subform[2].P3_checkbox10[2]"),
        ("i90_eye_color", "pink", "form1[0].#subform[2].P3_checkbox10[3]"),
        ("i90_eye_color", "hazel", "form1[0].#subform[2].P3_checkbox10[4]"),
        ("i90_eye_color", "green", "form1[0].#subform[2].P3_checkbox10[5]"),
        ("i90_eye_color", "blue", "form1[0].#subform[2].P3_checkbox10[6]"),
        ("i90_eye_color", "gray", "form1[0].#subform[2].P3_checkbox10[7]"),
        ("i90_eye_color", "other", "form1[0].#subform[2].P3_checkbox10[8]"),
        # Hair color (order from form: White, Black, Brown, Red, Sandy, Gray, Blond, Bald, Unknown/Other)
        ("i90_hair_color", "white", "form1[0].#subform[2].P3_checkbox11[0]"),
        ("i90_hair_color", "black", "form1[0].#subform[2].P3_checkbox11[1]"),
        ("i90_hair_color", "brown", "form1[0].#subform[2].P3_checkbox11[2]"),
        ("i90_hair_color", "red", "form1[0].#subform[2].P3_checkbox11[3]"),
        ("i90_hair_color", "sandy", "form1[0].#subform[2].P3_checkbox11[4]"),
        ("i90_hair_color", "gray", "form1[0].#subform[2].P3_checkbox11[5]"),
        ("i90_hair_color", "blond", "form1[0].#subform[2].P3_checkbox11[6]"),
        ("i90_hair_color", "bald", "form1[0].#subform[2].P3_checkbox11[7]"),
        ("i90_hair_color", "other", "form1[0].#subform[2].P3_checkbox11[8]"),
    ]
    for fid, val, field in _expansion_pairs:
        registry[f"exp_{fid}_{val}"] = {
            "fact": fid,
            "field": field,
            "kind": "checkbox",
            "expected_value": val,
            "expansion": True,
        }

    # Build plan using core binder (handles confidence/conflict)
    plan, review = [], []

    for reg_id, spec in registry.items():
        fact_id = spec["fact"]
        fact = facts.get(fact_id)
        if not fact:
            continue

        # Checkbox with expected value (filing reason)
        if spec["kind"] == "checkbox" and "expected_value" in spec:
            if fact.get("status") == "conflicted":
                if not any(r["fact"] == fact_id for r in review):
                    review.append({
                        "fact": fact_id, "reason": "conflict",
                        "detail": "Conflicting filing reason."
                    })
                continue
            if fact.get("value") == spec["expected_value"]:
                if fact.get("confidence", 0) >= 0.7:
                    plan.append((spec["field"], True, "checkbox", fact_id))
                else:
                    review.append({
                        "fact": fact_id, "reason": "uncertain",
                        "detail": f"Low confidence for {fact_id}."
                    })
        # Text field
        elif spec["kind"] == "text":
            single = {fact_id: {"kind": "text", "field": spec["field"], "required": False}}
            # fact may be a raw string (from test) or a dict with value/confidence/status (from UI)
            if isinstance(fact, dict) and "value" in fact:
                fact_dict = fact
            else:
                fact_dict = {"value": fact, "confidence": 1.0, "status": "ok"}
            p, r = bind(single, {fact_id: fact_dict})
            plan.extend(p)
            review.extend(r)

    # Deduplicate by field name (generated + detailed may overlap)
    seen = set()
    deduped_plan = []
    for f, v, k, fid in plan:
        if f not in seen:
            seen.add(f)
            deduped_plan.append((f, v, k, fid))
    return deduped_plan, review

if __name__ == "__main__":
    from datetime import datetime, timezone
    now = lambda: datetime.now(timezone.utc).isoformat()
    def F(fid, val, conf=1.0):
        return {"id": fid, "value": val, "source": "applicant-typed",
                "confidence": conf, "status": "verified", "corrections": [], "updatedAt": now()}

    # Comprehensive test with address facts
    facts = {
        "i90_filing_reason": F("i90_filing_reason", "2f"),
        "family_name": F("family_name", "RIVERA"),
        "given_name": F("given_name", "JOSE"),
        "a_number": F("a_number", "A987654321"),
        "date_of_birth": F("date_of_birth", "11/03/1975"),
        "current_street": F("current_street", "123 Main St"),
        "current_city": F("current_city", "Bronx"),
        "current_state": F("current_state", "NY"),
        "current_zip": F("current_zip", "10466"),
    }
    plan, review = build_i90_full_plan(facts)
    print(f"I-90 full: {len(plan)} fields, {len(review)} review items")
    # Show breakdown
    from collections import Counter
    kinds = Counter(k for _, _, k, _ in plan)
    print(f"  By kind: {dict(kinds)}")
