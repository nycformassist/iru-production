"""
Complete I-130 field registry — Phase 5.
Maps every AUTO + ASK field to its fact ID and PDF field name.
Built from i130_baseline_locked.json (438 fields, zero unclassified).

Organization: question groups, each mapping to one or more fields.
Reuses: address.py (101 fields), biographic.py (30 fields).
"""
# Two homes, two import paths (same rule as the I-589 binder,
# i589_full_binder.py:30-33): the worktree copy loads as
# _python.i130_full_registry (Vercel, api/ on sys.path), the engine
# copy as a top-level module (local api_server imports from
# ../iru-form-engine). Bare `from address import ...` crashes with
# ModuleNotFoundError on a cold start when api/_python is not on
# sys.path (Carbon Pass 2, H-4).
try:
    from _python.address import I130_ADDRESS_BLOCKS
    from _python.biographic import BIOGRAPHIC_REGISTRY
except ImportError:  # pragma: no cover - engine-copy import path
    from address import I130_ADDRESS_BLOCKS
    from biographic import BIOGRAPHIC_REGISTRY

# Full field name prefix resolver
def F(subform, name):
    return f"form1[0].#subform[{subform}].{name}"

# ── AUTO: existing facts (23 fields) ──────────────────────────────
AUTO_REGISTRY = {
    "i130_beneficiary_relationship": {
        "kind": "checkbox_group", "mapping": {
            "spouse": F(0, "Pt1Line1_Spouse[0]"),
            "child_under_21": F(0, "Pt1Line1_Child[0]"),
            "son_daughter_over_21": F(0, "Pt1Line1_Child[0]"),
            "married_child": F(0, "Pt1Line1_Child[0]"),
            "sibling": F(0, "Pt1Line1_Siblings[0]"),
            "parent": F(0, "Pt1Line1_Parent[0]"),
        }},
    "i130_petitioner_is_usc": {
        "kind": "checkbox_group", "mapping": {
            "usc": F(2, "Pt2Line36_USCitizen[0]"),
            "lpr": F(2, "Pt2Line36_LPR[0]"),
        }},
    "i130_petitioner_family_name": {"kind": "text", "field": F(0, "Pt2Line4a_FamilyName[0]")},
    "i130_petitioner_given_name": {"kind": "text", "field": F(0, "Pt2Line4b_GivenName[0]")},
    "i130_petitioner_a_number": {"kind": "text", "field": F(0, "#area[4].Pt2Line1_AlienNumber[0]")},
    "i130_petitioner_dob": {"kind": "text", "field": F(1, "Pt2Line8_DateofBirth[0]")},
    "i130_petitioner_street": {"kind": "text", "field": F(1, "Pt2Line12_StreetNumberName[0]")},
    "i130_petitioner_city": {"kind": "text", "field": F(1, "Pt2Line12_CityOrTown[0]")},
    "i130_petitioner_state": {"kind": "text", "field": F(1, "Pt2Line12_State[0]")},
    "i130_petitioner_zip": {"kind": "text", "field": F(1, "Pt2Line12_PostalCode[0]")},
    "i130_petitioner_country": {"kind": "text", "field": F(1, "Pt2Line12_Country[0]")},
    "i130_beneficiary_family_name": {"kind": "text", "field": F(4, "Pt4Line4a_FamilyName[0]")},
    "i130_beneficiary_given_name": {"kind": "text", "field": F(4, "Pt4Line4b_GivenName[0]")},
    "i130_beneficiary_a_number": {"kind": "text", "field": F(4, "#area[6].Pt4Line1_AlienNumber[0]")},
    "i130_beneficiary_dob": {"kind": "text", "field": F(4, "Pt4Line9_DateOfBirth[0]")},
    "i130_beneficiary_birth_country": {"kind": "text", "field": F(4, "Pt4Line8_CountryOfBirth[0]")},
    "i130_beneficiary_street": {"kind": "text", "field": F(4, "Pt4Line11_StreetNumberName[0]")},
    "i130_beneficiary_city": {"kind": "text", "field": F(4, "Pt4Line11_CityOrTown[0]")},
    "i130_beneficiary_state": {"kind": "text", "field": F(4, "Pt4Line11_State[0]")},
    "i130_beneficiary_zip": {"kind": "text", "field": F(4, "Pt4Line11_PostalCode[0]")},
    "i130_beneficiary_country": {"kind": "text", "field": F(4, "Pt4Line11_Country[0]")},
    "i130_filed_before": {
        "kind": "checkbox_group", "mapping": {
            "yes": F(7, "Part4Line1_Yes[0]"),   # Pt5 Line 1 on page 7
            "no": F(7, "Part4Line1_No[0]"),
        }},
# ── EXPANSION 2026-11-04: Part A (Pt1/Pt3/Pt5/Pt6) ──

    # ── PT1: Relationship ──────────────────────────────────────────
    "i130_child_relationship_type": {
        "kind": "checkbox_group", "mapping": {
            "in_wedlock": F(0, "Pt1Line2_InWedlock[0]"),
            "adopted": F(0, "Pt1Line2_AdoptedChild[0]"),
            "stepchild": F(0, "Pt1Line2_Stepchild[0]"),
            "out_of_wedlock": F(0, "Pt1Line2_OutOfWedlock[0]"),
        }},
    "i130_multiple_beneficiaries": {
        "kind": "checkbox_group", "mapping": {
            "yes": F(0, "Pt1Line3_Yes[0]"),
            "no": F(0, "Pt1Line3_No[0]"),
        }},
    "i130_concurrent_filing": {
        "kind": "checkbox_group", "mapping": {
            "yes": F(0, "Pt1Line4_Yes[0]"),
            "no": F(0, "Pt1Line4_No[0]"),
        }},

    # ── PT3: Biographic ────────────────────────────────────────────
    # Ethnicity: verified — [1] = Hispanic or Latino, [0] = Not Hispanic or Latino
    "i130_petitioner_ethnicity": {
        "kind": "checkbox_group", "mapping": {
            "yes": F(3, "Pt3Line1_Ethnicity[1]"),
            "no": F(3, "Pt3Line1_Ethnicity[0]"),
        }},
    "i130_petitioner_race": {
        "kind": "checkbox_group", "mapping": {
            "white": F(3, "Pt3Line2_Race_White[0]"),
            "black": F(3, "Pt3Line2_Race_Black[0]"),
            "asian": F(3, "Pt3Line2_Race_Asian[0]"),
            "american_indian_alaska_native": F(3, "Pt3Line2_Race_AmericanIndianAlaskaNative[0]"),
            "native_hawaiian_pacific_islander": F(3, "Pt3Line2_Race_NativeHawaiianOtherPacificIslander[0]"),
        }},
    # Height: single text answer ("5'8\""); the binder parses feet/inches
    # and sets BOTH comboboxes (Carbon Pass 1 finding 20). The old
    # kind:"text" mapping wrote the raw "5'8\"" into the feet-only box.
    "i130_petitioner_height": {
        "kind": "height",
        "fields": [F(3, "Pt3Line3_HeightFeet[0]"), F(3, "Pt3Line3_HeightInches[0]")]},
    # Weight: 3 digit fields — use weight_digits kind (see biographic.py binder)
    "i130_petitioner_weight": {
        "kind": "weight_digits",
        "fields": [F(3, "Pt3Line4_Pound1[0]"), F(3, "Pt3Line4_Pound2[0]"), F(3, "Pt3Line4_Pound3[0]")]},
    # Eye color: VERIFIED indices (not in visual order)
    "i130_petitioner_eye_color": {
        "kind": "checkbox_group", "mapping": {
            "black": F(3, "Pt3Line5_EyeColor[7]"),
            "blue": F(3, "Pt3Line5_EyeColor[0]"),
            "brown": F(3, "Pt3Line5_EyeColor[1]"),
            "gray": F(3, "Pt3Line5_EyeColor[6]"),
            "green": F(3, "Pt3Line5_EyeColor[5]"),
            "hazel": F(3, "Pt3Line5_EyeColor[2]"),
            "maroon": F(3, "Pt3Line5_EyeColor[4]"),
            "pink": F(3, "Pt3Line5_EyeColor[3]"),
            "unknown": F(3, "Pt3Line5_EyeColor[8]"),
        }},
    # Hair color: fields live in subform[4], NOT subform[3]
    "i130_petitioner_hair_color": {
        "kind": "checkbox_group", "mapping": {
            "bald": F(4, "Pt3Line6_HairColor[0]"),
            "black": F(4, "Pt3Line6_HairColor[1]"),
            "blond": F(4, "Pt3Line6_HairColor[2]"),
            "brown": F(4, "Pt3Line6_HairColor[3]"),
            "gray": F(4, "Pt3Line6_HairColor[4]"),
            "red": F(4, "Pt3Line6_HairColor[5]"),
            "sandy": F(4, "Pt3Line6_HairColor[6]"),
            "white": F(4, "Pt3Line6_HairColor[7]"),
            "unknown": F(4, "Pt3Line6_HairColor[8]"),
        }},

    # ── PT5: Other information / prior petition ────────────────────
    "i130_other_name_family": {"kind": "text", "field": F(7, "Pt5Line2a_FamilyName[0]")},
    # Location: city mapped; state field Pt5Line3b_State[0] (subform[7]) needs
    # a separate question or binder split.
    "i130_prior_petition_location": {"kind": "text", "field": F(7, "Pt5Line3a_CityOrTown[0]")},
    "i130_prior_petition_date": {"kind": "text", "field": F(7, "Pt5Line4_DateFiled[0]")},
    "i130_prior_petition_result": {"kind": "text", "field": F(7, "Pt5Line5_Result[0]")},

    # ── PT6: Contact ───────────────────────────────────────────────
    "i130_petitioner_phone": {"kind": "text", "field": F(8, "Pt6Line3_DaytimePhoneNumber[0]")},
    "i130_petitioner_mobile": {"kind": "text", "field": F(8, "Pt6Line4_MobileNumber[0]")},
    "i130_petitioner_email": {"kind": "text", "field": F(8, "Pt6Line5_Email[0]")},
    "i130_interpreter_language": {"kind": "text", "field": F(8, "Pt6Line1b_Language[0]")},
# ── EXPANSION 2026-11-04: Part B (Pt2 Petitioner) ──

    # Line 5: other names (simplified — single text -> family name field)
    "i130_petitioner_other_name": {
        "kind": "text", "field": F(1, "Pt2Line5a_FamilyName[0]"), "required": False,
    },
    # Line 4c: middle name
    "i130_petitioner_middle_name": {
        "kind": "text", "field": F(0, "Pt2Line4c_MiddleName[0]"), "required": False,
    },
    # Lines 6/7: birthplace
    "i130_petitioner_birth_city": {
        "kind": "text", "field": F(1, "Pt2Line6_CityTownOfBirth[0]"), "required": False,
    },
    "i130_petitioner_birth_country": {
        "kind": "text", "field": F(1, "Pt2Line7_CountryofBirth[0]"), "required": False,
    },
    # Line 9: gender
    "i130_petitioner_gender": {
        "kind": "checkbox_group", "mapping": {
            "male": F(1, "Pt2Line9_Male[0]"),
            "female": F(1, "Pt2Line9_Female[0]"),
        }, "required": False,
    },
    # Line 10: mailing address (street only, per simplification)
    "i130_petitioner_mailing_street": {
        "kind": "text", "field": F(1, "Pt2Line10_StreetNumberName[0]"), "required": False,
    },
    # Line 16: number of marriages
    "i130_petitioner_marriages": {
        "kind": "text", "field": F(1, "Pt2Line16_NumberofMarriages[0]"), "required": False,
    },
    # Line 17: current marital status (all 6 verified checkboxes, incl. Single)
    "i130_petitioner_marital_status": {
        "kind": "checkbox_group", "mapping": {
            "single": F(1, "Pt2Line17_Single[0]"),
            "married": F(1, "Pt2Line17_Married[0]"),
            "separated": F(1, "Pt2Line17_Separated[0]"),
            "divorced": F(1, "Pt2Line17_Divorced[0]"),
            "annulled": F(1, "Pt2Line17_Annulled[0]"),
            "widowed": F(1, "Pt2Line17_Widowed[0]"),
        }, "required": False,
    },
    # Line 18/19a: current marriage date + place (city/town)
    "i130_petitioner_marriage_date": {
        "kind": "text", "field": F(2, "Pt2Line18_DateOfMarriage[0]"),
        "required": False, "format": "dateMDY",
    },
    "i130_petitioner_marriage_place": {
        "kind": "text", "field": F(2, "Pt2Line19a_CityTown[0]"), "required": False,
    },
    # Lines 22a/23: prior spouse 1 family name + marriage end date
    "i130_petitioner_prior_spouse1_family": {
        "kind": "text", "field": F(2, "Pt2Line22a_FamilyName[0]"), "required": False,
    },
    "i130_petitioner_prior_spouse1_end": {
        "kind": "text", "field": F(2, "Pt2Line23_DateMarriageEnded[0]"),
        "required": False, "format": "dateMDY",
    },
    # Line 24: prior spouse 2 family name
    "i130_petitioner_prior_spouse2_family": {
        "kind": "text", "field": F(2, "Pt2Line24_FamilyName[0]"), "required": False,
    },
    # Line 30a: prior spouse 3 family name
    "i130_petitioner_prior_spouse3_family": {
        "kind": "text", "field": F(2, "Pt2Line30a_FamilyName[0]"), "required": False,
    },
    # Line 36: naturalization Yes/No (distinct group from Pt2Line36 USCitizen/LPR
    # checkboxes used by i130_petitioner_is_usc — both exist in the baseline)
    "i130_petitioner_naturalized": {
        "kind": "checkbox_group", "mapping": {
            "yes": F(2, "Pt2Line36_Yes[0]"),
            "no": F(2, "Pt2Line36_No[0]"),
        }, "required": False,
    },
    # Line 37a: certificate number
    "i130_petitioner_cert_number": {
        "kind": "text", "field": F(2, "Pt2Line37a_CertificateNumber[0]"), "required": False,
    },
    # Lines 40/42: employment
    "i130_petitioner_employer": {
        "kind": "text", "field": F(3, "Pt2Line40_EmployerOrCompName[0]"), "required": False,
    },
    "i130_petitioner_occupation": {
        "kind": "text", "field": F(3, "Pt2Line42_Occupation[0]"), "required": False,
    },
    # Line 2: USCIS online account number
    "i130_petitioner_uscis_account": {
        "kind": "text", "field": F(0, "Pt2Line2_USCISOnlineActNumber[0]"), "required": False,
    },
# ── EXPANSION 2026-11-04: Part C (Pt4 Beneficiary) ──

    # Middle name (Line4c)
    "i130_beneficiary_middle_name": {"kind": "text", "field": F(4, "Pt4Line4c_MiddleName[0]")},
    # Other names used (Line5b/c, 6a/b/c, 8a/b/c) — family name slot
    "i130_beneficiary_other_name": {"kind": "text", "field": F(4, "Pt4Line6a_FamilyName[0]")},
    # Gender (Line9: Male/Female checkboxes)
    "i130_beneficiary_gender": {"kind": "checkbox_group", "mapping": {
        "male": F(4, "Pt4Line9_Male[0]"),
        "female": F(4, "Pt4Line9_Female[0]"),
    }},
    # Marital status (Line18: MaritalStatus[0..5] checkboxes, in order)
    "i130_beneficiary_marital_status": {"kind": "checkbox_group", "mapping": {
        "single": F(4, "Pt4Line18_MaritalStatus[0]"),
        "married": F(4, "Pt4Line18_MaritalStatus[1]"),
        "divorced": F(4, "Pt4Line18_MaritalStatus[2]"),
        "widowed": F(4, "Pt4Line18_MaritalStatus[3]"),
        "separated": F(4, "Pt4Line18_MaritalStatus[4]"),
        "annulled": F(4, "Pt4Line18_MaritalStatus[5]"),
    }},
    # Number of marriages (Line17)
    "i130_beneficiary_marriages": {"kind": "text", "field": F(4, "Pt4Line17_NumberofMarriages[0]")},
    # Current marriage date (Line19)
    "i130_beneficiary_marriage_date": {"kind": "text", "field": F(4, "Pt4Line19_DateOfMarriage[0]")},
    # Spouse family name (Line18a)
    "i130_beneficiary_spouse_family": {"kind": "text", "field": F(4, "Pt4Line18a_FamilyName[0]")},
    # Immigration: class of admission (Line21a)
    "i130_beneficiary_class_admission": {"kind": "text", "field": F(4, "Pt4Line21a_ClassOfAdmission[0]")},
    # Immigration: I-94 arrival/departure record number (Line21b)
    "i130_beneficiary_i94": {"kind": "text", "field": F(4, "Pt4Line21b_ArrivalDeparture[0]")},
    # Passport number (Line22)
    "i130_beneficiary_passport": {"kind": "text", "field": F(4, "Pt4Line22_PassportNumber[0]")},
    # Passport country of issuance (Line24)
    "i130_beneficiary_passport_country": {"kind": "text", "field": F(4, "Pt4Line24_CountryOfIssuance[0]")},
    # Daytime phone (Line14)
    "i130_beneficiary_phone": {"kind": "text", "field": F(4, "Pt4Line14_DaytimePhoneNumber[0]")},
    # Email (Line16)
    "i130_beneficiary_email": {"kind": "text", "field": F(4, "Pt4Line16_EmailAddress[0]")},
    # Employer address street (Line26 — AptSteFlrNumber slot used for street)
    "i130_beneficiary_employer_street": {"kind": "text", "field": F(4, "Pt4Line26_AptSteFlrNumber[0]")},
    # Children: child 1 (Line30a/31/32)
    "i130_beneficiary_child1_family": {"kind": "text", "field": F(4, "Pt4Line30a_FamilyName[0]")},
    "i130_beneficiary_child1_relationship": {"kind": "text", "field": F(4, "Pt4Line31_Relationship[0]")},
    "i130_beneficiary_child1_dob": {"kind": "text", "field": F(4, "Pt4Line32_DateOfBirth[0]")},
    # Children: child 2 (Line34a/35/36)
    "i130_beneficiary_child2_family": {"kind": "text", "field": F(4, "Pt4Line34a_FamilyName[0]")},
    "i130_beneficiary_child2_relationship": {"kind": "text", "field": F(4, "Pt4Line35_Relationship[0]")},
    "i130_beneficiary_child2_dob": {"kind": "text", "field": F(4, "Pt4Line36_DateOfBirth[0]")},
    # Children: child 3 (Line38a/39/40)
    "i130_beneficiary_child3_family": {"kind": "text", "field": F(4, "Pt4Line38a_FamilyName[0]")},
    "i130_beneficiary_child3_relationship": {"kind": "text", "field": F(4, "Pt4Line39_Relationship[0]")},
    "i130_beneficiary_child3_dob": {"kind": "text", "field": F(4, "Pt4Line40_DateOfBirth[0]")},
    # Children: child 4 (Line42a/43/44)
    "i130_beneficiary_child4_family": {"kind": "text", "field": F(4, "Pt4Line42a_FamilyName[0]")},
    "i130_beneficiary_child4_relationship": {"kind": "text", "field": F(4, "Pt4Line43_Relationship[0]")},
    "i130_beneficiary_child4_dob": {"kind": "text", "field": F(4, "Pt4Line44_DateOfBirth[0]")},
    # Prior proceedings (Line54) — "yes" checks Removal; "no" has no mapping (no fill)
    "i130_beneficiary_proceedings": {"kind": "checkbox_group", "mapping": {
        "yes": F(4, "Pt4Line54_Removal[0]"),
    }},
    # USCIS online account number (Line2)
    "i130_beneficiary_uscis_account": {"kind": "text", "field": F(4, "Pt4Line2_USCISOnlineActNumber[0]")},}


# ── ASK: small groups — field-level mappings (39 fields) ─────────────
# Each has a defined question; these are the PDF targets.
SMALL_GROUPS_REGISTRY = {
    "child_subtype": [
        {"fact": "child_in_wedlock", "field": F(1, "Pt1Line2_InWedlock[0]"), "kind": "checkbox"},
        {"fact": "child_adopted", "field": F(1, "Pt1Line2_AdoptedChild[0]"), "kind": "checkbox"},
        {"fact": "child_stepchild", "field": F(1, "Pt1Line2_Stepchild[0]"), "kind": "checkbox"},
        {"fact": "child_out_of_wedlock", "field": F(1, "Pt1Line2_OutOfWedlock[0]"), "kind": "checkbox"},
    ],
    "sibling_adoption": [
        {"fact": "sibling_adoption_yes", "field": F(1, "Pt1Line3_Yes[0]"), "kind": "checkbox"},
        {"fact": "sibling_adoption_no", "field": F(1, "Pt1Line3_No[0]"), "kind": "checkbox"},
    ],
    "petitioner_adoption_status": [
        {"fact": "pet_adoption_yes", "field": F(1, "Pt1Line4_Yes[0]"), "kind": "checkbox"},
        {"fact": "pet_adoption_no", "field": F(1, "Pt1Line4_No[0]"), "kind": "checkbox"},
    ],
    "petitioner_name_detail": [
        {"fact": "i130_petitioner_middle_name", "field": F(1, "Pt2Line4c_MiddleName[0]"), "kind": "text"},
        {"fact": "i130_petitioner_middle_name_2", "field": F(1, "Pt2Line4c_MiddleName[1]"), "kind": "text"},
        {"fact": "i130_petitioner_uscis_account", "field": F(1, "Pt2Line2_USCISOnlineActNumber[0]"), "kind": "text"},
        {"fact": "i130_petitioner_birth_country", "field": F(1, "Pt2Line7_CountryofBirth[0]"), "kind": "text"},
        {"fact": "i130_petitioner_alias_family", "field": F(1, "Pt2Line5a_FamilyName[0]"), "kind": "text"},
    ],
    "petitioner_marital": [
        {"fact": "pet_num_marriages", "field": F(1, "Pt2Line16_NumberofMarriages[0]"), "kind": "text"},
        {"fact": "pet_marriage_date", "field": F(1, "Pt2Line18_DateOfMarriage[0]"), "kind": "text"},
        {"fact": "pet_marriage_end_1", "field": F(1, "Pt2Line21_DateMarriageEnded[0]"), "kind": "text"},
        {"fact": "pet_marriage_end_2", "field": F(1, "Pt2Line23_DateMarriageEnded[0]"), "kind": "text"},
        {"fact": "pet_prior_spouse_family", "field": F(0, "PtLine20a_FamilyName[0]"), "kind": "text"},
    ],
    "beneficiary_name_detail": [
        {"fact": "i130_beneficiary_middle_name", "field": F(4, "Pt4Line4c_MiddleName[0]"), "kind": "text"},
        {"fact": "i130_beneficiary_alias_family", "field": F(4, "P4Line5a_FamilyName[0]"), "kind": "text"},
        {"fact": "i130_beneficiary_class_admission", "field": F(4, "Pt4Line21a_ClassOfAdmission[0]"), "kind": "text"},
    ],
    "beneficiary_marital": [
        {"fact": "ben_num_marriages", "field": F(4, "Pt4Line17_NumberofMarriages[0]"), "kind": "text"},
        {"fact": "ben_marital_single", "field": F(4, "Pt4Line18_MaritalStatus[0]"), "kind": "checkbox"},
        {"fact": "ben_marital_married", "field": F(4, "Pt4Line18_MaritalStatus[1]"), "kind": "checkbox"},
        {"fact": "ben_marital_divorced", "field": F(4, "Pt4Line18_MaritalStatus[2]"), "kind": "checkbox"},
        {"fact": "ben_marital_widowed", "field": F(4, "Pt4Line18_MaritalStatus[3]"), "kind": "checkbox"},
        {"fact": "ben_marital_separated", "field": F(4, "Pt4Line18_MaritalStatus[4]"), "kind": "checkbox"},
        {"fact": "ben_marital_annulled", "field": F(4, "Pt4Line18_MaritalStatus[5]"), "kind": "checkbox"},
        {"fact": "ben_marriage_date", "field": F(4, "Pt4Line19_DateOfMarriage[0]"), "kind": "text"},
        {"fact": "ben_marriage_end_1", "field": F(4, "Pt4Line17_DateMarriageEnded[0]"), "kind": "text"},
        {"fact": "ben_marriage_end_2", "field": F(4, "Pt4Line17_DateMarriageEnded[1]"), "kind": "text"},
    ],
    "prior_petition": [
        {"fact": "prior_pet_beneficiary_family", "field": F(7, "Pt5Line2a_FamilyName[0]"), "kind": "text"},
        {"fact": "prior_pet_beneficiary_given", "field": F(7, "Pt5Line2b_GivenName[0]"), "kind": "text"},
        {"fact": "prior_pet_beneficiary_middle", "field": F(7, "Pt5Line2c_MiddleName[0]"), "kind": "text"},
        {"fact": "prior_pet_city", "field": F(7, "Pt5Line3a_CityOrTown[0]"), "kind": "text"},
        {"fact": "prior_pet_state", "field": F(7, "Pt5Line3b_State[0]"), "kind": "text"},
        {"fact": "prior_pet_date_filed", "field": F(7, "Pt5Line4_DateFiled[0]"), "kind": "text"},
        {"fact": "prior_pet_result", "field": F(7, "Pt5Line5_Result[0]"), "kind": "text"},
    ],
    "interpretation": [
        {"fact": "interpretation_language", "field": F(9, "Pt6Line1b_Language[0]"), "kind": "text"},
    ],
}

# ── ASK: new question groups ──────────────────────────────────────
# Group 1: Names (petitioner + beneficiary middle, other names)
NAME_REGISTRY = {
    "petitioner_middle_name": {"kind": "text", "field": F(0, "Pt2Line4c_MiddleName[0]"),
        "question": "Petitioner: middle name (if any)"},
    "beneficiary_middle_name": {"kind": "text", "field": F(4, "Pt4Line4c_MiddleName[0]"),
        "question": "Beneficiary: middle name (if any)"},
    # Other names: repeating group (family, given, middle per entry)
    # Maps to Pt2Line5a/b/c (petitioner) and Pt4Line5a/b/c (beneficiary)
}

# Group 2: Birthplace details
BIRTH_REGISTRY = {
    "petitioner_birth_city": {"kind": "text", "field": F(1, "Pt2Line6_CityTownOfBirth[0]"),
        "question": "Petitioner: city/town of birth"},
    "petitioner_birth_country": {"kind": "text", "field": F(1, "Pt2Line7_CountryofBirth[0]"),
        "question": "Petitioner: country of birth"},
}

# Group 3: USCIS account
USCIS_REGISTRY = {
    "petitioner_uscis_account": {"kind": "text", "field": F(0, "Pt2Line2_USCISOnlineActNumber[0]"),
        "question": "Petitioner: USCIS online account number (if any)"},
}

# Group 4: Relationship conditionals
RELATIONSHIP_REGISTRY = {
    "child_relationship_subtype": {
        "kind": "checkbox_group",
        "question": "Child was (select one)",
        "conditional": "i130_beneficiary_relationship in [child*]",
        "mapping": {
            "in_wedlock": F(0, "Pt1Line2_InWedlock[0]"),
            "stepchild": F(0, "Pt1Line2_Stepchild[0]"),
            "adopted": F(0, "Pt1Line2_AdoptedChild[0]"),
            "out_of_wedlock": F(0, "Pt1Line2_OutOfWedlock[0]"),
        }},
    "sibling_adoption_related": {
        "kind": "checkbox_group",
        "question": "If sibling: related by adoption?",
        "conditional": "i130_beneficiary_relationship == sibling",
        "mapping": {"yes": F(0, "Pt1Line3_Yes[0]"), "no": F(0, "Pt1Line3_No[0]")}},
    "petitioner_status_via_adoption": {
        "kind": "checkbox_group",
        "question": "Did you gain status through adoption?",
        "mapping": {"yes": F(0, "Pt1Line4_Yes[0]"), "no": F(0, "Pt1Line4_No[0]")}},
}

# Group 5: Marital history (petitioner)
MARITAL_REGISTRY = {
    "petitioner_marital_status": {
        "kind": "checkbox_group",
        "question": "Current marital status",
        "mapping": {
            # Pt2 Line 17 checkboxes - need to verify names
        }},
    "petitioner_num_marriages": {"kind": "text",
        "question": "How many times have you been married?"},
}

# Group 6: Prior petitions (repeating)
PRIOR_PETITION_REGISTRY = {
    "prior_petition_details": {
        "kind": "repeating_group",
        "question": "Prior petition details",
        "conditional": "i130_filed_before == yes",
        # Fields: name (2a/b/c), city/state (3a/b), date filed (4), result (5)
    },
}

# (Module import is silent: the summary prints that used to run here
# on every cold-start import were removed, Carbon Pass 1 finding 21d.)
