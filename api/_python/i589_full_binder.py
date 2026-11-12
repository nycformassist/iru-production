"""
I-589 comprehensive binder (Application for Asylum and for Withholding
of Removal), official edition 07/28/26, 460 AcroForm fields, 12 pages.

Follows the I-765 binder pattern (commit ff0d6d0): normalizes UI fact
objects {value, confidence, status} AND raw strings; splits the full
legal name into family/given; cross-form aliases let I-765 facts feed
I-589 (same fact, different form ID — alias, don't duplicate).

Checkbox order was verified against printed labels by rect proximity,
not index order:
- Every Part B / Part C yes/no pair: [0] = Yes, [1] = No.
- Spouse "Is this person in the U.S.?" (PtAIILine15_CheckBox15):
  [0] = No, [1] = Yes (REVERSED — verified by word proximity).
- Item 18 court proceedings: CheckBox3[0] = 18a never, [1] = 18c not
  now but has been, [2] = 18b now. (Verified by widget-rect proximity
  to the printed options AND by on_state(): [0]=A, [1]=C, [2]=B.
  An earlier version of this binder had [1]/[2] swapped; the 2026-11-12
  fix corrects it — "now" checks [2], "past" checks [1].)
- Marital: [0] Single, [1] Married, [2] Divorced, [3] Widowed.
- Sex checkboxes: [0] Male, [1] Female.

NEVER filled (standing boundaries): Part D signature block and Part E
preparer (consumer-controlled), Part F asylum interview (officer),
EOIR/USCIS use-only fields, PDF417 barcodes, SSN anywhere (excluded
except I-485). The Part B / Part C narrative text fields take the
Premium narrative draft verbatim — the applicant reviews and corrects
every narrative before finalization; nothing is invented here.
"""
import json
import os
import re

# Two homes, two import paths (same rule as the I-765 binder, whose
# two copies diverge on this line): the worktree copy loads as
# _python.i589_full_binder (Vercel), the engine copy as a top-level
# module (local api_server imports from ../iru-form-engine).
try:
    from _python.binder import bind
except ImportError:  # pragma: no cover - engine-copy import path
    from binder import bind

_HERE = os.path.dirname(__file__)
_gen = json.load(open(os.path.join(_HERE, "i589_generated.json")))
_fields = json.load(open(os.path.join(_HERE, "i589_fields.json")))
_detailed = json.load(open(os.path.join(_HERE, "i589_detailed_registry.json")))
# First occurrence wins by short name (same rule as the I-765 binder).
_name_map = {}
for f in _fields:
    _name_map.setdefault(f["short"], f["name"])


def _semantic_to_fact(semantic):
    mapping = {
        "family_name": "family_name",
        "given_name": "given_name",
        "middle_name": "middle_name",
        "date_of_birth": "i589_dob",
        "a_number": "i589_a_number",
        "residence_street": "i589_residence_street",
        "residence_apt": "i589_residence_apt",
        "residence_city": "i589_residence_city",
        "residence_state": "i589_residence_state",
        "residence_zip": "i589_residence_zip",
        "residence_tel_area": "i589_residence_tel_area",
        "residence_tel": "i589_residence_tel",
        "mailing_care_of": "i589_mailing_care_of",
        "mailing_street": "i589_mailing_street",
        "mailing_apt": "i589_mailing_apt",
        "mailing_city": "i589_mailing_city",
        "mailing_state": "i589_mailing_state",
        "mailing_zip": "i589_mailing_zip",
        "mailing_tel_area": "i589_mailing_tel_area",
        "mailing_tel": "i589_mailing_tel",
    }
    return mapping.get(semantic, semantic)


def _raw_value(facts, fid):
    """Raw answer for a fact id, whether the fact is a raw string (test)
    or a fact-object dict {value, confidence, status} (UI fact record)."""
    v = facts.get(fid)
    if isinstance(v, dict):
        return v.get("value")
    return v


# Date facts this binder writes, by fact id (Item G). No other Python
# binder formats dates: the I-130 registries carry a declarative
# "format": "dateMDY" that nothing consumes, and unified_deliverable
# only strftime()s timestamps — so the formatter lives here, local to
# this binder (shared helpers are out of scope for this fix).
_DATE_FACTS = {
    "i589_dob",
    "i589_entry_date", "i589_entry2_date", "i589_entry3_date",
    "i589_entry_status_expires", "i589_passport_expiry",
    "i589_last_left_country_date",
    "i589_spouse_dob", "i589_spouse_marriage_date",
    "i589_spouse_last_entry_date", "i589_spouse_prev_arrival_date",
    "i589_spouse_auth_stay_expiry",
}
# Per-child date keys in i589_children entries (Item G).
_CHILD_DATE_KEYS = {"dob", "entry_date", "auth_exp"}

_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def _format_date_mdy(value):
    """'YYYY-MM-DD' -> 'MM/DD/YYYY', the JS TRANSFORMS.dateMDY
    equivalent (api/_lib/formmap.js). Any value that is not a strict
    ISO date (already MM/DD/YYYY, free text, None) passes through
    unchanged — same as the JS side, no validation, no guessing."""
    if value is None:
        return value
    m = _ISO_DATE_RE.match(str(value).strip())
    if m:
        return "%s/%s/%s" % (m.group(2), m.group(3), m.group(1))
    return str(value)


def _split_full_name(full_name):
    """Best-effort split of a full legal name into (given, family).
    Last whitespace-separated token is the family name; the rest is the
    given name. Single token -> family name only. The split is flagged
    for applicant review; it never invents a middle name."""
    tokens = (full_name or "").strip().split()
    if not tokens:
        return ("", "")
    if len(tokens) == 1:
        return ("", tokens[0])
    return (" ".join(tokens[:-1]), tokens[-1])


# Cross-form aliases: the same fact under an I-765 ID feeds I-589 when
# the I-589 ID is absent. Alias, don't duplicate (Premium plan §4).
_CROSS_FORM = {
    "i589_a_number": "i765_a_number",
    "i589_dob": "i765_dob",
    "i589_i94": "i765_i94",
    "i589_full_name": "i765_full_name",
    "i589_entry_date": "i765_last_entry",
    "i589_entry_status": "i765_status",
}

# Yes/No checkbox pairs: (fact_id, yes_short, no_short). Resolved via
# _name_map at runtime — the XFA prefixes differ by section, so the
# short name is the stable key. [0] = Yes, [1] = No for every Part B /
# Part C pair (verified by rect proximity to the printed Yes/No words).
_YESNO = [
    ("i589_pb_q1a", "ckboxyn1a[0]", "ckboxyn1a[1]"),
    ("i589_pb_q1b", "ckboxyn1b[0]", "ckboxyn1b[1]"),
    ("i589_pb_q2", "ckboxyn2[0]", "ckboxyn2[1]"),
    ("i589_pb_q3a", "ckboxyn3a[0]", "ckboxyn3a[1]"),
    ("i589_pb_q3b", "ckboxyn3b[0]", "ckboxyn3b[1]"),
    ("i589_pb_q4", "ckboxyn4[0]", "ckboxyn4[1]"),
    ("i589_pc_q1", "ckboxync1[0]", "ckboxync1[1]"),
    ("i589_pc_q2a", "ckboxync2a[0]", "ckboxync2a[1]"),
    ("i589_pc_q2b", "ckboxync2b[0]", "ckboxync2b[1]"),
    ("i589_pc_q3", "ckboxync3[0]", "ckboxync3[1]"),
    ("i589_pc_q4", "PCckboxyn4[0]", "PCckboxyn4[1]"),
    ("i589_pc_q5", "ckboxync5[0]", "ckboxync5[1]"),
    ("i589_pc_q6", "ckboxync6[0]", "ckboxync6[1]"),
    ("i589_fluent_english", "CheckBox4[0]", "CheckBox4[1]"),
    ("i589_spouse_in_proceedings", "PtAIILine22_Yes[0]", "PtAIILine22_No[0]"),
    ("i589_spouse_included", "PtAIILine24_Yes[0]", "PtAIILine24_No[0]"),
]

# Per-child field shorts (resolved via _name_map). Children 1-4 are on
# Part A.II (p2-p3); children 5-6 are on Supplement A (p11).
_CHILD_FIELDS = [
    {  # child 1 (p2)
        "alien": "ChildAlien1[0]", "passport": "ChildPassport1[0]",
        "marital": "ChildMarital1[0]", "last": "ChildLast1[0]",
        "first": "ChildFirst1[0]", "middle": "ChildMiddle1[0]",
        "dob": "ChildDOB1[0]", "birth": "ChildCity1[0]",
        "nat": "ChildNat1[0]", "race": "ChildRace1[0]",
        "sex_m": "CheckBox12_Sex[0]", "sex_f": "CheckBox12_Sex[1]",
        "in_us_yes": "CheckBox17[0]", "in_us_no": "CheckBox17[1]",
        "specify": "PtAIILine13_Specify[0]",
        "entry_place": "PtAIILine14_PlaceofLastEntry[0]",
        "entry_date": "PtAIILine15_ExpirationDate[0]",
        "i94": "PtAIILine16_I94Number[0]",
        "status": "PtAIILine17_StatusofLastAdmission[0]",
        "current": "PtAIILine18_CurrentStatusofChild[0]",
        "auth_exp": "PtAIILine19_ExpDateofAuthorizedStay[0]",
        "proc_yes": "PtAIILine20_Yes[0]", "proc_no": "PtAIILine20_No[0]",
        "incl_yes": "PtAIILine21_Yes[0]", "incl_no": "PtAIILine21_No[0]",
    },
    {  # child 2 (p3)
        "alien": "ChildAlien2[0]", "passport": "ChildPassport2[0]",
        "marital": "ChildMarital2[0]", "last": "ChildLast2[0]",
        "first": "ChildFirst2[0]", "middle": "ChildMiddle2[0]",
        "dob": "ChildDOB2[0]", "birth": "ChildCity2[0]",
        "nat": "ChildNat2[0]", "race": "ChildRace2[0]",
        "sex_m": "CheckBox26_Sex[0]", "sex_f": "CheckBox26_Sex[1]",
        "in_us_yes": "CheckBox27[0]", "in_us_no": "CheckBox27[1]",
        "specify": "PtAIILine13_Specify2[0]",
        "entry_place": "PtAIILine14_PlaceofLastEntry2[0]",
        "entry_date": "PtAIILine15_DateofLastEntry2[0]",
        "i94": "PtAIILine16_I94Number2[0]",
        "status": "PtAIILine17_StatusofLastAdmission2[0]",
        "current": "PtAIILine18_ChildCurrentStatus2[0]",
        "auth_exp": "PtAIILine19_ExpDateofAuthorizedStay2[0]",
        "proc_yes": "PtAIILine20_Yes2[0]", "proc_no": "PtAIILine20_No2[0]",
        "incl_yes": "PtAIILine21_Yes2[0]", "incl_no": "PtAIILine21_No2[0]",
    },
    {  # child 3 (p3)
        "alien": "ChildAlien3[0]", "passport": "ChildPassport3[0]",
        "marital": "ChildMarital3[0]", "last": "ChildLast3[0]",
        "first": "ChildFirst3[0]", "middle": "ChildMiddle3[0]",
        "dob": "ChildDOB3[0]", "birth": "ChildCity3[0]",
        "nat": "ChildNat3[0]", "race": "ChildRace3[0]",
        "sex_m": "CheckBox36_Sex[0]", "sex_f": "CheckBox36_Sex[1]",
        "in_us_yes": "CheckBox37[0]", "in_us_no": "CheckBox37[1]",
        "specify": "PtAIILine13_Specify3[0]",
        "entry_place": "PtAIILine14_PlaceofLastEntry3[0]",
        "entry_date": "PtAIILine15_DateofLastEntry3[0]",
        "i94": "PtAIILine16_I94Number3[0]",
        "status": "PtAIILine17_StatusofLastAdmission3[0]",
        "current": "PtAIILine18_ChildCurrentStatus3[0]",
        "auth_exp": "PtAIILine19_ExpDateofAuthorizedStay3[0]",
        "proc_yes": "PtAIILine20_Yes3[0]", "proc_no": "PtAIILine20_No3[0]",
        "incl_yes": "PtAIILine21_Yes3[0]", "incl_no": "PtAIILine21_No3[0]",
    },
    {  # child 4 (p3)
        "alien": "ChildAlien4[0]", "passport": "ChildPassport4[0]",
        "marital": "ChildMarital4[0]", "last": "ChildLast4[0]",
        "first": "ChildFirst4[0]", "middle": "ChildMiddle4[0]",
        "dob": "ChildDOB4[0]", "birth": "ChildCity4[0]",
        "nat": "ChildNat4[0]", "race": "ChildRace4[0]",
        "sex_m": "CheckBox46_Sex[0]", "sex_f": "CheckBox46_Sex[1]",
        "in_us_yes": "CheckBox47[0]", "in_us_no": "CheckBox47[1]",
        "specify": "PtAIILine13_Specify4[0]",
        "entry_place": "PtAIILine14_PlaceofLastEntry4[0]",
        "entry_date": "PtAIILine15_DateofLastEntry4[0]",
        "i94": "PtAIILine16_I94Number4[0]",
        "status": "PtAIILine17_StatusofLastAdmission4[0]",
        "current": "PtAIILine18_ChildCurrentStatus4[0]",
        "auth_exp": "PtAIILine19_ExpDateofAuthorizedStay4[0]",
        "proc_yes": "PtAIILine20_Yes4[0]", "proc_no": "PtAIILine20_No4[0]",
        "incl_yes": "PtAIILine21_Yes4[0]", "incl_no": "PtAIILine21_No4[0]",
    },
    {  # child 5 (Supplement A, p11)
        "alien": "TextField12[6]", "passport": "TextField12[7]",
        "marital": "TextField12[8]", "last": "TextField12[0]",
        "first": "TextField12[2]", "middle": "TextField12[3]",
        "dob": "DateTimeField14[0]", "birth": "TextField12[1]",
        "nat": "TextField12[4]", "race": "TextField12[5]",
        "sex_m": "CheckBox12_Sex[2]", "sex_f": "CheckBox12_Sex[3]",
        "in_us_yes": "CheckBox57[0]", "in_us_no": "CheckBox57[1]",
        "specify": "SuppLALine13_Specify[0]",
        "entry_place": "ChildEntry5[0]", "entry_date": "ChildExp5[0]",
        "i94": "ChildINum5[0]", "status": "ChildStatus5[0]",
        "current": "ChildCurrent5[0]", "auth_exp": "ChildExpAuth5[0]",
        "proc_yes": "SuppA_CheckBox20[0]", "proc_no": "SuppA_CheckBox20[1]",
        "incl_yes": "SuppA_CheckBox21[0]", "incl_no": "SuppA_CheckBox21[1]",
    },
    {  # child 6 (Supplement A, p11)
        "alien": "TextField12[16]", "passport": "TextField12[17]",
        "marital": "TextField12[18]", "last": "TextField12[10]",
        "first": "TextField12[12]", "middle": "TextField12[13]",
        "dob": "DateTimeField14[1]", "birth": "TextField12[11]",
        "nat": "TextField12[14]", "race": "TextField12[15]",
        "sex_m": "SuppAL12_CheckBox[0]", "sex_f": "SuppAL12_CheckBox[1]",
        "in_us_yes": "SuppAL13_CheckBox[0]", "in_us_no": "SuppAL13_CheckBox[1]",
        "specify": "SuppLALine13_Specify2[0]",
        "entry_place": "ChildEntry6[0]", "entry_date": "ChildExp6[0]",
        "i94": "ChildINum6[0]", "status": "ChildStatus6[0]",
        "current": "ChildCurrent6[0]", "auth_exp": "ChildExpAuth6[0]",
        "proc_yes": "SuppALine20_CheckBox2[0]", "proc_no": "SuppALine20_CheckBox2[1]",
        "incl_yes": "SuppALine21_CheckBox[0]", "incl_no": "SuppALine21_CheckBox[1]",
    },
]

# Parents/siblings deceased checkboxes (Part A.III Q5), short names
# resolved via _name_map (the full names carry a section prefix).
_DECEASED = {
    "mother": "m[0]",
    "father": "f[0]",
    "sib1": "s1[0]",
    "sib2": "s2[0]",
    "sib3": "s3[0]",
    "sib4": "s4[0]",
}


def _yes_no_value(v):
    """Normalize a yes/no answer to 'yes' / 'no' / None."""
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("yes", "y", "true", "1"):
        return "yes"
    if s in ("no", "n", "false", "0"):
        return "no"
    return None


def _full(short):
    """Resolve a short field name to its full PDF name (first wins)."""
    return _name_map.get(short)


def build_i589_full_plan(facts, addresses=None, biographic=None):
    facts = dict(facts or {})
    # Cross-form aliases: I-765 facts feed I-589 when the I-589 fact
    # is absent. Never overwrite an I-589 answer with an I-765 one.
    for i589_id, i765_id in _CROSS_FORM.items():
        if not _raw_value(facts, i589_id) and _raw_value(facts, i765_id):
            facts[i589_id] = facts[i765_id]
    # i589_-prefixed name facts are accepted too (some callers send
    # i589_family_name); the registry's canonical keys are the plain
    # "family_name" / "given_name" / "middle_name".
    for _prefixed, _plain in (("i589_family_name", "family_name"),
                              ("i589_given_name", "given_name"),
                              ("i589_middle_name", "middle_name")):
        if not _raw_value(facts, _plain) and _raw_value(facts, _prefixed):
            facts[_plain] = facts[_prefixed]
    # i589_full_name (one UI answer) feeds the family/given name fields
    # the PDF actually has. Derive them only when not already provided.
    _full_name = _raw_value(facts, "i589_full_name")
    _name_split = False
    if _full_name and not _raw_value(facts, "family_name") and not _raw_value(facts, "given_name"):
        _given, _family = _split_full_name(str(_full_name))
        if _family:
            facts["family_name"] = _family
        if _given:
            facts["given_name"] = _given
        _name_split = True

    registry = {}
    for m in _gen["address"] + _gen["identity"]:
        fact_id = _semantic_to_fact(m["semantic"])
        key = f"gen_{m['field']}"
        if key in registry:
            continue
        registry[key] = {
            "fact": fact_id,
            "field": m["full_name"],
            "kind": "text",
            "required": False,
            "generated": True,
        }
    # ── ONE SOURCE OF TRUTH for Part A.III (Item C, 2026-11-12) ──
    # The 92 i589_bg_* entries (last address, 5-year residences,
    # education, employment, parents/siblings) are SKIPPED here.
    # No questionnaire or API caller produces facts with those ids —
    # the A.III data travels as repeating groups through the JS path
    # (api/_lib/repeating-fill.js buildRepeatingFillPlan +
    # api/_lib/forms/repeating-589.js) — so this iteration could never
    # fire, and keeping it meant two mechanisms covering the same PDF
    # fields. The JS repeating path is canonical for A.III; this
    # registry file remains the REFERENCE / AUDIT artifact for the
    # layout: its bg mappings were verified correct against the
    # 07/28/26 template with PyMuPDF (widget-rect proximity to the
    # printed table headers — interleaved rows 1-2, e.g. res1 =
    # TextField13[8,10,12,14] + DateTimeField24/26), and the
    # repeating-589.js mappings were corrected to match it on the same
    # date. The repeating path CANNOT express the registry's shape
    # directly (the registry is consumed only by this Python binder;
    # the JS draft path never reads it), so unifying on the registry
    # as the code-level mapper would need a cross-runtime registry
    # consumer that does not exist — hence this direction, not that
    # one. The 60 non-bg detailed entries below ARE still iterated:
    # i589_entry_date is produced by the live questionnaire and fills
    # DateTimeField2[0] only through this loop, and the entry-manner
    # block below reads _detailed["i589_entry_status"] directly.
    # The binder's dedup by field name (end of this function) is
    # preserved, so no double-write is possible if both paths ever
    # become active for the same field.
    for fact_id, full_name in _detailed.items():
        if fact_id.startswith("i589_bg_"):
            continue
        key = f"detailed_{fact_id}"
        if key not in registry:
            registry[key] = {
                "fact": fact_id,
                "field": full_name,
                "kind": "text",
                "required": False,
            }

    plan, review = [], []
    if _name_split:
        review.append({"fact": "i589_full_name", "reason": "name-split",
                       "detail": "Full name split into given/family names for the form; verify the split is correct."})
    for reg_id, spec in registry.items():
        fact_value = facts.get(spec["fact"])
        if not fact_value or spec["kind"] != "text":
            continue
        if isinstance(fact_value, dict) and "value" in fact_value:
            fact = fact_value
        else:
            fact = {"value": fact_value, "confidence": 1.0, "status": "ok"}
        # Item G: date facts are written MM/DD/YYYY, never raw ISO.
        if spec["fact"] in _DATE_FACTS:
            fact = dict(fact)
            fact["value"] = _format_date_mdy(fact.get("value"))
        single = {spec["fact"]: {"kind": "text", "field": spec["field"], "required": False}}
        p, r = bind(single, {spec["fact"]: fact})
        plan.extend(p)
        review.extend(r)

    # Item C (continued): A.III facts supplied directly to this binder
    # are NOT filled here — they go through the JS repeating-group
    # path. Flag them instead of silently dropping them. (*_deceased
    # is excluded: the _DECEASED block below DOES fill those boxes.)
    _bg_supplied = [fid for fid in facts
                    if fid.startswith("i589_bg_")
                    and not fid.endswith("_deceased")
                    and _raw_value(facts, fid)]
    if _bg_supplied:
        _shown = ", ".join(sorted(_bg_supplied)[:5])
        if len(_bg_supplied) > 5:
            _shown += ", ..."
        review.append({"fact": "i589_bg_*", "reason": "repeating-path-only",
                       "detail": f"{len(_bg_supplied)} Part A.III background fact(s) ({_shown}) were not filled by this binder: Part A.III fills through the JS repeating-group path (api/_lib/forms/repeating-589.js)."})

    # ── Checkbox groups ──
    # _check takes a short name (resolved via _name_map) or a full name.
    def _check(short_or_full, fact_id):
        field = short_or_full if short_or_full.startswith("form1[") else _full(short_or_full)
        if field:
            plan.append((field, True, "checkbox", fact_id))
        else:
            review.append({"fact": fact_id, "reason": "field-not-found",
                           "detail": f"Checkbox '{short_or_full}' was not found in the form template."})

    # Sex (Item 10): [0] Male, [1] Female.
    _sex = str(_raw_value(facts, "i589_sex") or "").strip().lower()
    if _sex in ("male", "m"):
        _check("PartALine9Sex[0]", "i589_sex")
    elif _sex in ("female", "f"):
        _check("PartALine9Sex[1]", "i589_sex")
    elif _sex:
        review.append({"fact": "i589_sex", "reason": "unmappable-value",
                       "detail": f"Sex value '{_sex}' has no checkbox mapping."})

    # Marital status (Item 11): [0] Single, [1] Married, [2] Divorced, [3] Widowed.
    _marital = str(_raw_value(facts, "i589_marital_status") or "").strip().lower()
    _marital_map = {
        "single": "Marital[0]",
        "married": "Marital[1]",
        "divorced": "Marital[2]",
        "widowed": "Marital[3]",
    }
    if _marital in _marital_map:
        _check(_marital_map[_marital], "i589_marital_status")
        if _marital == "single":
            # "I am not married. (Skip to Your Children below.)"
            _check("CheckBox5[0]", "i589_marital_status")
    elif _marital:
        review.append({"fact": "i589_marital_status", "reason": "unmappable-value",
                       "detail": f"Marital status '{_marital}' has no checkbox mapping."})

    # Court proceedings (Item 18). The precise answer is
    # i589_court_status (never / now / past, from the questionnaire);
    # it takes precedence when present. The coarse i589_in_proceedings
    # yes/no is the fallback: "yes" -> 18b (now in proceedings);
    # "no" cannot distinguish 18a (never) from 18c (not now, has
    # been) from this answer alone, so it is flagged for review,
    # never guessed. Box order (verified by rect proximity + on_state
    # 2026-11-12): [0] = 18a never, [1] = 18c past, [2] = 18b now.
    _court = str(_raw_value(facts, "i589_court_status") or "").strip().lower()
    _court_map = {
        "never": "CheckBox3[0]",
        "now": "CheckBox3[2]",
        "past": "CheckBox3[1]",
    }
    _proc = _yes_no_value(_raw_value(facts, "i589_in_proceedings"))
    if _court in _court_map:
        _check(_court_map[_court], "i589_court_status")
        if ((_proc == "yes" and _court != "now")
                or (_proc == "no" and _court == "now")):
            review.append({"fact": "i589_court_status", "reason": "contradiction",
                           "detail": f"Court status '{_court}' contradicts the in-proceedings answer '{_proc}'. The precise court-status answer was filled; confirm with the applicant."})
    else:
        if _court:
            review.append({"fact": "i589_court_status", "reason": "unmappable-value",
                           "detail": f"Court status '{_court}' has no checkbox mapping."})
        if _proc == "yes":
            _check("CheckBox3[2]", "i589_in_proceedings")
        elif _proc == "no":
            review.append({"fact": "i589_in_proceedings", "reason": "ambiguous",
                           "detail": "Not currently in proceedings does not say whether the applicant was ever in proceedings (Item 18a vs 18c). Applicant must confirm."})
        elif _raw_value(facts, "i589_in_proceedings"):
            review.append({"fact": "i589_in_proceedings", "reason": "unmappable-value",
                           "detail": "Proceedings answer is not a clear yes/no; confirm Item 18 with the applicant."})

    # Persecution grounds (Part B Q1): check all that apply.
    # The screening collects one ground; the value may also be a list.
    _grounds = _raw_value(facts, "i589_persecution_grounds")
    if isinstance(_grounds, str):
        _grounds = [_grounds]
    _ground_map = {
        "race": "CheckBoxrace[0]",
        "religion": "CheckBoxreligion[0]",
        "nationality": "CheckBoxnationality[0]",
        "political": "CheckBoxpolitics[0]",
        "social_group": "CheckBoxsocial[0]",
        "torture": "CheckBoxtorture[0]",
    }
    if _grounds:
        for g in _grounds:
            key = str(g).strip().lower()
            if key in _ground_map:
                _check(_ground_map[key], "i589_persecution_grounds")
            else:
                review.append({"fact": "i589_persecution_grounds", "reason": "unmappable-value",
                               "detail": f"Ground '{g}' has no checkbox mapping."})
        if "torture" in [str(g).strip().lower() for g in _grounds]:
            # Top-of-form CAT opt-in: "Check this box if you also want
            # to apply for withholding of removal under the Convention
            # Against Torture."
            _check("CheckBox31[0]", "i589_persecution_grounds")

    # Spouse sex (Part A.II Item 14): [0] Male, [1] Female.
    _ssex = str(_raw_value(facts, "i589_spouse_sex") or "").strip().lower()
    if _ssex in ("male", "m"):
        _check("CheckBox14_Sex[0]", "i589_spouse_sex")
    elif _ssex in ("female", "f"):
        _check("CheckBox14_Sex[1]", "i589_spouse_sex")

    # Spouse in the U.S. (Item 15): REVERSED — [0] = No, [1] = Yes.
    _sinus = _yes_no_value(_raw_value(facts, "i589_spouse_in_us"))
    if _sinus == "yes":
        _check("PtAIILine15_CheckBox15[1]", "i589_spouse_in_us")
    elif _sinus == "no":
        _check("PtAIILine15_CheckBox15[0]", "i589_spouse_in_us")

    # Part B / Part C yes/no pairs + fluent English + spouse flags.
    for fact_id, yes_short, no_short in _YESNO:
        v = _yes_no_value(_raw_value(facts, fact_id))
        if v == "yes":
            _check(yes_short, fact_id)
        elif v == "no":
            _check(no_short, fact_id)

    # Has children (Part A.II): [0] have children, [1] do not have any.
    _has_kids = _yes_no_value(_raw_value(facts, "i589_has_children"))
    if _has_kids == "yes":
        _check("ChildrenCheckbox[0]", "i589_has_children")
    elif _has_kids == "no":
        _check("ChildrenCheckbox[1]", "i589_has_children")

    # Parents/siblings deceased (Part A.III Q5).
    for who, short in _DECEASED.items():
        v = _yes_no_value(_raw_value(facts, f"i589_bg_{who}_deceased"))
        if v == "yes":
            _check(short, f"i589_bg_{who}_deceased")

    # ── Children repeating group (Part A.II + Supplement A, max 6) ──
    _kids = _raw_value(facts, "i589_children")
    if isinstance(_kids, dict):
        _kids = _kids.get("value")
    if isinstance(_kids, list) and _kids:
        if len(_kids) > len(_CHILD_FIELDS):
            review.append({"fact": "i589_children", "reason": "overflow",
                           "detail": f"{len(_kids)} children exceed the 6 slots on the form + Supplement A. Copy Supplement A as needed for the rest."})
        for idx, entry in enumerate(_kids[: len(_CHILD_FIELDS)]):
            if not isinstance(entry, dict):
                continue
            fmap = _CHILD_FIELDS[idx]
            n = idx + 1
            _cname = str(entry.get("name") or "").strip()
            if _cname:
                _cg, _cf = _split_full_name(_cname)
                if _cf and _full(fmap["last"]):
                    plan.append((_full(fmap["last"]), _cf, "text", f"i589_children_{n}_family"))
                if _cg and _full(fmap["first"]):
                    plan.append((_full(fmap["first"]), _cg, "text", f"i589_children_{n}_given"))
                review.append({"fact": f"i589_children_{n}", "reason": "name-split",
                               "detail": f"Child {n} name split into given/family; verify the split is correct."})
            if entry.get("dob") and _full(fmap["dob"]):
                plan.append((_full(fmap["dob"]), _format_date_mdy(entry["dob"]), "text", f"i589_children_{n}_dob"))
            if entry.get("country") and _full(fmap["birth"]):
                # Country of birth fills the "City and Country of Birth"
                # field with the country only; the city is missing.
                plan.append((_full(fmap["birth"]), str(entry["country"]), "text", f"i589_children_{n}_birth"))
                review.append({"fact": f"i589_children_{n}", "reason": "partial",
                               "detail": f"Child {n} birth field has country of birth only; birth city is missing."})
            # Optional per-child details when the entry carries them.
            for key, field_key in (("a_number", "alien"), ("passport", "passport"),
                                   ("marital", "marital"), ("nationality", "nat"),
                                   ("race", "race"), ("entry_place", "entry_place"),
                                   ("entry_date", "entry_date"), ("i94", "i94"),
                                   ("status", "status"), ("current_status", "current"),
                                   ("auth_exp", "auth_exp"), ("location_if_not_us", "specify")):
                if entry.get(key) and _full(fmap[field_key]):
                    _val = _format_date_mdy(entry[key]) if key in _CHILD_DATE_KEYS else str(entry[key])
                    plan.append((_full(fmap[field_key]), _val, "text",
                                 f"i589_children_{n}_{key}"))
            _csex = str(entry.get("sex") or "").strip().lower()
            if _csex in ("male", "m") and _full(fmap["sex_m"]):
                _check(_full(fmap["sex_m"]), f"i589_children_{n}_sex")
            elif _csex in ("female", "f") and _full(fmap["sex_f"]):
                _check(_full(fmap["sex_f"]), f"i589_children_{n}_sex")
            for key, yes_k, no_k in (("in_us", "in_us_yes", "in_us_no"),
                                     ("in_proceedings", "proc_yes", "proc_no"),
                                     ("included", "incl_yes", "incl_no")):
                v = _yes_no_value(entry.get(key))
                if v == "yes" and _full(fmap[yes_k]):
                    _check(_full(fmap[yes_k]), f"i589_children_{n}_{key}")
                elif v == "no" and _full(fmap[no_k]):
                    _check(_full(fmap[no_k]), f"i589_children_{n}_{key}")

    # ── Supplement A (p11) + Supplement B (p12) headers ──
    # Same applicant name / A-Number as Part A.I; fill the headers so
    # the continuation pages are identified.
    _an = _raw_value(facts, "i589_a_number")
    _nm = _raw_value(facts, "i589_full_name") or ""
    if not _nm and (_raw_value(facts, "family_name") or _raw_value(facts, "given_name")):
        _nm = f"{_raw_value(facts, 'given_name') or ''} {_raw_value(facts, 'family_name') or ''}".strip()
    if _an:
        for short in ("PtAILine1_ANumber[1]", "PtAILine1_ANumber[2]"):
            if _full(short):
                plan.append((_full(short), str(_an), "text", "i589_a_number"))
    if _nm:
        for short in ("ApplicantName[0]", "SupBApplicantName[0]"):
            if _full(short):
                plan.append((_full(short), str(_nm), "text", "i589_full_name"))

    # Entry manner: "uninspected" maps to the 19c Status text; any
    # other value cannot be turned into a status without the visa type.
    _manner = str(_raw_value(facts, "i589_entry_manner") or "").strip().lower()
    if _manner == "uninspected" and not _raw_value(facts, "i589_entry_status"):
        plan.append((_detailed["i589_entry_status"], "Entered without inspection",
                     "text", "i589_entry_manner"))
    elif _manner in ("inspected", "unsure"):
        review.append({"fact": "i589_entry_manner", "reason": "needs-detail",
                       "detail": "Entry manner alone does not give the status at last entry (Item 19c Status). Confirm the visa type or status with the applicant."})

    # Deduplicate by field name (generated + detailed + headers may overlap).
    seen = set()
    deduped_plan = []
    for f, v, k, fid in plan:
        if f not in seen:
            seen.add(f)
            deduped_plan.append((f, v, k, fid))
    return deduped_plan, review
