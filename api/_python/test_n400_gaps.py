"""
N-400 gap-closure tests (Items A, H, I — 2026-11-12).

A: biographic facts (height / weight / eye / hair / race) produce plan
   entries and fill the correct PDF fields (reopen + read back).
H: Part 9 Items 17.a-17.c questions wire to P11_Line17A/B/C (reopen +
   read back; Yes to one, No to another).
I: an old-key factRecord (n400_spouse_is_usc only) resolves to the
   spouse-citizen checkbox.

Run: ~/workspace/ocr-spike-env/bin/python test_n400_gaps.py
(from api/_python; paths resolve relative to this file).
Exits non-zero on any failure. Follows the test_full_verification.py
pattern: plan -> apply_fill -> reopen with PyMuPDF -> read back.
"""
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from datetime import datetime, timezone
import fitz

now = lambda: datetime.now(timezone.utc).isoformat()

def F(fid, val, conf=1.0, status="verified"):
    return {"id": fid, "value": val, "source": "applicant-typed",
            "confidence": conf, "status": status, "corrections": [],
            "updatedAt": now()}

from n400_full_binder import build_n400_full_plan
from binder import apply_fill

TEMPLATE = os.path.join(_HERE, "..", "..", "public", "forms", "n-400.pdf")
QUESTIONS_TS = os.path.join(_HERE, "..", "..", "src", "n400-questions.ts")

failures = []

def check(cond, msg):
    if cond:
        print(f"  ok: {msg}")
    else:
        failures.append(msg)
        print(f"  FAIL: {msg}")

def widgets_of(path):
    doc = fitz.open(path)
    wmap = {}
    for pg in doc:
        for w in pg.widgets():
            wmap[w.field_name] = w
    return doc, wmap

def field_short(full):
    return full.split(".")[-1]

# ── Item A: all five biographic facts fill correctly ──────────────
print("=== Item A: biographic facts ===")
facts_a = {
    "family_name": F("family_name", "SANTOS"),
    "n400_height": F("n400_height", "5'8\""),
    "n400_weight": F("n400_weight", "165"),
    "n400_eye_color": F("n400_eye_color", "brown"),
    "n400_hair_color": F("n400_hair_color", "black"),
    "race": F("race", "white"),
}
plan_a, review_a = build_n400_full_plan(facts_a)
by_field_a = {f: (v, k, fid) for f, v, k, fid in plan_a}
FEET = "form1[0].#subform[2].P7_Line3_HeightFeet[0]"
INCH = "form1[0].#subform[2].P7_Line3_HeightInches[0]"
W1 = "form1[0].#subform[2].P7_Line4_Pounds1[0]"
W2 = "form1[0].#subform[2].P7_Line4_Pounds2[0]"
W3 = "form1[0].#subform[2].P7_Line4_Pounds3[0]"
EYE_BROWN = "form1[0].#subform[2].P7_Line5_Eye[0]"   # on_state BRO
HAIR_BLACK = "form1[0].#subform[2].P7_Line6_Hair[7]"  # on_state BLK
RACE_WHITE = "form1[0].#subform[2].P7_Line2_Race[4]"   # on_state W
for fld, want in ((FEET, "5"), (INCH, "8"), (W1, "1"), (W2, "6"),
                  (W3, "5")):
    check(by_field_a.get(fld, (None,))[0] == want,
          f"plan has {field_short(fld)} = {want!r}")
check(by_field_a.get(EYE_BROWN, (None, None, None))[1] == "checkbox"
      and by_field_a[EYE_BROWN][0] is True, "plan checks eye brown box")
check(by_field_a.get(HAIR_BLACK, (None, None, None))[1] == "checkbox"
      and by_field_a[HAIR_BLACK][0] is True, "plan checks hair black box")
check(by_field_a.get(RACE_WHITE, (None, None, None))[1] == "checkbox"
      and by_field_a[RACE_WHITE][0] is True, "plan checks race white box")

out_a = "/tmp/n400_gaps_A.pdf"
filled_a, errors_a = apply_fill(TEMPLATE, out_a, plan_a)
check(not errors_a, f"apply_fill no errors (got {errors_a})")
doc_a, w_a = widgets_of(out_a)
check(str(w_a[FEET].field_value).strip() == "5",
      f"read-back height feet = {w_a[FEET].field_value!r}")
check(str(w_a[INCH].field_value).strip() == "8",
      f"read-back height inches = {w_a[INCH].field_value!r}")
check(str(w_a[W1].field_value).strip() == "1"
      and str(w_a[W2].field_value).strip() == "6"
      and str(w_a[W3].field_value).strip() == "5",
      "read-back weight boxes = '1','6','5'")
check(w_a[EYE_BROWN].field_value == "BRO",
      f"read-back eye brown box = {w_a[EYE_BROWN].field_value!r} (on BRO)")
check(all(not w_a[f"form1[0].#subform[2].P7_Line5_Eye[{i}]"].field_value
          for i in range(9) if i != 0),
      "read-back other eye boxes unchecked")
check(w_a[HAIR_BLACK].field_value == "BLK",
      f"read-back hair black box = {w_a[HAIR_BLACK].field_value!r} (on BLK)")
check(all(not w_a[f"form1[0].#subform[2].P7_Line6_Hair[{i}]"].field_value
          for i in range(9) if i != 7),
      "read-back other hair boxes unchecked")
check(w_a[RACE_WHITE].field_value == "W",
      f"read-back race white box = {w_a[RACE_WHITE].field_value!r} (on W)")
check(all(not w_a[f"form1[0].#subform[2].P7_Line2_Race[{i}]"].field_value
          for i in range(5) if i != 4),
      "read-back other race boxes unchecked")
doc_a.close()

# A2: weight zero-padding + alternate height spelling
plan_a2, _ = build_n400_full_plan({
    "n400_height": F("n400_height", "5 ft 6 in"),
    "n400_weight": F("n400_weight", "65"),
})
by_a2 = {f: (v, k, fid) for f, v, k, fid in plan_a2}
check(by_a2.get(FEET, (None,))[0] == "5"
      and by_a2.get(INCH, (None,))[0] == "6",
      "\"5 ft 6 in\" splits to feet 5 / inches 6")
check(by_a2.get(W1, (None,))[0] == "0"
      and by_a2.get(W2, (None,))[0] == "6"
      and by_a2.get(W3, (None,))[0] == "5",
      "\"65\" lb zero-pads to '0','6','5'")

# A3: unmappable biographic values go to review, not silently dropped
_, review_a3 = build_n400_full_plan({
    "n400_eye_color": F("n400_eye_color", "purple"),
    "n400_height": F("n400_height", "tall"),
    "n400_weight": F("n400_weight", "abc"),
})
flagged = {r["fact"] for r in review_a3}
check("n400_eye_color" in flagged, "unknown eye color 'purple' -> review")
check("n400_height" in flagged, "unparseable height 'tall' -> review")
check("n400_weight" in flagged, "unparseable weight 'abc' -> review")

# ── Item H: Part 9 Items 17.a-17.c ───────────────────────────────
print("=== Item H: Part 9 Items 17.a-17.c ===")
ts = open(QUESTIONS_TS, encoding="utf-8").read()
for qid, fid, short in (
        ("n400_gmc_17a", "n400_gmc_17a", "P9 17.a Prostitution"),
        ("n400_gmc_17b", "n400_gmc_17b", "P9 17.b Controlled substances"),
        ("n400_gmc_17c", "n400_gmc_17c", "P9 17.c Married to more than one person")):
    check(f'id: "{qid}"' in ts, f"question {qid} exists in n400-questions.ts")
    check(f'factId: "{fid}"' in ts, f"question {qid} factId {fid}")
    check(short in ts, f"question {qid} shortLabel {short!r}")
p9_map = json.load(open(os.path.join(_HERE, "n400_p9_ui_mapping.json")))
p9_pairs = json.load(open(os.path.join(_HERE, "n400_p9_pairs.json")))
p9_by_base = {p.get("base"): p.get("fields", []) for p in p9_pairs}
for fid, base in (("n400_gmc_17a", "P11_Line17A"),
                  ("n400_gmc_17b", "P11_Line17B"),
                  ("n400_gmc_17c", "P11_Line17C")):
    check(p9_map.get(fid) == base, f"ui-mapping {fid} -> {base}")
    check(p9_by_base.get(base) == [f"{base}[0]", f"{base}[1]"],
          f"p9 pair {base} has [0]/[1] fields")

# Yes to 17.a, No to 17.b, Yes to 17.c — read both boxes back each way.
plan_h, _ = build_n400_full_plan({
    "n400_gmc_17a": F("n400_gmc_17a", "yes"),
    "n400_gmc_17b": F("n400_gmc_17b", "no"),
    "n400_gmc_17c": F("n400_gmc_17c", "yes"),
})
A_YES = "form1[0].#subform[8].P11_Line17A[1]"  # on Y
A_NO = "form1[0].#subform[8].P11_Line17A[0]"   # on N
B_YES = "form1[0].#subform[8].P11_Line17B[1]"
B_NO = "form1[0].#subform[8].P11_Line17B[0]"
C_YES = "form1[0].#subform[8].P11_Line17C[1]"
C_NO = "form1[0].#subform[8].P11_Line17C[0]"
by_h = {f for f, v, k, fid in plan_h}
check(A_YES in by_h and A_NO not in by_h, "plan: 17.a Yes -> P11_Line17A[1]")
check(B_NO in by_h and B_YES not in by_h, "plan: 17.b No -> P11_Line17B[0]")
check(C_YES in by_h and C_NO not in by_h, "plan: 17.c Yes -> P11_Line17C[1]")
out_h = "/tmp/n400_gaps_H.pdf"
filled_h, errors_h = apply_fill(TEMPLATE, out_h, plan_h)
check(not errors_h, f"apply_fill no errors (got {errors_h})")
doc_h, w_h = widgets_of(out_h)
check(w_h[A_YES].field_value == "Y" and not w_h[A_NO].field_value,
      f"read-back 17.a: Yes box={w_h[A_YES].field_value!r}, No box={w_h[A_NO].field_value!r}")
check(w_h[B_NO].field_value == "N" and not w_h[B_YES].field_value,
      f"read-back 17.b: No box={w_h[B_NO].field_value!r}, Yes box={w_h[B_YES].field_value!r}")
check(w_h[C_YES].field_value == "Y" and not w_h[C_NO].field_value,
      f"read-back 17.c: Yes box={w_h[C_YES].field_value!r}, No box={w_h[C_NO].field_value!r}")
doc_h.close()

# ── Item I: old factId alias ─────────────────────────────────────
print("=== Item I: n400_spouse_is_usc alias ===")
CIT_YES = "form1[0].#subform[10].P10_Line1_Citizen[1]"  # on Y
CIT_NO = "form1[0].#subform[10].P10_Line1_Citizen[0]"   # on N
old_only = {"n400_spouse_is_usc": F("n400_spouse_is_usc", "yes")}
plan_i, _ = build_n400_full_plan(old_only)
by_i = {f for f, v, k, fid in plan_i}
check(CIT_YES in by_i and CIT_NO not in by_i,
      "old-key-only record plans the spouse-citizen Yes box")
check("spouse_citizen" not in old_only,
      "binder did not mutate the caller's facts dict")
out_i = "/tmp/n400_gaps_I.pdf"
filled_i, errors_i = apply_fill(TEMPLATE, out_i, plan_i)
check(not errors_i, f"apply_fill no errors (got {errors_i})")
doc_i, w_i = widgets_of(out_i)
check(w_i[CIT_YES].field_value == "Y" and not w_i[CIT_NO].field_value,
      f"read-back old-key Yes: Yes box={w_i[CIT_YES].field_value!r}, "
      f"No box={w_i[CIT_NO].field_value!r}")
doc_i.close()

# New key wins when both are present.
plan_i2, _ = build_n400_full_plan({
    "spouse_citizen": F("spouse_citizen", "no"),
    "n400_spouse_is_usc": F("n400_spouse_is_usc", "yes"),
})
by_i2 = {f for f, v, k, fid in plan_i2}
check(CIT_NO in by_i2 and CIT_YES not in by_i2,
      "both keys present: new key (no) wins over old key (yes)")

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for m in failures:
        print(f"  - {m}")
    sys.exit(1)
print("ALL N-400 GAP TESTS PASSED")
