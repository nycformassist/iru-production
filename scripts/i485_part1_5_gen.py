#!/usr/bin/env python3
"""I-485 Parts 1-5 questionnaire expansion generator (2026-11-04).

Single source of truth for the 129 new Part 1-5 questions.
Generates:
  1. TypeScript block appended to ~/workspace/iru-claude-verify-2026-10-28/src/i485-questions.ts
  2. New entries for ~/workspace/iru-form-engine/i485_detailed_registry.json

Ground truth: Form I-485 Edition 09/18/26, public/forms/i-485.pdf.
Field short names verified against iru-form-engine/i485_fields.json AND
against live PyMuPDF widget rects (misleading names resolved by position):
  - Pt4Line7_EmployerName[0] = left box "Employer or School (current or most recent)"
  - Pt4Line7_EmployerName[2] = right box "Name of Employer, Company, or School"
  - Pt4Line7_EmployerName[1] = full-width "Your Occupation" box
  - Part4Line7_StreetName[1] = "If unemployed or retired, source of financial support" (item 7)
  - Part4Line8_StreetName[0] = "If unemployed or retired, source of financial support" (item 8)
  - Pt5Line5_CityTownOfBirth[0] = Parent 1 Country of Birth (item 4)
  - Pt5Line10_CityTownOfBirth[0] = Parent 2 Country of Birth (item 8)
  - Pt1Line19_SSN[0] = SSN (task draft said Pt1Line5_SSN[0]; that field DOES NOT EXIST)
  - Pt5Line8_DateofBirth[1..3] + Pt5Line2_YNNA are Part 6 fields (misnamed) -> NOT included
  - P3_Line4/5/6 = interpreter contact (Part 11) -> DISPOSITIONED, not included
  - Pt3Line7a/7b = applicant signature/date (Part 10) -> DISPOSITIONED, not included

Each question: id == factId, so no FACTID_ALIASES entries are needed
(normalize_facts passes through keys unchanged when no alias exists).
"""
import json
import sys

FIELDS_PATH = '/home/hatch/workspace/iru-form-engine/i485_fields.json'
REGISTRY_PATH = '/home/hatch/workspace/iru-form-engine/i485_detailed_registry.json'
TS_PATH = '/home/hatch/workspace/iru-claude-verify-2026-10-28/src/i485-questions.ts'

# (factId, step, shortLabel, label, type, pdf_short_name)
Q = [
    # ── Part 1 personal (step: personal) ──
    ("i485_middle_name", "personal", "Middle name",
     "What is your current legal middle name (if applicable)?", "text", "Pt1Line1_MiddleName[0]"),
    ("i485_othername1_family", "personal", "Other name 1 family",
     "What is the family name (last name) of the first other name you have used since birth?", "text", "Pt1Line2_FamilyName[0]"),
    ("i485_othername1_given", "personal", "Other name 1 given",
     "What is the given name (first name) of the first other name you have used since birth?", "text", "Pt1Line2_GivenName[0]"),
    ("i485_othername1_middle", "personal", "Other name 1 middle",
     "What is the middle name of the first other name you have used since birth (if applicable)?", "text", "Pt1Line2_MiddleName[0]"),
    ("i485_othername2_family", "personal", "Other name 2 family",
     "What is the family name (last name) of the second other name you have used since birth?", "text", "Pt1Line2a_FamilyName[0]"),
    ("i485_othername2_given", "personal", "Other name 2 given",
     "What is the given name (first name) of the second other name you have used since birth?", "text", "Pt1Line2a_GivenName[0]"),
    ("i485_othername2_middle", "personal", "Other name 2 middle",
     "What is the middle name of the second other name you have used since birth (if applicable)?", "text", "Pt1Line2a_MiddleName[0]"),
    ("i485_other_dob_1", "personal", "Other date of birth 1",
     "What is the first other date of birth you have used? (mm/dd/yyyy)", "date", "Pt1Line3A_OtherDOB[0]"),
    ("i485_other_dob_2", "personal", "Other date of birth 2",
     "What is the second other date of birth you have used? (mm/dd/yyyy)", "date", "Pt1Line3B_OtherDOB[0]"),
    ("i485_other_anumber_1", "personal", "Other A-Number 1",
     "What is the first other A-Number you have used or been assigned?", "text", "Pt1Line5A_ANumber[0]"),
    ("i485_other_anumber_2", "personal", "Other A-Number 2",
     "What is the second other A-Number you have used or been assigned?", "text", "Pt1Line5B_ANumber[0]"),
    ("i485_birth_city", "personal", "City of birth",
     "What city or town were you born in?", "text", "Pt1Line7_CityTownOfBirth[0]"),
    ("i485_birth_country", "personal", "Country of birth",
     "What country were you born in?", "text", "Pt1Line7_CountryOfBirth[0]"),
    ("i485_citizenship_country", "personal", "Country of citizenship",
     "What is your country of citizenship or nationality?", "text", "Pt1Line8_CountryofCitizenshipNationality[0]"),
    ("i485_uscis_account", "personal", "USCIS online account",
     "What is your USCIS online account number (if any)?", "text", "Pt1Line9_USCISAccountNumber[0]"),
    ("i485_ssn", "personal", "Social Security Number",
     "What is your U.S. Social Security Number (SSN)?", "text", "Pt1Line19_SSN[0]"),
    # ── Part 1 immigration history (step: immigration) ──
    ("i485_passport_number", "immigration", "Passport number",
     "What is the passport or travel document number you used at your last arrival?", "text", "Pt1Line10_PassportNum[0]"),
    ("i485_passport_expiry", "immigration", "Passport expiration",
     "What is the expiration date of that passport or travel document? (mm/dd/yyyy)", "date", "Pt1Line10_ExpDate[0]"),
    ("i485_passport_country", "immigration", "Passport issuing country",
     "What country issued that passport or travel document?", "text", "Pt1Line10_Passport[0]"),
    ("i485_visa_number", "immigration", "Nonimmigrant visa number",
     "What is the nonimmigrant visa number you used during your most recent arrival (if any)?", "text", "Pt1Line10_VisaNum[0]"),
    ("i485_visa_issue_date", "immigration", "Visa issue date",
     "What date was that nonimmigrant visa issued? (mm/dd/yyyy)", "date", "Pt1Line10_NonImmDate[0]"),
    ("i485_arrival_city", "immigration", "Arrival city",
     "In what city or town did you last arrive in the United States?", "text", "Pt1Line10_CityTown[0]"),
    ("i485_arrival_state", "immigration", "Arrival state",
     "In what state did you last arrive in the United States?", "select", "Pt1Line10_State[0]"),
    ("i485_arrival_date", "immigration", "Arrival date",
     "What was the date of your last arrival into the United States? (mm/dd/yyyy)", "date", "Pt1Line10_DateofArrival[0]"),
    ("i485_admitted_as", "immigration", "Admitted as",
     "When you last arrived, you were inspected at a port of entry and admitted as what (for example, visitor, student, temporary worker)?", "text", "Pt1Line11_Admitted[0]"),
    ("i485_paroled_as", "immigration", "Paroled as",
     "When you last arrived, you were inspected at a port of entry and paroled as what (for example, humanitarian parole, Cuban parole)?", "text", "Pt1Line11_Paroled[0]"),
    ("i485_arrival_other", "immigration", "Arrival other",
     "If you came into the United States without admission or parole, or your situation is different, explain here.", "text", "Pt1Line11_Other[0]"),
    ("i485_i94_family", "immigration", "I-94 family name",
     "What family name (last name) appears on your most recent Form I-94 Arrival/Departure Record?", "text", "P1Line12_FamilyName[0]"),
    ("i485_i94_given", "immigration", "I-94 given name",
     "What given name (first name) appears on your most recent Form I-94?", "text", "P1Line13_GivenName[0]"),
    ("i485_i94_number", "immigration", "I-94 number",
     "What is your most recent Form I-94 Arrival/Departure Record number?", "text", "P1Line12_I94[0]"),
    ("i485_i94_expiry", "immigration", "I-94 authorized stay expiration",
     "What is the expiration date of authorized stay shown on your Form I-94 (or type D/S for Duration of Status)?", "text", "Pt1Line12_Date[0]"),
    ("i485_i94_status", "immigration", "I-94 status",
     "What immigration status is shown on your Form I-94 (for example, class of admission, or paroled, if paroled)?", "text", "Pt1Line12_Status[0]"),
    ("i485_current_status", "immigration", "Current immigration status",
     "What is your current immigration status (if it has changed since your last arrival)?", "text", "Pt1Line14_Status[0]"),
    ("i485_current_status_expiry", "immigration", "Current status expiration",
     "What is the expiration date of your current immigration status (or type D/S for Duration of Status)?", "text", "Pt1Line15_Date[0]"),
    # ── Part 1 addresses (step: address) ──
    ("i485_phys_careof", "address", "Physical address care of",
     "For your current U.S. physical address, what is the 'In Care Of' name (if any)?", "text", "Part1_Item18_InCareOfName[0]"),
    ("i485_phys_street", "address", "Physical address street",
     "What is the street number and name of your current U.S. physical address?", "text", "Pt1Line18_StreetNumberName[0]"),
    ("i485_phys_unit", "address", "Physical address unit",
     "What is the apartment, suite, or floor number of your current U.S. physical address (if any)?", "text", "Pt1Line18US_AptSteFlrNumber[0]"),
    ("i485_phys_city", "address", "Physical address city",
     "What city or town is your current U.S. physical address in?", "text", "Pt1Line18_CityOrTown[0]"),
    ("i485_phys_state", "address", "Physical address state",
     "What state is your current U.S. physical address in?", "select", "Pt1Line18_State[0]"),
    ("i485_phys_zip", "address", "Physical address ZIP",
     "What is the ZIP code of your current U.S. physical address?", "text", "Pt1Line18_ZipCode[0]"),
    ("i485_phys_date_first", "address", "Date first resided",
     "On what date did you first reside at your current U.S. physical address? (mm/dd/yyyy)", "date", "Pt1Line18_Date[0]"),
    ("i485_mailing_careof", "address", "Mailing address care of",
     "For your current mailing address, what is the 'In Care Of' name (if any)?", "text", "Pt1Line18_CurrentInCareOfName[0]"),
    ("i485_mailing_street", "address", "Mailing address street",
     "What is the street number and name of your current mailing address?", "text", "Pt1Line18_CurrentStreetNumberName[0]"),
    ("i485_mailing_unit", "address", "Mailing address unit",
     "What is the apartment, suite, or floor number of your current mailing address (if any)?", "text", "Pt1Line18_CurrentAptSteFlrNumber[0]"),
    ("i485_mailing_city", "address", "Mailing address city",
     "What city or town is your current mailing address in?", "text", "Pt1Line18_CurrentCityOrTown[0]"),
    ("i485_mailing_state", "address", "Mailing address state",
     "What state is your current mailing address in?", "select", "Pt1Line18_CurrentState[0]"),
    ("i485_mailing_zip", "address", "Mailing address ZIP",
     "What is the ZIP code of your current mailing address?", "text", "Pt1Line18_CurrentZipCode[0]"),
    ("i485_prior_careof", "address", "Prior address care of",
     "For your prior address, what is the 'In Care Of' name (if any)?", "text", "Pt1Line18_PriorInCareOfName[0]"),
    ("i485_prior_street", "address", "Prior address street",
     "What is the street number and name of your prior address?", "text", "Pt1Line18_PriorStreetName[0]"),
    ("i485_prior_unit", "address", "Prior address unit",
     "What is the apartment, suite, or floor number of your prior address (if any)?", "text", "Pt1Line18_PriorAddress_Number[0]"),
    ("i485_prior_city", "address", "Prior address city",
     "What city or town is your prior address in?", "text", "Pt1Line18_PriorCity[0]"),
    ("i485_prior_state", "address", "Prior address state",
     "What state is your prior address in?", "select", "Pt1Line18_PriorState[0]"),
    ("i485_prior_zip", "address", "Prior address ZIP",
     "What is the ZIP code of your prior address?", "text", "Pt1Line18_PriorZipCode[0]"),
    ("i485_prior_province", "address", "Prior address province",
     "What is the province of your prior address (if outside the United States)?", "text", "Pt1Line18_PriorProvince[0]"),
    ("i485_prior_postal", "address", "Prior address postal code",
     "What is the postal code of your prior address (if outside the United States)?", "text", "Pt1Line18_PriorPostalCode[0]"),
    ("i485_prior_country", "address", "Prior address country",
     "What country is your prior address in?", "text", "Pt1Line18_PriorCountry[0]"),
    ("i485_prior_date_from", "address", "Prior address from date",
     "From what date did you reside at your prior address? (mm/dd/yyyy)", "date", "Pt1Line18_PriorDateFrom[0]"),
    ("i485_prior_date_to", "address", "Prior address to date",
     "To what date did you reside at your prior address? (mm/dd/yyyy)", "date", "Pt1Line18PriorDateTo[0]"),
    ("i485_recent_street", "address", "Recent foreign address street",
     "What is the street number and name of your most recent address outside the United States where you lived for more than one year?", "text", "Pt1Line18_RecentStreetName[0]"),
    ("i485_recent_unit", "address", "Recent foreign address unit",
     "What is the apartment, suite, or floor number of that address (if any)?", "text", "Pt1Line18_RecentNumber[0]"),
    ("i485_recent_city", "address", "Recent foreign address city",
     "What city or town is that address in?", "text", "Pt1Line18_RecentCity[0]"),
    ("i485_recent_state", "address", "Recent foreign address state",
     "What state is that address in?", "select", "Pt1Line18_RecentState[0]"),
    ("i485_recent_zip", "address", "Recent foreign address ZIP",
     "What is the ZIP code of that address?", "text", "Pt1Line18_RecentZipCode[0]"),
    ("i485_recent_province", "address", "Recent foreign address province",
     "What is the province of that address?", "text", "Pt1Line18_RecentProvince[0]"),
    ("i485_recent_postal", "address", "Recent foreign address postal code",
     "What is the postal code of that address?", "text", "Pt1Line18_RecentPostalCode[0]"),
    ("i485_recent_country", "address", "Recent foreign address country",
     "What country is that address in?", "text", "Pt1Line18_RecentCountry[0]"),
    ("i485_recent_date_from", "address", "Recent foreign address from date",
     "From what date did you reside at that address? (mm/dd/yyyy)", "date", "Pt1Line18_RecentDateFrom[0]"),
    ("i485_recent_date_to", "address", "Recent foreign address to date",
     "To what date did you reside at that address? (mm/dd/yyyy)", "date", "Pt1Line18_RecentDateTo[0]"),
    # ── Part 2 filing-category details (step: basis) ──
    ("i485_petition_receipt", "basis", "Petition receipt number",
     "What is the receipt number of the underlying petition (if any)?", "text", "Pt2Line2_Receipt[0]"),
    ("i485_petition_priority_date", "basis", "Petition priority date",
     "What is the priority date from the underlying petition (if any)? (mm/dd/yyyy)", "date", "Pt2Line2_Date[0]"),
    ("i485_principal_family", "basis", "Principal applicant family",
     "If you are filing as a derivative applicant, what is the principal applicant's family name (last name)?", "text", "Pt2Line2_FamilyName[0]"),
    ("i485_principal_given", "basis", "Principal applicant given",
     "If you are filing as a derivative applicant, what is the principal applicant's given name (first name)?", "text", "Pt2Line2_GivenName[0]"),
    ("i485_principal_middle", "basis", "Principal applicant middle",
     "If you are filing as a derivative applicant, what is the principal applicant's middle name (if applicable)?", "text", "Pt2Line2_MiddleName[0]"),
    ("i485_principal_dob", "basis", "Principal applicant DOB",
     "What is the principal applicant's date of birth? (mm/dd/yyyy)", "date", "Pt1Line2_DOB[0]"),
    ("i485_principal_anumber", "basis", "Principal applicant A-Number",
     "What is the principal applicant's A-Number (if any)?", "text", "Pt2Line2_AlienNumber[0]"),
    ("i485_asylum_grant_date", "basis", "Asylum grant date",
     "If you selected asylum, on what date were you granted asylum? (mm/dd/yyyy)", "date", "Pt2Line3d_Asylum[0]"),
    ("i485_refugee_admission_date", "basis", "Refugee admission date",
     "If you selected refugee, what was the date of your initial admission as a refugee? (mm/dd/yyyy)", "date", "Pt2Line3d_Refugee[0]"),
    ("i485_dv_rank", "basis", "Diversity Visa rank number",
     "If you selected the Diversity Visa program, what is your Diversity Visa rank number?", "text", "Pt2Line1g_DV[0]"),
    ("i485_other_eligibility", "basis", "Other eligibility",
     "If you selected 'Other Eligibility,' describe the basis for your eligibility.", "text", "Pt2Line1g_OtherEligibility[0]"),
    # ── Part 4 items 1-6 (step: immigration) ──
    ("i485_embassy_city", "immigration", "Embassy city",
     "In what city or town is the U.S. Embassy or U.S. Consulate where you applied for an immigrant visa abroad?", "text", "Pt4Line2_CityTown[0]"),
    ("i485_embassy_country", "immigration", "Embassy country",
     "In what country is that U.S. Embassy or U.S. Consulate?", "text", "Pt4Line2_CityTownOfBirth[0]"),
    ("i485_visa_decision", "immigration", "Visa decision",
     "What was the decision on that immigrant visa application (for example, approved, refused, denied, withdrawn)?", "text", "Pt4Line3_Decision[0]"),
    ("i485_visa_decision_date", "immigration", "Visa decision date",
     "What was the date of that decision? (mm/dd/yyyy)", "date", "Pt4Line4_Date[0]"),
    # ── Part 4 employment history (step: employment) ──
    ("i485_emp1_type", "employment", "Employer 1 type box",
     "For your current or most recent employer or school, what is entered in the 'Employer or School (current or most recent)' box?", "text", "Pt4Line7_EmployerName[0]"),
    ("i485_emp1_name", "employment", "Employer 1 name",
     "What is the name of your current or most recent employer, company, or school?", "text", "Pt4Line7_EmployerName[2]"),
    ("i485_emp1_occupation", "employment", "Employer 1 occupation",
     "What is your occupation at your current or most recent employer or school (if unemployed or retired, so state)?", "text", "Pt4Line7_EmployerName[1]"),
    ("i485_emp1_street", "employment", "Employer 1 street",
     "What is the street number and name of your current or most recent employer, company, or school?", "text", "Part4Line7_StreetName[0]"),
    ("i485_emp1_unit", "employment", "Employer 1 unit",
     "What is the apartment, suite, or floor number of that employer's address (if any)?", "text", "P4Line7_Number[0]"),
    ("i485_emp1_city", "employment", "Employer 1 city",
     "What city or town is that employer's address in?", "text", "P4Line7_City[0]"),
    ("i485_emp1_state", "employment", "Employer 1 state",
     "What state is that employer's address in?", "select", "P4Line7_State[0]"),
    ("i485_emp1_zip", "employment", "Employer 1 ZIP",
     "What is the ZIP code of that employer's address?", "text", "P4Line7_ZipCode[0]"),
    ("i485_emp1_province", "employment", "Employer 1 province",
     "What is the province of that employer's address (if outside the United States)?", "text", "P4Line7_Province[0]"),
    ("i485_emp1_postal", "employment", "Employer 1 postal code",
     "What is the postal code of that employer's address (if outside the United States)?", "text", "P4Line7_PostalCode[0]"),
    ("i485_emp1_country", "employment", "Employer 1 country",
     "What country is that employer's address in?", "text", "P4Line7_Country[0]"),
    ("i485_emp1_date_from", "employment", "Employer 1 from date",
     "From what date were you employed at, unemployed, retired, or attending that employer or school? (mm/dd/yyyy)", "date", "Pt4Line7_DateFrom[0]"),
    ("i485_emp1_date_to", "employment", "Employer 1 to date",
     "To what date were you employed at, unemployed, retired, or attending that employer or school? (mm/dd/yyyy)", "date", "Pt4Line7_DateTo[0]"),
    ("i485_emp1_support", "employment", "Employer 1 support source",
     "If unemployed or retired, what was your source of financial support during that period?", "text", "Part4Line7_StreetName[1]"),
    ("i485_emp2_name", "employment", "Employer 2 name",
     "What is the name of your most recent employer, company, or school outside the United States (if not already listed above)?", "text", "Pt4Line8_EmployerName[0]"),
    ("i485_emp2_occupation", "employment", "Employer 2 occupation",
     "What is your occupation at that employer or school (if unemployed or retired, so state)?", "text", "Pt4Line8_Occupation[0]"),
    ("i485_emp2_street", "employment", "Employer 2 street",
     "What is the street number and name of that employer, company, or school?", "text", "P4Line8_StreetName[0]"),
    ("i485_emp2_unit", "employment", "Employer 2 unit",
     "What is the apartment, suite, or floor number of that employer's address (if any)?", "text", "P4Line8_Number[0]"),
    ("i485_emp2_city", "employment", "Employer 2 city",
     "What city or town is that employer's address in?", "text", "P4Line8_City[0]"),
    ("i485_emp2_state", "employment", "Employer 2 state",
     "What state is that employer's address in?", "select", "P4Line8_State[0]"),
    ("i485_emp2_zip", "employment", "Employer 2 ZIP",
     "What is the ZIP code of that employer's address?", "text", "P4Line8_ZipCode[0]"),
    ("i485_emp2_province", "employment", "Employer 2 province",
     "What is the province of that employer's address (if outside the United States)?", "text", "P4Line8_Province[0]"),
    ("i485_emp2_postal", "employment", "Employer 2 postal code",
     "What is the postal code of that employer's address (if outside the United States)?", "text", "P4Line8_PostalCode[0]"),
    ("i485_emp2_country", "employment", "Employer 2 country",
     "What country is that employer's address in?", "text", "P4Line8_Country[0]"),
    ("i485_emp2_date_from", "employment", "Employer 2 from date",
     "From what date were you employed at, unemployed, retired, or attending that employer or school? (mm/dd/yyyy)", "date", "Pt4Line8_DateFrom[0]"),
    ("i485_emp2_date_to", "employment", "Employer 2 to date",
     "To what date were you employed at, unemployed, retired, or attending that employer or school? (mm/dd/yyyy)", "date", "Pt4Line8_DateTo[0]"),
    ("i485_emp2_support", "employment", "Employer 2 support source",
     "If unemployed or retired, what was your source of financial support during that period?", "text", "Part4Line8_StreetName[0]"),
    # ── Part 5 parents (step: parents) ──
    ("i485_parent1_family", "parents", "Parent 1 family name",
     "What is Parent 1's legal family name (last name)?", "text", "Pt5Line1_FamilyName[0]"),
    ("i485_parent1_given", "parents", "Parent 1 given name",
     "What is Parent 1's legal given name (first name)?", "text", "Pt5Line1_GivenName[0]"),
    ("i485_parent1_middle", "parents", "Parent 1 middle name",
     "What is Parent 1's legal middle name (if applicable)?", "text", "Pt5Line1_MiddleName[0]"),
    ("i485_parent1_birth_family", "parents", "Parent 1 birth family name",
     "What is Parent 1's family name (last name) at birth (if different than above)?", "text", "Pt5Line2_FamilyName[0]"),
    ("i485_parent1_birth_given", "parents", "Parent 1 birth given name",
     "What is Parent 1's given name (first name) at birth (if different than above)?", "text", "Pt5Line2_GivenName[0]"),
    ("i485_parent1_birth_middle", "parents", "Parent 1 birth middle name",
     "What is Parent 1's middle name at birth (if different than above, if applicable)?", "text", "Pt5Line2_MiddleName[0]"),
    ("i485_parent1_dob", "parents", "Parent 1 date of birth",
     "What is Parent 1's date of birth? (mm/dd/yyyy)", "date", "Pt5Line3_DateofBirth[0]"),
    ("i485_parent1_birth_country", "parents", "Parent 1 country of birth",
     "What is Parent 1's country of birth?", "text", "Pt5Line5_CityTownOfBirth[0]"),
    ("i485_parent2_family", "parents", "Parent 2 family name",
     "What is Parent 2's legal family name (last name)?", "text", "Pt5Line6_FamilyName[0]"),
    ("i485_parent2_given", "parents", "Parent 2 given name",
     "What is Parent 2's legal given name (first name)?", "text", "Pt5Line6_GivenName[0]"),
    ("i485_parent2_middle", "parents", "Parent 2 middle name",
     "What is Parent 2's legal middle name (if applicable)?", "text", "Pt5Line6_MiddleName[0]"),
    ("i485_parent2_birth_family", "parents", "Parent 2 birth family name",
     "What is Parent 2's family name (last name) at birth (if different than above)?", "text", "Pt5Line7_FamilyName[0]"),
    ("i485_parent2_birth_given", "parents", "Parent 2 birth given name",
     "What is Parent 2's given name (first name) at birth (if different than above)?", "text", "Pt5Line7_GivenName[0]"),
    ("i485_parent2_birth_middle", "parents", "Parent 2 birth middle name",
     "What is Parent 2's middle name at birth (if different than above, if applicable)?", "text", "Pt5Line7_MiddleName[0]"),
    ("i485_parent2_dob", "parents", "Parent 2 date of birth",
     "What is Parent 2's date of birth? (mm/dd/yyyy)", "date", "Pt5Line8_DateofBirth[0]"),
    ("i485_parent2_birth_country", "parents", "Parent 2 country of birth",
     "What is Parent 2's country of birth?", "text", "Pt5Line10_CityTownOfBirth[0]"),
    # ── Part 10 applicant contact (step: contact) ──
    ("i485_daytime_phone", "contact", "Daytime phone",
     "What is your daytime telephone number?", "text", "Pt3Line3_DaytimePhoneNumber1[0]"),
    ("i485_mobile_phone", "contact", "Mobile phone",
     "What is your mobile telephone number (if any)?", "text", "Pt3Line4_MobileNumber1[0]"),
    ("i485_email", "contact", "Email",
     "What is your email address (if any)?", "text", "Pt3Line5_Email[0]"),
]

NEW_STEPS = [
    ("immigration", "Immigration History"),
    ("address", "Addresses"),
    ("employment", "Employment History"),
    ("parents", "Parents"),
    ("contact", "Contact Information"),
]

STATES = [
    ("AL", "Alabama"), ("AK", "Alaska"), ("AZ", "Arizona"), ("AR", "Arkansas"),
    ("CA", "California"), ("CO", "Colorado"), ("CT", "Connecticut"), ("DE", "Delaware"),
    ("DC", "District of Columbia"), ("FL", "Florida"), ("GA", "Georgia"), ("HI", "Hawaii"),
    ("ID", "Idaho"), ("IL", "Illinois"), ("IN", "Indiana"), ("IA", "Iowa"),
    ("KS", "Kansas"), ("KY", "Kentucky"), ("LA", "Louisiana"), ("ME", "Maine"),
    ("MD", "Maryland"), ("MA", "Massachusetts"), ("MI", "Michigan"), ("MN", "Minnesota"),
    ("MS", "Mississippi"), ("MO", "Missouri"), ("MT", "Montana"), ("NE", "Nebraska"),
    ("NV", "Nevada"), ("NH", "New Hampshire"), ("NJ", "New Jersey"), ("NM", "New Mexico"),
    ("NY", "New York"), ("NC", "North Carolina"), ("ND", "North Dakota"), ("OH", "Ohio"),
    ("OK", "Oklahoma"), ("OR", "Oregon"), ("PA", "Pennsylvania"), ("RI", "Rhode Island"),
    ("SC", "South Carolina"), ("SD", "South Dakota"), ("TN", "Tennessee"), ("TX", "Texas"),
    ("UT", "Utah"), ("VT", "Vermont"), ("VA", "Virginia"), ("WA", "Washington"),
    ("WV", "West Virginia"), ("WI", "Wisconsin"), ("WY", "Wyoming"),
]

def ts_escape(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


def main():
    fields = json.load(open(FIELDS_PATH))
    short_set = {f['short'] for f in fields}
    short_type = {f['short']: f['type'] for f in fields}

    # ---- Verification pass ----
    errors = []
    seen_fact, seen_short = set(), set()
    for fact, step, short_label, label, typ, short in Q:
        if fact in seen_fact:
            errors.append(f'DUPLICATE factId {fact}')
        seen_fact.add(fact)
        if short in seen_short:
            errors.append(f'DUPLICATE field {short} (fact {fact})')
        seen_short.add(short)
        if short not in short_set:
            errors.append(f'MISSING field in i485_fields.json: {short} (fact {fact})')
        elif short_type[short] not in ('Text', 'ComboBox'):
            errors.append(f'WRONG TYPE {short_type[short]} for {short} (fact {fact})')
        if typ == 'select' and short_type.get(short) != 'ComboBox':
            errors.append(f'select question but field not ComboBox: {short} (fact {fact})')
    # No collision with existing question factIds
    existing_factids = {
        'i485_adjustment_basis', 'i485_basis_approved', 'i485_visa_current',
        'i485_physically_in_us', 'i485_inspected_entry', 'i485_maintained_status',
        'family_name', 'given_name', 'date_of_birth', 'a_number', 'current_street',
        'i485_medical_exam_done', 'i485_affidavit_available', 'i485_criminal_history',
        'i485_fraud_misrep',
    }
    for fact, *_ in Q:
        if fact in existing_factids:
            errors.append(f'COLLISION with existing factId {fact}')
    # No collision with 84 Yes/No pair factIds
    try:
        pairs = json.load(open('/home/hatch/workspace/iru-form-engine/i485_yesno_pairs.json'))
        pair_facts = {p.get('fact') for p in pairs}
        for fact, *_ in Q:
            if fact in pair_facts:
                errors.append(f'COLLISION with Yes/No pair factId {fact}')
    except FileNotFoundError:
        print('WARN: i485_yesno_pairs.json not found; pair-collision check skipped')
    if errors:
        print('VERIFICATION FAILED:')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    print(f'Verified: {len(Q)} questions, all short names exist in i485_fields.json, '
          f'no duplicate factIds/fields, no collisions.')

    # ---- Generate TypeScript block ----
    state_opts = ',\n    '.join(
        f'{{ value: "{v}", labels: {{ EN: "{n}" }} }}' for v, n in STATES)
    lines = []
    lines.append('')
    lines.append('  // ── Parts 1-5 expansion (2026-11-04): personal, immigration, addresses,')
    lines.append('  //    filing-category details, employment history, parents, contact ──')
    lines.append('  //    Ground truth: Form I-485 Edition 09/18/26; field short names verified')
    lines.append('  //    against i485_fields.json and live PyMuPDF widget positions.')
    lines.append('  //    id == factId for every question below, so no FACTID_ALIASES entries needed.')
    cur_step = None
    for fact, step, short_label, label, typ, short in Q:
        if step != cur_step:
            cur_step = step
            lines.append(f'  // ── Step: {step} ──')
        lines.append('  {')
        lines.append(f'    id: "{fact}",')
        lines.append(f'    shortLabel: "{ts_escape(short_label)}",')
        lines.append(f'    step: "{step}",')
        lines.append(f'    type: "{typ}",')
        lines.append(f'    factId: "{fact}",')
        if typ == 'select':
            lines.append('    options: I485_STATE_OPTIONS,')
        lines.append(f'    labels: {{ EN: "{ts_escape(label)}" }},')
        lines.append('    required: false,')
        lines.append('  },')
    block = '\n'.join(lines)

    ts = open(TS_PATH).read()
    anchor = '  {'
    # Insert before the closing of the I485_QUESTIONS array: find the last "];" that closes it
    # The array ends right before "export const I485_STEPS".
    marker = '];\n\nexport const I485_STEPS'
    if marker not in ts:
        print('ERROR: could not find I485_QUESTIONS array end marker')
        sys.exit(1)
    if 'i485_middle_name' in ts:
        print('ERROR: expansion already present in TS file; refusing to double-append')
        sys.exit(1)
    ts = ts.replace(marker, block + '\n' + marker, 1)

    # Add state options const before the questions array
    state_const = ('const I485_STATE_OPTIONS = [\n    ' +
                   state_opts.replace('\n    ', '\n    ') + '\n];\n\n')
    q_anchor = 'export const I485_QUESTIONS = ['
    if 'I485_STATE_OPTIONS' not in ts:
        ts = ts.replace(q_anchor, state_const + q_anchor, 1)

    # Add new steps to I485_STEPS (append before its closing "];")
    steps_marker = '];\n\nexport const I485_FORM_INFO'
    if steps_marker not in ts:
        print('ERROR: could not find I485_STEPS end marker')
        sys.exit(1)
    new_steps_lines = []
    for sid, title in NEW_STEPS:
        new_steps_lines.append(
            f'  {{ id: "{sid}", title: {{ EN: "{title}" }} }},')
    ts = ts.replace(steps_marker,
                    '\n'.join(new_steps_lines) + '\n' + steps_marker, 1)
    open(TS_PATH, 'w').write(ts)
    print(f'TS updated: {len(Q)} questions appended, {len(NEW_STEPS)} steps added.')

    # ---- Update detailed registry ----
    reg = json.load(open(REGISTRY_PATH))
    before = len(reg)
    for fact, step, short_label, label, typ, short in Q:
        reg[fact] = short
    with open(REGISTRY_PATH, 'w') as f:
        json.dump(reg, f, indent=1, sort_keys=True)
        f.write('\n')
    print(f'Registry updated: {before} -> {len(reg)} entries.')


if __name__ == '__main__':
    main()
