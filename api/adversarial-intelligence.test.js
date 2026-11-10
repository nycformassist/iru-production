// Adversarial intelligence verification tests
// Owner principle (2026-11-03): synthetic data must TRY TO FOOL the engine,
// not just pass cleanly. These cases are designed to trigger conflicts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessN400, applyIntelligence, scoreAssessment } from '../src/tier1-assess.ts';

// The owner's actual adversarial test case from 2026-11-03
const adversarialN400 = {
  n400_age: 'yes',
  n400_lpr_status: 'yes',
  n400_lpr_years: '5_plus',
  n400_married_to_usc: 'yes',
  n400_state_months: 'yes',
  n400_legal_name: 'Nono',
  n400_given_name: 'Poll',
  n400_dob: '2000-11-03',
  n400_a_number: 'A1334567',           // 7 digits — should flag format
  n400_email: 'V347.829.5506@gmail.com', // phone number as email — should flag
  n400_phone: '2125551212',
  n400_address: '1 main street',
  n400_traveled: 'yes',
  n400_trips: [{ destination: 'Cuba', departure: '2024-11-03', return: '2026-07-02' }], // 20 months!
  n400_long_trip: 'no',                // CONTRADICTION: 20mo trip but "no" to 6+ months
  n400_has_children: 'no',
  n400_child_support: 'yes',           // CONTRADICTION: no children but child support
  n400_arrests: 'yes',
  n400_taxes: 'no',
};

describe('Adversarial N-400 intelligence', () => {
  const basic = assessN400(adversarialN400, 'EN');
  const withIntel = applyIntelligence('n400', adversarialN400, basic);
  const scored = scoreAssessment(withIntel, 'N-400');

  it('catches trip duration contradiction (20mo trip, answered No to 6+ months)', () => {
    const found = withIntel.blockers.some(b => b.t.includes('Trip duration contradiction'));
    assert.ok(found, 'Should flag 20-month trip vs "No" to 6+ months as CONFLICT');
  });

  it('catches child support contradiction (no children, but child support yes)', () => {
    const found = withIntel.blockers.some(b => b.t.includes('Child support contradiction'));
    assert.ok(found, 'Should flag no-children + child-support as CONFLICT');
  });

  it('catches phone-number-as-email', () => {
    const found = withIntel.blockers.some(b => b.t.includes('Email looks like phone number') || b.t.includes('Invalid email'));
    assert.ok(found, 'Should flag V347.829.5506@gmail.com as suspicious email');
  });

  it('catches short A-Number (7 digits)', () => {
    const found = withIntel.blockers.some(b => b.t.includes('A-Number format'));
    assert.ok(found, 'Should flag A1334567 (7 digits) as format issue');
  });

  it('marks not-ready when conflicts exist', () => {
    assert.equal(withIntel.ready, false, 'Conflicts should block ready=true');
  });

  it('scores GMC as Developing (not 0%) when warnings exist but questions answered', () => {
    const gmc = scored.sections.find(s => s.section === 'Good Moral Character');
    assert.ok(gmc, 'GMC section should exist');
    assert.ok(gmc.score > 0, `GMC should not be 0% (got ${gmc.score})`);
    assert.equal(gmc.band, 'Developing', `GMC should be Developing, got ${gmc.band}`);
  });

  it('has no "General" section', () => {
    const general = scored.sections.find(s => s.section === 'General');
    assert.ok(!general, 'No finding should land in "General"');
  });

  it('infers heightened character review from arrest + tax combo', () => {
    const found = withIntel.warnings.some(w => w.t.includes('Heightened character review'));
    assert.ok(found, 'Should infer heightened review from arrest + missing taxes');
  });
});

import { assessI765, applyIntelligence as applyIntel765, scoreAssessment as score765 } from '../src/tier1-assess.ts';

describe('Adversarial I-765 intelligence', () => {
  it('catches renewal without prior EAD', () => {
    const answers = {
      i765_category: 'c9', i765_filing_type: 'renewal', i765_prior_ead: 'no',
      i765_full_name: 'Test', i765_dob: '1990-01-01', i765_country_birth: 'Test',
      i765_last_entry: '2020-01-01', i765_status: 'B-2', i765_current_status: 'Pending',
    };
    const basic = assessI765(answers, 'EN');
    const found = basic.blockers.some(b => b.t.includes('Renewal without prior EAD'));
    assert.ok(found, 'Should flag renewal with no prior EAD as conflict');
    assert.equal(basic.ready, false);
  });

  it('requires eligibility category (D-1: IRU does not determine)', () => {
    const answers = { i765_filing_type: 'initial', i765_full_name: 'Test', i765_dob: '1990-01-01', i765_country_birth: 'Test', i765_last_entry: '2020-01-01' };
    const basic = assessI765(answers, 'EN');
    const found = basic.blockers.some(b => b.t.includes('Eligibility category'));
    assert.ok(found, 'Missing category should be a blocker');
  });

  it('infers asylum EAD timing for (c)(8)', () => {
    const answers = {
      i765_category: 'c8', i765_filing_type: 'initial',
      i765_full_name: 'Test', i765_dob: '1990-01-01', i765_country_birth: 'Test',
      i765_last_entry: '2020-01-01', i765_status: 'Pending', i765_current_status: 'Pending',
    };
    const basic = assessI765(answers, 'EN');
    const withIntel = applyIntel765('i765', answers, basic);
    const found = withIntel.warnings.some(w => w.t.includes('Asylum-based EAD timing'));
    assert.ok(found, 'Should infer 150/180-day clock for (c)(8)');
  });

  it('validates A-Number format', () => {
    const answers = {
      i765_category: 'c9', i765_filing_type: 'initial', i765_a_number: 'A123',
      i765_full_name: 'Test', i765_dob: '1990-01-01', i765_country_birth: 'Test',
      i765_last_entry: '2020-01-01', i765_status: 'B-2', i765_current_status: 'Pending',
    };
    const basic = assessI765(answers, 'EN');
    const found = basic.warnings.some(w => w.t.includes('A-Number format'));
    assert.ok(found, 'Should flag short A-Number');
  });

  // Owner's 2026-11-09 report case: the readiness report scored 88% /
  // "Ready to prepare" for a (c)(8) RENEWAL filed 8 days after entry,
  // with an 8-year-old applicant — and only said "verify with staff".
  // Premium intelligence must catch the mutually contradictory dates as
  // a BLOCKER, not a soft warning.
  const isoDaysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const isoYearsAgo = (n) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    return d.toISOString().slice(0, 10);
  };

  it("catches (c)(8) renewal 8 days after entry — clock cannot have reached 150 days", () => {
    const answers = {
      i765_category: 'c8', i765_filing_type: 'renewal', i765_prior_ead: 'yes',
      i765_full_name: 'fgg fgdg', i765_dob: isoYearsAgo(8), i765_country_birth: 'Cuba',
      i765_last_entry: isoDaysAgo(8), i765_status: 'entered without inspection', i765_current_status: 'pending',
    };
    const basic = assessI765(answers, 'EN');
    const withIntel = applyIntel765('i765', answers, basic);
    const found = withIntel.blockers.some(b => b.t.includes('(c)(8) clock cannot have reached 150 days'));
    assert.ok(found, 'Should flag (c)(8) + entry 8 days ago as a CONFLICT blocker');
    assert.equal(withIntel.ready, false, 'Contradictory dates must block ready=true');
    const scored = score765(withIntel, 'I-765');
    assert.ok(scored.overallScore < 0.88, `Score must drop below the old 88% once the contradiction is a blocker (got ${scored.overallScore})`);
  });

  it('does NOT flag (c)(8) when entry was more than 150 days ago', () => {
    const answers = {
      i765_category: 'c8', i765_filing_type: 'initial',
      i765_full_name: 'Test', i765_dob: '1990-01-01', i765_country_birth: 'Test',
      i765_last_entry: isoDaysAgo(200), i765_status: 'Pending', i765_current_status: 'Pending',
    };
    const basic = assessI765(answers, 'EN');
    const withIntel = applyIntel765('i765', answers, basic);
    const found = withIntel.blockers.some(b => b.t.includes('150 days'));
    assert.equal(found, false, 'Entry 200 days ago can satisfy the 150-day clock');
  });

  it('flags a future last-entry date as impossible', () => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    const answers = {
      i765_category: 'c9', i765_filing_type: 'initial',
      i765_full_name: 'Test', i765_dob: '1990-01-01', i765_country_birth: 'Test',
      i765_last_entry: d.toISOString().slice(0, 10), i765_status: 'B-2', i765_current_status: 'Pending',
    };
    const basic = assessI765(answers, 'EN');
    const withIntel = applyIntel765('i765', answers, basic);
    const found = withIntel.blockers.some(b => b.t.includes('Last entry date is in the future'));
    assert.ok(found, 'Future entry date must be a blocker');
  });

  it('flags a young renewal applicant for verification', () => {
    const answers = {
      i765_category: 'c9', i765_filing_type: 'renewal', i765_prior_ead: 'yes',
      i765_full_name: 'Test', i765_dob: isoYearsAgo(8), i765_country_birth: 'Test',
      i765_last_entry: isoDaysAgo(400), i765_status: 'B-2', i765_current_status: 'Pending',
    };
    const basic = assessI765(answers, 'EN');
    const withIntel = applyIntel765('i765', answers, basic);
    const found = withIntel.warnings.some(w => w.t.includes('Young renewal applicant'));
    assert.ok(found, 'An 8-year-old renewal applicant should be flagged for verification');
  });
});

import { buildFactRecord, markConflicts, scoreSectionWeighted } from '../src/tier1-assess.ts';

describe('Fact provenance layer', () => {
  it('tracks applicant-typed facts with full confidence', () => {
    const fr = buildFactRecord({ n400_age: 'yes' });
    assert.equal(fr.facts['n400_age'].source, 'applicant-typed');
    assert.equal(fr.facts['n400_age'].confidence, 1.0);
    assert.equal(fr.facts['n400_age'].status, 'provided');
  });

  it('tracks corrections with history', () => {
    const fr1 = buildFactRecord({ n400_age: 'no' });
    const fr2 = buildFactRecord({ n400_age: 'yes' }, fr1);
    assert.equal(fr2.facts['n400_age'].source, 'corrected');
    assert.equal(fr2.facts['n400_age'].status, 'corrected');
    assert.equal(fr2.facts['n400_age'].corrections.length, 1);
    assert.equal(fr2.facts['n400_age'].corrections[0].oldValue, 'no');
    assert.equal(fr2.facts['n400_age'].confidence, 0.9);
  });

  it('marks conflicts with low confidence', () => {
    const fr = buildFactRecord({ n400_traveled: 'no' });
    const marked = markConflicts(fr, ['n400_traveled']);
    assert.equal(marked.facts['n400_traveled'].status, 'conflicted');
    assert.equal(marked.facts['n400_traveled'].confidence, 0.3);
  });

  it('confidence-weighted scoring reduces score for low-confidence facts', () => {
    const findings = { blockers: [], warnings: [{ t: 'Test warning about n400_age', d: 'test' }], complete: [{ t: 'n400_age complete', d: 'test' }] };
    const fr = buildFactRecord({ n400_age: 'yes' });
    const marked = markConflicts(fr, ['n400_age']);
    const weighted = scoreSectionWeighted(findings, marked);
    const unweighted = scoreSectionWeighted(findings, fr);
    assert.ok(weighted <= unweighted, 'Conflicted facts should not score higher');
  });
});
