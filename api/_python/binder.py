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
AUTO_FILL_CONFIDENCE = 0.7

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
        elif kind == "checkbox_group":
            field = spec["mapping"].get(value)
            if field:
                fill_plan.append((field, True, "checkbox", fact_id))
            else:
                review_queue.append({"fact": fact_id, "reason": "unmappable-value",
                    "detail": f"Value '{value}' has no checkbox mapping."})
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
                try:
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
