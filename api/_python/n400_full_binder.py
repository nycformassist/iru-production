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
    # Item I — factId alias: the spouse-citizen question's factId was
    # renamed from n400_spouse_is_usc to spouse_citizen (Carbon Pass 2,
    # commit 344d697). Saved / in-flight factRecords still carry the
    # old key, so accept BOTH: the old key resolves only when the new
    # key is absent. The new key is never removed. Work on a copy so
    # the caller's dict is not mutated.
    facts = dict(facts or {})
    if "spouse_citizen" not in facts and "n400_spouse_is_usc" in facts:
        facts["spouse_citizen"] = facts["n400_spouse_is_usc"]
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
            # Polarity (M-8 class): 13/14 radio pairs are Y/N-reversed
            # in the JSON vs the template (verified with PyMuPDF:
            # yes_field on_state 'N', no_field on_state 'Y'), and this
            # loop never applied _polarity() — a "yes" checked the No
            # box. Resolve per pair like the GMC/P9 loops do. Pairs
            # with non-Y/N on_states (e.g. gender M/F) are untouched:
            # _polarity() swaps only on an exact Y/N reversal.
            yf, nf = _polarity(pair.get("yes_field"), pair.get("no_field"))
            yes_vals = [v.lower() for v in pair.get("yes_values", ["yes", "y", "true", "1"])]
            no_vals = [v.lower() for v in pair.get("no_values", ["no", "n", "false", "0"])]
            if val in yes_vals:
                plan.append((yf, True, "checkbox", fid))
            elif val in no_vals:
                plan.append((nf, True, "checkbox", fid))
    except Exception as _e:
        print("[n400_full_binder] " + _e.__class__.__name__ + " in n400 radio pairs: " + str(_e), file=sys.stderr)


    # Item A — biographic facts (Part 7): height / weight / eye color /
    # hair color / race were collected by the questionnaire but never
    # mapped, and flagged nothing. Uses the shared bind() kinds:
    # "height" splits one answer ("5'8\"") across the feet/inches
    # comboboxes; "weight_digits" splits pounds across the three
    # 1-digit boxes ("165" -> "1","6","5"; "65" -> "0","6","5", same
    # as the I-90 binder); "checkbox_group" / "checkbox_multi" check
    # the matching box. Checkbox order was verified against the
    # printed labels next to each widget in public/forms/n-400.pdf
    # (rect proximity + on_state codes: eye BRO/BLU/GRN/HAZ/GRY/BLK/
    # PNK/MAR/XXX, hair BAL/SDY/RED/WHI/GRY/BLN/BRO/BLK/XXX, race
    # I/A/B/A/W). A collected biographic fact with no mapping (unknown
    # value, unparseable height/weight, conflict, low confidence) goes
    # to review via bind() instead of being silently dropped. Facts
    # may also arrive via the biographic= argument; facts win.
    _bio = {}
    for _k in ("n400_height", "n400_weight", "n400_eye_color",
               "n400_hair_color", "race"):
        _v = facts.get(_k)
        if _v is None and biographic:
            _v = biographic.get(_k)
        if _v is None:
            continue
        if isinstance(_v, dict) and "value" in _v:
            _bv = _v.get("value")
            _bd = dict(_v)
        else:
            _bv, _bd = _v, {"value": _v, "confidence": 1.0, "status": "ok"}
        # Checkbox values compare exactly in bind(); normalize case.
        if _k in ("n400_eye_color", "n400_hair_color", "race"):
            if isinstance(_bv, str):
                _bd["value"] = _bv.strip().lower()
            elif isinstance(_bv, list):
                _bd["value"] = [str(x).strip().lower() for x in _bv]
        _bio[_k] = _bd
    if _bio:
        _bio_registry = {
            "n400_height": {"kind": "height", "fields": [
                _name_map["P7_Line3_HeightFeet[0]"],
                _name_map["P7_Line3_HeightInches[0]"],
            ], "required": False},
            "n400_weight": {"kind": "weight_digits", "fields": [
                _name_map["P7_Line4_Pounds1[0]"],
                _name_map["P7_Line4_Pounds2[0]"],
                _name_map["P7_Line4_Pounds3[0]"],
            ], "required": False},
            "n400_eye_color": {"kind": "checkbox_group", "mapping": {
                "black": _name_map["P7_Line5_Eye[5]"],
                "blue": _name_map["P7_Line5_Eye[1]"],
                "brown": _name_map["P7_Line5_Eye[0]"],
                "gray": _name_map["P7_Line5_Eye[4]"],
                "green": _name_map["P7_Line5_Eye[2]"],
                "hazel": _name_map["P7_Line5_Eye[3]"],
                "other": _name_map["P7_Line5_Eye[8]"],
            }, "required": False},
            "n400_hair_color": {"kind": "checkbox_group", "mapping": {
                "black": _name_map["P7_Line6_Hair[7]"],
                "blond": _name_map["P7_Line6_Hair[5]"],
                "brown": _name_map["P7_Line6_Hair[6]"],
                "gray": _name_map["P7_Line6_Hair[4]"],
                "red": _name_map["P7_Line6_Hair[2]"],
                "white": _name_map["P7_Line6_Hair[3]"],
                "bald": _name_map["P7_Line6_Hair[0]"],
                "other": _name_map["P7_Line6_Hair[8]"],
            }, "required": False},
            "race": {"kind": "checkbox_multi", "mapping": {
                "white": _name_map["P7_Line2_Race[4]"],
                "black": _name_map["P7_Line2_Race[2]"],
                "asian": _name_map["P7_Line2_Race[1]"],
                "native": _name_map["P7_Line2_Race[0]"],
                "pacific": _name_map["P7_Line2_Race[3]"],
            }, "required": False},
        }
        _bp, _br = bind(_bio_registry, _bio)
        plan.extend(_bp)
        review.extend(_br)

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
