"""
Biographic information (I-130 Part 3, 30 fields) — Phase 4.

Six factual questions, none collected in any existing workflow:
1. Ethnicity (2 checkboxes: Hispanic or Latino / Not Hispanic or Latino)
2. Race (5 checkboxes, select all applicable)
3. Height (feet + inches comboboxes)
4. Weight (pounds, 3 digit fields)
5. Eye color (9 checkboxes, 3x3 grid)
6. Hair color (9 checkboxes, 3x3 grid)

Checkbox indices mapped by visual position (verified against rendered PDF).
Eye color indices are NOT in visual order — mapped explicitly.
"""
P3 = "form1[0].#subform[3]"
P3_HAIR = "form1[0].#subform[4]"

BIOGRAPHIC_REGISTRY = {
    "bio_ethnicity": {
        "kind": "checkbox_group",
        "question": "What is your ethnicity? (Select one)",
        "mapping": {
            "hispanic_latino": f"{P3}.Pt3Line1_Ethnicity[1]",
            "not_hispanic_latino": f"{P3}.Pt3Line1_Ethnicity[0]",
        },
    },
    "bio_race": {
        "kind": "checkbox_multi",  # select all applicable
        "question": "What is your race? (Select all that apply)",
        "mapping": {
            "white": f"{P3}.Pt3Line2_Race_White[0]",
            "asian": f"{P3}.Pt3Line2_Race_Asian[0]",
            "black": f"{P3}.Pt3Line2_Race_Black[0]",
            "american_indian_alaska_native": f"{P3}.Pt3Line2_Race_AmericanIndianAlaskaNative[0]",
            "native_hawaiian_pacific": f"{P3}.Pt3Line2_Race_NativeHawaiianOtherPacificIslander[0]",
        },
    },
    "bio_height_feet": {
        "kind": "combobox",
        "question": "Height — feet",
        "field": f"{P3}.Pt3Line3_HeightFeet[0]",
    },
    "bio_height_inches": {
        "kind": "combobox",
        "question": "Height — inches",
        "field": f"{P3}.Pt3Line3_HeightInches[0]",
    },
    "bio_weight": {
        "kind": "weight_digits",  # 3 digit fields: hundreds/tens/ones
        "question": "Weight in pounds",
        "fields": [f"{P3}.Pt3Line4_Pound1[0]", f"{P3}.Pt3Line4_Pound2[0]", f"{P3}.Pt3Line4_Pound3[0]"],
    },
    "bio_eye_color": {
        "kind": "checkbox_group",
        "question": "Eye color (select one)",
        "mapping": {
            # index -> label, verified by (y,x) position on rendered PDF
            "black": f"{P3}.Pt3Line5_EyeColor[7]",
            "blue": f"{P3}.Pt3Line5_EyeColor[0]",
            "brown": f"{P3}.Pt3Line5_EyeColor[1]",
            "gray": f"{P3}.Pt3Line5_EyeColor[6]",
            "green": f"{P3}.Pt3Line5_EyeColor[5]",
            "hazel": f"{P3}.Pt3Line5_EyeColor[2]",
            "maroon": f"{P3}.Pt3Line5_EyeColor[4]",
            "pink": f"{P3}.Pt3Line5_EyeColor[3]",
            "unknown_other": f"{P3}.Pt3Line5_EyeColor[8]",
        },
    },
    "bio_hair_color": {  # NOTE: fields in #subform[4], not [3]
        "kind": "checkbox_group",
        "question": "Hair color (select one)",
        "mapping": {
            "bald": f"{P3_HAIR}.Pt3Line6_HairColor[0]",
            "black": f"{P3_HAIR}.Pt3Line6_HairColor[1]",
            "blond": f"{P3_HAIR}.Pt3Line6_HairColor[2]",
            "brown": f"{P3_HAIR}.Pt3Line6_HairColor[3]",
            "gray": f"{P3_HAIR}.Pt3Line6_HairColor[4]",
            "red": f"{P3_HAIR}.Pt3Line6_HairColor[5]",
            "sandy": f"{P3_HAIR}.Pt3Line6_HairColor[6]",
            "white": f"{P3_HAIR}.Pt3Line6_HairColor[7]",
            "unknown_other": f"{P3_HAIR}.Pt3Line6_HairColor[8]",
        },
    },
}

def bind_biographic(facts, threshold=0.7):
    """Bind biographic facts to fill plan + review queue.
    facts: dict of fact_id -> Tier1Fact-style dict."""
    plan, review = [], []
    for fid, spec in BIOGRAPHIC_REGISTRY.items():
        fact = facts.get(fid)
        if fact is None:
            continue
        if fact["status"] == "conflicted":
            review.append({"fact": fid, "reason": "conflict", "detail": "Biographic conflict"})
            continue
        if fact["confidence"] < threshold:
            review.append({"fact": fid, "reason": "uncertain",
                           "detail": f"Confidence {fact['confidence']:.2f} below {threshold}"})
            continue
        v = fact["value"]
        kind = spec["kind"]
        if kind == "checkbox_group":
            f = spec["mapping"].get(v)
            if f: plan.append((f, True, "checkbox", fid))
        elif kind == "checkbox_multi":
            for val in (v if isinstance(v, list) else [v]):
                f = spec["mapping"].get(val)
                if f: plan.append((f, True, "checkbox", fid))
        elif kind in ("combobox", "text"):
            plan.append((spec["field"], str(v), "combobox" if kind == "combobox" else "text", fid))
        elif kind == "weight_digits":
            # Safe digit extraction (Carbon Pass 2, L-2, matching
            # binder.py weight_digits): raw int(v) raises ValueError on
            # "165 lbs" and "1000" writes 4 chars into 3 fields.
            digits = "".join(c for c in str(v) if c.isdigit())
            if not digits:
                review.append({"fact": fid, "reason": "unmappable-value",
                               "detail": f"Value '{v}' is not a weight in pounds."})
            else:
                digits = digits[-3:].rjust(3, "0")
                for d, fld in zip(digits, spec["fields"]):
                    plan.append((fld, d, "text", fid))
    return plan, review
