"""
Pattern-based mapper for I-130 detail fields (the long tail).
Maps field name patterns to question groups without hand-mapping each field.

Strategy: group by line number ranges that correspond to form sections,
then map each section to its question group.
"""
import re

# Petitioner (Pt2) line -> question group mapping
# Based on I-130 form structure (edition 04/01/24)
PT2_LINE_GROUPS = {
    # Other names
    '5': 'petitioner_other_names',      # 5a/b/c: other names used
    # Birth info
    '6': 'petitioner_birth_city',        # 6: city/town of birth
    # Sex
    '9': 'petitioner_sex',               # 9: Male/Female
    # Mailing address (10) - handled by address.py
    # Physical addresses (12, 14) - handled by address.py
    # Marital
    '16': 'petitioner_num_marriages',    # 16: number of marriages
    '17': 'petitioner_marital_status',   # 17: current marital status (6 checkboxes)
    '18': 'petitioner_spouse_name',      # 18a/b/c: current spouse name
    '19': 'petitioner_marriage_place',   # 19a/b/c/d: place of marriage
    '20': 'petitioner_spouse1',          # 20a/b/c: spouse 1 (prior)
    '21': 'petitioner_marriage1_end',    # 21: date marriage 1 ended
    '22': 'petitioner_spouse2',          # 22a/b/c: spouse 2 (prior)
    '23': 'petitioner_marriage2_end',    # 23: date marriage 2 ended
    # Parents
    '24': 'petitioner_parent1',          # 24a/b/c: parent 1 name
    '25': 'petitioner_parent1_dob',      # 25: parent 1 DOB
    '26': 'petitioner_parent1_sex',      # 26: parent 1 sex
    '27': 'petitioner_parent1_birth',    # 27: parent 1 birth country
    '28': 'petitioner_parent1_residence',# 28: parent 1 residence
    '30': 'petitioner_parent2',          # 30a/b/c: parent 2 name
    '31': 'petitioner_parent2_dob',      # 31: parent 2 DOB
    '32': 'petitioner_parent2_sex',      # 32: parent 2 sex
    '33': 'petitioner_parent2_birth',    # 33: parent 2 birth country
    '34': 'petitioner_parent2_residence',# 34: parent 2 residence
    # Citizenship (for LPR petitioners)
    '36': 'petitioner_citizenship_detail', # 36: how citizenship acquired
    '37': 'petitioner_natz_cert',        # 37a/b/c: naturalization cert
    '38': 'petitioner_cert_yesno',       # 38: has certificate?
    '39': 'petitioner_cert_detail',      # 39a/b/c: certificate details
    # Admission (for LPR petitioners)
    '40': 'petitioner_admission',        # 40a/b/c/d: class, date, place of admission
    '41': 'petitioner_admission_marriage', # 41: gained status via marriage?
    # Employment
    '42': 'petitioner_employer1',        # 42: employer 1 name
    '43': 'petitioner_employer1_addr',   # 43a-h: employer 1 address
    '44': 'petitioner_occupation1',      # 44: occupation 1
    '45': 'petitioner_employment1_dates',# 45a/b: employment dates
    '46': 'petitioner_employer2',        # 46: employer 2 name
    '47': 'petitioner_employer2_addr',   # 47a-h: employer 2 address
    '48': 'petitioner_occupation2',      # 48: occupation 2
    '49': 'petitioner_employment2_dates',# 49a/b: employment dates
    '11': 'petitioner_mailing_same',     # 11: mailing same as physical?
    '13': 'petitioner_address_dates',    # 13a/b: address date ranges
    '15': 'petitioner_address2_dates',   # 15a/b: address 2 dates
}

# Beneficiary (Pt4) line -> question group mapping
PT4_LINE_GROUPS = {
    '2': 'beneficiary_uscis_account',
    '5': 'beneficiary_other_names',
    '6': 'beneficiary_birth_city',
    '7': 'beneficiary_birth_country',
    '8': 'beneficiary_birth_country_detail',
    '9': 'beneficiary_sex',
    '10': 'beneficiary_prior_petition',
    '14': 'beneficiary_phone',
    '15': 'beneficiary_phone_detail',
    '16': 'beneficiary_spouse',
    '17': 'beneficiary_num_marriages',
    '18': 'beneficiary_marital_status',
    '20': 'beneficiary_children',
    '21': 'beneficiary_admission',
    '22': 'beneficiary_i94',
    '23': 'beneficiary_status_expiry',
    '25': 'beneficiary_employment',
    '26': 'beneficiary_employment_detail',
    '27': 'beneficiary_employment_dates',
    '28': 'beneficiary_occupation',
    '30': 'beneficiary_spouse2',
    '31': 'beneficiary_marriage_end',
    '32': 'beneficiary_marriage_place',
    '34': 'beneficiary_parent1',
    '35': 'beneficiary_parent1_dob',
    '36': 'beneficiary_parent1_detail',
    '38': 'beneficiary_parent2',
    '39': 'beneficiary_parent2_dob',
    '40': 'beneficiary_parent2_detail',
    '42': 'beneficiary_prior_entry',
    '43': 'beneficiary_entry_detail',
    '44': 'beneficiary_visa_info',
    '46': 'beneficiary_arrival',
    '47': 'beneficiary_departure',
    '48': 'beneficiary_status_detail',
    '53': 'beneficiary_additional_1',
    '54': 'beneficiary_additional_2',
    '55': 'beneficiary_additional_3',
    '56': 'beneficiary_additional_4',
    '57': 'beneficiary_additional_5',
    '58': 'beneficiary_additional_6',
}

def get_question_group(field_short, part):
    """Return question group for a detail field, or None."""
    m = re.search(r'Line(\d+)', field_short)
    if not m:
        return None
    line = m.group(1)
    if part == 'Pt2':
        return PT2_LINE_GROUPS.get(line)
    elif part == 'Pt4':
        return PT4_LINE_GROUPS.get(line)
    return None

def build_detail_registry(baseline):
    """Build registry entries for detail fields grouped by question."""
    from collections import defaultdict
    groups = defaultdict(list)
    for r in baseline:
        if r['category'] != 'ASK':
            continue
        src = r['source']
        if src not in ('new_q: petitioner_detail', 'new_q: beneficiary_detail'):
            continue
        # Determine part from field name
        field = r['field']
        part = 'Pt2' if 'Pt2Line' in field else 'Pt4' if 'Pt4Line' in field else None
        if not part:
            # Try full name lookup
            continue
        qgroup = get_question_group(field, part)
        if qgroup:
            groups[qgroup].append(r)
    return groups
