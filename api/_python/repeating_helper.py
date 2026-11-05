"""
Repeating group helper: maps fact arrays to PDF repeating field sets.
"""
import re

def bind_repeating(facts, group_id, field_template, max_entries=6):
    """
    Bind a repeating group.
    
    facts: dict of facts, expects f"{group_id}" to be a list of entry dicts
    group_id: e.g., "n400_trips"
    field_template: dict mapping entry field -> PDF field template with {n}
                    e.g., {"date_from": "P8_Trip{n}_DateFrom[0]"}
    max_entries: maximum entries to process
    
    Returns: (fill_plan, review_queue)
    """
    fill_plan = []
    review = []
    
    entries = facts.get(group_id, {}).get("value", [])
    if not isinstance(entries, list):
        entries = []
    
    for idx, entry in enumerate(entries[:max_entries]):
        n = idx + 1
        for entry_field, template in field_template.items():
            pdf_field = template.format(n=n)
            value = entry.get(entry_field)
            if value:
                # Simple fill - in production, would use binder.bind() for validation
                fill_plan.append((pdf_field, str(value), "text", f"{group_id}_{n}_{entry_field}"))
    
    return fill_plan, review

def get_n400_trip_template(_fields=None, _name_map=None):
    """N-400 Part 8 travel: 6 trips."""
    # Field pattern: P8_Line1_DateLeft{n}[0], P8_Line1_DateReturn{n}[0]
    # Need full field names from _name_map
    if _name_map:
        return {
            "date_from": _name_map.get("P8_Line1_DateLeft{n}[0]", "").format(n="{n}"),
            "date_to": _name_map.get("P8_Line1_DateReturn{n}[0]", "").format(n="{n}"),
        }
    return {
        "date_from": "P8_Line1_DateLeft{n}[0]",
        "date_to": "P8_Line1_DateReturn{n}[0]",
    }
