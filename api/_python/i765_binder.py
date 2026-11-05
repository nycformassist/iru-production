"""I765 binder: Tier 1 facts -> fill plan + review queue."""
import json
import os, sys
# bundled: _python is on sys.path via api/ directory
from _python.binder import bind
def build_i765_plan(facts):
    mappings = json.load(open(os.path.join(os.path.dirname(__file__), 'i765_detailed_registry.json')))
    fields = json.load(open(os.path.join(os.path.dirname(__file__), 'i765_fields.json')))
    name_map = {f['short']: f['name'] for f in fields}
    registry = {}
    for fact_id, short in mappings.items():
        registry[fact_id] = {"fact": fact_id, "field": name_map[short], "kind": "text", "required": False}
    return bind(registry, facts)
