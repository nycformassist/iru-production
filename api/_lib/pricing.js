/**
 * lib/pricing.js — B2C pricing & entitlement structure (owner-set,
 * 2026-10-21 directive). Pure data + pure functions; imported by BOTH
 * the server (checkout enforcement) and the client (offer display) so
 * the amounts a consumer sees are the amounts the server charges.
 *
 * TEST MODE ONLY. These amounts describe the intended commercial
 * structure the owner directed us to implement and test. Nothing here
 * activates a live charge, and no Stripe product/price is created or
 * modified by this module — checkout amounts are enforced server-side
 * at session creation from this table, never taken from the client.
 *
 * Structure:
 * - Limited evaluation: $1.00 one-time. Grants ONLY the limited
 *   evaluation. Credited toward either complete purchase.
 * - One-form Complete Preparation: $99.95 TOTAL (incl. the $1) for ONE
 *   selected form (I-589 XOR I-765). Upgrade charge after evaluation:
 *   $98.95.
 * - Two-form bundle: $129.95 TOTAL (incl. the $1) for BOTH forms.
 *   Upgrade charge after evaluation: $128.95. Savings vs two separate
 *   one-form purchases (2 × $99.95 = $199.90): $69.95.
 * - Second-form add-on: after a completed one-form purchase, the other
 *   form for $30.00 more (total paid becomes $129.95).
 * No recurring billing, no hidden charges, no automatic upgrades.
 */

export const FORM_IDS = ['I-589', 'I-765'];

export const SKUS = {
  EVALUATION: 'iru-evaluation',
  ONE_FORM: 'iru-complete-one-form',
  BUNDLE: 'iru-complete-bundle',
  SECOND_FORM: 'iru-second-form-addon',
  /** Pre-B2C single-product SKU (env-priced). Kept for compatibility
   *  with the original test-mode path; not part of the B2C offer. */
  LEGACY: 'iru-assessment-form-draft',
};

export const PRICING = {
  evaluation: {
    sku: SKUS.EVALUATION,
    chargeCents: 100,
    totalCents: 100,
    creditedCents: 0,
    name: 'IRU Limited Evaluation',
    scope: 'A limited initial evaluation: the broad categories of preparation gaps and missing information in your case, what complete preparation would add, and your next step. It does not include the full readiness workflow or any prepared form.',
  },
  oneForm: {
    sku: SKUS.ONE_FORM,
    // Charged at upgrade time, after the $1 evaluation credit.
    chargeCents: 9895,
    totalCents: 9995,
    creditedCents: 100,
    name: 'IRU Complete Preparation — One Form',
    scope: 'Complete preparation of ONE form you select — Form I-589 or Form I-765 — as a reviewable DRAFT PDF, with corrections and regeneration and a completion summary. Includes your $1.00 evaluation payment as a credit.',
  },
  bundle: {
    sku: SKUS.BUNDLE,
    chargeCents: 12895,
    totalCents: 12995,
    creditedCents: 100,
    name: 'IRU Complete Preparation — Both Forms (Bundle)',
    scope: 'Complete preparation of BOTH Form I-589 and Form I-765, each as a reviewable DRAFT PDF, with corrections and regeneration and completion summaries. Includes your $1.00 evaluation payment as a credit.',
    separateTotalCents: 19990, // 2 × $99.95
    savingsCents: 6995, // 19990 − 12995
  },
  secondForm: {
    sku: SKUS.SECOND_FORM,
    chargeCents: 3000,
    totalCents: 12995, // $99.95 already paid + $30.00
    creditedCents: 0,
    name: 'IRU Second Form Add-On',
    scope: 'Adds preparation of the second form (the one not covered by your one-form purchase) on the same terms: reviewable DRAFT PDF, corrections and regeneration, completion summary. After this purchase your total paid is $129.95 — the same as the two-form bundle.',
  },
};

/** Format integer cents as a USD string, e.g. 9995 → "$99.95". */
export function formatCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return `$${(n / 100).toFixed(2)}`;
}

/**
 * The offer exactly as it must be shown BEFORE the initial payment:
 * both complete-purchase options, their scope, and their TOTAL prices,
 * alongside the $1 evaluation entry. Pure function of PRICING.
 */
export function buildOffer() {
  return {
    currency: 'usd',
    evaluation: {
      sku: PRICING.evaluation.sku,
      price: formatCents(PRICING.evaluation.chargeCents),
      chargeCents: PRICING.evaluation.chargeCents,
      creditedToward: 'either complete purchase',
      scope: PRICING.evaluation.scope,
    },
    options: [
      {
        sku: PRICING.oneForm.sku,
        kind: 'one-form',
        totalPrice: formatCents(PRICING.oneForm.totalCents),
        totalCents: PRICING.oneForm.totalCents,
        afterEvaluationCharge: formatCents(PRICING.oneForm.chargeCents),
        afterEvaluationChargeCents: PRICING.oneForm.chargeCents,
        scope: PRICING.oneForm.scope,
        formsIncluded: 'exactly one form — Form I-589 OR Form I-765, your choice',
      },
      {
        sku: PRICING.bundle.sku,
        kind: 'bundle',
        totalPrice: formatCents(PRICING.bundle.totalCents),
        totalCents: PRICING.bundle.totalCents,
        afterEvaluationCharge: formatCents(PRICING.bundle.chargeCents),
        afterEvaluationChargeCents: PRICING.bundle.chargeCents,
        scope: PRICING.bundle.scope,
        formsIncluded: 'both forms — Form I-589 AND Form I-765',
        savingsNote: `Buying both forms separately would cost ${formatCents(PRICING.bundle.separateTotalCents)} (2 × ${formatCents(PRICING.oneForm.totalCents)}). The bundle costs ${formatCents(PRICING.bundle.totalCents)} — a saving of ${formatCents(PRICING.bundle.savingsCents)}.`,
      },
    ],
    secondFormAddon: {
      sku: PRICING.secondForm.sku,
      price: formatCents(PRICING.secondForm.chargeCents),
      chargeCents: PRICING.secondForm.chargeCents,
      resultingTotal: formatCents(PRICING.secondForm.totalCents),
      scope: PRICING.secondForm.scope,
    },
    disclosures: [
      'All prices are one-time payments in USD. There is no subscription, no recurring billing, and no automatic upgrade.',
      'The $1.00 evaluation payment is credited toward either complete purchase, so the totals above are the most you would pay.',
      'IRU prepares DRAFT forms for your review. IRU does not sign, submit, or file anything, and preparation help is not legal advice.',
    ],
  };
}

/** Resolve a purchasable SKU to its pricing row. Null for unknown SKUs. */
export function pricingForSku(sku) {
  for (const row of Object.values(PRICING)) {
    if (row.sku === sku) return row;
  }
  return null;
}
