"""
I-589 binder tests — Items B, C, G (2026-11-12).

Proves, by reopening the filled PDF with PyMuPDF and reading values
back in the correct fields (local-proof doctrine):
  B: the four questionnaire facts (i589_sex, i589_court_status,
     i589_spouse_sex, i589_spouse_in_us) fill the right checkboxes,
     including the Item 18 box order and the reversed spouse-in-US pair.
  C: Part A.III background (i589_bg_*) facts are NOT filled by this
     binder (JS repeating-group path is canonical) while the other
     detailed-registry entries still fire, and the dedup holds.
  G: dates fill as MM/DD/YYYY, never raw ISO.

Run from the worktree root (or from the engine copy — same file works
in both layouts):
  ~/workspace/ocr-spike-env/bin/python api/_python/test_i589_binder.py
Also pytest-compatible: `python -m pytest test_i589_binder.py` where
pytest is installed (plain asserts, no fixtures).
"""
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

import fitz  # noqa: E402
from binder import apply_fill  # noqa: E402
from i589_full_binder import (  # noqa: E402
    _format_date_mdy,
    _name_map,
    build_i589_full_plan,
)


def _resolve(*rel, fallback):
    for cand in (os.path.join(_HERE, *rel), fallback):
        p = os.path.normpath(cand)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(fallback)


TEMPLATE = _resolve("..", "..", "public", "forms", "i-589.pdf",
                    fallback="/home/hatch/workspace/iru-institutional/public/forms/i-589.pdf")
TEMPLATE_JS = _resolve("..", "..", "forms", "templates", "i-589.pdf",
                       fallback="/home/hatch/workspace/iru-institutional/forms/templates/i-589.pdf")
QUESTIONS_TS = _resolve("..", "..", "src", "i589-questions.ts",
                        fallback="/home/hatch/workspace/iru-institutional/src/i589-questions.ts")


def F(value):
    return {"value": value, "confidence": 1.0, "status": "ok"}


def _plan_fields(plan):
    return {f: (v, k, fid) for f, v, k, fid in plan}


def _field(short):
    return _name_map[short]


def _checked(plan, short):
    """The plan checks this checkbox (and only this one of its pair)."""
    fields = _plan_fields(plan)
    return _field(short) in fields and fields[_field(short)][1] == "checkbox"


def _read_back(pdf_path, wanted):
    doc = fitz.open(pdf_path)
    found = {}
    for pg in doc:
        for w in pg.widgets():
            if w.field_name in wanted:
                found[w.field_name] = w.field_value
    doc.close()
    return found


def _is_checked(value):
    return value not in (None, "", "Off", "0")


# ── Item B ──────────────────────────────────────────────────────────

def test_sex_checkboxes():
    plan, _ = build_i589_full_plan({"i589_sex": "female"})
    assert _checked(plan, "PartALine9Sex[1]"), "female -> PartALine9Sex[1]"
    assert not _checked(plan, "PartALine9Sex[0]"), "female must not check Male"
    plan, _ = build_i589_full_plan({"i589_sex": "male"})
    assert _checked(plan, "PartALine9Sex[0]"), "male -> PartALine9Sex[0]"
    assert not _checked(plan, "PartALine9Sex[1]"), "male must not check Female"
    # 'M'/'F' shorthand accepted by the binder.
    plan, _ = build_i589_full_plan({"i589_sex": "M"})
    assert _checked(plan, "PartALine9Sex[0]")
    plan, review = build_i589_full_plan({"i589_sex": "other"})
    assert not _checked(plan, "PartALine9Sex[0]") and not _checked(plan, "PartALine9Sex[1]")
    assert any(r["fact"] == "i589_sex" and r["reason"] == "unmappable-value" for r in review), \
        "unmappable sex must be flagged, never guessed"


def test_court_status_boxes():
    # Rect + on_state proof (template 07/28/26): [0]=18a never (on A),
    # [1]=18c past (on C), [2]=18b now (on B). The pre-fix binder had
    # [1]/[2] swapped.
    cases = {"never": "CheckBox3[0]", "now": "CheckBox3[2]", "past": "CheckBox3[1]"}
    for value, short in cases.items():
        plan, _ = build_i589_full_plan({"i589_court_status": value})
        assert _checked(plan, short), f"court_status {value!r} -> {short}"
        others = [s for s in cases.values() if s != short]
        for other in others:
            assert not _checked(plan, other), f"court_status {value!r} must not check {other}"


def test_court_status_precedence_and_contradiction():
    # Precise court_status wins over the coarse in_proceedings answer.
    plan, review = build_i589_full_plan(
        {"i589_in_proceedings": "yes", "i589_court_status": "past"})
    assert _checked(plan, "CheckBox3[1]"), "past wins -> CheckBox3[1]"
    assert not _checked(plan, "CheckBox3[2]"), "stale 'yes' must not also check now"
    assert any(r["fact"] == "i589_court_status" and r["reason"] == "contradiction"
               for r in review), "contradictory answers must be flagged"
    plan, review = build_i589_full_plan(
        {"i589_in_proceedings": "no", "i589_court_status": "never"})
    assert _checked(plan, "CheckBox3[0]")
    assert not any(r["reason"] == "ambiguous" for r in review), \
        "court_status=never resolves the 18a/18c ambiguity"


def test_in_proceedings_fallback():
    # No court_status: the old coarse behavior, with the corrected box.
    plan, _ = build_i589_full_plan({"i589_in_proceedings": "yes"})
    assert _checked(plan, "CheckBox3[2]"), "in_proceedings=yes -> 18b now [2]"
    assert not _checked(plan, "CheckBox3[1]")
    plan, review = build_i589_full_plan({"i589_in_proceedings": "no"})
    assert not _checked(plan, "CheckBox3[0]") and not _checked(plan, "CheckBox3[1]") \
        and not _checked(plan, "CheckBox3[2]"), "'no' must not guess a box"
    assert any(r["fact"] == "i589_in_proceedings" and r["reason"] == "ambiguous"
               for r in review), "'no' must flag 18a vs 18c"


def test_spouse_checkboxes():
    plan, _ = build_i589_full_plan({"i589_spouse_sex": "male"})
    assert _checked(plan, "CheckBox14_Sex[0]"), "spouse male -> CheckBox14_Sex[0]"
    plan, _ = build_i589_full_plan({"i589_spouse_sex": "female"})
    assert _checked(plan, "CheckBox14_Sex[1]"), "spouse female -> CheckBox14_Sex[1]"
    # Spouse in the U.S. is REVERSED: [1] = Yes, [0] = No.
    plan, _ = build_i589_full_plan({"i589_spouse_in_us": "yes"})
    assert _checked(plan, "PtAIILine15_CheckBox15[1]"), "spouse in US yes -> [1]"
    assert not _checked(plan, "PtAIILine15_CheckBox15[0]")
    plan, _ = build_i589_full_plan({"i589_spouse_in_us": "no"})
    assert _checked(plan, "PtAIILine15_CheckBox15[0]"), "spouse in US no -> [0]"
    assert not _checked(plan, "PtAIILine15_CheckBox15[1]")


def test_questions_emit_binder_values():
    """The four new questions in src/i589-questions.ts emit exactly the
    option values the binder expects — the questions -> facts link."""
    src = open(QUESTIONS_TS, encoding="utf-8").read()

    def options_for(qid):
        start = src.index(f"id: '{qid}'")
        end = src.find("id: 'i589_", start + 1)
        block = src[start:end if end > 0 else len(src)]
        # Option lines are written `{ value: 'x', labels: ... }`;
        # conditionalOn's `value:` must not match.
        return re.findall(r"\{ value: '([^']+)'", block)

    assert "i589_sex" in src and set(options_for("i589_sex")) == {"male", "female"}
    assert set(options_for("i589_court_status")) == {"never", "now", "past"}
    assert set(options_for("i589_spouse_sex")) == {"male", "female"}
    assert set(options_for("i589_spouse_in_us")) == {"yes", "no"}
    # Spouse questions are gated on married; court status is asked
    # unless the applicant already said they ARE in proceedings.
    assert "conditionalOn: { factId: 'i589_marital_status', operator: 'equals', value: 'married' }" in src
    assert "conditionalOn: { factId: 'i589_in_proceedings', operator: 'not_equals', value: 'yes' }" in src


# ── Item C ──────────────────────────────────────────────────────────

def test_bg_facts_not_filled():
    facts = {
        "i589_bg_addr1_street": "1 Old St", "i589_bg_addr1_city": "OldCity",
        "i589_bg_addr1_from": "2020-01-01", "i589_bg_addr1_to": "2021-01-01",
        "i589_bg_res1_street": "2 Res St", "i589_bg_res1_city": "ResCity",
        "i589_bg_edu1_school": "Old School", "i589_bg_emp1_employer": "Old Corp",
        "i589_bg_mother_name": "Mum", "i589_bg_sib1_name": "Sib",
    }
    plan, review = build_i589_full_plan(facts)
    fields = _plan_fields(plan)
    for bg_field in (
            "form1[0].#subform[4].TextField13[0]",   # addr1 street
            "form1[0].#subform[4].TextField13[2]",   # addr1 city
            "form1[0].#subform[4].TextField13[8]",   # res1 street
            "form1[0].#subform[4].TextField13[10]",  # res1 city
            "form1[0].#subform[4].TextField13[28]",  # edu1 school
            "form1[0].#subform[4].TextField13[40]",  # emp1 employer
            "form1[0].#subform[4].TextField13[46]",  # mother name
            "form1[0].#subform[4].TextField13[48]"):  # sib1 name
        assert bg_field not in fields, f"bg fact must not fill {bg_field}"
    assert any(r["fact"] == "i589_bg_*" and r["reason"] == "repeating-path-only"
               for r in review), "supplied bg facts must be flagged, not silently dropped"


def test_non_bg_detailed_entries_still_fire():
    plan, _ = build_i589_full_plan({
        "i589_entry_date": "2024-03-15",
        "i589_spouse_dob": "1988-02-02",
        "i589_pb_q1a_narrative": "I was harmed.",
    })
    fields = _plan_fields(plan)
    assert fields["form1[0].#subform[0].DateTimeField2[0]"][0] == "03/15/2024", \
        "entry_date still fills (and as MM/DD/YYYY)"
    assert "form1[0].#subform[1].NotMarried[0].DateTimeField7[0]" in fields
    assert "form1[0].#subform[5].#subform[6].TextField14[0]" in fields


def test_bg_deceased_still_fills():
    plan, _ = build_i589_full_plan({"i589_bg_mother_deceased": "yes"})
    assert _checked(plan, "m[0]"), "mother deceased still checks m[0]"
    plan, _ = build_i589_full_plan({"i589_bg_sib2_deceased": "yes"})
    assert _checked(plan, "s2[0]"), "sib2 deceased still checks s2[0]"


def test_dedup_preserved():
    plan, _ = build_i589_full_plan({
        "i589_entry_manner": "uninspected",
        "i589_entry_status": "Entered without inspection",
    })
    hits = [f for f, _, _, _ in plan
            if f == "form1[0].#subform[0].TextField4[1]"]
    assert len(hits) == 1, "entry_status field must appear exactly once"


# ── Item G ──────────────────────────────────────────────────────────

def test_format_date_mdy_unit():
    assert _format_date_mdy("1990-05-14") == "05/14/1990"
    assert _format_date_mdy("2024-03-15") == "03/15/2024"
    assert _format_date_mdy("05/14/1990") == "05/14/1990", "already MDY passes through"
    assert _format_date_mdy("May 14, 1990") == "May 14, 1990", "free text passes through"
    assert _format_date_mdy("1990-5-4") == "1990-5-4", "non-padded ISO passes through (JS parity)"
    assert _format_date_mdy(None) is None


def test_dates_fill_mdy():
    plan, _ = build_i589_full_plan({
        "i589_dob": F("1990-05-14"),
        "i589_entry_date": F("2024-03-15"),
        "i589_entry_status_expires": F("2025-01-31"),
        "i589_passport_expiry": F("2030-12-01"),
        "i589_last_left_country_date": F("2024-03-10"),
        "i589_spouse_dob": F("1988-02-02"),
        "i589_spouse_marriage_date": F("2015-06-20"),
        "i589_spouse_last_entry_date": F("2023-11-05"),
        "i589_spouse_prev_arrival_date": F("2020-08-08"),
        "i589_spouse_auth_stay_expiry": F("2026-04-30"),
        "i589_children": [{"name": "Ana Santos", "dob": "2018-06-22",
                           "entry_date": "2024-03-15", "auth_exp": "2025-09-01"}],
    })
    fields = _plan_fields(plan)
    expected = {
        "form1[0].#subform[0].DateTimeField1[0]": "05/14/1990",   # dob
        "form1[0].#subform[0].DateTimeField2[0]": "03/15/2024",   # entry_date
        "form1[0].#subform[0].DateTimeField2[1]": "01/31/2025",   # status expires
        "form1[0].#subform[0].DateTimeField2[2]": "12/01/2030",   # passport expiry
        "form1[0].#subform[0].DateTimeField6[0]": "03/10/2024",   # last left
        "form1[0].#subform[1].NotMarried[0].DateTimeField7[0]": "02/02/1988",
        "form1[0].#subform[1].NotMarried[0].DateTimeField8[0]": "06/20/2015",
        "form1[0].#subform[1].NotMarried[0].PtAIILine17_DateofLastEntry[0]": "11/05/2023",
        "form1[0].#subform[1].NotMarried[0].PtAIILine23_PreviousArrivalDate[0]": "08/08/2020",
        "form1[0].#subform[1].NotMarried[0].PtAIILine21_ExpDateofAuthorizedStay[0]": "04/30/2026",
    }
    for field, want in expected.items():
        assert field in fields, f"date field missing from plan: {field}"
        assert fields[field][0] == want, f"{field}: got {fields[field][0]!r}, want {want!r}"
    # Child 1 dates (binder writes them raw into the plan tuples).
    child = {fid: v for _, v, _, fid in plan}
    assert child["i589_children_1_dob"] == "06/22/2018"
    assert child["i589_children_1_entry_date"] == "03/15/2024"
    assert child["i589_children_1_auth_exp"] == "09/01/2025"
    # No ISO date anywhere in the plan.
    for f, v, k, fid in plan:
        if k == "text" and isinstance(v, str):
            assert not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v.strip()), \
                f"raw ISO date leaked into plan: {f} = {v!r}"


# ── PDF reopen (local-proof doctrine) ───────────────────────────────

def test_pdf_reopen_readback():
    facts = {
        "family_name": "Santos", "given_name": "Maria",
        "i589_dob": F("1990-05-14"),
        "i589_a_number": F("A123456789"),
        "i589_entry_date": F("2024-03-15"),
        "i589_entry_manner": "uninspected",
        "i589_sex": "female",
        "i589_court_status": "now",
        "i589_marital_status": "married",
        "i589_spouse_sex": "male",
        "i589_spouse_in_us": "yes",
        "i589_spouse_dob": F("1988-02-02"),
        "i589_has_children": "yes",
        "i589_children": [{"name": "Ana Santos", "dob": "2018-06-22",
                           "country": "Honduras"}],
        "i589_bg_addr1_street": "1 Old St",  # must NOT fill (Item C)
    }
    plan, review = build_i589_full_plan(facts)
    out = "/tmp/i589_binder_items_bcg.pdf"
    filled, errors = apply_fill(TEMPLATE, out, plan)
    assert not errors, f"apply_fill errors: {errors}"
    assert filled == len(plan), f"filled {filled} of {len(plan)} plan entries"

    wanted = {
        _field("PartALine9Sex[1]"), _field("PartALine9Sex[0]"),
        _field("CheckBox3[2]"), _field("CheckBox3[1]"), _field("CheckBox3[0]"),
        _field("CheckBox14_Sex[0]"), _field("CheckBox14_Sex[1]"),
        _field("PtAIILine15_CheckBox15[1]"), _field("PtAIILine15_CheckBox15[0]"),
        "form1[0].#subform[0].DateTimeField1[0]",
        "form1[0].#subform[0].DateTimeField2[0]",
        "form1[0].#subform[1].NotMarried[0].DateTimeField7[0]",
        "form1[0].#subform[4].TextField13[0]",  # A.III last-address street: must stay empty
        "form1[0].#subform[4].TextField13[8]",  # A.III residence 1 street: must stay empty
    }
    got = _read_back(out, wanted)
    # Item B read-backs (checkbox on-states, not 'True').
    assert _is_checked(got.get(_field("PartALine9Sex[1]"))), \
        f"sex Female box read back {got.get(_field('PartALine9Sex[1]'))!r}"
    assert not _is_checked(got.get(_field("PartALine9Sex[0]")))
    assert _is_checked(got.get(_field("CheckBox3[2]"))), \
        f"court 'now' box [2] read back {got.get(_field('CheckBox3[2]'))!r}"
    assert not _is_checked(got.get(_field("CheckBox3[1]")))
    assert not _is_checked(got.get(_field("CheckBox3[0]")))
    assert _is_checked(got.get(_field("CheckBox14_Sex[0]"))), "spouse Male box"
    assert not _is_checked(got.get(_field("CheckBox14_Sex[1]")))
    assert _is_checked(got.get(_field("PtAIILine15_CheckBox15[1]"))), \
        "spouse in US Yes is [1] (reversed)"
    assert not _is_checked(got.get(_field("PtAIILine15_CheckBox15[0]")))
    # Item G read-backs.
    assert got.get("form1[0].#subform[0].DateTimeField1[0]") == "05/14/1990", \
        f"dob read back {got.get('form1[0].#subform[0].DateTimeField1[0]')!r}"
    assert got.get("form1[0].#subform[0].DateTimeField2[0]") == "03/15/2024"
    assert got.get("form1[0].#subform[1].NotMarried[0].DateTimeField7[0]") == "02/02/1988"
    # Item C read-backs: A.III boxes stay empty from this binder.
    assert not (got.get("form1[0].#subform[4].TextField13[0]") or "").strip()
    assert not (got.get("form1[0].#subform[4].TextField13[8]") or "").strip()
    assert any(r["fact"] == "i589_bg_*" for r in review)
    print(f"  [reopen] filled={filled} dob={got.get('form1[0].#subform[0].DateTimeField1[0]')!r} "
          f"entry={got.get('form1[0].#subform[0].DateTimeField2[0]')!r} "
          f"sexF={got.get(_field('PartALine9Sex[1]'))!r} courtNow={got.get(_field('CheckBox3[2]'))!r}")


def test_js_template_carries_same_fields():
    """The JS draft path reads forms/templates/i-589.pdf: the checkbox
    fields this binder targets must exist there with the same export
    values (else the two templates disagree about Item 10/18)."""
    doc = fitz.open(TEMPLATE_JS)
    states = {}
    names = set()
    for pg in doc:
        for w in pg.widgets():
            names.add(w.field_name)
            # Read on_state() while the doc is open: widgets are
            # weakly referenced and die with the document.
            states[w.field_name] = w.on_state()
    doc.close()
    assert states[_field("PartALine9Sex[0]")] == "M"
    assert states[_field("PartALine9Sex[1]")] == "F"
    assert states[_field("CheckBox3[0]")] == "A"
    assert states[_field("CheckBox3[1]")] == "C"
    assert states[_field("CheckBox3[2]")] == "B"
    assert states[_field("PtAIILine15_CheckBox15[1]")] == "Y"
    assert states[_field("PtAIILine15_CheckBox15[0]")] == "N"
    # Entry-history dates the repeating path used to map: DT3[1]/DT3[2]
    # do not exist in either template.
    assert "form1[0].#subform[0].DateTimeField3[1]" not in names
    assert "form1[0].#subform[0].DateTimeField3[2]" not in names


_TESTS = [v for k, v in sorted(globals().items())
          if k.startswith("test_") and callable(v)]

if __name__ == "__main__":
    failed = []
    for fn in _TESTS:
        try:
            fn()
            print(f"  PASS {fn.__name__}")
        except Exception as e:  # noqa: BLE001 - report and continue
            failed.append((fn.__name__, e))
            print(f"  FAIL {fn.__name__}: {e}")
    print(f"\n{len(_TESTS) - len(failed)}/{len(_TESTS)} I-589 binder tests passed")
    if failed:
        raise SystemExit(1)
