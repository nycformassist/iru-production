"""
Address history: repeating groups with date ranges, wired to fact records.

Each address entry is a Tier1Fact-style record:
{
  "id": "addr_1", "kind": "mailing"|"physical",
  "value": {address fields...},
  "source": "applicant-typed", "confidence": 1.0, "status": "verified",
  "date_from": "2020-01-15", "date_to": "present",
  "corrections": [], "updatedAt": ...
}

The binder gates each address by its confidence/status before mapping.
I-130 physical history: Physical Address 1 (12a-12h) + dates (13a/13b),
Physical Address 2 (14a-14h) + dates (15a/15b).
"""
from _python.address import address_to_fill_plan, I130_ADDRESS_BLOCKS

def bind_addresses(address_facts, block_map, confidence_threshold=0.7):
    """Bind a list of address facts to fill plan + review queue.
    block_map: list of (fact_id, block_key) in priority order.
    Returns (fill_plan, review_queue)."""
    fill_plan, review = [], []
    for fact_id, block_key in block_map:
        fact = next((f for f in address_facts if f["id"] == fact_id), None)
        if fact is None:
            continue
        conf, status = fact["confidence"], fact["status"]
        if status == "conflicted":
            review.append({"fact": fact_id, "reason": "conflict",
                "detail": f"Address conflicts with {fact.get('conflict', {}).get('other_source', 'another source')}"})
            continue
        if conf < confidence_threshold:
            review.append({"fact": fact_id, "reason": "uncertain",
                "detail": f"Address confidence {conf:.2f} below {confidence_threshold}"})
            continue
        prefix = I130_ADDRESS_BLOCKS[block_key]
        plan = address_to_fill_plan(block_key, fact["value"], prefix)
        # tag with fact id for traceability
        plan = [(f, v, k, fact_id) for f, v, k, _ in plan]
        fill_plan.extend(plan)
        # date range -> I-130 date fields (13a/13b for block 1, 15a/15b for block 2)
        date_fields = {
            "petitioner_physical_1": ("form1[0].#subform[1].Pt2Line13a_DateFrom[0]",
                                      "form1[0].#subform[1].Pt2Line13b_DateTo[0]"),
            "petitioner_physical_2": ("form1[0].#subform[1].Pt2Line15a_DateFrom[0]",
                                      "form1[0].#subform[1].Pt2Line15b_DateTo[0]"),
        }
        if block_key in date_fields:
            df, dt = date_fields[block_key]
            if fact.get("date_from"):
                fill_plan.append((df, fact["date_from"], "text", fact_id))
            if fact.get("date_to"):
                fill_plan.append((dt, fact["date_to"], "text", fact_id))
    return fill_plan, review
