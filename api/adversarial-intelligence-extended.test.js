// Adversarial intelligence verification — Premium extension to the four
// expanded forms (I-485, N-400, I-130, I-90), owner directive 2026-11-10.
// Owner principle (2026-11-03): synthetic data must TRY TO FOOL the engine.
// Every case below is designed to trigger a conflict the engine must catch
// as a CONFLICT blocker (ready=false), or to prove a clean case is NOT flagged.
// Also covers the Premium gating: the intelligence applies ONLY when the
// applicant holds a paid preparation entitlement (premium=true); a
// Readiness-only buyer (premium=false) gets the basic assessment only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessN400, assessI130, assessI485, assessI90, assessI765,
  applyIntelligence, scoreAssessment, buildExplanationDrafts,
} from '../src/tier1-assess.ts';

// Relative dates so these tests never go stale.
const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const isoDaysAhead = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const isoYearsAgo = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};
const isoMonthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};
const isoMonthsAhead = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

// Clean base answers that satisfy the basic assessment for each form,
// so `ready` is meaningful (only intelligence conflicts can block it).
const cleanI485 = {
  i485_basis: 'family', i485_basis_approved: 'yes', i485_visa_available: 'yes',
  i485_in_us: 'yes', i485_last_entry: 'yes', i485_i94_number: '123456789',
  i485_i94_expiry: isoDaysAhead(365), i485_current_status_expiry: isoDaysAhead(365),
  i485_status_maintained: 'yes', i485_medical: 'yes', i485_criminal: 'no',
  i485_fraud: 'no', i485_dob: '1990-01-01', i485_arrival_date: isoYearsAgo(3),
  i485_passport_expiry: isoDaysAhead(365), i485_phys_date_first: isoYearsAgo(2),
};
const cleanN400 = {
  n400_age: 'yes', n400_lpr_status: 'yes', n400_lpr_years: '5_plus',
  n400_state_months: 'yes', n400_legal_name: 'Test', n400_dob: '1990-01-01',
  n400_a_number: 'A12345678', n400_lpr_date: isoYearsAgo(6),
  n400_long_trip: 'no', n400_arrests: 'no', n400_taxes: 'yes',
  n400_traveled: 'no', n400_has_children: 'no', n400_child_support: 'na',
};
const cleanI130 = {
  i130_petitioner_status: 'usc', i130_relationship: 'spouse',
  i130_petitioner_age: 'yes', i130_spouse_130a: 'yes',
  i130_pet_name: 'Petitioner', i130_ben_name: 'Beneficiary',
  i130_ben_dob: '1992-01-01', i130_pet_dob: '1990-01-01',
  i130_prior_denied: 'no', i130_prior_petition: 'no',
  i130_ben_location: 'yes', i130_concurrent_filing: 'no',
  i130_ben_proceedings: 'no', i130_multiple_beneficiaries: 'no',
};
const cleanI90 = {
  i90_reason: '2f', i90_has_card: 'yes', i90_name: 'Smith', i90_given: 'John',
  i90_a_number: 'A12345678', i90_address: '1 Main St',
  i90_card_expiry: isoMonthsAhead(3), i90_date_admission: isoYearsAgo(9),
  i90_dob: '1990-01-01', i90_name_changed: 'no',
  i90_card_name_family: 'Smith', i90_card_name_given: 'John',
  i90_exclusion: 'no', i90_abandoned: 'no', i90_police_report: 'no',
};

const hasConflict = (withIntel, fragment) =>
  withIntel.blockers.some(b => b.t.includes(fragment));
const hasWarning = (withIntel, fragment) =>
  withIntel.warnings.some(w => w.t.includes(fragment));

// ── Premium gating ──────────────────────────────────────────────────

describe('Premium gating — intelligence applies only to Premium preparation', () => {
  it('premium=false returns the basic assessment unchanged, even with contradictions', () => {
    // I-485 with an asylum grant 6 months ago: a hard contradiction.
    const answers = {
      ...cleanI485, i485_basis: 'asylum',
      i485_asylum_grant_date: isoMonthsAgo(6),
    };
    const basic = assessI485(answers, 'EN');
    const gated = applyIntelligence('i485', answers, basic, { premium: false });
    assert.equal(hasConflict(gated, 'Asylum grant is less than one year ago'), false,
      'Readiness-only buyer must NOT see the Premium contradiction');
    assert.deepEqual(gated, basic, 'premium=false must return the assessment unchanged');
  });

  it('premium=true (default) applies the intelligence for the same answers', () => {
    const answers = {
      ...cleanI485, i485_basis: 'asylum',
      i485_asylum_grant_date: isoMonthsAgo(6),
    };
    const basic = assessI485(answers, 'EN');
    const withIntel = applyIntelligence('i485', answers, basic);
    assert.ok(hasConflict(withIntel, 'Asylum grant is less than one year ago'),
      'Premium preparation must catch the asylum 1-year contradiction');
    assert.equal(withIntel.ready, false);
  });

  it('premium=false hides I-765 contradictions too (the I-765 Premium piece)', () => {
    const answers = {
      i765_category: 'c8', i765_filing_type: 'renewal', i765_prior_ead: 'yes',
      i765_full_name: 'Test', i765_dob: isoYearsAgo(8), i765_country_birth: 'Cuba',
      i765_last_entry: isoDaysAgo(8), i765_status: 'pending', i765_current_status: 'pending',
    };
    const basic = assessI765(answers, 'EN');
    const gated = applyIntelligence('i765', answers, basic, { premium: false });
    assert.equal(hasConflict(gated, '(c)(8) clock'), false,
      'Readiness-only buyer must NOT see the (c)(8) clock contradiction');
  });

  it('premium=false hides N-400, I-130, and I-90 contradictions', () => {
    const n400 = { ...cleanN400, n400_dob: isoDaysAhead(5) };
    const gated400 = applyIntelligence('n400', n400, assessN400(n400, 'EN'), { premium: false });
    assert.equal(hasConflict(gated400, 'Date of birth is in the future'), false);

    const i130 = { ...cleanI130, i130_ben_dob: isoDaysAhead(5) };
    const gated130 = applyIntelligence('i130', i130, assessI130(i130, 'EN'), { premium: false });
    assert.equal(hasConflict(gated130, 'in the future'), false);

    const i90 = { ...cleanI90, i90_dob: isoDaysAhead(5) };
    const gated90 = applyIntelligence('i90', i90, assessI90(i90, 'EN'), { premium: false });
    assert.equal(hasConflict(gated90, 'Date of birth is in the future'), false);
  });
});

// ── I-485 ───────────────────────────────────────────────────────────

describe('Adversarial I-485 Premium intelligence', () => {
  it('catches asylum grant less than one year ago (cannot adjust yet)', () => {
    const answers = { ...cleanI485, i485_basis: 'asylum', i485_asylum_grant_date: isoMonthsAgo(6) };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Asylum grant is less than one year ago'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag asylum grant more than one year ago', () => {
    const answers = { ...cleanI485, i485_basis: 'asylum', i485_asylum_grant_date: isoYearsAgo(2) };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.equal(hasConflict(withIntel, 'Asylum grant'), false);
    assert.equal(withIntel.ready, true);
  });

  it('catches asylum basis with no grant date', () => {
    const answers = { ...cleanI485, i485_basis: 'asylum' };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Asylum grant date is missing'));
    assert.equal(withIntel.ready, false);
  });

  it('catches refugee admission less than one year ago', () => {
    const answers = { ...cleanI485, i485_basis: 'refugee', i485_refugee_admission_date: isoMonthsAgo(6) };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Refugee admission is less than one year ago'));
    assert.equal(withIntel.ready, false);
  });

  it('catches inspected entry with no I-94 number', () => {
    const answers = { ...cleanI485, i485_i94_number: '' };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Inspected entry but no I-94 number'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag inspected entry when the I-94 number is provided', () => {
    const withIntel = applyIntelligence('i485', cleanI485, assessI485(cleanI485, 'EN'));
    assert.equal(hasConflict(withIntel, 'I-94 number'), false);
  });

  it('catches expired I-94 while status is claimed maintained', () => {
    const answers = { ...cleanI485, i485_i94_expiry: isoDaysAgo(30) };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'I-94 expired but status is claimed maintained'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag an expired I-94 when status is NOT claimed maintained', () => {
    const answers = { ...cleanI485, i485_i94_expiry: isoDaysAgo(30), i485_status_maintained: 'no' };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.equal(hasConflict(withIntel, 'I-94 expired but status is claimed maintained'), false);
  });

  it('treats "D/S" as a valid I-94 expiry, not a date', () => {
    const answers = { ...cleanI485, i485_i94_expiry: 'D/S' };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.equal(hasConflict(withIntel, 'I-94 expired'), false);
  });

  it('catches arrival before date of birth', () => {
    const answers = { ...cleanI485, i485_arrival_date: '1985-01-01', i485_dob: '1990-01-01' };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Arrival date is before date of birth'));
    assert.equal(withIntel.ready, false);
  });

  it('catches a future date of birth', () => {
    const answers = { ...cleanI485, i485_dob: isoDaysAhead(5) };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Date of birth is in the future'));
  });

  it('catches a child born before the parent', () => {
    const answers = { ...cleanI485, i485_child2_dob: '1980-01-01' };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Child date of birth is before parent date of birth'));
  });

  it('catches visa available with a future priority date', () => {
    const answers = { ...cleanI485, i485_petition_priority_date: isoDaysAhead(30) };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Visa available but priority date is in the future'));
    assert.equal(withIntel.ready, false);
  });

  it('catches inverted employment dates', () => {
    const answers = {
      ...cleanI485,
      i485_emp1_date_from: isoYearsAgo(1), i485_emp1_date_to: isoYearsAgo(2),
    };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Employment 1 dates are inverted'));
  });

  it('flags an expired passport as a warning, not a blocker', () => {
    const answers = { ...cleanI485, i485_passport_expiry: isoDaysAgo(10) };
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Passport has expired'));
    assert.equal(hasConflict(withIntel, 'Passport has expired'), false);
  });

  it('builds Part 8 explanation drafts only from the applicant answers — nothing invented', () => {
    const answers = { ...cleanI485, i485_adm_01: 'yes', i485_adm_07: 'yes', i485_adm_12: 'no' };
    const drafts = buildExplanationDrafts('i485', answers);
    assert.equal(drafts.length, 2, 'One draft per Part 8 "yes"');
    assert.equal(drafts[0].status, 'draft-needs-review');
    assert.ok(drafts[0].draftText.includes('review and correct'), 'Draft must be labelled for review');
    // The draft must not claim facts the applicant did not supply.
    assert.ok(!drafts[0].draftText.includes('on 2020'), 'Draft must not invent a date');
    const withIntel = applyIntelligence('i485', answers, assessI485(answers, 'EN'));
    assert.ok(hasWarning(withIntel, '2 explanation drafts prepared'), 'Report must surface the drafts');
  });

  it('builds no drafts when no Part 8 question is answered yes', () => {
    const drafts = buildExplanationDrafts('i485', cleanI485);
    assert.equal(drafts.length, 0);
  });
});

// ── N-400 ───────────────────────────────────────────────────────────

describe('Adversarial N-400 Premium intelligence', () => {
  it('catches claiming 5+ years as LPR when the LPR date is 3 years ago', () => {
    const answers = { ...cleanN400, n400_lpr_years: '5_plus', n400_lpr_date: isoYearsAgo(3) };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Residency duration contradicts LPR date'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag 5+ years when the LPR date is 6 years ago', () => {
    const withIntel = applyIntelligence('n400', cleanN400, assessN400(cleanN400, 'EN'));
    assert.equal(hasConflict(withIntel, 'Residency duration contradicts'), false);
    assert.equal(withIntel.ready, true);
  });

  it('catches claiming 3–5 years when the LPR date is 1 year ago', () => {
    const answers = { ...cleanN400, n400_lpr_years: '3_to_5', n400_lpr_date: isoYearsAgo(1) };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Residency duration contradicts LPR date'));
  });

  it('catches becoming an LPR before being born', () => {
    const answers = { ...cleanN400, n400_lpr_date: '1985-01-01', n400_dob: '1990-01-01' };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'LPR date before date of birth'));
  });

  it('catches a 3-year path with a marriage less than 3 years old', () => {
    const answers = {
      ...cleanN400, n400_lpr_years: '3_to_5', n400_married_usc: 'yes',
      n400_marriage_date: isoYearsAgo(1), n400_spouse_natz_date: isoYearsAgo(5),
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Marriage is less than 3 years old for the 3-year path'));
    assert.equal(withIntel.ready, false);
  });

  it('catches a 3-year path when the spouse has been a citizen less than 3 years', () => {
    const answers = {
      ...cleanN400, n400_lpr_years: '3_to_5', n400_married_usc: 'yes',
      n400_marriage_date: isoYearsAgo(5), n400_spouse_natz_date: isoYearsAgo(1),
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Spouse has been a U.S. citizen less than 3 years'));
  });

  it('does NOT flag the 3-year path when marriage and spouse citizenship are both 4+ years', () => {
    const answers = {
      ...cleanN400, n400_lpr_years: '3_to_5', n400_married_usc: 'yes',
      n400_marriage_date: isoYearsAgo(4), n400_spouse_natz_date: isoYearsAgo(4),
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.equal(hasConflict(withIntel, '3-year path'), false);
  });

  it('infers the 3-year path when the fixed married-USC ID is used (regression)', () => {
    const answers = { ...cleanN400, n400_lpr_years: '3_to_5', n400_married_usc: 'yes' };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Three-year eligibility path'),
      'The 3-year inference must fire now that the real question ID is read');
  });

  it('catches inverted residence dates', () => {
    const answers = {
      ...cleanN400,
      n400_residence_history: [
        { street: '1 Main St', city: 'NYC', state: 'NY', from: '01/2024', to: '01/2023' },
      ],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Residence dates are inverted'));
  });

  it('flags a gap of more than 6 months in residence history', () => {
    const answers = {
      ...cleanN400,
      n400_residence_history: [
        { street: '1 Main St', city: 'NYC', state: 'NY', from: '01/2020', to: '01/2021' },
        { street: '2 Oak Ave', city: 'NYC', state: 'NY', from: '01/2022', to: 'present' },
      ],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Gap in residence history'));
    assert.equal(hasConflict(withIntel, 'Gap in residence history'), false, 'A gap is a warning, not a blocker');
  });

  it('catches inverted employment dates', () => {
    const answers = {
      ...cleanN400,
      n400_employment_history: [
        { employer: 'Acme', title: 'Clerk', from: '01/2024', to: '01/2023' },
      ],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Employment dates are inverted'));
  });

  it('flags overlapping employment of more than 2 months for verification', () => {
    const answers = {
      ...cleanN400,
      n400_employment_history: [
        { employer: 'Acme', title: 'Clerk', from: '01/2022', to: '12/2023' },
        { employer: 'Beta', title: 'Manager', from: '06/2023', to: 'present' },
      ],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Overlapping employment periods'));
  });

  it('catches a trip that returns before it departs', () => {
    const answers = {
      ...cleanN400, n400_traveled: 'yes',
      n400_trips: [{ destination: 'Cuba', departure: '2024-06-01', return: '2024-05-01' }],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Trip return is before departure'));
  });

  it('catches overlapping trips', () => {
    const answers = {
      ...cleanN400, n400_traveled: 'yes',
      n400_trips: [
        { destination: 'Cuba', departure: '2024-01-01', return: '2024-03-01' },
        { destination: 'Mexico', departure: '2024-02-01', return: '2024-04-01' },
      ],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Overlapping trips'));
  });

  it('catches a trip departing in the future', () => {
    const answers = {
      ...cleanN400, n400_traveled: 'yes',
      n400_trips: [{ destination: 'Cuba', departure: isoDaysAhead(5), return: isoDaysAhead(10) }],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Trip departure is in the future'));
  });

  it('notes a trip that ended before becoming an LPR (does not count against residence)', () => {
    const answers = {
      ...cleanN400, n400_traveled: 'yes',
      n400_trips: [{ destination: 'Cuba', departure: isoYearsAgo(8), return: isoYearsAgo(7) }],
    };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Trip before becoming an LPR'));
  });

  it('flags children listed but child support not current', () => {
    const answers = { ...cleanN400, n400_has_children: 'yes', n400_child_support: 'no' };
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Child support not current'));
  });

  it('builds GMC explanation drafts only from the applicant answers', () => {
    const answers = { ...cleanN400, n400_gmc_00: 'yes', n400_gmc_05: 'yes', n400_gmc_10: 'no' };
    const drafts = buildExplanationDrafts('n400', answers);
    assert.equal(drafts.length, 2, 'One draft per GMC "yes"');
    assert.equal(drafts[0].questionRef, 'GMC Q1');
    assert.equal(drafts[1].questionRef, 'GMC Q6');
    assert.equal(drafts[0].status, 'draft-needs-review');
    assert.ok(!drafts[0].draftText.includes('arrested'), 'Draft must not invent the underlying facts');
    const withIntel = applyIntelligence('n400', answers, assessN400(answers, 'EN'));
    assert.ok(hasWarning(withIntel, '2 explanation drafts prepared'), 'Report must surface the drafts');
  });
});

// ── I-130 ───────────────────────────────────────────────────────────

describe('Adversarial I-130 Premium intelligence', () => {
  it('infers immediate relative for a USC petitioning a child under 21 (regression)', () => {
    const answers = { ...cleanI130, i130_relationship: 'child_under_21' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Immediate relative category'),
      'The immediate-relative inference must fire for child_under_21 (the old code checked a non-existent value)');
  });

  it('infers F2A for an LPR petitioning a spouse', () => {
    const answers = { ...cleanI130, i130_petitioner_status: 'lpr', i130_relationship: 'spouse' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Family preference category (F2A)'));
  });

  it('catches a parent petitioning a child when the petitioner is younger than the child', () => {
    const answers = {
      ...cleanI130, i130_relationship: 'child_under_21',
      i130_pet_dob: '2000-01-01', i130_ben_dob: '1990-01-01',
    };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Petitioner is younger than the child beneficiary'));
    assert.equal(withIntel.ready, false);
  });

  it('catches a child petitioning a parent when the petitioner is older than the parent', () => {
    // Relationship 'parent' = the petitioner is the CHILD petitioning for
    // their parent. The petitioner must be younger than the beneficiary.
    // Here the "child" (petitioner, born 1980) is OLDER than the "parent" (born 1990) — impossible.
    const answers = {
      ...cleanI130, i130_relationship: 'parent',
      i130_pet_dob: '1980-01-01', i130_ben_dob: '1990-01-01',
    };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Petitioner is older than the parent beneficiary'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag a child petitioning a parent when the petitioner is younger', () => {
    const answers = {
      ...cleanI130, i130_relationship: 'parent',
      i130_pet_dob: '1990-01-01', i130_ben_dob: '1960-01-01',
    };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.equal(hasConflict(withIntel, 'Petitioner is older than the parent beneficiary'), false);
  });

  it('catches a child under 21 whose DOB says 25', () => {
    const answers = { ...cleanI130, i130_relationship: 'child_under_21', i130_ben_dob: isoYearsAgo(25) };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Beneficiary is 21 or older, not a child under 21'));
    assert.equal(withIntel.ready, false);
  });

  it('catches a son/daughter over 21 whose DOB says 18', () => {
    const answers = { ...cleanI130, i130_relationship: 'son_daughter_over_21', i130_ben_dob: isoYearsAgo(18) };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Beneficiary is under 21, not a son/daughter over 21'));
  });

  it('catches a petitioner under 21 petitioning a sibling', () => {
    const answers = { ...cleanI130, i130_relationship: 'sibling', i130_pet_dob: isoYearsAgo(19) };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Petitioner is under 21'));
  });

  it('catches spouse marriage dates that differ by 60 days', () => {
    const answers = {
      ...cleanI130,
      i130_pet_marriage_date: '2020-01-01', i130_ben_marriage_date: '2020-03-01',
    };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Marriage dates do not match'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag spouse marriage dates that match exactly', () => {
    const answers = {
      ...cleanI130,
      i130_pet_marriage_date: '2020-01-01', i130_ben_marriage_date: '2020-01-01',
    };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.equal(hasConflict(withIntel, 'Marriage dates do not match'), false);
  });

  it('catches a prior petition with no filing date', () => {
    const answers = { ...cleanI130, i130_prior_petition: 'yes' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Prior petition date is missing'));
  });

  it('catches a prior denial with no prior petition', () => {
    const answers = { ...cleanI130, i130_prior_petition: 'no', i130_prior_denied: 'yes' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Prior denial without a prior petition'));
  });

  it('catches a prior result that says denied while denial was answered No', () => {
    const answers = {
      ...cleanI130, i130_prior_petition: 'yes', i130_prior_petition_date: isoYearsAgo(1),
      i130_prior_petition_result: 'Denied by USCIS', i130_prior_denied: 'no',
    };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Prior result says denied, but denial was answered No'));
  });

  it('catches concurrent filing with the beneficiary outside the U.S.', () => {
    const answers = { ...cleanI130, i130_concurrent_filing: 'yes', i130_ben_location: 'no' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Concurrent filing with beneficiary outside the U.S.'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag concurrent filing when the beneficiary is in the U.S.', () => {
    const answers = { ...cleanI130, i130_concurrent_filing: 'yes', i130_ben_location: 'yes' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.equal(hasConflict(withIntel, 'Concurrent filing'), false);
  });

  it('catches multiple beneficiaries with no derivative child listed', () => {
    const answers = { ...cleanI130, i130_multiple_beneficiaries: 'yes' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Derivative children not listed'));
  });

  it('flags a beneficiary in removal proceedings and builds a draft', () => {
    const answers = { ...cleanI130, i130_ben_proceedings: 'yes' };
    const withIntel = applyIntelligence('i130', answers, assessI130(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Beneficiary in removal proceedings'));
    assert.ok(hasWarning(withIntel, 'explanation draft'), 'Proceedings draft must surface');
    const drafts = buildExplanationDrafts('i130', answers);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].questionId, 'i130_ben_proceedings');
  });
});

// ── I-90 ────────────────────────────────────────────────────────────

describe('Adversarial I-90 Premium intelligence', () => {
  it('catches reason 2f when the card expires 12 months away', () => {
    const answers = { ...cleanI90, i90_card_expiry: isoMonthsAhead(12) };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Card does not expire within 6 months'));
    assert.equal(withIntel.ready, false);
  });

  it('does NOT flag reason 2f when the card expires in 3 months', () => {
    const withIntel = applyIntelligence('i90', cleanI90, assessI90(cleanI90, 'EN'));
    assert.equal(hasConflict(withIntel, 'Card does not expire within 6 months'), false);
    assert.ok(hasWarning(withIntel, 'Routine renewal'));
  });

  it('flags an already-expired card as a warning, not a blocker', () => {
    const answers = { ...cleanI90, i90_card_expiry: isoDaysAgo(30) };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Card already expired'));
    assert.equal(hasConflict(withIntel, 'Card already expired'), false);
  });

  it('catches reason 2b (never received) when the applicant has the card', () => {
    const answers = { ...cleanI90, i90_reason: '2b', i90_has_card: 'yes' };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Card status contradiction'));
  });

  it('catches reason 2e (name changed) when name change was answered No', () => {
    const answers = { ...cleanI90, i90_reason: '2e', i90_name_changed: 'no' };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Name-change reason but no name change reported'));
  });

  it('catches a card name that differs while name change was answered No', () => {
    const answers = { ...cleanI90, i90_card_name_family: 'Jones', i90_card_name_given: 'John' };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Card name differs but no name change reported'));
    assert.equal(withIntel.ready, false);
  });

  it('notes when the card already shows the current name after a name change', () => {
    const answers = { ...cleanI90, i90_name_changed: 'yes', i90_reason: '2e' };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'Card already shows the current name'));
  });

  it('catches admission before date of birth', () => {
    const answers = { ...cleanI90, i90_date_admission: '1985-01-01', i90_dob: '1990-01-01' };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Admission date is before date of birth'));
  });

  it('catches a card expiring before the admission date', () => {
    const answers = { ...cleanI90, i90_date_admission: isoYearsAgo(2), i90_card_expiry: isoYearsAgo(5) };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'Card expires before the admission date'));
  });

  it('catches a short A-Number', () => {
    const answers = { ...cleanI90, i90_a_number: 'A123' };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasConflict(withIntel, 'A-Number format'));
  });

  it('flags exclusion proceedings and abandonment for attorney review', () => {
    const excl = applyIntelligence('i90', { ...cleanI90, i90_exclusion: 'yes' }, assessI90({ ...cleanI90, i90_exclusion: 'yes' }, 'EN'));
    assert.ok(hasWarning(excl, 'Exclusion or deportation proceedings'));
    const aband = applyIntelligence('i90', { ...cleanI90, i90_abandoned: 'yes' }, assessI90({ ...cleanI90, i90_abandoned: 'yes' }, 'EN'));
    assert.ok(hasWarning(aband, 'Abandonment of status disclosed'));
  });

  it('flags a lost/stolen card with no police report', () => {
    const answers = { ...cleanI90, i90_reason: '2a', i90_has_card: 'no', i90_police_report: 'no' };
    const withIntel = applyIntelligence('i90', answers, assessI90(answers, 'EN'));
    assert.ok(hasWarning(withIntel, 'No police report for lost/stolen card'));
  });

  it('builds a name-change explanation draft from the applicant answers', () => {
    const answers = { ...cleanI90, i90_name_changed: 'yes' };
    const drafts = buildExplanationDrafts('i90', answers);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].status, 'draft-needs-review');
    assert.ok(drafts[0].draftText.includes('Smith'), 'Draft may quote the card name the applicant supplied');
    assert.ok(!drafts[0].draftText.includes('married'), 'Draft must not invent a reason for the change');
  });
});

// ── Scoring: conflicts drop the score ───────────────────────────────

describe('Premium intelligence drops the readiness score', () => {
  it('I-485 with an asylum 1-year conflict scores below the clean case', () => {
    const clean = scoreAssessment(applyIntelligence('i485', cleanI485, assessI485(cleanI485, 'EN')), 'I-485');
    const badAnswers = { ...cleanI485, i485_basis: 'asylum', i485_asylum_grant_date: isoMonthsAgo(6) };
    const bad = scoreAssessment(applyIntelligence('i485', badAnswers, assessI485(badAnswers, 'EN')), 'I-485');
    assert.ok(bad.overallScore < clean.overallScore, `Conflict case (${bad.overallScore}) must score below clean case (${clean.overallScore})`);
    // The overall band is an average across sections, so a single-section
    // blocker does not force Incomplete — but the case must not be ready.
    assert.equal(bad.ready, false, 'A blocked case must not be ready');
    assert.ok(bad.blockers.some(b => b.t.includes('Asylum grant is less than one year ago')));
  });

  it('N-400 with a 5-year/3-year contradiction scores below the clean case', () => {
    const clean = scoreAssessment(applyIntelligence('n400', cleanN400, assessN400(cleanN400, 'EN')), 'N-400');
    const bad = scoreAssessment(
      applyIntelligence('n400', { ...cleanN400, n400_lpr_date: isoYearsAgo(3) }, assessN400({ ...cleanN400, n400_lpr_date: isoYearsAgo(3) }, 'EN')),
      'N-400',
    );
    assert.ok(bad.overallScore < clean.overallScore);
  });
});
