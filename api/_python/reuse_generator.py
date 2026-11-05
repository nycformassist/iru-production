"""
Reuse generator: apply I-130's proven patterns to generate mappings for four forms.
Uses address component patterns, identity field patterns, and semantic matching.
"""
import json
import re

def load_form_data(form):
    fields = json.load(open(f'/home/hatch/workspace/iru-form-engine/{form}_fields.json'))
    baseline = json.load(open(f'/home/hatch/workspace/iru-form-engine/{form}_baseline.json'))
    return fields, baseline

def generate_address_mappings(form):
    """
    Generate address mappings using I-130's address component patterns.
    The address.py module handles: street, unit, city, state, zip, country,
    in_care_of, province, postal_code + Apt/Ste/Flr checkboxes.
    """
    fields, _ = load_form_data(form)
    mappings = []

    # Group fields by likely address block (by page and proximity in name)
    # I-90: P1_Line6* (mailing), P1_Line7* (physical)
    # N-400: Part 5 address fields
    # I-765: mailing/residence address
    # I-485: Part 1 address fields

    addr_keywords = ['street', 'city', 'state', 'zip', 'postal', 'province',
                     'country', 'apt', 'unit', 'incare', 'careof']

    for f in fields:
        short_lower = f['short'].lower()
        # Skip consumer fields
        if any(k in short_lower for k in ['preparer', 'interpreter', 'attorney',
                                            'signature', 'certif']):
            continue
        if any(k in short_lower for k in addr_keywords):
            # Determine the semantic field type
            field_type = None
            if 'street' in short_lower or 'address' in short_lower:
                field_type = 'street'
            elif 'city' in short_lower or 'town' in short_lower:
                field_type = 'city'
            elif 'state' in short_lower:
                field_type = 'state'
            elif 'zip' in short_lower:
                field_type = 'zip'
            elif 'postal' in short_lower:
                field_type = 'postal_code'
            elif 'province' in short_lower:
                field_type = 'province'
            elif 'country' in short_lower:
                field_type = 'country'
            elif 'apt' in short_lower or 'unit' in short_lower:
                field_type = 'unit'
            elif 'care' in short_lower:
                field_type = 'in_care_of'

            if field_type:
                mappings.append({
                    "field": f['short'],
                    "full_name": f['name'],
                    "type": f['type'],
                    "semantic": field_type,
                    "source": "generated: address-component-pattern",
                    "confidence": "high",  # Pattern is proven
                })

    return mappings

def generate_identity_mappings(form):
    """Generate identity mappings (name, DOB, A-number) via pattern matching."""
    fields, _ = load_form_data(form)
    mappings = []

    patterns = {
        'family_name': ['familyname', 'lastname', 'surname'],
        'given_name': ['givenname', 'firstname'],
        'middle_name': ['middlename'],
        'date_of_birth': ['dateofbirth', 'dob', '_dob['],
        'a_number': ['aliennumber', 'a_number', 'anumber'],
    }

    for f in fields:
        short_lower = f['short'].lower()
        # Skip consumer fields (preparer, interpreter, attorney, signature)
        if any(k in short_lower for k in ['preparer', 'interpreter', 'attorney',
                                            'signature', 'certif']):
            continue
        for semantic, keywords in patterns.items():
            if any(k in short_lower for k in keywords):
                mappings.append({
                    "field": f['short'],
                    "full_name": f['name'],
                    "type": f['type'],
                    "semantic": semantic,
                    "source": "generated: identity-pattern",
                    "confidence": "high",
                })
                break

    return mappings

if __name__ == "__main__":
    for form in ['i90', 'n400', 'i765', 'i485']:
        addr = generate_address_mappings(form)
        ident = generate_identity_mappings(form)
        print(f"{form.upper()}: {len(addr)} address + {len(ident)} identity = "
              f"{len(addr) + len(ident)} generated mappings")

        # Save
        with open(f'/home/hatch/workspace/iru-form-engine/{form}_generated.json', 'w') as f:
            json.dump({"address": addr, "identity": ident}, f, indent=1)
