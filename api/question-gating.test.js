// Owner ruling 2026-10-28: marriage / relationship evidence questions are
// gated by marital status AND case type, identically in the questionnaire
// and the packet. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MARRIAGE_KEY,
  RELATIONSHIP_KEY,
  RELATIONSHIP_ASKED_WHEN_SINGLE_FOR,
  skippedEvidenceKeys,
  filterPhase2Questions,
  pruneSkippedAnswers,
  isMarriageNotApplicable,
  isRelationshipNotApplicable,
  scopedQuestionText,
  FAMILY_RELATIONSHIP_LABELS,
  FAMILY_RELATIONSHIP_TIPS,
} from '../src/questionGating.ts';
import { getNotApplicableReasons } from './_lib/evidence.js';

const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

/** Real PHASE_2 question ids per case type, parsed from the source of truth. */
function phase2Ids(caseType) {
  const start = constants.indexOf('export const PHASE_2_QUESTIONS');
  const end = constants.indexOf('export const PHASE_3_QUESTIONS', start);
  const block = constants.slice(start, end > 0 ? end : undefined);
  const order = ['asylum', 'citizenship', 'family'];
  const from = block.indexOf(`  ${caseType}: [`);
  assert.ok(from >= 0, `${caseType} block exists`);
  const next = order.map((c) => block.indexOf(`  ${c}: [`, from + 1)).filter((i) => i > from);
  const to = next.length ? Math.min(...next) : block.length;
  return [...block.slice(from, to).matchAll(/\{ id: "([a-z_0-9]+)"/g)].map((m) => m[1]);
}
const asList = (ids) => ids.map((id) => ({ id }));
const ids = (list) => list.map((q) => q.id);

test('single + asylum: neither marriage nor relationship is asked', () => {
  const out = ids(filterPhase2Questions(asList(phase2Ids('asylum')), { marital_status: 'single', case_type: 'asylum' }));
  assert.ok(!out.includes(MARRIAGE_KEY));
  assert.ok(!out.includes(RELATIONSHIP_KEY));
  assert.ok(out.includes('has_persecution_proof'), 'unrelated questions are kept');
});

test('single + citizenship: neither is asked (already absent from the list)', () => {
  const base = phase2Ids('citizenship');
  assert.ok(!base.includes(MARRIAGE_KEY) && !base.includes(RELATIONSHIP_KEY));
  const out = ids(filterPhase2Questions(asList(base), { marital_status: 'single', case_type: 'citizenship' }));
  assert.deepEqual(out, base, 'nothing else is removed');
});

test('single + family: marriage skipped, relationship still asked (family scope)', () => {
  const out = ids(filterPhase2Questions(asList(phase2Ids('family')), { marital_status: 'single', case_type: 'family' }));
  assert.ok(!out.includes(MARRIAGE_KEY));
  assert.ok(out.includes(RELATIONSHIP_KEY));
});

test('married / divorced / widowed: both asked in asylum and family', () => {
  for (const status of ['married', 'divorced', 'widowed']) {
    for (const caseType of ['asylum', 'family']) {
      const full = phase2Ids(caseType);
      const out = ids(filterPhase2Questions(asList(full), { marital_status: status, case_type: caseType }));
      assert.deepEqual(out, full, `${status}/${caseType}: unfiltered`);
      assert.ok(out.includes(MARRIAGE_KEY) && out.includes(RELATIONSHIP_KEY));
    }
  }
});

test('unanswered marital status asks both (never skip on missing data)', () => {
  const full = phase2Ids('asylum');
  assert.deepEqual(ids(filterPhase2Questions(asList(full), { case_type: 'asylum' })), full);
});

test('missing case_type defaults to asylum exactly as the questionnaire does', () => {
  assert.deepEqual(skippedEvidenceKeys({ marital_status: 'single' }), [MARRIAGE_KEY, RELATIONSHIP_KEY]);
});

test('marital status changed single -> married: answers were cleared, so both reappear unanswered', () => {
  const single = { marital_status: 'single', case_type: 'asylum', has_marriage_cert: 'yes', has_proof_of_relationship: 'no', proxy_marriage_1: 'yes' };
  const pruned = pruneSkippedAnswers(single);
  assert.equal(pruned.has_marriage_cert, undefined);
  assert.equal(pruned.has_proof_of_relationship, undefined);
  assert.equal(pruned.proxy_marriage_1, undefined);
  const nowMarried = { ...pruned, marital_status: 'married' };
  assert.equal(pruneSkippedAnswers(nowMarried), nowMarried, 'no-op when nothing is skipped');
  assert.deepEqual(skippedEvidenceKeys(nowMarried), []);
  assert.equal(nowMarried.has_marriage_cert, undefined, 'no stale answer resurfaces');
});

test('marital status changed married -> single: stale answers and proxy ticks are cleared', () => {
  const married = { marital_status: 'married', case_type: 'asylum', has_marriage_cert: 'no', proxy_marriage_2: 'yes', has_proof_of_relationship: 'yes', proxy_relationship_1: 'yes', has_passport: 'yes' };
  const out = pruneSkippedAnswers({ ...married, marital_status: 'single' });
  for (const k of ['has_marriage_cert', 'proxy_marriage_2', 'has_proof_of_relationship', 'proxy_relationship_1']) {
    assert.equal(out[k], undefined, `${k} cleared`);
  }
  assert.equal(out.has_passport, 'yes', 'unrelated answers untouched');
});

test('married -> single in a FAMILY case clears marriage only; relationship answer survives', () => {
  const out = pruneSkippedAnswers({ marital_status: 'single', case_type: 'family', has_marriage_cert: 'yes', has_proof_of_relationship: 'yes', proxy_relationship_2: 'yes' });
  assert.equal(out.has_marriage_cert, undefined);
  assert.equal(out.has_proof_of_relationship, 'yes');
  assert.equal(out.proxy_relationship_2, 'yes');
});

test('case type changed family -> asylum while single: relationship becomes skipped and cleared', () => {
  const out = pruneSkippedAnswers({ marital_status: 'single', case_type: 'asylum', has_proof_of_relationship: 'yes' });
  assert.equal(out.has_proof_of_relationship, undefined);
});

test('pruneSkippedAnswers returns the SAME object when nothing changes (no render loop)', () => {
  const a = { marital_status: 'single', case_type: 'asylum', has_passport: 'yes' };
  assert.equal(pruneSkippedAnswers(a), a);
  const b = { marital_status: 'married', has_marriage_cert: 'yes' };
  assert.equal(pruneSkippedAnswers(b), b);
});

test('client rule and server rule agree for every marital status x case type', () => {
  for (const status of ['single', 'married', 'divorced', 'widowed', undefined]) {
    for (const caseType of ['asylum', 'citizenship', 'family', undefined]) {
      const answers = { marital_status: status, case_type: caseType };
      const server = new Set(getNotApplicableReasons({ maritalStatus: status || 'unknown', caseType }).map((r) => r.key));
      assert.equal(server.has(MARRIAGE_KEY), isMarriageNotApplicable(answers), `marriage ${status}/${caseType}`);
      assert.equal(server.has(RELATIONSHIP_KEY), isRelationshipNotApplicable(answers), `relationship ${status}/${caseType}`);
    }
  }
});

test('packet: relationship is N/A for single asylum but NOT for single family; marriage N/A for both', () => {
  const keys = (min) => getNotApplicableReasons(min).map((r) => r.key);
  assert.ok(keys({ maritalStatus: 'single', caseType: 'asylum' }).includes(RELATIONSHIP_KEY));
  assert.ok(!keys({ maritalStatus: 'single', caseType: 'family' }).includes(RELATIONSHIP_KEY));
  assert.ok(keys({ maritalStatus: 'single', caseType: 'family' }).includes(MARRIAGE_KEY));
});

test('single family applicant sees family-scoped wording in all 5 languages (not marriage / joint bank accounts)', () => {
  const q = { id: RELATIONSHIP_KEY, labels: { EN: 'default', ES: 'default', ZH: 'default', HT: 'default', AR: 'default' }, guardianTips: { EN: 't', ES: 't', ZH: 't', HT: 't', AR: 't' } };
  for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
    const scoped = scopedQuestionText(q, { marital_status: 'single', case_type: 'family' }, lang);
    assert.equal(scoped.label, FAMILY_RELATIONSHIP_LABELS[lang]);
    assert.equal(scoped.tip, FAMILY_RELATIONSHIP_TIPS[lang]);
    assert.notEqual(scoped.label, 'default');
    const married = scopedQuestionText(q, { marital_status: 'married', case_type: 'family' }, lang);
    assert.equal(married.label, 'default', 'non-single keeps the original wording');
  }
  assert.ok(!/bank|marriage/i.test(FAMILY_RELATIONSHIP_LABELS.EN));
});

test('table can be flipped to skip-both-everywhere with one constant', () => {
  assert.deepEqual([...RELATIONSHIP_ASKED_WHEN_SINGLE_FOR], ['family']);
});

test('App wiring: filtered list drives questions and back-navigation; prune effect present', () => {
  assert.match(app, /if \(stage === 'PHASE2'\) return filterPhase2Questions\(/);
  assert.match(app, /setCurrentQ\(Math\.max\(0, filterPhase2Questions\(/, 'back from PHASE3 uses the FILTERED length');
  assert.ok(!/setCurrentQ\(\(PHASE_2_QUESTIONS\[answers\.case_type \|\| 'asylum'\] \|\| \[\]\)\.length - 1\)/.test(app), 'unfiltered back-nav removed');
  assert.match(app, /pruneSkippedAnswers\(prev\)/);
  assert.match(app, /\[answers\.marital_status, answers\.case_type\]/);
  assert.match(app, /scopedQuestionText\(question as any, answers, lang\)\.label/);
});

test('PHASE3 arrest gating and PHASE1 are untouched by the new gating', () => {
  assert.match(app, /PHASE_3_QUESTIONS\.filter\(q => q\.id !== 'has_arrests' \|\| answers\.has_prior_arrests === 'yes'\)/);
  assert.match(app, /if \(stage === 'PHASE1'\) return PHASE_1_QUESTIONS;/);
});
