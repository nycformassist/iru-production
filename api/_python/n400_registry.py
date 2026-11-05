"""
N-400 registry — Naturalization (426 fields, 27 Tier 1 facts).
Maps Tier 1 questionnaire facts to primary form fields.
"""
import json
import os

_fields_cache = None
def _fields():
    global _fields_cache
    if _fields_cache is None:
        _fields_cache = json.load(open(os.path.join(os.path.dirname(__file__), 'n400_fields.json')))
    return _fields_cache

def resolve(short):
    for f in _fields():
        if f['short'] == short:
            return f['name']
    return None

# Core mappings: Tier 1 fact -> primary N-400 field(s)
N400_REGISTRY = {
    "a_number": {"kind": "text", "short": "Line1_AlienNumber[0]"},
    "family_name": {"kind": "text", "short": "P2_Line1_FamilyName[0]"},
    "given_name": {"kind": "text", "short": "P2_Line1_GivenName[0]"},
    "date_of_birth": {"kind": "text", "short": "P2_Line8_DateOfBirth[0]"},
    "email": {"kind": "text", "short": "P12_Line5_Email[0]"},
    "phone": {"kind": "text", "short": "P12_Line3_Telephone[0]"},
    # Eligibility (Part 1): maps to reason checkboxes
    # n400_is_lpr + n400_married_to_usc determine the path
}

def find_fields(pattern):
    """Find fields by substring pattern."""
    return [(f['page'], f['short'], f['type']) for f in _fields() if pattern.lower() in f['short'].lower()]
