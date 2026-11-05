"""I-90 question groups."""
import json
import os
_fields = json.load(open(os.path.join(os.path.dirname(__file__), 'i90_fields.json')))
_name_map = {f['short']: f['name'] for f in _fields}
def F(short): return _name_map.get(short, short)

I90_QUESTION_GROUPS = {
    "sex": {
        "question": "What is your sex?",
        "fields": [
            {"fact": "sex_male", "field": F("P1_Line8_male[0]"), "kind": "checkbox", "expected": "male"},
            {"fact": "sex_female", "field": F("P1_Line8_female[0]"), "kind": "checkbox", "expected": "female"},
        ],
    },
    "admission": {
        "question": "Admission details",
        "fields": [
            {"fact": "class_of_admission", "field": F("P1_Line14_ClassOfAdmission[0]"), "kind": "text"},
            {"fact": "date_of_admission", "field": F("P1_Line15_DateOfAdmission[0]"), "kind": "text"},
        ],
    },
    "status": {
        "question": "What is your current immigration status? (Select only one - Part 2, Item 1)",
        "fields": [
            {"fact": "i90_status_lpr", "field": F("P2_checkbox1[0]"), "kind": "checkbox", "expected": "lpr"},
            {"fact": "i90_status_commuter", "field": F("P2_checkbox1[1]"), "kind": "checkbox", "expected": "commuter"},
            {"fact": "i90_status_conditional", "field": F("P2_checkbox1[2]"), "kind": "checkbox", "expected": "conditional"},
        ],
    },
    "section_a_reason": {
        "question": "Select the reason for your application (Section A - for LPR/commuter):",
        "fields": [
            {"fact": "i90_reason_2a", "field": F("P2_checkbox2[5]"), "kind": "checkbox", "expected": "lost"},
            {"fact": "i90_reason_2b", "field": F("P2_checkbox2[6]"), "kind": "checkbox", "expected": "never_received"},
            {"fact": "i90_reason_2c", "field": F("P2_checkbox2[7]"), "kind": "checkbox", "expected": "mutilated"},
            {"fact": "i90_reason_2d", "field": F("P2_checkbox2[4]"), "kind": "checkbox", "expected": "dhs_error"},
            {"fact": "i90_reason_2e", "field": F("P2_checkbox2[0]"), "kind": "checkbox", "expected": "legal_change"},
            {"fact": "i90_reason_2f", "field": F("P2_checkbox2[1]"), "kind": "checkbox", "expected": "expired"},
            {"fact": "i90_reason_2g1", "field": F("P2_checkbox2[2]"), "kind": "checkbox", "expected": "age14_after16"},
            {"fact": "i90_reason_2g2", "field": F("P2_checkbox2[3]"), "kind": "checkbox", "expected": "age14_before16"},
            {"fact": "i90_reason_2h1", "field": F("P2_checkbox2[11]"), "kind": "checkbox", "expected": "to_commuter"},
            {"fact": "i90_reason_2h2", "field": F("P2_checkbox2[9]"), "kind": "checkbox", "expected": "to_resident"},
            {"fact": "i90_reason_2i", "field": F("P2_checkbox2[10]"), "kind": "checkbox", "expected": "auto_converted"},
            {"fact": "i90_reason_2j", "field": F("P2_checkbox2[8]"), "kind": "checkbox", "expected": "other"},
        ],
    },
    "section_b_reason": {
        "question": "Select the reason for your application (Section B - for conditional residents):",
        "fields": [
            {"fact": "i90_reason_3a", "field": F("P2_checkbox3[4]"), "kind": "checkbox", "expected": "lost"},
            {"fact": "i90_reason_3b", "field": F("P2_checkbox3[0]"), "kind": "checkbox", "expected": "never_received"},
            {"fact": "i90_reason_3c", "field": F("P2_checkbox3[1]"), "kind": "checkbox", "expected": "mutilated"},
            {"fact": "i90_reason_3d", "field": F("P2_checkbox3[2]"), "kind": "checkbox", "expected": "dhs_error"},
            {"fact": "i90_reason_3e", "field": F("P2_checkbox3[3]"), "kind": "checkbox", "expected": "legal_change"},
        ],
    },

    "processing_biographic": {
        "question": "Biographic information (for processing)",
        "fields": [
            {"fact": "bio_height_feet", "field": F("P3_Line8_HeightFeet[0]"), "kind": "text"},
            {"fact": "bio_height_inches", "field": F("P3_Line8_HeightInches[0]"), "kind": "text"},
            {"fact": "bio_weight", "field": F("P3_Line9_HeightInches1[0]"), "kind": "text"},
            {"fact": "bio_weight_d2", "field": F("P3_Line9_HeightInches2[0]"), "kind": "text"},
            {"fact": "bio_weight_d3", "field": F("P3_Line9_HeightInches3[0]"), "kind": "text"},
        ],
    },
    "processing_visa": {
        "question": "Where did you apply for your immigrant visa or adjustment of status?",
        "fields": [
            {"fact": "visa_applied_location", "field": F("P3_Line1_LocationAppliedVisa[0]"), "kind": "text"},
            {"fact": "visa_issued_location", "field": F("P3_Line2_LocationIssuedVisa[0]"), "kind": "text"},
            {"fact": "us_destination", "field": F("P3_Line3a_Destination[0]"), "kind": "text"},
        ],
    },

    "p3_race": {
        "question": "What is your race? (Select all that apply)",
        "fields": [
            {"fact": "bio_race_white", "field": F("P3_checkbox7_White[0]"), "kind": "checkbox", "expected": "white"},
            {"fact": "bio_race_asian", "field": F("P3_checkbox7_Asian[0]"), "kind": "checkbox", "expected": "asian"},
            {"fact": "bio_race_black", "field": F("P3_checkbox7_Black[0]"), "kind": "checkbox", "expected": "black"},
            {"fact": "bio_race_indian", "field": F("P3_checkbox7_Indian[0]"), "kind": "checkbox", "expected": "indian"},
            {"fact": "bio_race_hawaiian", "field": F("P3_checkbox7_Hawaiian[0]"), "kind": "checkbox", "expected": "hawaiian"},
        ],
    },
    "p3_eye_color": {
        "question": "What is your eye color?",
        "fields": [
            {"fact": "bio_eye_black", "field": F("P3_checkbox10[6]"), "kind": "checkbox", "expected": "black"},
            {"fact": "bio_eye_blue", "field": F("P3_checkbox10[0]"), "kind": "checkbox", "expected": "blue"},
            {"fact": "bio_eye_brown", "field": F("P3_checkbox10[5]"), "kind": "checkbox", "expected": "brown"},
            {"fact": "bio_eye_gray", "field": F("P3_checkbox10[8]"), "kind": "checkbox", "expected": "gray"},
            {"fact": "bio_eye_hazel", "field": F("P3_checkbox10[2]"), "kind": "checkbox", "expected": "hazel"},
            {"fact": "bio_eye_maroon", "field": F("P3_checkbox10[4]"), "kind": "checkbox", "expected": "maroon"},
            {"fact": "bio_eye_pink", "field": F("P3_checkbox10[3]"), "kind": "checkbox", "expected": "pink"},
            {"fact": "bio_eye_unknown", "field": F("P3_checkbox10[7]"), "kind": "checkbox", "expected": "unknown"},
        ],
    },
    "p3_hair_color": {
        "question": "What is your hair color?",
        "fields": [
            {"fact": "bio_hair_bald", "field": F("P3_checkbox11[0]"), "kind": "checkbox", "expected": "bald"},
            {"fact": "bio_hair_black", "field": F("P3_checkbox11[8]"), "kind": "checkbox", "expected": "black"},
            {"fact": "bio_hair_blond", "field": F("P3_checkbox11[1]"), "kind": "checkbox", "expected": "blond"},
            {"fact": "bio_hair_brown", "field": F("P3_checkbox11[7]"), "kind": "checkbox", "expected": "brown"},
            {"fact": "bio_hair_red", "field": F("P3_checkbox11[6]"), "kind": "checkbox", "expected": "red"},
            {"fact": "bio_hair_sandy", "field": F("P3_checkbox11[3]"), "kind": "checkbox", "expected": "sandy"},
            {"fact": "bio_hair_white", "field": F("P3_checkbox11[5]"), "kind": "checkbox", "expected": "white"},
            {"fact": "bio_hair_unknown", "field": F("P3_checkbox11[4]"), "kind": "checkbox", "expected": "unknown"},
        ],
    },
    "p3_ethnicity_extra": {
        "question": "Additional ethnicity information",
        "fields": [
            {"fact": "bio_ethnicity_extra1", "field": F("P3_checkbox5[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "bio_ethnicity_extra2", "field": F("P3_checkbox5[1]"), "kind": "checkbox", "expected": "no"},
            {"fact": "bio_ethnicity_extra3", "field": F("P3_checkbox6[0]"), "kind": "checkbox", "expected": "yes"},
            {"fact": "bio_ethnicity_extra4", "field": F("P3_checkbox6[1]"), "kind": "checkbox", "expected": "no"},
        ],
    },

    "p3_ethnicity": {
        "question": "What is your ethnicity?",
        "fields": [
            {"fact": "bio_ethnicity_hispanic", "field": F("P3_checkbox4[0]"), "kind": "checkbox", "expected": "hispanic"},
            {"fact": "bio_ethnicity_nothispanic", "field": F("P3_checkbox4[1]"), "kind": "checkbox", "expected": "not_hispanic"},
        ],
    },
}

I90_DISPOSITIONS = {
    "P1_Line16_SSN[0]": "CONSUMER - SSN never collected (D-2)",
}

def get_i90_mappings():
    mappings = []
    for gid, g in I90_QUESTION_GROUPS.items():
        for f in g["fields"]:
            mappings.append({"group": gid, **f})
    return mappings

if __name__ == "__main__":
    m = get_i90_mappings()
    print(f"I-90: {len(I90_QUESTION_GROUPS)} groups, {len(m)} mappings")
