"""
Repeating group PDF binder: populates repeating field sets from fact arrays.

Each form's repeating groups are defined as templates. The binder takes
a list of entries and populates the corresponding PDF fields.
"""
import json
import os

# Load field name maps
def _load_name_map(form):
    path = f'/home/hatch/workspace/iru-form-engine/{form}_fields.json'
    fields = json.load(open(path))
    return {f['short']: f['name'] for f in fields}

# Repeating group definitions
# Each: (group_id, max_entries, field_template)
# field_template: {entry_key: pdf_short_template} where {n} is entry number

REPEATING_GROUPS = {
    'n400': [
        {
            'id': 'n400_trips',
            'label': 'Travel history (Part 8)',
            'max_entries': 6,
            'fields': {
                'date_left': 'P8_Line1_DateLeft{n}[0]',
                'date_return': 'P8_Line1_DateReturn{n}[0]',
            },
        },
        {
            'id': 'n400_employment',
            'label': 'Employment (Part 7)',
            'max_entries': 3,
            'fields': {
                'employer_name': 'P7_EmployerName{n}[0]',
                'occupation': 'P7_OccupationFieldStudy{n}[0]',
            },
        },
    ],
    'i485': [
        {
            'id': 'i485_children',
            'label': 'Children (Part 6)',
            'max_entries': 1,
            'fields': {
                'family_name': 'Pt6Line12_FamilyName[{idx}]',
                'given_name': 'Pt6Line12_GivenName[{idx}]',
                'city_of_birth': 'Pt6Line10_CityTownOfBirth[{idx}]',
                'country_of_birth': 'Pt6Line10_Country[{idx}]',
            },
            'zero_based': True,
        },
    ],
    'i130': [
        # I-130 address history handled by address_history.py
    ],
    'i90': [],
    'i765': [
        {
            'id': 'i765_other_names',
            'label': 'Other names used (Part 1)',
            'max_entries': 2,
            'fields': {
                'family_name': 'Line3a_FamilyName[{idx}]',
                'given_name': 'Line3b_GivenName[{idx}]',
                'middle_name': 'Line3c_MiddleName[{idx}]',
            },
            'zero_based': True,
        },
    ],
}

def bind_repeating_group(form, group_def, entries, name_map):
    """
    Bind repeating entries to PDF fields.
    
    Returns: (fill_plan, review_queue, overflow)
    - fill_plan: list of (pdf_field_full_name, value, kind, fact_id)
    - review_queue: list of review items
    - overflow: list of entries that didn't fit (if max exceeded)
    """
    fill_plan = []
    review = []
    overflow = []
    
    max_n = group_def['max_entries']
    fields = group_def['fields']
    
    # Handle overflow explicitly
    if len(entries) > max_n:
        overflow = entries[max_n:]
        entries = entries[:max_n]
        review.append({
            'group': group_def['id'],
            'reason': 'overflow',
            'message': f'{len(overflow)} entries exceed PDF capacity ({max_n}). Additional entries require Part 14.',
            'overflow_count': len(overflow),
        })
    
    zero_based = group_def.get('zero_based', False)
    for idx, entry in enumerate(entries):
        n = idx + 1
        idx_val = idx if zero_based else n
        for entry_key, template in fields.items():
            short = template.format(n=n, idx=idx_val)
            full_name = name_map.get(short)
            if not full_name:
                continue
            value = entry.get(entry_key)
            if value:
                fill_plan.append((
                    full_name,
                    str(value),
                    'text',
                    f"{group_def['id']}_{n}_{entry_key}"
                ))
    
    return fill_plan, review, overflow

def get_repeating_groups(form):
    """Return repeating group definitions for a form."""
    return REPEATING_GROUPS.get(form, [])
