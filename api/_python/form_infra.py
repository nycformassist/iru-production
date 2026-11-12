"""
Cross-form infrastructure — Phase 6 foundation.
Generic field enumeration, form profiles, and reusable binder patterns
so each new form is configuration, not new engineering.
"""
import fitz, json, os, re
from collections import Counter

_HERE = os.path.dirname(os.path.abspath(__file__))

FORM_PROFILES = {
    "i90": {"pdf": "i-90.pdf", "edition": "01/20/25", "pages": 7,
            "questions": 9, "note": "Green card renewal; smallest"},
    "n400": {"pdf": "n-400.pdf", "edition": "01/20/25", "pages": 14,
             "questions": 27, "note": "Naturalization; largest questionnaire"},
    "i485": {"pdf": "i-485.pdf", "edition": "09/18/26", "pages": 24,
             "questions": 15, "note": "Adjustment of status; largest PDF"},
    "i765": {"pdf": "i-765.pdf", "edition": "08/21/25", "pages": 7,
             "questions": 11, "note": "Work permit; 45-field registry exists (Phase 2)"},
}

# Templates live in the repo at public/forms/ (Carbon Pass 2, H-4:
# the old /home/hatch/workspace/iru-n400-verify dev path no longer
# exists). PDF filenames are the hyphenated public/forms names.
PDF_DIR = os.path.join(_HERE, "..", "..", "public", "forms")

def enumerate_form(form_key):
    """Enumerate all AcroForm fields for a form. Returns (fields, stats)."""
    profile = FORM_PROFILES[form_key]
    doc = fitz.open(f"{PDF_DIR}/{profile['pdf']}")
    fields = []
    for i, pg in enumerate(doc):
        for w in pg.widgets():
            short = w.field_name.split(".")[-1]
            if "BarCode" in short:
                continue
            fields.append({
                "page": i, "type": w.field_type_string,
                "name": w.field_name, "short": short,
            })
    doc.close()
    stats = {
        "total": len(fields),
        "by_type": dict(Counter(f["type"] for f in fields)),
        "by_page": dict(Counter(f["page"] for f in fields)),
    }
    return fields, stats

def save_enumeration(form_key):
    fields, stats = enumerate_form(form_key)
    path = os.path.join(_HERE, f"{form_key}_fields.json")
    with open(path, "w") as f:
        json.dump(fields, f, indent=1)
    return fields, stats, path

if __name__ == "__main__":
    import sys
    for key in FORM_PROFILES:
        fields, stats, path = save_enumeration(key)
        print(f"{key}: {stats['total']} fields, {stats['by_type']}")
