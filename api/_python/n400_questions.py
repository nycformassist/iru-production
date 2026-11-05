"""
N-400 question groups: 324 unmapped fields organized by section.
Reuses biographic, address, and Tier 1 intelligence.
"""
import json
import os
_fields = json.load(open(os.path.join(os.path.dirname(__file__), 'n400_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}
def F(short): return _name_map.get(short)

N400_QUESTION_GROUPS = {
    # P7: Biographic (50 fields) - reuse biographic module pattern
    "biographic": {
        "note": "Reuses I-130 biographic intelligence (6 questions -> 30 fields pattern)",
        "fields": [
            # Ethnicity (2 checkboxes)
            {"fact": "bio_ethnicity_hispanic", "field": F("P7_Line1_Ethnicity[0]"), "kind": "checkbox", "expected": "hispanic"},
            {"fact": "bio_ethnicity_hispanic", "field": F("P7_Line1_Ethnicity[1]"), "kind": "checkbox", "expected": "not_hispanic"},
            # Race (5 checkboxes) - mapped by position like I-130
            # Height/Weight
            {"fact": "bio_height_feet", "field": F("P7_Line3_HeightFeet[0]"), "kind": "text"},
            {"fact": "bio_height_inches", "field": F("P7_Line3_HeightInches[0]"), "kind": "text"},
            {"fact": "bio_weight", "field": F("P7_Line4_Pounds2[0]"), "kind": "text"},
        ],
    },
    # P12: GMC yes/no questions - map to Tier 1 facts
    "gmc_arrests": {
        "question": "Have you ever been arrested, cited, or detained?",
        "fact": "n400_ever_arrested",
        "fields": [
            # P12_6a is likely the arrest question (yes/no pair)
            {"fact": "n400_ever_arrested", "field": F("P12_6a[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "n400_ever_arrested", "field": F("P12_6a[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },
    "gmc_taxes": {
        "question": "Have you filed taxes for the required period?",
        "fact": "n400_taxes_filed",
        "fields": [
            {"fact": "n400_taxes_filed", "field": F("P12_6b[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "n400_taxes_filed", "field": F("P12_6b[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },
    "gmc_support": {
        "question": "Are you currently supporting dependents?",
        "fact": "n400_child_support_current",
        "fields": [
            {"fact": "n400_child_support_current", "field": F("P12_6c[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "n400_child_support_current", "field": F("P12_6c[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },    "p2_key_info": {
        "question": "Key N-400 information",
        "fields": [
            {"fact": "n400_pr_date", "field": F("P2_Line9_DateBecamePermanentResident[0]"), "kind": "text"},
            {"fact": "sex_male", "field": F("P2_Line7_Gender[0]"), "kind": "checkbox", "expected": "male"},
            {"fact": "sex_female", "field": F("P2_Line7_Gender[1]"), "kind": "checkbox", "expected": "female"},
            {"fact": "n400_name_change_yes", "field": F("P2_Line34_NameChange[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "n400_name_change_no", "field": F("P2_Line34_NameChange[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },
    "part1_eligibility": {
        "question": "What is your eligibility basis for naturalization?",
        "fields": [
            {"fact": "n400_elig_vawa", "field": F("Part1_Eligibility[0]"), "kind": "checkbox", "expected": "vawa"},
            {"fact": "n400_elig_spouse", "field": F("Part1_Eligibility[1]"), "kind": "checkbox", "expected": "spouse"},
            {"fact": "n400_elig_general", "field": F("Part1_Eligibility[2]"), "kind": "checkbox", "expected": "general"},
            {"fact": "n400_elig_military", "field": F("Part1_Eligibility[3]"), "kind": "checkbox", "expected": "military"},
            {"fact": "n400_elig_military1yr", "field": F("Part1_Eligibility[4]"), "kind": "checkbox", "expected": "military1yr"},
            {"fact": "n400_elig_other", "field": F("Part1_Eligibility[5]"), "kind": "checkbox", "expected": "other"},
            {"fact": "n400_elig_spouse2", "field": F("Part1_Eligibility[6]"), "kind": "checkbox", "expected": "spouse"},
        ],
    },
    "p7_race_detail": {
        "question": "What is your race? (Select all that apply)",
        "fields": [
            {"fact": "bio_race_white", "field": F("P7_Line2_Race[0]"), "kind": "checkbox", "expected": "white"},
            {"fact": "bio_race_asian", "field": F("P7_Line2_Race[1]"), "kind": "checkbox", "expected": "asian"},
            {"fact": "bio_race_black", "field": F("P7_Line2_Race[2]"), "kind": "checkbox", "expected": "black"},
            {"fact": "bio_race_indian", "field": F("P7_Line2_Race[3]"), "kind": "checkbox", "expected": "indian"},
            {"fact": "bio_race_hawaiian", "field": F("P7_Line2_Race[4]"), "kind": "checkbox", "expected": "hawaiian"},
        ],
    },
}

# P9 Travel: repeating group (48 fields) - uses trip_list from Tier 1
# P11 Children: repeating group (28 fields) - uses children_list from Tier 1
# P10 Marriage: marital history (20 fields)

def get_n400_mappings():
    mappings = []
    for gid, g in N400_QUESTION_GROUPS.items():
        for f in g["fields"]:
            if f["field"]:  # Only if field resolved
                mappings.append({"group": gid, **f})
    return mappings

if __name__ == "__main__":
    m = get_n400_mappings()
    print(f"N-400: {len(N400_QUESTION_GROUPS)} groups, {len(m)} mappings")
