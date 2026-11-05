"""
I-765 question groups: following I-130's 69-group pattern.
Maps Tier 1 facts + new questions to PDF fields.
"""
import json
import os

_fields = json.load(open(os.path.join(os.path.dirname(__file__), 'i765_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}

def F(short):
    """Resolve short name to full field name."""
    return _name_map.get(short, short)

# Question groups: each maps facts to fields
I765_QUESTION_GROUPS = {
    # Group 1: Filing type (Part 1) - from Tier 1
    "filing_type": {
        "question": "Is this an initial, renewal, or replacement application?",
        "fact": "i765_filing_type",
        "fields": [
            {"fact": "i765_filing_type", "field": F("Part1_Checkbox[0]"),
             "kind": "checkbox", "expected": "initial"},
            {"fact": "i765_filing_type", "field": F("Part1_Checkbox[1]"),
             "kind": "checkbox", "expected": "renewal"},
            {"fact": "i765_filing_type", "field": F("Part1_Checkbox[2]"),
             "kind": "checkbox", "expected": "replacement"},
        ],
    },
    # Group 2: Eligibility category (D-1: applicant-selected, never inferred)
    "eligibility_category": {
        "question": "What is your eligibility category? (Select from official list)",
        "fact": "i765_category",
        "note": "D-1: IRU does not determine, recommend, or default the category.",
        "fields": [
            # Category maps to Item 27 field - applicant writes the code
            {"fact": "i765_category", "field": F("Line27a_Degree[0]"),
             "kind": "text", "note": "Category code entered by applicant"},
        ],
    },
    # Group 3: Immigration history (entry, status, documents)
    "immigration_history": {
        "question": "Immigration history details",
        "fields": [
            {"fact": "i765_last_entry", "field": F("Line21_DateOfLastEntry[0]"), "kind": "text"},
            {"fact": "i765_status", "field": F("Line23_StatusLastEntry[0]"), "kind": "text"},
            {"fact": "i765_current_status", "field": F("Line24_CurrentStatus[0]"), "kind": "text"},
            {"fact": "i765_passport", "field": F("Line20b_Passport[0]"), "kind": "text"},
            {"fact": "i765_travel_doc", "field": F("Line20c_TravelDoc[0]"), "kind": "text"},
            {"fact": "i765_passport_expiry", "field": F("Line20e_ExpDate[0]"), "kind": "text"},
        ],
    },
    # Group 4: SEVIS and E-Verify (conditional)
    "sevis_everify": {
        "question": "SEVIS number and E-Verify (if applicable)",
        "conditional": "Applies to certain categories (e.g., STEM OPT)",
        "fields": [
            {"fact": "i765_sevis", "field": F("Line26_SEVISnumber[0]"), "kind": "text"},
            {"fact": "i765_everify", "field": F("Line27b_Everify[0]"), "kind": "text"},
            {"fact": "i765_everify_id", "field": F("Line27c_EverifyIDNumber[0]"), "kind": "text"},
        ],
    },
    # Group 5: Receipt numbers (renewal/replacement)
    "receipt_numbers": {
        "question": "Prior receipt numbers (if renewing or replacing)",
        "conditional": "Only if filing_type is renewal or replacement",
        "fields": [
            {"fact": "i765_prior_receipt", "field": F("Line28_ReceiptNumber[0]"), "kind": "text"},
            {"fact": "i765_receipt_30a", "field": F("Line30a_ReceiptNumber[0]"), "kind": "text"},
        ],
    },
    # Group 6: USCIS account
    "uscis_account": {
        "question": "USCIS online account number",
        "fields": [
            {"fact": "i765_uscis_account", "field": F("Line8_ElisAccountNumber[0]"), "kind": "text"},
            {"fact": "i765_uscis_account_2", "field": F("USCISELISAcctNumber[0]"), "kind": "text"},
        ],
    },

    # Group 7: Sex (Line 9)
    "sex": {
        "question": "What is your sex?",
        "fields": [
            {"fact": "sex_male", "field": F("Line9_Checkbox[0]"), "kind": "checkbox", "expected": "male"},
            {"fact": "sex_female", "field": F("Line9_Checkbox[1]"), "kind": "checkbox", "expected": "female"},
        ],
    },
    # Group 8: Marital status (Line 10)
    "marital_status": {
        "question": "What is your marital status?",
        "fields": [
            {"fact": "marital_single", "field": F("Line10_Checkbox[0]"), "kind": "checkbox", "expected": "single"},
            {"fact": "marital_married", "field": F("Line10_Checkbox[1]"), "kind": "checkbox", "expected": "married"},
            {"fact": "marital_divorced", "field": F("Line10_Checkbox[2]"), "kind": "checkbox", "expected": "divorced"},
            {"fact": "marital_widowed", "field": F("Line10_Checkbox[3]"), "kind": "checkbox", "expected": "widowed"},
        ],
    },
    # Group 9: Previously filed I-765 (Line 19)
    "previously_filed": {
        "question": "Have you previously filed Form I-765?",
        "fields": [
            {"fact": "i765_previously_filed", "field": F("Line19_Checkbox[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "i765_previously_filed", "field": F("Line19_Checkbox[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },
    # Group 10: Mailing same as physical (Part 2 Line 5)
    "mailing_same": {
        "question": "Is your mailing address the same as your physical address?",
        "fields": [
            {"fact": "mailing_same", "field": F("Part2Line5_Checkbox[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "mailing_same", "field": F("Part2Line5_Checkbox[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },

    # Group 11: Arrest/conviction for (c)(26) (Item 29)
    "arrest_c26": {
        "question": "Have you EVER been arrested for and/or convicted of any crime? (For (c)(26) eligibility)",
        "fields": [
            {"fact": "i765_arrest_c26", "field": F("PtLine29_YesNo[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "i765_arrest_c26", "field": F("PtLine29_YesNo[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },
    # Group 12: Arrest/conviction for (c)(35)/(c)(36) (Item 31.b)
    "arrest_c35": {
        "question": "Have you EVER been arrested for and/or convicted of any crime? (For (c)(35)/(c)(36) eligibility)",
        "fields": [
            {"fact": "i765_arrest_c35", "field": F("PtLine30b_YesNo[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "i765_arrest_c35", "field": F("PtLine30b_YesNo[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },
}

# Dispositions for fields that are NOT mapped
I765_DISPOSITIONS = {
    "Line12b_SSN[0]": "CONSUMER - SSN never collected (D-2)",
    "Part4_NameofLanguage[0]": "CONSUMER - Interpreter certification",
    # Checkboxes that are part of groups above
}

def get_i765_mappings():
    """Return all I-765 field mappings as a flat list."""
    mappings = []
    for group_id, group in I765_QUESTION_GROUPS.items():
        for f in group["fields"]:
            mappings.append({
                "group": group_id,
                "fact": f["fact"],
                "field": f["field"],
                "kind": f["kind"],
                "expected": f.get("expected"),
            })
    return mappings

if __name__ == "__main__":
    mappings = get_i765_mappings()
    print(f"I-765 question groups: {len(I765_QUESTION_GROUPS)}")
    print(f"Total field mappings: {len(mappings)}")
    for g_id, g in I765_QUESTION_GROUPS.items():
        print(f"  {g_id}: {len(g['fields'])} fields")
