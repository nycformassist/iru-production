"""
I-90 binder: Tier 1 facts -> fill plan + review queue.
Follows the I-130 binder pattern.
"""
import json
import os
import sys
# bundled: _python is on sys.path via api/ directory
from _python.binder import bind  # Reuse the core binder logic

def load_i90_registry():
    mappings = json.load(open(os.path.join(os.path.dirname(__file__), 'i90_detailed_registry.json')))
    fields = json.load(open(os.path.join(os.path.dirname(__file__), 'i90_fields.json')))
    name_map = {f['short']: f['name'] for f in fields}
    type_map = {f['short']: f['type'] for f in fields}

    registry = {}
    # Filing reason checkboxes
    for val, short in mappings["i90_filing_reason"].items():
        registry[f"i90_filing_reason_{val}"] = {
            "fact": "i90_filing_reason",
            "field": name_map[short],
            "kind": "checkbox",
            "expected_value": val,
        }
    # Text fields
    for fact_id in ["family_name", "given_name", "a_number", "date_of_birth"]:
        short = mappings[fact_id]
        registry[fact_id] = {
            "fact": fact_id,
            "field": name_map[short],
            "kind": "text",
        }
    return registry

def build_i90_plan(facts):
    """
    Build fill plan for I-90.
    facts: dict of fact_id -> Tier1Fact
    Returns (plan, review_queue)
    """
    registry = load_i90_registry()
    plan = []
    review = []

    for reg_id, spec in registry.items():
        fact_id = spec["fact"]
        fact = facts.get(fact_id)
        if not fact:
            continue

        # For checkbox groups, only fill if value matches
        if spec["kind"] == "checkbox":
            # Check conflict FIRST, even if value doesn't match expected
            # (conflicted facts should never fill)
            if fact.get("status") == "conflicted":
                # Only add once per fact
                if not any(r["fact"] == fact_id and r["reason"] == "conflict" for r in review):
                    review.append({
                        "fact": fact_id, "reason": "conflict",
                        "detail": f"Conflicting values for filing reason."
                    })
                continue
            if fact.get("value") == spec["expected_value"]:
                if fact.get("confidence", 0) < 0.7:
                    review.append({
                        "fact": fact_id, "reason": "uncertain",
                        "detail": f"Low confidence ({fact.get('confidence', 0):.0%}) for filing reason."
                    })
                else:
                    plan.append((spec["field"], True, "checkbox", fact_id))
            # If value doesn't match, skip (don't check the box)
        else:
            # Text field: use standard binder logic
            from _python.binder import bind as core_bind
            single_reg = {fact_id: {"kind": "text", "field": spec["field"], "required": False}}
            p, r = core_bind(single_reg, {fact_id: fact})
            plan.extend(p)
            review.extend(r)

    return plan, review

if __name__ == "__main__":
    # Test
    from datetime import datetime, timezone
    now = lambda: datetime.now(timezone.utc).isoformat()
    def F(fid, val, conf=1.0):
        return {"id": fid, "value": val, "source": "applicant-typed",
                "confidence": conf, "status": "verified", "corrections": [], "updatedAt": now()}

    facts = {
        "i90_filing_reason": F("i90_filing_reason", "2f"),
        "family_name": F("family_name", "RIVERA"),
        "given_name": F("given_name", "JOSE"),
        "a_number": F("a_number", "A987654321"),
        "date_of_birth": F("date_of_birth", "11/03/1975"),
    }
    plan, review = build_i90_plan(facts)
    print(f"I-90: {len(plan)} fields, {len(review)} review items")
    for f, v, k, fid in plan:
        print(f"  [{k}] {f.split('.')[-1][:40]} <- {v}")
