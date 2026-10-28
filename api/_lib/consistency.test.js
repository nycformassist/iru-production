/**
 * consistency.test.js — C2: deterministic model-output vs record check.
 *
 * FIXTURE PROVENANCE: the live runs never captured raw model JSON (the
 * server deliberately logs no model text). The "contradiction" fixtures
 * below are RECONSTRUCTIONS of the rendered wording observed in live runs
 * (residence x3, Cuba report entry date); they are not verbatim captures.
 * The clean fixture mirrors the 2f2254b run profile (Cuban origin and
 * citizenship, single, 2026 entry <1y, no prior arrests) and must NEVER flag.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkOutputConsistency } from './consistency.js';
import { minimizeForModel, RESIDENCE_NOT_PROVIDED } from './privacy.js';

const NOW_YEAR = new Date().getUTCFullYear();

function minFor(over = {}) {
  return minimizeForModel({
    country_of_origin: 'Cuba', country_of_birth: 'Cuba', citizenship: 'Cuba',
    residence_country: 'US',
    entry_date: `${NOW_YEAR}-01-05`, case_type: 'asylum',
    marital_status: 'single', has_prior_arrests: 'no',
    has_passport: 'no', has_i94: 'yes', narrative_text: '',
    ...over,
  }, []);
}

const out = (over = {}) => ({
  readinessSummary: 'The applicant is of Cuban origin and citizenship, is single, and entered the United States in ' + NOW_YEAR + ' (less than one year ago). No prior arrests were reported.',
  factsProvided: ['Country of origin: Cuba', 'Marital status: single', 'Prior arrests: no'],
  missingInformation: ['Passport (the applicant reported not having one)'],
  contradictions: [], inferences: [],
  suggestedQuestions: ['Do you have any alternative identity document?'],
  uncertaintyNotes: ['Marital status is single; the specific marriage date is unknown.'],
  notLegalAdvice: 'This is not legal advice. Unknown things are unknown.',
  evidenceGaps: [],
  ...over,
});

const fields = r => r.flags.map(f => `${f.field}:${f.rule}`).sort();

describe('C2 checkOutputConsistency: clean review (false-positive guard)', () => {
  it('flags nothing on a clean review that matches the record', () => {
    assert.deepEqual(checkOutputConsistency(minFor(), out()).flags, []);
  });

  it('does not flag a separate clause that merely contains "unknown"', () => {
    const r = checkOutputConsistency(minFor(), out({ uncertaintyNotes: ['Marital status is single; the marriage date is unknown.', 'Country of origin is Cuba, and the marriage date is unknown.', 'There are no prior arrests so the certificate status is unknown.'] }));
    assert.deepEqual(r.flags, []);
  });

  it('does not flag "not provided" for an evidence answer of no (a correct statement)', () => {
    const r = checkOutputConsistency(minFor(), out({ missingInformation: ['Passport was not provided.'] }));
    assert.deepEqual(r.flags, []);
  });

  it('does not flag year+band, the generalized entry form, or document-date tension', () => {
    const r = checkOutputConsistency(minFor(), out({
      readinessSummary: `Entered in ${NOW_YEAR}, less than one year ago.`,
      contradictions: [`A lease dated ${NOW_YEAR - 2} predates the stated entry in ${NOW_YEAR}; confirm which is true.`],
    }));
    assert.deepEqual(r.flags, []);
  });
});

describe('C2: reconstructed live contradictions are flagged', () => {
  it('residence: "reported as Unknown" while the record holds a country (3 live runs)', () => {
    const r = checkOutputConsistency(minFor(), out({
      missingInformation: ['Country of residence (reported as Unknown)'],
      uncertaintyNotes: ["The applicant's country of residence is unknown."],
    }));
    assert.deepEqual(fields(r), ['residenceCountry:unknown-claim']);
  });

  it('entry date: the exact entry date listed as missing when the year is on record (Cuba report)', () => {
    const r = checkOutputConsistency(minFor(), out({ missingInformation: ['Exact date of entry'] }));
    assert.deepEqual(fields(r), ['entryYear:listed-missing']);
  });

  it('entry date: "entry date is missing" in prose', () => {
    const r = checkOutputConsistency(minFor(), out({ uncertaintyNotes: ['The entry date is missing.'] }));
    assert.deepEqual(fields(r), ['entryYear:unknown-claim']);
  });

  it('marital status reported unknown while the record says single', () => {
    const r = checkOutputConsistency(minFor(), out({ uncertaintyNotes: ['Marital status is unknown.'] }));
    assert.deepEqual(fields(r), ['maritalStatus:unknown-claim']);
  });

  it('arrest history unclear while the record says no prior arrests', () => {
    const r = checkOutputConsistency(minFor(), out({ uncertaintyNotes: ['Arrest history is unclear.'] }));
    assert.deepEqual(fields(r), ['priorArrests:unknown-claim']);
  });

  it('a different entry year is a year-mismatch', () => {
    const r = checkOutputConsistency(minFor(), out({ readinessSummary: `The applicant entered the United States in ${NOW_YEAR - 3}.` }));
    assert.deepEqual(fields(r), ['entryYear:year-mismatch']);
  });

  it('evidence answered no but called unknown', () => {
    const r = checkOutputConsistency(minFor(), out({ uncertaintyNotes: ['Passport status is unclear.'] }));
    assert.deepEqual(fields(r), ['has_passport:unknown-claim']);
  });
});

describe('C2: legitimately unknown or generalized fields are never flagged', () => {
  it('the "Not provided" residence sentinel is treated as unknown by design (C1)', () => {
    const m = minFor({ residence_country: undefined });
    assert.equal(m.residenceCountry, RESIDENCE_NOT_PROVIDED);
    const r = checkOutputConsistency(m, out({ missingInformation: ['Country of residence (reported as Unknown)'] }));
    assert.deepEqual(r.flags, []);
  });

  it('absent marital status, entry date, and arrest answers may be called unknown', () => {
    const m = minimizeForModel({ country_of_origin: 'Cuba', case_type: 'asylum', narrative_text: '' }, []);
    const r = checkOutputConsistency(m, out({ uncertaintyNotes: ['Marital status is unknown.', 'Arrest history is unclear.', 'The entry date is missing.'] }));
    assert.deepEqual(r.flags, []);
  });

  it('not-applicable evidence (single -> marriage certificate) is never flagged', () => {
    const r = checkOutputConsistency(minFor({ has_marriage_cert: 'no' }), out({ uncertaintyNotes: ['Marriage certificate status is unknown.'] }));
    assert.deepEqual(r.flags, []);
  });

  it('gated has_arrests "unknown" is never flagged', () => {
    const r = checkOutputConsistency(minFor(), out({ uncertaintyNotes: ['Certificates of disposition are unknown because there are no prior arrests.'] }));
    assert.deepEqual(r.flags, []);
  });

  it('a future or unparseable entry date is left to the model to flag', () => {
    const m = minFor({ entry_date: `${NOW_YEAR + 3}-01-01` });
    const r = checkOutputConsistency(m, out({ uncertaintyNotes: ['The entry date is unclear and needs correction.'] }));
    assert.deepEqual(r.flags, []);
  });
});

describe('C2: precision guard (15 plausible clean sentences must never flag)', () => {
  const CLEAN = [
    'Country of origin: Cuba. Country of residence: US.',
    'The applicant has not provided a passport; alternative identity documents may be available.',
    'Marital status: single. The relationship documents are not applicable.',
    `Entry in ${NOW_YEAR} is under one year, so a green card is not expected.`,
    'Items not applicable: marriage certificate (single status).',
    'Documentation of country of residence is missing.',
    'Proof of country of residence is not available.',
    'Evidence for country of residence is unclear.',
    'The exact marriage date is unknown.',
    'The applicant did not state the date they left Cuba.',
    'Citizenship is Cuban; passport details are unclear.',
    'The nationality on the passport is unknown.',
    'No arrests were reported, so certificates of disposition are not applicable.',
    'I-94 was provided; its entry date is not stated in the summary.',
    'Date of birth is unknown.',
  ];
  for (const s of CLEAN) {
    it(`clean: ${s}`, () => {
      const r = checkOutputConsistency(minFor(), out({ readinessSummary: s, missingInformation: [s], uncertaintyNotes: [] }));
      assert.deepEqual(r.flags, []);
    });
  }
  for (const s of ['Country of residence is missing.', 'Marital status is not provided.', 'Unknown country of residence.']) {
    it(`caught: ${s}`, () => {
      const r = checkOutputConsistency(minFor(), out({ readinessSummary: s, uncertaintyNotes: [] }));
      assert.equal(r.flags.length, 1);
    });
  }
});

describe('C2: contract', () => {
  it('never mutates the model output', () => {
    const data = out({ missingInformation: ['Country of residence (reported as Unknown)'] });
    const before = JSON.stringify(data);
    checkOutputConsistency(minFor(), data);
    assert.equal(JSON.stringify(data), before);
  });

  it('non-English output is skipped and reported, not pretended-covered', () => {
    const r = checkOutputConsistency(minFor(), out({ missingInformation: ['Country of residence (unknown)'] }), 'ES');
    assert.deepEqual(r, { flags: [], skipped: 'lang' });
  });

  it('flags carry field ids and rule names only: no record values, no model text', () => {
    const r = checkOutputConsistency(minFor(), out({ uncertaintyNotes: ['Marital status is unknown.'] }));
    const blob = JSON.stringify(r);
    assert.ok(!/single|Cuba|unknown\./i.test(blob.replace(/unknown-claim/g, '')));
    for (const f of r.flags) assert.deepEqual(Object.keys(f).sort(), ['field', 'rule']);
  });

  it('is safe on malformed input', () => {
    assert.deepEqual(checkOutputConsistency(null, out()).flags, []);
    assert.deepEqual(checkOutputConsistency(minFor(), null).flags, []);
    assert.deepEqual(checkOutputConsistency(minFor(), { readinessSummary: 5, factsProvided: [null, 7] }).flags, []);
  });
});
