"""
Reusable form-completion binder: fact records + provenance -> field fill plan.

Rules (integrate existing IRU intelligence, don't rebuild it):
- status == 'conflicted'            -> REVIEW (never auto-fill a conflict)
- fact missing + registry required  -> REVIEW (missing required)
- confidence < threshold (0.7)      -> REVIEW (uncertain)
- otherwise                         -> FILL

Output: fill_plan [(field_name, value, kind)] and review_queue [flag dicts].
The review queue is the selective human-review surface that travels with the
consolidated IRU report.
"""
import re

AUTO_FILL_CONFIDENCE = 0.7

_HEIGHT_RE = re.compile(r"""^\s*(\d+)\s*(?:'|ft|feet|-|,)?\s*(\d*)\s*(?:"|in|inches|”)?\s*$""")

def _parse_height(value):
    """Parse a height answer into (feet, inches|None).

    Accepts 5'8", 5'8, 5 ft 8 in, 5 feet 8 inches, 5-8, 5.8, and a bare
    number: <= 8 is feet alone; 9+ is total inches (68 -> 5'8"). Returns
    (None, None) when the value cannot be parsed.
    """
    if value is None:
        return None, None
    if isinstance(value, (list, tuple)):
        value = " ".join(str(v) for v in value)
    s = str(value).strip().lower().replace("’", "'").replace("”", '"')
    if re.fullmatch(r"\d+\.\d+", s):
        feet_s, inches_s = s.split(".")
        return int(feet_s), int(inches_s)
    m = _HEIGHT_RE.match(s)
    if not m:
        return None, None
    feet_s, inches_s = m.group(1), m.group(2)
    if not inches_s:
        n = int(feet_s)
        if n > 8:
            return n // 12, n % 12
        return n, None
    feet, inches = int(feet_s), int(inches_s)
    if inches >= 12:
        feet += inches // 12
        inches = inches % 12
    return feet, inches

def bind(registry, facts):
    fill_plan, review_queue = [], []
    for fact_id, spec in registry.items():
        fact = facts.get(fact_id)
        required = spec.get("required", False)

        if fact is None:
            if required:
                review_queue.append({"fact": fact_id, "reason": "missing-required",
                    "detail": "Required for this form but no answer was provided."})
            continue

        value, conf, status = fact["value"], fact["confidence"], fact["status"]

        if status == "conflicted":
            c = fact.get("conflict", {})
            review_queue.append({"fact": fact_id, "reason": "conflict",
                "detail": (f"Typed value '{value}' conflicts with "
                           f"{c.get('other_source')}: '{c.get('other_value')}'. "
                           f"{c.get('note', '')}".strip())})
            continue

        if conf < AUTO_FILL_CONFIDENCE:
            review_queue.append({"fact": fact_id, "reason": "uncertain",
                "detail": (f"Confidence {conf:.2f} below auto-fill threshold "
                           f"{AUTO_FILL_CONFIDENCE}. Source: {fact['source']}. "
                           f"{fact.get('note', '')}".strip())})
            continue

        kind = spec["kind"]
        if kind == "text":
            fill_plan.append((spec["field"], value, "text", fact_id))
        elif kind == "combobox":
            # Comboboxes (e.g. height feet/inches) take a plain string
            # value; apply_fill sets field_value the same as text.
            fill_plan.append((spec["field"], str(value), "text", fact_id))
        elif kind == "checkbox_group":
            field = spec["mapping"].get(value)
            if field:
                fill_plan.append((field, True, "checkbox", fact_id))
            else:
                review_queue.append({"fact": fact_id, "reason": "unmappable-value",
                    "detail": f"Value '{value}' has no checkbox mapping."})
        elif kind == "checkbox_multi":
            # Select-all-that-apply: value may be a list or a
            # comma-separated string. Each selected value checks its box.
            values = value if isinstance(value, list) else str(value).split(",")
            checked = False
            for v in values:
                v = v.strip() if isinstance(v, str) else v
                field = spec["mapping"].get(v)
                if field:
                    fill_plan.append((field, True, "checkbox", fact_id))
                    checked = True
            if not checked:
                review_queue.append({"fact": fact_id, "reason": "unmappable-value",
                    "detail": f"Value '{value}' has no checkbox mapping."})
        elif kind == "weight_digits":
            # Weight in pounds split across the spec's digit fields
            # (hundreds/tens/ones), e.g. "165" -> "1", "6", "5".
            digits = "".join(ch for ch in str(value) if ch.isdigit())
            if not digits:
                review_queue.append({"fact": fact_id, "reason": "unmappable-value",
                    "detail": f"Value '{value}' is not a weight in pounds."})
            else:
                digits = digits[-3:].rjust(3, "0")
                for d, fld in zip(digits, spec["fields"]):
                    fill_plan.append((fld, d, "text", fact_id))
        elif kind == "height":
            # Single height answer ("5'8\"") split across the spec's
            # [feet, inches] combobox fields (Carbon Pass 1 finding 20).
            feet, inches = _parse_height(value)
            if feet is None:
                review_queue.append({"fact": fact_id, "reason": "unmappable-value",
                    "detail": f"Value '{value}' is not a parseable height."})
            else:
                fields = spec.get("fields", [])
                if len(fields) >= 1:
                    fill_plan.append((fields[0], str(feet), "text", fact_id))
                if len(fields) >= 2 and inches is not None:
                    fill_plan.append((fields[1], str(inches), "text", fact_id))
        else:
            # Unknown kinds used to fall through silently and the fact
            # was never filled. Surface it for human review instead.
            review_queue.append({"fact": fact_id, "reason": "unsupported-kind",
                "detail": f"Kind '{kind}' is not supported by the binder."})
    return fill_plan, review_queue


def apply_fill(pdf_path, out_path, fill_plan):
    """Fill AcroForm fields via PyMuPDF. Returns (filled_count, errors).

    Widgets must be updated while bound to their page, so the fill is
    applied inside the page iteration, not from a cached dict.
    """
    import fitz
    doc = fitz.open(pdf_path)
    plan_by_name = {f: (v, k, fid) for f, v, k, fid in fill_plan}
    filled, errors = 0, []
    found = set()
    for pg in doc:
        for w in pg.widgets():
            if w.field_name in plan_by_name:
                value, kind, fact_id = plan_by_name[w.field_name]
                found.add(w.field_name)
                # H-6: signature fields are NEVER filled by automation —
                # skip and record, so a registry slip cannot sign a form.
                if re.search(r'signature', w.field_name, re.I):
                    errors.append(f"{w.field_name} (fact {fact_id}): "
                                  "signature field skipped, never filled")
                    continue
                try:
                    if kind == "checkbox":
                        # M-8: a truthy checkbox value must use the
                        # widget's actual export value. Setting the
                        # literal string "Yes" leaves the box unchecked
                        # when on_state() is "Y", "1", or "2".
                        if value is True or (isinstance(value, str)
                                and value.strip().lower() in ("yes", "true", "1", "y")):
                            try:
                                on_state = w.on_state()
                            except Exception:
                                on_state = None
                            w.field_value = on_state or True
                        else:
                            w.field_value = False
                    else:
                        w.field_value = value
                    w.update()
                    filled += 1
                except Exception as e:
                    errors.append(f"{w.field_name}: {e}")
    for f, v, k, fid in fill_plan:
        if f not in found:
            errors.append(f"{f} (fact {fid}): field not found in PDF")
    doc.save(out_path, garbage=3, deflate=True)
    return filled, errors
