// Report gaps #1–#6 (2026-10-29, owner-authorized): the readiness report
// must distinguish Reported / Provided / Reviewed / Verified, flag
// claimed-vs-detected document mismatches, and keep the score formula
// untouched. Pure-logic unit tests plus source guards for the wired paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { detectReviewMismatch } from '../src/reviewMismatch.ts';
import { resolveReviewAssociation } from './_lib/vision.js';
import { buildPacketNextSteps, nextStepsStrings } from './_lib/nextsteps.js';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');

// ── Gap #1: claimed-vs-detected mismatch detection ──────────────────────

test('gap1: clear mismatches are flagged', () => {
  // Owner's real case: selected Formal Lease, detected utility bill.
  assert.equal(detectReviewMismatch('has_lease', 'utility bill').mismatch, true);
  assert.equal(detectReviewMismatch('has_green_card', 'utility bill').mismatch, true);
  assert.equal(detectReviewMismatch('has_passport', 'utility bill').mismatch, true);
  // A known document belonging to a different item.
  assert.equal(detectReviewMismatch('has_lease', 'passport photo page').mismatch, true);
  assert.equal(detectReviewMismatch('has_persecution_proof', 'passport photo page').mismatch, true);
});

test('gap1: matches are not flagged', () => {
  assert.equal(detectReviewMismatch('has_lease', 'formal lease agreement').mismatch, false);
  assert.equal(detectReviewMismatch('has_passport', 'passport photo page').mismatch, false);
  assert.equal(detectReviewMismatch('has_tax_transcripts', 'IRS tax transcript').mismatch, false);
  assert.equal(detectReviewMismatch('has_green_card', 'permanent resident card').mismatch, false);
  assert.equal(detectReviewMismatch('has_marriage_cert', 'marriage certificate').mismatch, false);
  assert.equal(detectReviewMismatch('has_arrests', 'certificate of disposition').mismatch, false);
});

test('gap1: uncertain categories never flag', () => {
  for (const c of ['', 'unrecognized', 'unknown', '  ', null, undefined]) {
    assert.equal(detectReviewMismatch('has_lease', c).mismatch, false, `category ${JSON.stringify(c)}`);
  }
  assert.equal(detectReviewMismatch(null, 'utility bill').mismatch, false);
  assert.equal(detectReviewMismatch(undefined, 'utility bill').mismatch, false);
});

test('gap1: broad keys only flag on clear home-key conflicts', () => {
  // A hospital record can legitimately be persecution evidence — no flag.
  assert.equal(detectReviewMismatch('has_persecution_proof', 'hospital record').mismatch, false);
  assert.equal(detectReviewMismatch('has_proof_of_relationship', 'family photograph').mismatch, false);
});

test('gap1: App wires the mismatch note into review receipt and checklist', () => {
  assert.ok(app.includes("from './reviewMismatch'"), 'App imports detectReviewMismatch');
  assert.ok(app.includes('detectReviewMismatch(photoEvidenceKey, review.documentCategory)'), 'review receipt computes mismatch');
  assert.ok(app.includes('photoMismatchNote'), 'mismatch note key used');
  // The note must not contain words the server sanitizer would strip.
  assert.ok(!/authentic|genuine|verified|legally sufficient/i.test('You listed {item}, but the photo appears to show {category}. Confirm with a qualified reviewer that this document supports what you claimed.'));
});

// ── Gap #2: reviewed 'yes' vs unreviewed 'yes' ──────────────────────────

test('gap2: triage row distinguishes reviewed from unreviewed yes claims', () => {
  assert.ok(app.includes('uploads.some(u => u.key === key && u.review)'), 'triage checks for a reviewed upload');
  assert.ok(app.includes('ui.imageInformedGap'), 'reviewed yes appends the localized review-status note');
  assert.ok(app.includes('triageClaimedNotProvided'), 'unreviewed yes gets the claimed-not-provided sentence');
});

// ── Gap #3: score formula untouched, scope explicit ──────────────────────

test('gap3: scoring formula does not consult the review', () => {
  const fnStart = app.indexOf('const calculateReadinessScore');
  assert.ok(fnStart !== -1, 'calculateReadinessScore exists');
  const fnEnd = app.indexOf('};', app.indexOf('return { score, total, alternativesCounted }', fnStart));
  const fnSrc = app.slice(fnStart, fnEnd);
  assert.ok(!fnSrc.includes('imageReview'), 'score never reads imageReview');
  assert.ok(!fnSrc.includes('uploads'), 'score never reads uploads');
});

test('gap3: score scope is stated next to the score', () => {
  assert.ok(app.includes('pktScoreReviewNote'), 'score-scope note key used');
  assert.ok(constants.includes('pktScoreReviewNote: "Automated photo reviews do not change this score. It is based on your questionnaire answers only."'));
});

// ── Gap #4: claimed-but-not-provided sentence ────────────────────────────

test('gap4: claimed-not-provided sentence exists in all five languages', () => {
  for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
    const block = constants.split(new RegExp(`^  ${lang}:`, 'm'))[1].split(/^  \w+:/m)[0];
    assert.ok(block && block.includes('triageClaimedNotProvided'), `triageClaimedNotProvided present in ${lang}`);
  }
  const en = "You reported having this document, but no document was provided in this session.";
  assert.ok(constants.includes(en), 'EN wording exact');
  assert.ok(!/must|should have|failed|negligence/i.test(en), 'factual, never accusatory');
});

// ── Gap #5: explicit photo↔item association ─────────────────────────────

test('gap5: uncertain or conflicting model inference defaults to the user selection', () => {
  assert.deepEqual(resolveReviewAssociation('has_lease', 'none'), { linkedKey: 'has_lease', source: 'user' });
  assert.deepEqual(resolveReviewAssociation('has_lease', ''), { linkedKey: 'has_lease', source: 'user' });
  assert.deepEqual(resolveReviewAssociation('has_lease', 'has_passport'), { linkedKey: 'has_lease', source: 'user' });
  assert.deepEqual(resolveReviewAssociation('has_lease', 'bogus-key'), { linkedKey: 'has_lease', source: 'user' });
});

test('gap5: agreeing or unselected cases keep the model value', () => {
  assert.deepEqual(resolveReviewAssociation('has_lease', 'has_lease'), { linkedKey: 'has_lease', source: 'model' });
  assert.deepEqual(resolveReviewAssociation(null, 'has_passport'), { linkedKey: 'has_passport', source: 'model' });
  assert.deepEqual(resolveReviewAssociation(null, 'none'), { linkedKey: 'none', source: 'model' });
  assert.deepEqual(resolveReviewAssociation('bogus', 'has_lease'), { linkedKey: 'has_lease', source: 'model' });
});

test('gap5: review endpoint applies the association and App shows it', () => {
  const ep = readFileSync(new URL('../api/review-image.js', import.meta.url), 'utf8');
  assert.ok(ep.includes('resolveReviewAssociation'), 'endpoint resolves the association');
  assert.ok(ep.includes('linkSource'), 'endpoint attaches linkSource');
  assert.ok(app.includes('photoLinkedToUser'), 'packet shows user-selection provenance');
  assert.ok(app.includes('photoLinkedToModel'), 'packet shows model provenance');
  assert.ok(app.includes('photoLinkedToNone'), 'packet handles unlinked reviews');
});

// ── Gap #6: tailored professional questions ─────────────────────────────

test('gap6: mismatch produces a tailored question; no mismatch does not', () => {
  const base = { caseType: 'asylum', readinessPercent: 50, evidenceItemCount: 2, conflicts: 0, unconfirmed: 0, form: null, resourcesKind: 'none', conflictLabels: [] };
  const withMismatch = buildPacketNextSteps({ ...base, mismatches: [{ item: 'Formal Lease', category: 'utility bill' }] }, 'EN');
  const tailored = withMismatch.professionalQuestions.find(q => q.includes('utility bill') && q.includes('Formal Lease'));
  assert.ok(tailored, 'tailored mismatch question present');
  assert.ok(!/you (committed|are guilty of|falsified)/i.test(tailored), 'observation, never a legal conclusion');
  assert.ok(!tailored.toLowerCase().includes('authentic'), 'no authenticity claim');

  const withoutMismatch = buildPacketNextSteps({ ...base, mismatches: [] }, 'EN');
  assert.ok(!withoutMismatch.professionalQuestions.some(q => q.includes('appears to show')), 'no tailored question without a mismatch');
});

test('gap6: questionMismatch exists in all five languages', () => {
  for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
    const s = nextStepsStrings(lang);
    assert.equal(typeof s.questionMismatch, 'function', `questionMismatch is a function in ${lang}`);
    const q = s.questionMismatch('X', 'Y');
    assert.ok(q.includes('X') && q.includes('Y'), `questionMismatch interpolates in ${lang}`);
    assert.ok(typeof s.pktReviewsSummary === 'function', `pktReviewsSummary is a function in ${lang}`);
  }
});

test('gap6: next-steps understand section states the review count when reviews exist', () => {
  const base = { caseType: 'asylum', readinessPercent: 50, evidenceItemCount: 2, conflicts: 0, unconfirmed: 0, form: null, resourcesKind: 'none', conflictLabels: [] };
  const withReviews = buildPacketNextSteps({ ...base, reviewedCount: 2 }, 'EN');
  assert.ok(withReviews.understand.some(t => t.includes('2 document photo(s)') && t.includes('nothing has been verified')), 'review summary line present');
  const withoutReviews = buildPacketNextSteps({ ...base, reviewedCount: 0 }, 'EN');
  assert.ok(!withoutReviews.understand.some(t => t.includes('document photo(s)')), 'no review summary line without reviews');
});
