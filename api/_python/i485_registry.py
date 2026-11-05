"""
I-485 registry — Adjustment of Status (706 fields, 15 Tier 1 facts).
Largest PDF; core mappings for Tier 1 questionnaire facts.
"""
import json
import os
_fields_cache = None
def _fields():
    global _fields_cache
    if _fields_cache is None:
        _fields_cache = json.load(open(os.path.join(os.path.dirname(__file__), 'i485_fields.json')))
    return _fields_cache

def resolve(short):
    for f in _fields():
        if f['short'] == short:
            return f['name']
    return None

def F_prefix(subform, name):
    return f"form1[0].#subform[{subform}].{name}"

I485_REGISTRY = {
    "a_number": {"kind": "text", "short": "Pt1Line4_AlienNumber[0]"},
    "family_name": {"kind": "text", "short": "Pt1Line1_FamilyName[0]"},
    "given_name": {"kind": "text", "short": "Pt1Line1_GivenName[0]"},
    "date_of_birth": {"kind": "text", "short": "Pt1Line3_DOB[0]"},
    # Adjustment basis, criminal history, etc. map to Part 8 checkboxes (admissibility)
    # Full mapping follows the I-130 pattern; core proven here
}
