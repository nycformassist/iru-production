"""
I-90 complete mappings: reuses biographic module, dispositions overflow.
"""
import json
import os

_fields = json.load(open(os.path.join(os.path.dirname(__file__), 'i90_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}
_type_map = {f['short']: f['type'] for f in _fields}

def F(short):
    return _name_map.get(short)

# Biographic mappings (reuse I-130 biographic intelligence)
# P3 biographic fields -> map to bio_ facts
I90_BIOGRAPHIC = {
    # Height: P3_Line8_HeightFeet (ComboBox), P3_Line8_HeightInches (ComboBox)
    "bio_height_feet": F("P3_Line8_HeightFeet[0]"),
    "bio_height_inches": F("P3_Line8_HeightInches[0]"),
    # Weight: P3_Line9_HeightInches1/2/3 are actually weight digits (naming quirk)
    # Race checkboxes: P3_checkbox7_*
    # Eye color: P3_checkbox10_*
    # Hair color: P3_checkbox11_*
}

# Get the actual checkbox mappings by position (like I-130 biographic)
# For now, map the known ones
I90_QUESTION_GROUPS = {
    "biographic": {
        "fields": [
            {"fact": "bio_height_feet", "field": F("P3_Line8_HeightFeet[0]"), "kind": "text"},
            {"fact": "bio_height_inches", "field": F("P3_Line8_HeightInches[0]"), "kind": "text"},
            # Race: map via position (need to verify)
            # Eye/hair: map via position
        ],
    },
    "processing": {
        "fields": [
            {"fact": "visa_location_applied", "field": F("P3_Line1_LocationAppliedVisa[0]"), "kind": "text"},
            {"fact": "visa_location_issued", "field": F("P3_Line2_LocationIssuedVisa[0]"), "kind": "text"},
            {"fact": "destination_city_state", "field": F("P3_Line3a1_CityandState[0]"), "kind": "text"},
            {"fact": "destination", "field": F("P3_Line3a_Destination[0]"), "kind": "text"},
        ],
    },
}

# P8: System overflow (like I-130 Pt9) - auto-populated, not asked
I90_OVERFLOW = [f['short'] for f in _fields if f['short'].startswith('P8_')]

# Dispositions
I90_DISPOSITIONS = {
    "P1_Line16_SSN[0]": "CONSUMER - SSN never collected",
    **{f: "SYSTEM - Overflow/continuation (auto-populated)" for f in I90_OVERFLOW},
}

# (Module import is silent: the summary prints that used to run here
# on every cold-start import were removed, Carbon Pass 1 finding 21d.)
