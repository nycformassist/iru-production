/**
 * lib/evaluation.js — The LIMITED evaluation (B2C directive §4).
 *
 * What the $1 entry payment buys: a genuinely useful but CONCISE
 * result — the BROAD CATEGORIES of preparation gaps and missing
 * information, what looks accounted for, what complete preparation
 * adds, and the next step with the upgrade options.
 *
 * What it deliberately NEVER contains (these are the paid deliverables
 * of the full workflow):
 * - the personalized readiness narrative / full assessment text;
 * - per-item evidence alternatives, target facts, or next actions
 *   (the full evidence-gap detail);
 * - document-review findings or any generated form / PDF;
 * - any eligibility determination.
 *
 * It is computed deterministically from the applicant's own evidence
 * answers — no model call, so no prompt, model output, or internal
 * decision logic is ever exposed through this endpoint.
 */

import { buildOffer } from './pricing.js';

/** Broad categories only — never the underlying per-item detail. */
export const GAP_CATEGORIES = [
  { id: 'identity-documents', label: 'Identity documents', keys: ['has_passport'] },
  { id: 'entry-records', label: 'U.S. entry records', keys: ['has_i94'] },
  { id: 'residence-evidence', label: 'Evidence of where you live', keys: ['has_lease'] },
  { id: 'case-evidence', label: 'Evidence supporting your case', keys: ['has_persecution_proof'] },
  { id: 'status-documents', label: 'Immigration status documents', keys: ['has_green_card'] },
  { id: 'financial-records', label: 'Financial and tax records', keys: ['has_tax_transcripts'] },
  { id: 'family-records', label: 'Family and relationship records', keys: ['has_marriage_cert', 'has_proof_of_relationship'] },
  { id: 'court-records', label: 'Court records', keys: ['has_arrests'] },
];

export function buildLimitedEvaluation(min) {
  const evidence = (min && min.evidence) || {};
  const categories = GAP_CATEGORIES.map((cat) => {
    let answered = 0;
    let missing = 0;
    for (const key of cat.keys) {
      const v = evidence[key];
      if (v === undefined || v === null || v === '') continue;
      answered += 1;
      if (v === 'no' || v === 'unknown') missing += 1;
    }
    const status = answered === 0 ? 'not-addressed' : missing > 0 ? 'needs-attention' : 'accounted-for';
    return { id: cat.id, label: cat.label, status, itemsNeedingAttention: missing };
  });
  const needing = categories.filter((c) => c.status === 'needs-attention');
  const accounted = categories.filter((c) => c.status === 'accounted-for');

  return {
    kind: 'limited-evaluation',
    headline: needing.length > 0
      ? `${needing.length} of ${categories.length} preparation areas need attention before your case is fully prepared.`
      : 'Based on the areas you answered, no broad preparation gaps stand out — the complete preparation would confirm the details.',
    caseType: (min && min.caseType) || null,
    gapCategories: categories,
    areasAccountedFor: accounted.map((c) => c.label),
    whatCompletePreparationAdds: [
      'A full readiness review of your circumstances, with each missing item explained — why it matters, what could support it, and what to do next, in priority order.',
      'Review of your documents and information together, with conflicts and uncertainties flagged for you to resolve.',
      'Preparation of your selected form as a reviewable DRAFT PDF you can check, correct, and regenerate — with the matching official blank form for comparison.',
      'A "Your Next Steps" section in every output, tailored to your form and findings.',
    ],
    nextStep: needing.length > 0
      ? 'Start with the areas marked "needs attention" above. Complete preparation turns each one into specific, prioritized actions and prepares your form draft.'
      : 'Complete preparation verifies the details behind these areas and prepares your form draft.',
    upgradeOptions: buildOffer(),
    limits: [
      'This limited evaluation names broad categories only. It is not the complete readiness report and does not include any prepared form.',
      'It does not determine whether you are eligible for any immigration benefit, and it is not legal advice.',
      'Nothing here has been independently verified — it reflects only the answers you provided.',
    ],
  };
}
