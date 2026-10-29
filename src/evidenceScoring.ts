// Evidence-aware readiness scoring (2026-10-29 redesign, owner-authorized).
//
// The score is an AWARENESS FACTOR, not a validated metric, not a
// probability, not a grade, and never a legal determination. It reflects
// STRENGTH OF EVIDENCE across four states that are never interchangeable:
//   Reported — the user says they have the document (questionnaire claim)
//   Provided — a document/image was uploaded (not yet examined)
//   Reviewed — automated analysis produced observations (never verification)
//   Verified — only a qualified human process verifies; IRU never confers this
//
// Pure functions, no I/O. Never throws.

import { detectReviewMismatch, detectReviewMatch } from './reviewMismatch.ts';

export interface ReviewEvidence {
  documentCategory?: string | null;
  legibility?: string | null; // 'legible' | 'partially-legible' | 'illegible'
  appearsComplete?: string | null; // 'yes' | 'no' | 'unclear'
}

export interface ItemScoreInput {
  /** Evidence checklist key, e.g. 'has_lease'. Needed to compare the review against the claim. */
  key: string;
  /** The corrected questionnaire answer for this item is 'yes'. */
  claimed: boolean;
  /** A proxy alternative was selected (only meaningful when not claimed). */
  proxyClaimed: boolean;
  /** A successfully completed automated review for this item, if any. */
  review: ReviewEvidence | null;
}

export interface ItemScore {
  /** Points for this item. Base scale is 0..1 per item; a matching, legible
   *  review may add modest support up to 1.25. Never implies verification. */
  points: number;
}

// Base weights (unchanged from the answers-only model): a reported claim
// earns 1, a proxy alternative earns half credit. Reviews never adjust
// proxy items: proxies are secondary by design, and reviews attach to
// primary evidence claims.
const BASE_CLAIMED = 1;
const BASE_PROXY = 0.5;
const REVIEW_MATCH_BONUS = 0.25;
const REVIEW_MISMATCH_PENALTY = 0.5;
const REVIEW_INCOMPLETE_PENALTY = 0.25;
const MAX_ITEM_POINTS = 1.25;

/**
 * Scores one evidence item by strength of evidence. The questionnaire claim
 * sets the base; an automated review can then modestly support (+0.25 for a
 * matching, legible document), contradict (-0.5 for a clear mismatch), or
 * weaken (-0.25 for a visibly incomplete document) the claim. An illegible
 * or unrecognized photo contributes nothing assessable, so the claim stands
 * as reported — never punished for photo quality, never rewarded without
 * evidence. Automated review can never verify: the ceiling stays far below
 * anything implying verification.
 */
export function scoreEvidenceItem(input: ItemScoreInput): ItemScore {
  const { key, claimed, proxyClaimed, review } = input;
  if (!claimed) {
    // Proxy alternatives keep their half credit; a review never adjusts
    // them. A 'no'/unanswered item with a review still scores 0 — the
    // claim, not the photo, drives the score.
    return { points: proxyClaimed ? BASE_PROXY : 0 };
  }
  let points = BASE_CLAIMED; // Reported
  if (review) {
    // Reviewed: automated observations adjust strength modestly.
    // Order matters: contradiction first, then incompleteness, then
    // support. Each branch is mutually exclusive by construction.
    if (detectReviewMismatch(key, review.documentCategory).mismatch) {
      // The evidence actively contradicts the claim.
      points = BASE_CLAIMED - REVIEW_MISMATCH_PENALTY;
    } else if (review.appearsComplete === 'no') {
      // Pages or fields are visibly missing; a reviewer will ask for them.
      points = BASE_CLAIMED - REVIEW_INCOMPLETE_PENALTY;
    } else if (
      review.legibility === 'legible' &&
      detectReviewMatch(key, review.documentCategory).match
    ) {
      // Matching, legible document: modest support, never verification.
      points = Math.min(MAX_ITEM_POINTS, BASE_CLAIMED + REVIEW_MATCH_BONUS);
    }
    // Illegible, partially-legible, uncertain, or unrecognized: nothing
    // assessable — the claim stands exactly as reported.
  }
  // Provided but not reviewed: also stands as reported; an unexamined
  // photo adds no assessable evidence either way.
  return { points };
}

export type ScoreBandKey =
  | 'scoreBandStrong'
  | 'scoreBandModerate'
  | 'scoreBandDeveloping'
  | 'scoreBandEarly';

/**
 * Coarse band for the score ratio (score / total). Bands are deliberately
 * coarse: the score is an awareness aid, and false precision would imply a
 * validated metric. The ratio can exceed 1 when matching, legible reviews
 * add modest support — bands absorb that gracefully.
 */
export function scoreBandForRatio(ratio: number): ScoreBandKey {
  if (ratio >= 0.9) return 'scoreBandStrong';
  if (ratio >= 0.6) return 'scoreBandModerate';
  if (ratio >= 0.35) return 'scoreBandDeveloping';
  return 'scoreBandEarly';
}

/**
 * Display formatting for the points total: trims to one decimal, dropping
 * a trailing ".0" so whole numbers read cleanly ("6", "5.5", "6.3").
 */
export function formatScorePoints(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
