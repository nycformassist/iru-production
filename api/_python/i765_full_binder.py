"""
I765 comprehensive binder: uses generated mappings from I-130 intelligence.
"""
import json
import os
import sys
# bundled: _python is on sys.path via api/ directory
from _python.binder import bind

_gen = json.load(open(os.path.join(os.path.dirname(__file__), 'i765_generated.json')))
_fields = json.load(open(os.path.join(os.path.dirname(__file__), 'i765_fields.json')))
# First occurrence wins: the real form field precedes its Part 6
# (Additional Information, p.7) duplicate of the same short name.
_name_map = {}
for f in _fields:
    _name_map.setdefault(f['short'], f['name'])

def _semantic_to_fact(semantic):
    mapping = {
        'family_name': 'family_name',
        'given_name': 'given_name',
        'middle_name': 'middle_name',
        'date_of_birth': 'date_of_birth',
        'a_number': 'a_number',
        'street': 'current_street',
        'city': 'current_city',
        'state': 'current_state',
        'zip': 'current_zip',
        'postal_code': 'current_postal',
        'province': 'current_province',
        'country': 'current_country',
        'unit': 'current_unit',
        'in_care_of': 'current_care_of',
    }
    # Form-specific prefixes
    if 'i765' == 'i765':
        if semantic == 'a_number': return 'i765_a_number'
        if semantic == 'date_of_birth': return 'i765_dob'
    return mapping.get(semantic, semantic)

def _raw_value(facts, fid):
    """Raw answer for a fact id, whether the fact is a raw string (test)
    or a fact-object dict {value, confidence, status} (UI fact record)."""
    v = facts.get(fid)
    if isinstance(v, dict):
        return v.get("value")
    return v


def _split_full_name(full_name):
    """Best-effort split of a full legal name into (given, family).
    Last whitespace-separated token is the family name; the rest is the
    given name. Single token -> family name only. The split is flagged
    for applicant review in the review queue; it never invents a
    middle name."""
    tokens = (full_name or "").strip().split()
    if not tokens:
        return ("", "")
    if len(tokens) == 1:
        return ("", tokens[0])
    return (" ".join(tokens[:-1]), tokens[-1])


def build_i765_full_plan(facts, addresses=None, biographic=None):
    # Work on a copy so derived facts never mutate the caller's record.
    facts = dict(facts or {})
    # i765_full_name (one UI answer) feeds the family/given name fields
    # the PDF actually has. Derive them only when not already provided.
    _full = _raw_value(facts, "i765_full_name")
    _name_split = False
    if _full and not _raw_value(facts, "family_name") and not _raw_value(facts, "given_name"):
        _given, _family = _split_full_name(str(_full))
        if _family:
            facts["family_name"] = _family
        if _given:
            facts["given_name"] = _given
        _name_split = True
    registry = {}
    for m in _gen['address'] + _gen['identity']:
        fact_id = _semantic_to_fact(m['semantic'])
        key = f"gen_{m['field']}"
        if key in registry:
            continue  # first occurrence wins: real field over Part 6 duplicate
        registry[key] = {
            "fact": fact_id,
            "field": m['full_name'],
            "kind": "checkbox" if m['type'] == 'CheckBox' else "text",
            "required": False,
            "generated": True,
        }

    # Add form-specific detailed mappings
    try:
        detailed = json.load(open(os.path.join(os.path.dirname(__file__), 'i765_detailed_registry.json')))
        for fact_id, short in detailed.items():
            if isinstance(short, str) and short in _name_map:
                # Avoid duplicates
                key = f"detailed_{fact_id}"
                if key not in registry:
                    registry[key] = {
                        "fact": fact_id,
                        "field": _name_map[short],
                        "kind": "text",
                        "required": False,
                    }
    except FileNotFoundError:
        pass

    plan, review = [], []
    if _name_split:
        review.append({"fact": "i765_full_name", "reason": "name-split",
                       "detail": "Full name split into given/family names for the form; verify the split is correct."})
    for reg_id, spec in registry.items():
        fact_value = facts.get(spec["fact"])
        if not fact_value or spec["kind"] != "text":
            continue
        # fact_value may be a raw string (from test) or a dict with value/confidence/status (from UI)
        # Normalize to the dict structure that bind() expects
        if isinstance(fact_value, dict) and "value" in fact_value:
            fact = fact_value
        else:
            fact = {"value": fact_value, "confidence": 1.0, "status": "ok"}
        single = {spec["fact"]: {"kind": "text", "field": spec["field"], "required": False}}
        p, r = bind(single, {spec["fact"]: fact})
        plan.extend(p)
        review.extend(r)
    # Filing type -> Part 1 checkboxes. Verified against the printed
    # labels (not y-order): 1.a Initial = [0], 1.b Replacement = [1],
    # 1.c Renewal = [2]. The y-order alone would swap Renewal/ Replacement.
    _filing = str(_raw_value(facts, "i765_filing_type") or "").strip().lower()
    _filing_map = {
        "initial": "form1[0].Page1[0].Part1_Checkbox[0]",
        "replacement": "form1[0].Page1[0].Part1_Checkbox[1]",
        "renewal": "form1[0].Page1[0].Part1_Checkbox[2]",
    }
    if _filing in _filing_map:
        plan.append((_filing_map[_filing], True, "checkbox", "i765_filing_type"))
    # Deduplicate by field name (generated + detailed may overlap)
    seen = set()
    deduped_plan = []
    for f, v, k, fid in plan:
        if f not in seen:
            seen.add(f)
            deduped_plan.append((f, v, k, fid))
    return deduped_plan, review
