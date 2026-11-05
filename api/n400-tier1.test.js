import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildN400FactRecord, assessN400Readiness, buildN400Report, N400_FORM } from './n400-tier1.js';
import { N400_QUESTIONS, N400_STEPS } from '../src/n400-questions.ts';

describe('N-400 Tier 1', () => {
  it('questionnaire has 9 steps covering all major form parts', () => {
    assert.strictEqual(N400_STEPS.length, 9);
    const stepIds = N400_STEPS.map(s => s.id);
    for (const s of ['eligibility', 'personal', 'residence', 'travel', 'character']) {
      assert.ok(stepIds.includes(s), `missing step ${s}`);
    }
  });

  it('every question has a factId and English label', () => {
    for (const q of N400_QUESTIONS) {
      assert.ok(q.id, 'question missing id');
      assert.ok(q.labels?.EN, `question ${q.id} missing EN label`);
    }
  });

  it('form info points to the correct edition and URLs', () => {
    assert.strictEqual(N400_FORM.edition, '01/20/25');
    assert.ok(N400_FORM.pdfUrl.includes('n-400.pdf'));
    assert.ok(N400_FORM.instructionsUrl.includes('n-400instr.pdf'));
  });

  it('happy path: complete applicant is ready', () => {
    const answers = {
      n400_age: 'yes', n400_lpr_status: 'yes', n400_lpr_years: '5_plus', n400_married_usc: 'no',
      n400_legal_name: 'Garcia', n400_given_name: 'Maria', n400_dob: '1985-03-15',
      n400_a_number: 'A123456789', n400_phone: '555-0100',
      n400_current_address: '123 Main St', n400_state_months: 'yes',
      n400_marital_status: 'single', n400_has_children: 'no',
      n400_traveled: 'no', n400_long_trip: 'no',
      n400_arrests: 'no', n400_taxes: 'yes', n400_child_support: 'na',
      n400_fee_reduction: 'no',
    };
    const rec = buildN400FactRecord(answers);
    assert.ok(Object.keys(rec.facts).length >= 15, 'facts written');
    const r = assessN400Readiness(rec);
    assert.strictEqual(r.ready, true);
    assert.strictEqual(r.blockers.length, 0);
  });

  it('blockers detected: under-18, non-LPR, short LPR duration, missing info', () => {
    const rec = buildN400FactRecord({ n400_age: 'no', n400_lpr_status: 'no', n400_lpr_years: 'under_3' });
    const r = assessN400Readiness(rec);
    assert.strictEqual(r.ready, false);
    assert.ok(r.blockers.length >= 3, `expected 3+ blockers, got ${r.blockers.length}`);
  });

  it('warnings flagged: long trip, arrest, missed taxes', () => {
    const rec = buildN400FactRecord({
      n400_age: 'yes', n400_lpr_status: 'yes', n400_lpr_years: '5_plus',
      n400_legal_name: 'X', n400_given_name: 'Y', n400_dob: '1990-01-01',
      n400_a_number: 'A1', n400_phone: '1', n400_current_address: '1',
      n400_state_months: 'yes', n400_marital_status: 'single', n400_has_children: 'no',
      n400_traveled: 'no', n400_long_trip: 'yes',
      n400_arrests: 'yes', n400_taxes: 'no', n400_child_support: 'na',
      n400_fee_reduction: 'no', n400_married_usc: 'no',
    });
    const r = assessN400Readiness(rec);
    assert.ok(r.warnings.length >= 3, `expected 3+ warnings, got ${r.warnings.length}`);
  });

  it('report includes download link and is not legal advice', () => {
    const rec = buildN400FactRecord({ n400_age: 'yes' });
    const r = assessN400Readiness(rec);
    const report = buildN400Report(rec, r);
    assert.ok(report.includes('n-400.pdf'), 'download link present');
    assert.ok(report.includes('not legal advice'), 'disclaimer present');
  });

  it('no SSN collected in questionnaire', () => {
    const text = JSON.stringify(N400_QUESTIONS).toLowerCase();
    assert.ok(!text.includes('social security'), 'no SSN reference');
    assert.ok(!text.includes('ssn'), 'no SSN abbreviation');
  });
});
