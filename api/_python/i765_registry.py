"""
I-765 registry — Employment Authorization (154 fields, 11 Tier 1 facts).
Note: D-1 — eligibility category is applicant-selected, never inferred.
"""
import json
import os
_fields_cache = None
def _fields():
    global _fields_cache
    if _fields_cache is None:
        _fields_cache = json.load(open(os.path.join(os.path.dirname(__file__), 'i765_fields.json')))
    return _fields_cache

def resolve(short):
    for f in _fields():
        if f['short'] == short:
            return f['name']
    return None

I765_REGISTRY = {
    "i765_a_number": {"kind": "text", "short": "Line7_AlienNumber[0]"},
    "i765_dob": {"kind": "text", "short": "Line19_DOB[0]"},
    "i765_i94": {"kind": "text", "short": "Line20a_I94Number[0]"},
    # i765_full_name: needs parsing into family/given
    # i765_category: D-1, applicant selects; maps to Item 27 checkboxes
    # i765_filing_type: initial/renewal/replacement -> Part 1 checkboxes
}
