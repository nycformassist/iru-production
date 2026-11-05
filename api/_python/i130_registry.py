"""
I-130 AcroForm field registry — maps Tier 1 factIds to PDF field names.
Pattern follows api/_lib/registry.js (I-589/I-765) but targets XFA-derived
AcroForm fields fillable via PyMuPDF (pdf-lib cannot enumerate these).
Field names verified against i-130.pdf (edition 04/01/24) via PyMuPDF.
"""
I130_REGISTRY = {
    # Part 1: Relationship — Line 1 checkboxes (select one)
    "i130_beneficiary_relationship": {
        "kind": "checkbox_group",
        "mapping": {
            "spouse": "form1[0].#subform[0].Pt1Line1_Spouse[0]",
            "child_under_21": "form1[0].#subform[0].Pt1Line1_Child[0]",
            "son_daughter_over_21": "form1[0].#subform[0].Pt1Line1_Child[0]",
            "married_child": "form1[0].#subform[0].Pt1Line1_Child[0]",
            "sibling": "form1[0].#subform[0].Pt1Line1_Siblings[0]",
            "parent": "form1[0].#subform[0].Pt1Line1_Parent[0]",
        },
        "required": True,
    },
    # Part 2: Petitioner — status (Line 36)
    "i130_petitioner_is_usc": {
        "kind": "checkbox_group",
        "mapping": {
            "usc": "form1[0].#subform[2].Pt2Line36_USCitizen[0]",
            "lpr": "form1[0].#subform[2].Pt2Line36_LPR[0]",
        },
        "required": True,
    },
    # Part 2: Petitioner — name (Lines 4a-4c)
    "i130_petitioner_family_name": {
        "kind": "text", "field": "form1[0].#subform[0].Pt2Line4a_FamilyName[0]", "required": True,
    },
    "i130_petitioner_given_name": {
        "kind": "text", "field": "form1[0].#subform[0].Pt2Line4b_GivenName[0]", "required": True,
    },
    "i130_petitioner_a_number": {
        "kind": "text", "field": "form1[0].#subform[0].#area[4].Pt2Line1_AlienNumber[0]", "required": False,
    },
    "i130_petitioner_dob": {
        "kind": "text", "field": "form1[0].#subform[1].Pt2Line8_DateofBirth[0]",
        "required": True, "format": "dateMDY",
    },
    # Part 4: Beneficiary — name (Lines 4a-4c)
    "i130_beneficiary_family_name": {
        "kind": "text", "field": "form1[0].#subform[4].Pt4Line4a_FamilyName[0]", "required": True,
    },
    "i130_beneficiary_given_name": {
        "kind": "text", "field": "form1[0].#subform[4].Pt4Line4b_GivenName[0]", "required": True,
    },
    "i130_beneficiary_a_number": {
        "kind": "text", "field": "form1[0].#subform[4].#area[6].Pt4Line1_AlienNumber[0]", "required": False,
    },
    "i130_beneficiary_dob": {
        "kind": "text", "field": "form1[0].#subform[4].Pt4Line9_DateOfBirth[0]",
        "required": True, "format": "dateMDY",
    },
    "i130_beneficiary_birth_country": {
        "kind": "text", "field": "form1[0].#subform[4].Pt4Line8_CountryOfBirth[0]", "required": True,
    },
}
