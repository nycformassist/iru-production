"""
I-485 question groups: filing category, admissibility, immigration history.
Follows I-130 intelligence patterns; form-specific logic implemented directly.
"""
import json
import os
_fields = json.load(open(os.path.join(os.path.dirname(__file__), 'i485_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}
def F(short): return _name_map.get(short)

# Load admissibility pairs
_pairs = json.load(open(os.path.join(os.path.dirname(__file__), 'i485_yesno_pairs.json')))

I485_QUESTION_GROUPS = {
    # Part 2: Filing category - THE DECISION HUB
    "filing_category": {
        "question": "What is your filing category for adjustment of status?",
        "fields": [
            {"fact": "i485_cat_family", "field": F("Pt2Line3a_CB[0]"), "kind": "checkbox", "expected": "family"},
            {"fact": "i485_cat_employment", "field": F("Pt2Line3b_CB[0]"), "kind": "checkbox", "expected": "employment"},
            {"fact": "i485_cat_special", "field": F("Pt2Line3c_CB[0]"), "kind": "checkbox", "expected": "special"},
            {"fact": "i485_cat_asylee", "field": F("Pt2Line3d_CB[0]"), "kind": "checkbox", "expected": "asylee"},
            {"fact": "i485_cat_victim", "field": F("Pt2Line3e_CB[0]"), "kind": "checkbox", "expected": "victim"},
            {"fact": "i485_cat_publiclaw", "field": F("Pt2Line3f_CB[0]"), "kind": "checkbox", "expected": "publiclaw"},
            {"fact": "i485_cat_other", "field": F("Pt2Line3g_CB[0]"), "kind": "checkbox", "expected": "other"},
        ],
    },
    # SSN - I-485 REQUIRES SSN (D-2 exception)
    "ssn": {
        "question": "What is your Social Security Number? (Required for I-485)",
        "fields": [
            {"fact": "ssn", "field": F("Pt1Line5_SSN[0]"), "kind": "text"},
        ],
    },
}

# Add admissibility pairs as a group
# Each pair gets yes/no mapping
_admiss_fields = []
for idx, p in enumerate(_pairs):
    base = p['base']
    fields = p['fields']
    # fields[0] is [0] (Yes), fields[1] is [1] (No) - verify by sorting
    _admiss_fields.append({
        "fact": f"i485_admiss_{idx:02d}_yes",
        "field": F(fields[0]),
        "kind": "checkbox",
        "expected": "yes",
    })
    _admiss_fields.append({
        "fact": f"i485_admiss_{idx:02d}_no",
        "field": F(fields[1]),
        "kind": "checkbox",
        "expected": "no",
    })

I485_QUESTION_GROUPS["admissibility"] = {
    "question": "Admissibility questions (answer truthfully)",
    "fields": _admiss_fields,
}

I485_QUESTION_GROUPS["immigration_history"] = {
    "question": "Immigration history (passport, visa, entry)",
    "fields": [
        {"fact": "i485_passport_num", "field": F("Pt1Line10_PassportNum[0]"), "kind": "text"},
        {"fact": "i485_visa_num", "field": F("Pt1Line10_VisaNum[0]"), "kind": "text"},
        {"fact": "i485_i94", "field": F("P1Line12_I94[0]"), "kind": "text"},
        {"fact": "i485_date_arrival", "field": F("Pt1Line10_DateofArrival[0]"), "kind": "text"},
        {"fact": "i485_status", "field": F("Pt1Line12_Status[0]"), "kind": "text"},
    ],
}

I485_QUESTION_GROUPS["contact_immigration"] = {
    "question": "Contact and immigration details",
    "fields": [
        {"fact": "phone_daytime", "field": F("P3_Line4_DaytimeTelePhoneNumber[0]"), "kind": "text"},
        {"fact": "phone_mobile", "field": F("P3_Line5_MobileTelePhoneNumber[0]"), "kind": "text"},
        {"fact": "email", "field": F("P3_Line6_Email[0]"), "kind": "text"},
        {"fact": "i485_passport_exp", "field": F("Pt1Line10_ExpDate[0]"), "kind": "text"},
        {"fact": "i485_admitted_yes", "field": F("Pt1Line11_Admitted[0]"), "kind": "checkbox", "expected": "yes"},
        {"fact": "i485_paroled_yes", "field": F("Pt1Line11_Paroled[0]"), "kind": "checkbox", "expected": "yes"},
    ],
}

def get_i485_mappings():
    """Return flat list of field mappings."""
    out = []
    for group_id, group in I485_QUESTION_GROUPS.items():
        for fm in group.get("fields", []):
            if fm.get("field"):
                out.append({
                    "group": group_id,
                    "fact": fm["fact"],
                    "field": fm["field"],
                    "kind": fm.get("kind", "text"),
                    "expected": fm.get("expected"),
                })
    return out
