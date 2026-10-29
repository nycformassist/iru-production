// Evidence-aware scoring (2026-10-29 redesign, owner-authorized).
//
// The owner REVERSED the earlier scoring freeze: the score may change when
// engineering evidence supports a better model. The score is an awareness
// factor reflecting strength of evidence across Reported / Provided /
// Reviewed / Verified-never-by-IRU. Automated review can modestly support
// or contradict a claim, but can never verify.
//
// These tests pin the new model. Preserved old-model invariants are
// asserted explicitly so the redesign's continuity is visible.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  scoreEvidenceItem,
  scoreBandForRatio,
  formatScorePoints,
} from '../src/evidenceScoring.ts';
import { detectReviewMatch } from '../src/reviewMismatch.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const constants = readFileSync(
  new URL('../src/constants.tsx', import.meta.url),
  'utf8',
);

// ── Preserved old-model invariants ─────────────────────────────────────

describe('old-model invariants preserved', () => {
  test('a reported claim still earns the base point', () => {
    assert.equal(
      scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review: null }).points,
      1,
    );
  });

  test('a proxy alternative still earns half credit', () => {
    assert.equal(
      scoreEvidenceItem({ key: 'has_lease', claimed: false, proxyClaimed: true, review: null }).points,
      0.5,
    );
  });

  test('an unclaimed item still earns nothing', () => {
    assert.equal(
      scoreEvidenceItem({ key: 'has_lease', claimed: false, proxyClaimed: false, review: null }).points,
      0,
    );
  });

  test('a review never adjusts a proxy item (proxies stay secondary by design)', () => {
    assert.equal(
      scoreEvidenceItem({
        key: 'has_lease',
        claimed: false,
        proxyClaimed: true,
        review: { documentCategory: 'formal lease agreement', legibility: 'legible', appearsComplete: 'yes' },
      }).points,
      0.5,
    );
  });

  test('a review on an unclaimed item does not create points (the claim drives the score)', () => {
    assert.equal(
      scoreEvidenceItem({
        key: 'has_lease',
        claimed: false,
        proxyClaimed: false,
        review: { documentCategory: 'formal lease agreement', legibility: 'legible', appearsComplete: 'yes' },
      }).points,
      0,
    );
  });

  test('calculateReadinessScore still returns { score, total, alternativesCounted } from the same 8 keys', () => {
    assert.ok(app.includes('return { score, total: total || 1, alternativesCounted };'));
    assert.ok(
      app.includes("['has_passport', 'has_i94', 'has_lease', 'has_persecution_proof', 'has_green_card', 'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship'].forEach(check);"),
      'has_arrests stays excluded from positive scoring; same 8 keys',
    );
  });

  test('total still counts applicable answered items (scale denominator stable)', () => {
    const fnStart = app.indexOf('const calculateReadinessScore');
    const fnEnd = app.indexOf('return { score, total: total || 1, alternativesCounted };', fnStart);
    const fnSrc = app.slice(fnStart, fnEnd);
    assert.ok(fnSrc.includes('total++;'), 'total increments per answered applicable item');
  });
});

// ── New model: mismatch must score lower than the same claim unreviewed ──

describe('mismatch contradicts the claim', () => {
  // Owner's real case: selected Formal Lease, detected utility bill.
  const mismatchReview = {
    documentCategory: 'utility bill',
    legibility: 'legible',
    appearsComplete: 'yes',
  };

  test('a clear mismatch scores lower than the same claim unreviewed', () => {
    const unreviewed = scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review: null });
    const mismatched = scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review: mismatchReview });
    assert.ok(mismatched.points < unreviewed.points, `${mismatched.points} < ${unreviewed.points}`);
    assert.equal(mismatched.points, 0.5);
  });

  test('a mismatch still scores above zero (the claim was made; the evidence is weak, not absent)', () => {
    const mismatched = scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review: mismatchReview });
    assert.ok(mismatched.points > 0);
  });

  test('mismatch dominates incompleteness (contradiction is the stronger signal)', () => {
    const both = scoreEvidenceItem({
      key: 'has_lease',
      claimed: true,
      proxyClaimed: false,
      review: { documentCategory: 'utility bill', legibility: 'legible', appearsComplete: 'no' },
    });
    assert.equal(both.points, 0.5);
  });
});

// ── New model: matching legible review may score modestly higher ─────────

describe('matching legible review modestly supports the claim', () => {
  test('a matching, legible review scores modestly higher than the same claim unreviewed', () => {
    const unreviewed = scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review: null });
    const supported = scoreEvidenceItem({
      key: 'has_lease',
      claimed: true,
      proxyClaimed: false,
      review: { documentCategory: 'formal lease agreement', legibility: 'legible', appearsComplete: 'yes' },
    });
    assert.ok(supported.points > unreviewed.points, `${supported.points} > ${unreviewed.points}`);
    assert.equal(supported.points, 1.25);
  });

  test('support stays far below anything implying verification', () => {
    const supported = scoreEvidenceItem({
      key: 'has_passport',
      claimed: true,
      proxyClaimed: false,
      review: { documentCategory: 'passport photo page', legibility: 'legible', appearsComplete: 'yes' },
    });
    assert.ok(supported.points <= 1.25, 'ceiling is modest support, not verification');
  });
});

// ── New model: illegible / incomplete / uncertain evidence ────────────────

describe('weak evidence handling', () => {
  test('an illegible photo contributes nothing assessable: claim stands as reported', () => {
    assert.equal(
      scoreEvidenceItem({
        key: 'has_lease',
        claimed: true,
        proxyClaimed: false,
        review: { documentCategory: 'formal lease agreement', legibility: 'illegible', appearsComplete: 'unclear' },
      }).points,
      1,
    );
  });

  test('an unrecognized category contributes nothing assessable: claim stands as reported', () => {
    assert.equal(
      scoreEvidenceItem({
        key: 'has_lease',
        claimed: true,
        proxyClaimed: false,
        review: { documentCategory: 'unrecognized', legibility: 'legible', appearsComplete: 'yes' },
      }).points,
      1,
    );
  });

  test('a partially-legible matching photo: claim stands as reported (support too weak to count)', () => {
    assert.equal(
      scoreEvidenceItem({
        key: 'has_lease',
        claimed: true,
        proxyClaimed: false,
        review: { documentCategory: 'formal lease agreement', legibility: 'partially-legible', appearsComplete: 'yes' },
      }).points,
      1,
    );
  });

  test('a visibly incomplete document scores below a complete one (missing pages will be asked for)', () => {
    const incomplete = scoreEvidenceItem({
      key: 'has_tax_transcripts',
      claimed: true,
      proxyClaimed: false,
      review: { documentCategory: 'tax transcript', legibility: 'legible', appearsComplete: 'no' },
    });
    assert.equal(incomplete.points, 0.75);
    assert.ok(incomplete.points < 1, 'weaker than the bare claim');
    assert.ok(incomplete.points > 0.5, 'stronger than a contradicted claim');
  });

  test('provided but not reviewed: stands as reported (an unexamined photo adds no assessable evidence)', () => {
    // No review object at all — same as unreviewed.
    assert.equal(
      scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review: null }).points,
      1,
    );
  });
});

// ── Verification is never conferred ───────────────────────────────────────

describe('verification is never conferred', () => {
  test('no score path claims verification', () => {
    const src = readFileSync(new URL('../src/evidenceScoring.ts', import.meta.url), 'utf8');
    // The module may say "never verification" / "can never verify" (disclaimers),
    // but must never positively claim it verifies anything.
    assert.ok(!/is verified|are verified|verification established|confers verification|counts as verif/i.test(src));
  });

  test('band names never imply verification', () => {
    for (const band of ['scoreBandStrong', 'scoreBandModerate', 'scoreBandDeveloping', 'scoreBandEarly']) {
      const m = new RegExp(`${band}: "([^"]+)"`).exec(constants);
      assert.ok(m, `${band} present in constants`);
      assert.ok(!/verif/i.test(m[1]), `${band} must not imply verification`);
    }
  });

  test('the score scope line disclaims verification, legal determination, and prediction', () => {
    const en = /pktScoreReviewNote: "([^"]+)"/.exec(constants)[1];
    assert.ok(/never verify/i.test(en), 'states reviews never verify');
    assert.ok(/not a legal determination/i.test(en), 'not a legal determination');
    assert.ok(/prediction of any outcome/i.test(en), 'not a prediction of any outcome');
    assert.ok(!/do not change this score/i.test(en), 'old freeze wording is gone');
  });
});

// ── Bands and formatting ─────────────────────────────────────────────────

describe('coarse presentation', () => {
  test('band thresholds', () => {
    assert.equal(scoreBandForRatio(1.0), 'scoreBandStrong');
    assert.equal(scoreBandForRatio(1.04), 'scoreBandStrong', 'ratio can exceed 1; bands absorb it');
    assert.equal(scoreBandForRatio(0.9), 'scoreBandStrong');
    assert.equal(scoreBandForRatio(0.89), 'scoreBandModerate');
    assert.equal(scoreBandForRatio(0.6), 'scoreBandModerate');
    assert.equal(scoreBandForRatio(0.59), 'scoreBandDeveloping');
    assert.equal(scoreBandForRatio(0.35), 'scoreBandDeveloping');
    assert.equal(scoreBandForRatio(0.34), 'scoreBandEarly');
    assert.equal(scoreBandForRatio(0), 'scoreBandEarly');
  });

  test('formatScorePoints trims cleanly', () => {
    assert.equal(formatScorePoints(6), '6');
    assert.equal(formatScorePoints(5.5), '5.5');
    assert.equal(formatScorePoints(6.25), '6.3');
    assert.equal(formatScorePoints(5.75), '5.8');
    assert.equal(formatScorePoints(0), '0');
  });

  test('no percent is rendered for the score (bands + points instead)', () => {
    // Both render sites must not compute a percent from the new score.
    const packet = app.indexOf('const generateHtml = ()');
    const screen = app.indexOf('Readiness Score + Readiness Review (2026-10-24 fix)');
    for (const [name, idx] of [['packet', packet], ['screen', screen]]) {
      const window = app.slice(idx, idx + 2500);
      assert.ok(!window.includes('readinessPercent'), `${name} render must not use a percent`);
      assert.ok(window.includes('scoreBandForRatio'), `${name} render uses bands`);
    }
  });
});

// ── detectReviewMatch ─────────────────────────────────────────────────────

describe('detectReviewMatch', () => {
  test('clear matches', () => {
    assert.equal(detectReviewMatch('has_lease', 'formal lease agreement').match, true);
    assert.equal(detectReviewMatch('has_passport', 'passport photo page').match, true);
    assert.equal(detectReviewMatch('has_green_card', 'permanent resident card').match, true);
  });

  test('non-matches that are not mismatches either', () => {
    // e.g. a category the detector cannot place: no support, no penalty.
    assert.equal(detectReviewMatch('has_lease', 'some random paper').match, false);
  });

  test('never matches on uncertain categories', () => {
    for (const cat of ['', 'unrecognized', 'unknown', 'unclear']) {
      assert.equal(detectReviewMatch('has_lease', cat).match, false, cat || '(empty)');
    }
  });

  test('broad keys match a certain, non-conflicting category', () => {
    assert.equal(detectReviewMatch('has_persecution_proof', 'hospital record').match, true);
    // ...but a clear home-key conflict still does not match.
    assert.equal(detectReviewMatch('has_persecution_proof', 'passport photo page').match, false);
  });

  test('never throws on junk input', () => {
    assert.doesNotThrow(() => detectReviewMatch(null, null));
    assert.doesNotThrow(() => detectReviewMatch(undefined, undefined));
  });
});

// ── Worked examples (owner's cases) ───────────────────────────────────────

describe('worked examples', () => {
  const lease = (review) =>
    scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review }).points;

  test("owner's Formal Lease case: mismatch < unreviewed < matching legible", () => {
    const mismatched = lease({ documentCategory: 'utility bill', legibility: 'legible', appearsComplete: 'yes' });
    const unreviewed = lease(null);
    const supported = lease({ documentCategory: 'formal lease agreement', legibility: 'legible', appearsComplete: 'yes' });
    assert.equal(mismatched, 0.5);
    assert.equal(unreviewed, 1.0);
    assert.equal(supported, 1.25);
    assert.ok(mismatched < unreviewed && unreviewed < supported);
  });

  test('band movement example: contradictions can move the band down', () => {
    // 6 applicable items: 2 plain yes, 3 mismatched yes, 1 no.
    const pts = 2 * 1.0 + 3 * 0.5 + 0;
    assert.equal(pts, 3.5);
    assert.equal(scoreBandForRatio(pts / 6), 'scoreBandDeveloping');
    // Same answers with no reviews: 5/6 -> Moderate.
    assert.equal(scoreBandForRatio(5 / 6), 'scoreBandModerate');
  });

  test('scale stability: identical answers with no reviews score exactly as the old model', () => {
    // Old model: 6 yes -> 6.0 of 6. New model without reviews: identical.
    const pts = 6 * scoreEvidenceItem({ key: 'has_lease', claimed: true, proxyClaimed: false, review: null }).points;
    assert.equal(pts, 6);
    assert.equal(scoreBandForRatio(pts / 6), 'scoreBandStrong');
  });
});

// ── Localization: all five languages ──────────────────────────────────────

describe('localization', () => {
  const keys = ['scoreBandStrong', 'scoreBandModerate', 'scoreBandDeveloping', 'scoreBandEarly', 'pktScoreReviewNote'];

  test('all new keys present in all five languages', () => {
    for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
      const block = constants.split(new RegExp(`^  ${lang}:`, 'm'))[1].split(/^  \w+:/m)[0];
      for (const k of keys) {
        assert.ok(block && block.includes(`${k}:`), `${k} present in ${lang}`);
      }
    }
  });

  test('EN band names are coarse and non-technical', () => {
    assert.ok(constants.includes('scoreBandStrong: "Strong"'));
    assert.ok(constants.includes('scoreBandModerate: "Moderate"'));
    assert.ok(constants.includes('scoreBandDeveloping: "Developing"'));
    assert.ok(constants.includes('scoreBandEarly: "Early stages"'));
  });
});

// ── Wiring guards ─────────────────────────────────────────────────────────

describe('wiring', () => {
  test('calculateReadinessScore delegates per-item scoring to scoreEvidenceItem', () => {
    const fnStart = app.indexOf('const calculateReadinessScore');
    const fnEnd = app.indexOf('return { score, total: total || 1, alternativesCounted };', fnStart);
    const fnSrc = app.slice(fnStart, fnEnd);
    assert.ok(fnSrc.includes('scoreEvidenceItem('), 'delegates to the pure scorer');
    assert.ok(fnSrc.includes('reviewForKey'), 'looks up the reviewed upload per key');
  });

  test('handleInterviewComplete is untouched by the redesign', () => {
    // The redesign must not touch the brittle sliced function.
    assert.ok(app.includes('const handleInterviewComplete'), 'function still exists');
  });
});
