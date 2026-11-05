"""
I-90 registry — Green Card Renewal (188 fields, 9 Tier 1 questions).
Field naming: P1_Line*, P2_checkbox*, etc. (different convention from I-130).
"""
def F(name):
    # I-90 uses simpler names; find full name by short
    return name  # resolved at fill time via short-name lookup

I90_REGISTRY = {
    "a_number": {"kind": "text", "short": "P1_Line1_AlienNumber[0]"},
    "family_name": {"kind": "text", "short": "P1_Line3a_FamilyName[0]"},
    "given_name": {"kind": "text", "short": "P1_Line3b_GivenName[0]"},
    "date_of_birth": {"kind": "text", "short": "P1_Line9_DateOfBirth[0]"},
    # Filing reason 2a-2h -> checkboxes (indices by y-position order)
    # y=121[5]=2.a, y=139[6]=2.b, y=157[7]=2.c, y=175[4]=2.d,
    # y=229[0]=2.e, y=259[1]=2.f, y=289[2]=2.g, y=346[3]=2.h
    "i90_filing_reason": {
        "kind": "checkbox_group",
        "mapping": {
            "2a": "P2_checkbox2[5]", "2b": "P2_checkbox2[6]",
            "2c": "P2_checkbox2[7]", "2d": "P2_checkbox2[4]",
            "2e": "P2_checkbox2[0]", "2f": "P2_checkbox2[1]",
            "2g": "P2_checkbox2[2]", "2h": "P2_checkbox2[3]",
        }},
    # i90_card_expiry_date: logic-only (no form field; used for readiness assessment)
}

def resolve_short(fields_json_path, short):
    """Resolve short name to full PyMuPDF field name."""
    import json
    fields = json.load(open(fields_json_path))
    for f in fields:
        if f["short"] == short:
            return f["name"]
    return None
