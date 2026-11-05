"""
I485 comprehensive binder: uses generated mappings from I-130 intelligence.
"""
import json
import sys
sys.path.insert(0, '/home/hatch/workspace/iru-form-engine')
from binder import bind

_gen = json.load(open('/home/hatch/workspace/iru-form-engine/i485_generated.json'))
_fields = json.load(open('/home/hatch/workspace/iru-form-engine/i485_fields.json'))
_name_map = {f['short']: f['name'] for f in _fields}

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
    if 'i485' == 'i765':
        if semantic == 'a_number': return 'i765_a_number'
        if semantic == 'date_of_birth': return 'i765_dob'
    return mapping.get(semantic, semantic)

def build_i485_full_plan(facts, addresses=None, biographic=None):
    registry = {}
    for m in _gen['address'] + _gen['identity']:
        fact_id = _semantic_to_fact(m['semantic'])
        registry[f"gen_{m['field']}"] = {
            "fact": fact_id,
            "field": m['full_name'],
            "kind": "checkbox" if m['type'] == 'CheckBox' else "text",
            "required": False,
            "generated": True,
        }

    # Add form-specific detailed mappings (detailed wins over generated)
    try:
        detailed = json.load(open('/home/hatch/workspace/iru-form-engine/i485_detailed_registry.json'))
        # Collect detailed fields first so we can skip overlapping gen entries
        detailed_fields = set()
        for fact_id, short in detailed.items():
            if isinstance(short, str) and short in _name_map:
                detailed_fields.add(_name_map[short])
        # Remove gen entries whose field is covered by a detailed entry
        for reg_id in list(registry.keys()):
            if registry[reg_id].get("generated") and registry[reg_id]["field"] in detailed_fields:
                del registry[reg_id]
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
    for reg_id, spec in registry.items():
        fact_value = facts.get(spec["fact"])
        if not fact_value or spec["kind"] != "text":
            continue
        # fact_value may be a raw string (from test) or a dict with value/confidence/status (from UI)
        if isinstance(fact_value, dict) and "value" in fact_value:
            fact = fact_value
        else:
            fact = {"value": fact_value, "confidence": 1.0, "status": "ok"}
        single = {spec["fact"]: {"kind": "text", "field": spec["field"], "required": False}}
        p, r = bind(single, {spec["fact"]: fact})
        plan.extend(p)
        review.extend(r)

    # I-485: Yes/No admissibility checkbox pairs (84 pairs, FULL PDF field names)
    try:
        import os as _os
        _pair_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "i485_yesno_pairs.json")
        with open(_pair_path) as _f:
            _yesno_pairs = json.load(_f)

        def _get_yesno_val(_fid):
            _v = facts.get(_fid)
            if isinstance(_v, dict):
                return _v.get("value", "")
            return _v or ""

        for _pair in _yesno_pairs:
            _fid = _pair.get("fact")
            _val = str(_get_yesno_val(_fid)).strip().lower()
            if not _val:
                continue
            _yf, _nf = _pair.get("yes_field"), _pair.get("no_field")
            if not _yf or not _nf:
                continue
            _yes_vals = [str(_v).lower() for _v in _pair.get("yes_values", ["yes", "y", "true", "1"])]
            _no_vals = [str(_v).lower() for _v in _pair.get("no_values", ["no", "n", "false", "0"])]
            if _val in _yes_vals:
                plan.append((_yf, "Yes", "checkbox", _fid))
            elif _val in _no_vals:
                plan.append((_nf, "Yes", "checkbox", _fid))
    except Exception:
        pass

    # I-485: Checkbox groups (marital status, ethnicity, race, eye/hair color, etc.)
    try:
        import os as _os2
        _grp_path = _os2.path.join(_os2.path.dirname(_os2.path.abspath(__file__)), "i485_checkbox_groups.json")
        with open(_grp_path) as _f2:
            _checkbox_groups = json.load(_f2)

        def _get_grp_val(_fid):
            _v = facts.get(_fid)
            if isinstance(_v, dict):
                return _v.get("value", "")
            return _v or ""

        for _grp in _checkbox_groups:
            _fid = _grp.get("fact")
            _val = str(_get_grp_val(_fid)).strip().lower()
            if not _val:
                continue
            _mapping = _grp.get("mapping", {})
            # Try exact match first, then lowercase match
            _field = _mapping.get(_val)
            if not _field:
                for _k, _v2 in _mapping.items():
                    if _k.lower() == _val:
                        _field = _v2
                        break
            if _field:
                plan.append((_field, "Yes", "checkbox", _fid))
    except Exception:
        pass
    # Deduplicate by field name (generated + detailed may overlap)
    seen = set()
    deduped_plan = []
    for f, v, k, fid in plan:
        if f not in seen:
            seen.add(f)
            deduped_plan.append((f, v, k, fid))
    
    # Handle repeating groups (I-485 children)
    try:
        from repeating_binder import get_repeating_groups, bind_repeating_group
        import json as _json
        _fields485 = _json.load(open('/home/hatch/workspace/iru-form-engine/i485_fields.json'))
        _name_map485 = {f['short']: f['name'] for f in _fields485}
        for group_def in get_repeating_groups('i485'):
            entries = facts.get(group_def['id'], {}).get('value', [])
            if entries:
                r_plan, r_review, r_overflow = bind_repeating_group(
                    'i485', group_def, entries, _name_map485
                )
                for f, v, k, fid in r_plan:
                    if f not in seen:
                        seen.add(f)
                        deduped_plan.append((f, v, k, fid))
                review.extend(r_review)
    except Exception:
        pass
    
    return deduped_plan, review
