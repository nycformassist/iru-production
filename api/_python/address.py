"""
Reusable structured address component for IRU form completion.

Design:
- One structured address fact feeds any address block on any form via a
  field-prefix mapper. The I-130 alone has 6 address blocks (101 subfields);
  the same component serves N-400, I-485, I-90, I-765.
- Addresses are repeating groups: a person has mailing + physical + history,
  each with date ranges.
- Unit type (Apt/Ste/Flr) maps to the 3-checkbox pattern USCIS uses.

Address fact shape:
{
  "street": str, "unit_type": "Apt"|"Ste"|"Flr"|None, "unit_number": str,
  "city": str, "state": str,            # US
  "zip": str, "province": str,           # non-US
  "postal_code": str, "country": str,
  "in_care_of": str,                     # mailing only
  "date_from": str, "date_to": str,      # history only
}
"""

UNIT_MAP = {"Apt": 0, "Ste": 1, "Flr": 2}

def address_to_fill_plan(prefix, addr, full_prefix, variant_map=None):
    """Map a structured address to fill-plan entries for one field block.
    prefix: e.g. 'Pt2Line10'; full_prefix: e.g. 'form1[0].#subform[1].Pt2Line10'
    variant_map: optional dict mapping standard suffix -> block-specific suffix,
                 e.g. {"_StreetNumberName": "a_StreetNumberName"} for Pt4Line12's
                 12a/12b/12c lettering.
    Returns list of (field_name, value, kind, fact_id)."""
    plan = []
    P = full_prefix
    vm = variant_map or {}
    def suffix(std):
        return vm.get(std, std)
    def add(std_suffix, value, kind="text"):
        if value:
            plan.append((f"{P}{suffix(std_suffix)}", value, kind, f"address:{prefix}"))

    add("_StreetNumberName[0]", addr.get("street"))
    # Unit checkboxes: Apt/Ste/Flr
    ut = addr.get("unit_type")
    if ut in UNIT_MAP:
        for name, idx in UNIT_MAP.items():
            plan.append((f"{P}{suffix('_Unit')}[{idx}]", name == ut, "checkbox", f"address:{prefix}"))
    add("_AptSteFlrNumber[0]", addr.get("unit_number"))
    add("_CityOrTown[0]", addr.get("city"))
    add("_State[0]", addr.get("state"), "combobox")
    add("_ZipCode[0]", addr.get("zip"))
    add("_Province[0]", addr.get("province"))
    add("_PostalCode[0]", addr.get("postal_code"))
    add("_Country[0]", addr.get("country"))
    add("_InCareofName[0]", addr.get("in_care_of"))
    return plan


# Pt4Line12 uses lettered variants: 12a street, 12b unit, 12c city, 12d state, 12e zip
PT4LINE12_VARIANT = {
    "_StreetNumberName[0]": "a_StreetNumberName[0]",
    "_Unit": "b_Unit",
    "_AptSteFlrNumber[0]": "b_AptSteFlrNumber[0]",
    "_CityOrTown[0]": "c_CityOrTown[0]",
    "_State[0]": "d_State[0]",
    "_ZipCode[0]": "e_ZipCode[0]",
}


# I-130 address block prefixes (full PyMuPDF field-name prefixes)
I130_ADDRESS_BLOCKS = {
    # petitioner mailing (p1)
    "petitioner_mailing": "form1[0].#subform[1].Pt2Line10",
    # petitioner physical address 1 (p1)
    "petitioner_physical_1": "form1[0].#subform[1].Pt2Line12",
    # petitioner physical address 2 / history (p1)
    "petitioner_physical_2": "form1[0].#subform[1].Pt2Line14",
    # beneficiary physical (p4)
    "beneficiary_physical": "form1[0].#subform[4].Pt4Line11",
    # beneficiary other address (p4)
    "beneficiary_other": "form1[0].#subform[4].Pt4Line12",
    # beneficiary outside-US address (p4)
    "beneficiary_abroad": "form1[0].#subform[4].Pt4Line13",
}
