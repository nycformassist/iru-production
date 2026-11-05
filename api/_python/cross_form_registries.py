"""
Cross-form registries: full Tier 1 fact -> field mappings for all four forms.
Built from baselines + Tier 1 question definitions.
"""
import json

def load_baseline(form):
    return json.load(open(f'/home/hatch/workspace/iru-form-engine/{form}_baseline.json'))

def load_fields(form):
    return json.load(open(f'/home/hatch/workspace/iru-form-engine/{form}_fields.json'))

def build_registry(form, fact_mappings):
    """
    fact_mappings: dict of fact_id -> short field name or list of shorts
    Returns registry dict for the binder.
    """
    fields = load_fields(form)
    name_map = {f['short']: f['name'] for f in fields}
    registry = {}
    for fact_id, shorts in fact_mappings.items():
        if isinstance(shorts, str):
            shorts = [shorts]
        for short in shorts:
            full = name_map.get(short)
            if full:
                # Determine kind from field type
                f = next(x for x in fields if x['short'] == short)
                kind = 'checkbox' if f['type'] == 'CheckBox' else 'text'
                registry[f"{fact_id}__{short}"] = {
                    "fact": fact_id, "field": full, "kind": kind
                }
    return registry

# I-90: 9 Tier 1 facts
I90_FACTS = {
    "a_number": "P1_Line1_AlienNumber[0]",
    "family_name": "P1_Line3a_FamilyName[0]",
    "given_name": "P1_Line3b_GivenName[0]",
    "date_of_birth": "P1_Line9_DateOfBirth[0]",
    # i90_filing_reason handled separately (checkbox group)
    # current_street -> address component
}

# N-400: 27 Tier 1 facts (core + extended)
N400_FACTS = {
    "a_number": "Line1_AlienNumber[0]",
    "family_name": "P2_Line1_FamilyName[0]",
    "given_name": "P2_Line1_GivenName[0]",
    "date_of_birth": "P2_Line8_DateOfBirth[0]",
    "email": "P12_Line5_Email[0]",
    "phone": "P12_Line3_Telephone[0]",
}

# I-765: 11 Tier 1 facts
I765_FACTS = {
    "i765_a_number": "Line7_AlienNumber[0]",
    "i765_dob": "Line19_DOB[0]",
    "i765_i94": "Line20a_I94Number[0]",
}

# I-485: 15 Tier 1 facts
I485_FACTS = {
    "a_number": "Pt1Line4_AlienNumber[0]",
    "family_name": "Pt1Line1_FamilyName[0]",
    "given_name": "Pt1Line1_GivenName[0]",
    "date_of_birth": "Pt1Line3_DOB[0]",
}

if __name__ == "__main__":
    for form, facts in [("i90", I90_FACTS), ("n400", N400_FACTS),
                        ("i765", I765_FACTS), ("i485", I485_FACTS)]:
        reg = build_registry(form, facts)
        print(f"{form.upper()}: {len(reg)} field mappings from {len(facts)} facts")
