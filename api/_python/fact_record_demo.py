"""Synthetic I-130 fact record with full Tier1Fact provenance.
Includes adversarial cases per standing doctrine: a conflict designed to be
caught, a low-confidence extraction, and a missing required field."""
from datetime import datetime, timezone

def now(): return datetime.now(timezone.utc).isoformat()

FACTS = {
    "i130_petitioner_is_usc": {
        "id": "i130_petitioner_is_usc", "value": "usc",
        "source": "applicant-typed", "confidence": 1.0, "status": "verified",
        "corrections": [], "updatedAt": now(),
    },
    "i130_petitioner_family_name": {
        "id": "i130_petitioner_family_name", "value": "SANTOS",
        "source": "applicant-typed", "confidence": 1.0, "status": "verified",
        "corrections": [], "updatedAt": now(),
    },
    "i130_petitioner_given_name": {
        "id": "i130_petitioner_given_name", "value": "MARIA",
        "source": "applicant-typed", "confidence": 1.0, "status": "verified",
        "corrections": [], "updatedAt": now(),
    },
    "i130_petitioner_dob": {
        "id": "i130_petitioner_dob", "value": "03/15/1985",
        "source": "applicant-typed", "confidence": 0.85, "status": "provided",
        "corrections": [], "updatedAt": now(),
    },
    "i130_petitioner_a_number": {
        "id": "i130_petitioner_a_number", "value": "A123456789",
        "source": "applicant-typed", "confidence": 0.9, "status": "corrected",
        "corrections": [{"old": "A12345678", "new": "A123456789", "at": now(),
                         "reason": "applicant corrected digit count"}],
        "updatedAt": now(),
    },
    "i130_beneficiary_relationship": {
        "id": "i130_beneficiary_relationship", "value": "spouse",
        "source": "applicant-typed", "confidence": 1.0, "status": "verified",
        "corrections": [], "updatedAt": now(),
    },
    "i130_beneficiary_family_name": {
        "id": "i130_beneficiary_family_name", "value": "SANTOS",
        "source": "applicant-typed", "confidence": 1.0, "status": "verified",
        "corrections": [], "updatedAt": now(),
    },
    "i130_beneficiary_given_name": {
        "id": "i130_beneficiary_given_name", "value": "CARLOS",
        "source": "applicant-typed", "confidence": 1.0, "status": "verified",
        "corrections": [], "updatedAt": now(),
    },
    # ADVERSARIAL 1: conflict — questionnaire says 1988, passport extraction says 1987
    "i130_beneficiary_dob": {
        "id": "i130_beneficiary_dob", "value": "07/22/1988",
        "source": "applicant-typed", "confidence": 0.3, "status": "conflicted",
        "corrections": [],
        "conflict": {"other_source": "document-extraction (passport)",
                     "other_value": "07/22/1987",
                     "note": "typed DOB differs from passport by one year"},
        "updatedAt": now(),
    },
    # ADVERSARIAL 2: low-confidence extraction, below auto-fill threshold
    "i130_beneficiary_birth_country": {
        "id": "i130_beneficiary_birth_country", "value": "Mexico",
        "source": "document-extraction", "confidence": 0.6, "status": "provided",
        "corrections": [],
        "note": "extracted from low-quality passport scan; not applicant-confirmed",
        "updatedAt": now(),
    },
    # ADVERSARIAL 3: missing entirely (beneficiary A-number not provided)
    # -> no entry; binder must flag as missing-required if registry says required,
    #    or missing-optional otherwise.
    "i130_needs_130a": {
        "id": "i130_needs_130a", "value": "yes",
        "source": "inferred", "confidence": 0.95, "status": "provided",
        "corrections": [],
        "note": "spouse petition requires Form I-130A supplement",
        "updatedAt": now(),
    },
}
