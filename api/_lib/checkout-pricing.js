/**
 * api/_lib/checkout-pricing.js — Pathway checkout pricing (owner-approved 2026-11-05, FINAL).
 *
 * Pure functions, no I/O. Per-form preparation prices come from ./catalog.js
 * FORMS levels: level 1 = $149 (14900c), level 2 = $199 (19900c),
 * level 3 = $249 (24900c). I-360 is NOT released and is NEVER priced.
 *
 * Pricing rules (owner-set, do not reopen):
 * - Readiness ($99.95) is a separate service: it never discounts a preparation
 *   purchase and never counts as owning a form.
 * - Bundle: I-589 + I-765 in the same case = $34900 total for the pair.
 *   It OVERRIDES the ordinary $50-off total ($348) for that exact combination.
 *   The $50 discount is NOT also applied to that pair.
 * - Additional form: regular price less $50 (5000c) per additional form.
 *   Each additional form needs its own paid entitlement. Discount shown
 *   before payment.
 *
 * NOTE: this module does NOT touch the retired B2C prices in pricing.js
 * (owner-set 2026-10-29; RETIRED owner decision 2026-11-05 — the $1
 * evaluation and its upgrade/add-on SKUs are no longer purchasable and
 * are kept only as a historical record). It is separate from
 * api/checkout.js wiring. The live consumer prices live HERE:
 * Readiness $99.95 via priceReadiness(), preparation levels via
 * pricePurchase().
 */

import { FORMS } from './catalog.js';

export const LEVEL_PRICE_CENTS = { 1: 14900, 2: 19900, 3: 24900 };
export const ADDITIONAL_FORM_DISCOUNT_CENTS = 5000;
export const BUNDLE_589_765_CENTS = 34900;
export const FORMPREP_SKU = 'iru-formprep';
/** Readiness (owner-approved 2026-11-05, FINAL): $99.95 for one of the
 *  two original eligible forms. A separate paid service — it never
 *  discounts preparation and never counts as owning a form. */
export const READINESS_SKU = 'iru-readiness';
export const READINESS_PRICE_CENTS = 9995;
export const READINESS_FORMS = ['I-589', 'I-765'];

const BUNDLE_PAIR = ['I-589', 'I-765'];
const CURRENCY = 'usd';

/**
 * Regular preparation price for one form, in integer cents.
 * Returns null when the form is unknown, unreleased, or has no price level
 * assigned (including I-360, which is never released and never priced).
 */
export function regularPriceCents(formCode) {
  const entry = typeof formCode === 'string' ? FORMS[formCode] : undefined;
  if (!entry || entry.released !== true) return null;
  const price = LEVEL_PRICE_CENTS[entry.level];
  return typeof price === 'number' ? price : null;
}

function isAvailable(formCode) {
  return regularPriceCents(formCode) !== null;
}

function fail(reason, error) {
  return {
    ok: false,
    reason,
    error,
    lines: [],
    totalCents: 0,
    bundleApplied: false,
    bundleSavingCents: 0,
    forms: [],
    currency: CURRENCY,
  };
}

/**
 * Price a Readiness purchase for one form (owner-approved 2026-11-05,
 * FINAL). Readiness is available only for I-589 and I-765, at a flat
 * $99.95 (9995c) — server-side only, never taken from the client.
 * No prerequisite (no evaluation, no prior purchase). Readiness never
 * discounts preparation and never counts as owning a form.
 */
export function priceReadiness(formCode) {
  if (!READINESS_FORMS.includes(formCode)) {
    return {
      ok: false,
      reason: 'form-not-available',
      error: `Form ${String(formCode)} is not available for Readiness purchase.`,
      totalCents: 0,
      currency: CURRENCY,
    };
  }
  return { ok: true, form: formCode, totalCents: READINESS_PRICE_CENTS, currency: CURRENCY };
}

/**
 * Price a preparation purchase for one case.
 *
 * @param {object} args
 * @param {string[]} [args.ownedForms] — forms already entitled for PREPARATION
 *   in this case (paid prep only). Unknown codes are ignored.
 * @param {string} args.selectedForm — the form being purchased.
 * @param {string|null} [args.addedForm] — an additional form added in the
 *   same purchase (e.g. via the Pathway Assistant), or null.
 * @param {string[]} [args.readinessForms] — forms covered by a Readiness
 *   purchase. Readiness NEVER counts as owned, never triggers the $50
 *   discount, and never triggers the bundle. Accepted for signature
 *   symmetry with callers; intentionally ignored.
 * @returns {{ ok: boolean, lines: Array<{form: string, regularCents: number,
 *   discountCents: number, finalCents: number, kind: 'first'|'additional'|'bundle'}>,
 *   totalCents: number, bundleApplied: boolean, bundleSavingCents: number,
 *   forms: string[], currency: string, reason?: string, error?: string }}
 */
export function pricePurchase({
  ownedForms = [],
  selectedForm,
  addedForm = null,
  readinessForms = [],
} = {}) {
  // readinessForms is intentionally unused: Readiness never counts as owned,
  // never triggers the $50 discount, and never triggers the bundle.
  void readinessForms;

  // 1. Validate selectedForm and addedForm (if given): must be known AND
  // released. Unknown/unreleased (including I-360) → price NOTHING.
  if (!selectedForm || !isAvailable(selectedForm)) {
    return fail(
      'form-not-available',
      `Form ${String(selectedForm)} is not available for preparation purchase.`
    );
  }
  if (addedForm !== null && addedForm !== undefined && addedForm !== '' && !isAvailable(addedForm)) {
    return fail(
      'form-not-available',
      `Form ${String(addedForm)} is not available for preparation purchase.`
    );
  }

  // 2. ownedForms = paid PREPARATION entitlements only. Ignore unknown /
  // unreleased / unpriced codes. readinessForms never count (see above).
  const owned = [
    ...new Set(
      (Array.isArray(ownedForms) ? ownedForms : []).filter((c) => isAvailable(c))
    ),
  ];
  const ownedSet = new Set(owned);

  // 3. newForms = unique([selectedForm, addedForm]) minus ownedForms.
  // Owned forms are NEVER re-charged and get no line.
  const requested = [...new Set([selectedForm, addedForm].filter(Boolean))];
  const newForms = requested.filter((c) => !ownedSet.has(c));
  if (newForms.length === 0) {
    return fail(
      'already-owned',
      'All selected forms are already owned for preparation in this case.'
    );
  }
  const newSet = new Set(newForms);

  // 4. Bundle: the pair is complete in the case (owned ∪ new) AND at least
  // one pair form is being charged in this purchase. (If both pair forms are
  // already owned, no pair line is charged, so no bundle saving is realized
  // in this purchase and bundleApplied stays false.)
  const pairNew = BUNDLE_PAIR.filter((c) => newSet.has(c));
  const caseHasPair = BUNDLE_PAIR.every((c) => ownedSet.has(c) || newSet.has(c));
  const bundleApplies = caseHasPair && pairNew.length > 0;

  // 5. Price each new form in [selectedForm, addedForm] order.
  const lines = [];
  let remainingIndex = 0; // index among remaining (non-bundle) new forms
  for (const form of newForms) {
    const regular = regularPriceCents(form);

    if (bundleApplies && BUNDLE_PAIR.includes(form)) {
      // Pair line: the pair's combined charge is always BUNDLE_589_765_CENTS.
      // Both pair forms new: the $49.00 saving sits on the I-589 line
      // (I-765 pays its regular price; I-589 pays the remainder).
      // One pair form owned: the new pair form pays the bundle total minus
      // the owned pair form's regular price.
      let finalCents;
      if (pairNew.length === 2) {
        finalCents =
          form === 'I-589'
            ? BUNDLE_589_765_CENTS - regularPriceCents('I-765')
            : regular;
      } else {
        const ownedPair = BUNDLE_PAIR.find((c) => ownedSet.has(c));
        finalCents = BUNDLE_589_765_CENTS - regularPriceCents(ownedPair);
      }
      lines.push({
        form,
        regularCents: regular,
        discountCents: regular - finalCents,
        finalCents,
        kind: 'bundle',
      });
    } else {
      // Remaining new form: the FIRST remaining new form is full price
      // (kind 'first') UNLESS ownedForms is non-empty, in which case every
      // remaining new form is 'additional' (regular − $50). Subsequent
      // remaining new forms are always 'additional'.
      const additional = owned.length > 0 || remainingIndex > 0;
      const discountCents = additional ? ADDITIONAL_FORM_DISCOUNT_CENTS : 0;
      lines.push({
        form,
        regularCents: regular,
        discountCents,
        finalCents: regular - discountCents,
        kind: additional ? 'additional' : 'first',
      });
      remainingIndex += 1;
    }
  }

  // 6. Totals.
  const totalCents = lines.reduce((sum, line) => sum + line.finalCents, 0);
  const bundleSavingCents = bundleApplies
    ? lines
        .filter((line) => line.kind === 'bundle')
        .reduce((sum, line) => sum + line.discountCents, 0)
    : 0;

  return {
    ok: true,
    lines,
    totalCents,
    bundleApplied: bundleApplies,
    bundleSavingCents,
    forms: lines.map((line) => line.form),
    currency: CURRENCY,
  };
}
