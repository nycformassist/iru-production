/**
 * api/_lib/catalog.js — Centralized IRU pricing catalog.
 *
 * SINGLE SOURCE OF TRUTH for every commercial offering. Each entry connects:
 *   SKU → forms covered → price → checkout product → entitlement scope
 *
 * INVARIANTS (enforced by tests):
 * - The price the customer SEES (client) === the price the server CHARGES (checkout)
 *   === the price VERIFIED after payment === the entitlement GRANTED.
 * - Existing B2C prices are FROZEN (owner-set 2026-10-29). Regression tests fail
 *   if any of these change.
 * - New bundle prices (owner-set 2026-11-01) are FROZEN once added.
 * - Government filing fees are NEVER included. IRU charges are for preparation
 *   only. The catalog must never conflate the two.
 * - The paywall supports the entire catalog even when forms are released in
 *   phases: entries for unreleased forms exist in the catalog but are flagged
 *   `released: false` and cannot be purchased until their form workflow ships.
 *
 * STRUCTURE:
 * Each entry: {
 *   sku: string (unique),
 *   kind: 'evaluation' | 'single' | 'bundle',
 *   forms: string[] (form IDs covered),
 *   priceCents: number (total price),
 *   chargeCents: number (amount charged at checkout; may differ from total
 *     when a credit applies),
 *   creditedCents: number (credit applied from prior purchase),
 *   name: string (display name),
 *   released: boolean (whether the forms are available for purchase),
 *   scope: object (entitlement scope granted on payment),
 * }
 */

export const FORM_IDS = ['I-589', 'I-765', 'I-130', 'I-485', 'I-864', 'I-131', 'I-90', 'N-400', 'I-751', 'I-360', 'N-600', 'N-565'];

// ─── FORMS — Seven-workflow platform (owner-confirmed 2026-11-05) ───
// Six BUILT workflows + I-360 IDENTIFIED (not built, never released).
// level: complexity tier (1=$149, 2=$199, 3=$249). null = owner has not assigned yet.
// released: true only when form workflow is built AND validated AND owner has activated it.
// readiness_available: true only for the two original eligible forms (I-589, I-765).
export const FORMS = {
  'I-589': { code: 'I-589', name: 'Application for Asylum', level: 3, released: true, readiness_available: true },
  'I-765': { code: 'I-765', name: 'Application for Employment Authorization', level: 1, released: true, readiness_available: true },
  'N-400': { code: 'N-400', name: 'Application for Naturalization', level: 3, released: true, readiness_available: false },
  'I-130': { code: 'I-130', name: 'Petition for Alien Relative', level: 2, released: true, readiness_available: false },
  'I-485': { code: 'I-485', name: 'Application to Adjust Status', level: 3, released: true, readiness_available: false },
  'I-90': { code: 'I-90', name: 'Application to Replace Permanent Resident Card', level: 1, released: true, readiness_available: false },
  // I-360: identified as 7th workflow opportunity. NOT built. NEVER released.
  'I-360': { code: 'I-360', name: 'Petition for Amerasian, Widow(er), or Special Immigrant', level: null, released: false, readiness_available: false },
};

/**
 * Get the list of released form codes (built, validated, owner-activated).
 * Pathway, checkout, and pricing UI MUST use this — never a hardcoded list.
 */
export function getReleasedForms() {
  return Object.values(FORMS)
    .filter((f) => f.released === true)
    .map((f) => f.code);
}

/**
 * Get the active catalog for Pathway: only released forms.
 * Returns the FORMS object filtered to released entries.
 */
export function getActiveCatalog() {
  return Object.fromEntries(
    Object.entries(FORMS).filter(([, f]) => f.released === true)
  );
}

// ─── B2C Paywall (owner-set 2026-10-29 — FROZEN as a historical
// record; RETIRED owner decision 2026-11-05 — the $1 evaluation and
// its upgrade/add-on SKUs are no longer purchasable) ───

const B2C = {
  evaluation: {
    sku: 'iru-evaluation',
    kind: 'evaluation',
    forms: [],
    priceCents: 100,
    chargeCents: 100,
    creditedCents: 0,
    name: 'IRU Limited Evaluation',
    released: false,
    retired: true,
    retiredReason: 'evaluation-retired',
    scope: { kind: 'evaluation' },
  },
  oneForm: {
    sku: 'iru-complete-one-form',
    kind: 'single',
    forms: [], // Selected at purchase: I-589 XOR I-765
    priceCents: 9995,
    chargeCents: 9895, // After $1 evaluation credit
    creditedCents: 100,
    name: 'IRU Complete Preparation — One Form',
    released: false,
    retired: true,
    retiredReason: 'evaluation-retired',
    scope: { kind: 'forms', formsCount: 1 },
  },
  bundle: {
    sku: 'iru-complete-bundle',
    kind: 'bundle',
    forms: ['I-589', 'I-765'],
    priceCents: 14995,
    chargeCents: 14895, // After $1 evaluation credit
    creditedCents: 100,
    name: 'IRU Complete Preparation — Two-Form Bundle',
    released: false,
    retired: true,
    retiredReason: 'evaluation-retired',
    scope: { kind: 'forms', formsCount: 2 },
  },
  secondForm: {
    sku: 'iru-second-form-addon',
    kind: 'single',
    forms: [], // The form not yet purchased
    priceCents: 5000,
    chargeCents: 5000,
    creditedCents: 0,
    name: 'IRU Complete Preparation — Second Form Add-on',
    released: false,
    retired: true,
    retiredReason: 'evaluation-retired',
    scope: { kind: 'forms', formsCount: 1 },
  },
};

// ─── Multi-form bundles (owner-set 2026-11-01 — FROZEN) ───
// These are comprehensive preparation bundles. Forms release in phases;
// unreleased forms are flagged and cannot be purchased until their
// workflow ships.

const BUNDLES = {
  bundle589_765: {
    sku: 'iru-bundle-589-765',
    kind: 'bundle',
    forms: ['I-589', 'I-765'],
    priceCents: 34900,
    chargeCents: 34900,
    creditedCents: 0,
    name: 'IRU Complete Preparation — I-589 + I-765',
    released: false, // I-589/I-765 workflows completing in Phase 2/3
    scope: { kind: 'forms', forms: ['I-589', 'I-765'] },
  },
  bundle130_485_864: {
    sku: 'iru-bundle-130-485-864',
    kind: 'bundle',
    forms: ['I-130', 'I-485', 'I-864'],
    priceCents: 54900,
    chargeCents: 54900,
    creditedCents: 0,
    name: 'IRU Complete Preparation — I-130 + I-485 + I-864',
    released: false, // Forms not yet built (outside Phase 2/3 scope)
    scope: { kind: 'forms', forms: ['I-130', 'I-485', 'I-864'] },
  },
  bundle130_485_864_765_131: {
    sku: 'iru-bundle-130-485-864-765-131',
    kind: 'bundle',
    forms: ['I-130', 'I-485', 'I-864', 'I-765', 'I-131'],
    priceCents: 69900,
    chargeCents: 69900,
    creditedCents: 0,
    name: 'IRU Complete Preparation — I-130 + I-485 + I-864 + I-765 + I-131',
    released: false, // Forms not yet built (outside Phase 2/3 scope)
    scope: { kind: 'forms', forms: ['I-130', 'I-485', 'I-864', 'I-765', 'I-131'] },
  },
};

// ─── Unified catalog ───

export const CATALOG = {
  ...Object.fromEntries(Object.values(B2C).map(e => [e.sku, e])),
  ...Object.fromEntries(Object.values(BUNDLES).map(e => [e.sku, e])),
};

/**
 * Get a catalog entry by SKU. Returns null for unknown SKUs.
 * Never throws — callers check for null.
 */
export function getCatalogEntry(sku) {
  if (!sku || typeof sku !== 'string') return null;
  return CATALOG[sku] || null;
}

/**
 * Check if a SKU is purchasable right now.
 * A SKU is purchasable iff it exists in the catalog AND is released.
 * Retired entries have released: false, so they are excluded here.
 */
export function isPurchasable(sku) {
  const entry = getCatalogEntry(sku);
  return entry !== null && entry.released === true;
}

/**
 * Get all purchasable SKUs (for paywall display).
 */
export function getPurchasableSkus() {
  return Object.values(CATALOG)
    .filter(e => e.released)
    .map(e => e.sku);
}

/**
 * Validate that a price agreement holds: the amount the client saw
 * must equal the amount the server will charge.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function validatePriceAgreement(sku, clientPriceCents) {
  const entry = getCatalogEntry(sku);
  if (!entry) return { ok: false, reason: 'unknown-sku' };
  // Retired entries fail as retired — before the not-released check —
  // so callers can distinguish "withdrawn product" from "not yet out".
  if (entry.retired) return { ok: false, reason: 'retired' };
  if (!entry.released) return { ok: false, reason: 'not-released' };
  if (clientPriceCents !== entry.chargeCents) {
    return { ok: false, reason: 'price-mismatch', expected: entry.chargeCents, got: clientPriceCents };
  }
  return { ok: true };
}
