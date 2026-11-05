"""N-400 binder: Tier 1 facts -> fill plan + review queue."""
import json
import os, sys
# bundled: _python is on sys.path via api/ directory
from _python.binder import bind

def build_n400_plan(facts):
    mappings = json.load(open(os.path.join(os.path.dirname(__file__), 'n400_detailed_registry.json')))
    fields = json.load(open(os.path.join(os.path.dirname(__file__), 'n400_fields.json')))
    name_map = {f['short']: f['name'] for f in fields}

    registry = {}
    for fact_id, short in mappings.items():
        registry[fact_id] = {
            "fact": fact_id, "field": name_map[short], "kind": "text", "required": False
        }
    return bind(registry, facts)

if __name__ == "__main__":
    from datetime import datetime, timezone
    now = lambda: datetime.now(timezone.utc).isoformat()
    def F(fid, val):
        return {"id": fid, "value": val, "source": "applicant-typed",
                "confidence": 1.0, "status": "verified", "corrections": [], "updatedAt": now()}
    facts = {
        "a_number": F("a_number", "A111222333"),
        "family_name": F("family_name", "GARCIA"),
        "given_name": F("given_name", "ANA"),
        "date_of_birth": F("date_of_birth", "05/20/1990"),
        "email": F("email", "ana.garcia@example.com"),
        "phone": F("phone", "718-555-0199"),
    }
    plan, review = build_n400_plan(facts)
    print(f"N-400: {len(plan)} fields, {len(review)} review items")
