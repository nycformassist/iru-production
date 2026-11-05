"""
N-400 pattern-based mappings for remaining 305 fields.
Follows I-130's detail_mapper.py pattern.
"""
import json
import os, re
from collections import defaultdict

_fields = json.load(open(os.path.join(os.path.dirname(__file__), 'n400_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}

def F(short):
    return _name_map.get(short)

# P12 GMC yes/no pairs: map to Tier 1 facts
# The 30 pairs correspond to GMC questions; map sequentially to known facts
GMC_FACT_ORDER = [
    "n400_ever_arrested",      # P12_6a
    "n400_taxes_filed",        # P12_6b
    "n400_child_support_current",  # P12_6c
    # Additional GMC facts from Tier 1...
    "n400_claimed_usc",        # Have you ever claimed to be a US citizen?
    "n400_voted",              # Have you ever voted?
    "n400_failed_selective",   # Did you fail to register for Selective Service?
    "n400_deserted",           # Have you ever deserted?
    "n400_deported",           # Have you ever been deported?
    # ... etc. (Tier 1 has the full list)
]

def build_gmc_mappings():
    """Build mappings for P12 yes/no pairs."""
    mappings = []
    # Find all P12_* base names with [0]/[1] pairs
    pairs = defaultdict(list)
    for f in _fields:
        m = re.match(r'(P12_\w+)\[(\d+)\]', f['short'])
        if m:
            pairs[m.group(1)].append((m.group(2), f['short']))

    # Map pairs to facts (in order)
    fact_idx = 0
    for base in sorted(pairs.keys()):
        indices = pairs[base]
        if len(indices) == 2:  # Yes/no pair
            # Sort by index: [0]=Yes, [1]=No (typical)
            indices.sort()
            if fact_idx < len(GMC_FACT_ORDER):
                fact = GMC_FACT_ORDER[fact_idx]
                mappings.append({
                    "fact": fact,
                    "field": F(f"{base}[{indices[0][0]}]"),
                    "kind": "checkbox",
                    "expected": "yes",
                    "group": "gmc",
                })
                mappings.append({
                    "fact": fact,
                    "field": F(f"{base}[{indices[1][0]}]"),
                    "kind": "checkbox",
                    "expected": "no",
                    "group": "gmc",
                })
                fact_idx += 1

    return mappings

def build_biographic_mappings():
    """P7 biographic fields - reuse I-130 pattern."""
    mappings = []
    # P7_Line1_Ethnicity[0]/[1]: Hispanic / Not Hispanic
    mappings.append({
        "fact": "bio_ethnicity", "field": F("P7_Line1_Ethnicity[0]"),
        "kind": "checkbox", "expected": "hispanic", "group": "biographic",
    })
    mappings.append({
        "fact": "bio_ethnicity", "field": F("P7_Line1_Ethnicity[1]"),
        "kind": "checkbox", "expected": "not_hispanic", "group": "biographic",
    })
    # Height/Weight
    mappings.append({
        "fact": "bio_height_feet", "field": F("P7_Line3_HeightFeet[0]"),
        "kind": "text", "group": "biographic",
    })
    mappings.append({
        "fact": "bio_height_inches", "field": F("P7_Line3_HeightInches[0]"),
        "kind": "text", "group": "biographic",
    })
    # Race checkboxes P7_Line2_Race[0-4]: map by position (like I-130)
    # White[?], Black[?], Asian[?], etc. - need position mapping
    # For now, map the known ones
    return mappings

if __name__ == "__main__":
    gmc = build_gmc_mappings()
    bio = build_biographic_mappings()
    print(f"N-400 patterns: {len(gmc)} GMC + {len(bio)} biographic = {len(gmc)+len(bio)} mappings")
