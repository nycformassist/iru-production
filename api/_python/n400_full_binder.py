"""
N400 comprehensive binder: uses generated mappings from I-130 intelligence.
"""
import json
import os
import sys
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from binder import bind

_gen = json.load(open(os.path.join(_HERE, 'n400_generated.json')))
_fields = json.load(open(os.path.join(_HERE, 'n400_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}

# ── Checkbox polarity (Carbon Pass 2, M-8) ──
# n400_gmc_pairs.json / n400_p9_pairs.json assume fields[0] = Yes,
# but the N-400 PDF reverses [0]/[1] on most pairs — verified with
# PyMuPDF against the template: GMC 18/30 reversed, P9 16/22
# reversed (the I-589 binder documents the same reversal class,
# i589_full_binder.py:16). The widget's on_state() is ground truth
# ('Y' = Yes box, 'N' = No box — confirmed against the printed
# Yes/No labels by rect proximity). Each pair is resolved against
# the template PDF; on any read failure the JSON order is kept.
_N400_TEMPLATE = os.path.join(_HERE, "..", "..", "public", "forms", "n-400.pdf")
_on_state_cache = None
def _n400_on_states():
    global _on_state_cache
    if _on_state_cache is None:
        _on_state_cache = {}
        try:
            import fitz
            _doc = fitz.open(_N400_TEMPLATE)
            for _pg in _doc:
                for _w in _pg.widgets():
                    _on_state_cache[_w.field_name] = _w.on_state()
            _doc.close()
        except Exception:
            _on_state_cache = {}
    return _on_state_cache

def _polarity(yes_field, no_field):
    """Return (yes_field, no_field) corrected against the PDF.
    Swaps only on an exact Y/N reversal; otherwise keeps JSON order."""
    states = _n400_on_states()
    if not states:
        return yes_field, no_field
    if states.get(yes_field) == "N" and states.get(no_field) == "Y":
        return no_field, yes_field
    return yes_field, no_field

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
    # Form-specific prefixes (none: the dead "if 'n400' == 'i765':"
    # branch below could never be true and was removed, finding 23).
    return mapping.get(semantic, semantic)

def build_n400_full_plan(facts, addresses=None, biographic=None):
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

    # Add form-specific detailed mappings
    try:
        detailed = json.load(open(_HERE + '/n400_detailed_registry.json'))
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
        # Normalize to the dict structure that bind() expects
        if isinstance(fact_value, dict) and "value" in fact_value:
            fact = fact_value
        else:
            fact = {"value": fact_value, "confidence": 1.0, "status": "ok"}
        single = {spec["fact"]: {"kind": "text", "field": spec["field"], "required": False}}
        p, r = bind(single, {spec["fact"]: fact})
        plan.extend(p)
        review.extend(r)

    # Yes/No checkbox mappings: GMC (30 pairs) + P9 (22 pairs).
    # Polarity is resolved per pair against the template PDF via
    # _polarity() (module level, Carbon Pass 2 M-8) — see above.
    _base = os.path.dirname(os.path.abspath(__file__))
    def _get_fact_value(fid):
        v = facts.get(fid)
        if isinstance(v, dict):
            return v.get("value", "")
        return v or ""
    try:
        with open(os.path.join(_base, "n400_gmc_pairs.json")) as f:
            gmc_pairs = json.load(f)
        for pair in gmc_pairs:
            fid = pair.get("fact")
            val = str(_get_fact_value(fid)).strip().lower()
            if not val:
                continue
            yf, nf = _polarity(pair.get("yes_field"), pair.get("no_field"))
            if val in ("yes", "y", "true", "1"):
                plan.append((yf, True, "checkbox", fid))
            elif val in ("no", "n", "false", "0"):
                plan.append((nf, True, "checkbox", fid))
    except Exception as _e:
        print("[n400_full_binder] " + _e.__class__.__name__ + " in n400 GMC pairs: " + str(_e), file=sys.stderr)

    try:
        with open(os.path.join(_base, "n400_p9_ui_mapping.json")) as f:
            p9_map = json.load(f)
        with open(os.path.join(_base, "n400_p9_pairs.json")) as f:
            p9_pairs = json.load(f)
        p9_by_base = {p.get("base"): p.get("fields", []) for p in p9_pairs}
        for fid, base in p9_map.items():
            val = str(_get_fact_value(fid)).strip().lower()
            if not val:
                continue
            fields = p9_by_base.get(base, [])
            if len(fields) >= 2:
                # P9 pairs store SHORT names; resolve to full PDF names
                # (a short name never matches a widget in apply_fill).
                full = [_name_map.get(fld, fld) for fld in fields[:2]]
                yf, nf = _polarity(full[0], full[1])
                if val in ("yes", "y", "true", "1"):
                    plan.append((yf, True, "checkbox", fid))
                elif val in ("no", "n", "false", "0"):
                    plan.append((nf, True, "checkbox", fid))
    except Exception as _e:
        print("[n400_full_binder] " + _e.__class__.__name__ + " in n400 Part 9 pairs: " + str(_e), file=sys.stderr)

    # N-400: 14 new radio questions (2026-11-04 expansion) - yes/no checkbox pairs
    try:
        with open(os.path.join(_base, "n400_radio_pairs.json")) as f:
            radio_pairs = json.load(f)
        for pair in radio_pairs:
            fid = pair.get("fact")
            val = str(_get_fact_value(fid)).strip().lower()
            if not val:
                continue
            yf, nf = pair.get("yes_field"), pair.get("no_field")
            yes_vals = [v.lower() for v in pair.get("yes_values", ["yes", "y", "true", "1"])]
            no_vals = [v.lower() for v in pair.get("no_values", ["no", "n", "false", "0"])]
            if val in yes_vals:
                plan.append((yf, True, "checkbox", fid))
            elif val in no_vals:
                plan.append((nf, True, "checkbox", fid))
    except Exception as _e:
        print("[n400_full_binder] " + _e.__class__.__name__ + " in n400 radio pairs: " + str(_e), file=sys.stderr)


    # Deduplicate by field name (generated + detailed may overlap)
    seen = set()
    deduped_plan = []
    for f, v, k, fid in plan:
        if f not in seen:
            seen.add(f)
            deduped_plan.append((f, v, k, fid))
    
    # Handle repeating groups
    try:
        from repeating_binder import get_repeating_groups, bind_repeating_group
        for group_def in get_repeating_groups('n400'):
            entries = facts.get(group_def['id'], {}).get('value', [])
            if entries:
                r_plan, r_review, r_overflow = bind_repeating_group(
                    'n400', group_def, entries, _name_map
                )
                # Add to plan (deduplicate)
                for f, v, k, fid in r_plan:
                    if f not in seen:
                        seen.add(f)
                        deduped_plan.append((f, v, k, fid))
                review.extend(r_review)
    except Exception as _e:
        print("[n400_full_binder] " + _e.__class__.__name__ + " in n400 repeating groups: " + str(_e), file=sys.stderr)
  # Repeating groups optional
    
    return deduped_plan, review
