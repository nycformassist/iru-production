/**
 * api/_lib/pathway.js — Pathway Assistant core.
 *
 * Single function used by BOTH DTC and BronxWorks versions.
 * Returns recommendation objects — NO prices in the function;
 * price display is the caller's UI-layer responsibility.
 *
 * RULES (enforced):
 * - ONLY recommend forms with released: true in activeCatalog
 * - NEVER recommend I-360 (identified, not built)
 * - NEVER recommend a form the customer already owns
 * - NEVER say customer "needs" the form — copy uses neutral reason_keys
 * - Function takes activeCatalog as input — no hardcoded form lists
 *
 * Pathway relationship graph (owner to confirm):
 * - I-765 → I-589 (asylum EAD)
 * - I-589 → I-765 (work authorization while pending)
 * - I-130 → I-485 (adjustment after petition)
 * - I-485 → I-765 (EAD), I-130 (if adjustment via petition)
 * - N-400 → (none — naturalization is terminal)
 * - I-90 → (none — card renewal is standalone)
 * - I-360 → (none — not built, do not recommend)
 */

// ─── Pathway relationship graph ───
// Maps a form to the forms commonly associated with its process.
// Each entry: { form: target form code, reason_key: neutral copy key }
export const PATHWAY_GRAPH = {
  'I-765': [
    { form: 'I-589', reason_key: 'asylum_ead' },
  ],
  'I-589': [
    { form: 'I-765', reason_key: 'work_auth_pending' },
  ],
  'I-130': [
    { form: 'I-485', reason_key: 'adjustment_after_petition' },
  ],
  'I-485': [
    { form: 'I-765', reason_key: 'ead_while_pending' },
    { form: 'I-130', reason_key: 'adjustment_via_petition' },
  ],
  'N-400': [],
  'I-90': [],
  'I-360': [], // Identified, not built — never recommend
};

// ─── Reason copy (neutral, never "you need this") ───
// Maps reason_key → human-readable explanation.
// DTC and BronxWorks use the same keys but may render different copy.
export const REASON_COPY = {
  asylum_ead: {
    title: 'Related form',
    explanation: 'This form is commonly filed alongside the one you selected. Whether it applies depends on your circumstances.',
  },
  work_auth_pending: {
    title: 'Related form',
    explanation: 'This form is commonly used while your application is pending. Whether it applies depends on your circumstances.',
  },
  adjustment_after_petition: {
    title: 'Related form',
    explanation: 'This form is commonly the next step after a petition is filed. Whether it applies depends on your circumstances.',
  },
  ead_while_pending: {
    title: 'You may also need',
    explanation: 'This form is commonly filed while an adjustment application is pending. Whether it applies depends on your circumstances.',
  },
  adjustment_via_petition: {
    title: 'Commonly filed together',
    explanation: 'These forms are often filed as part of the same immigration process. Whether it applies depends on your circumstances.',
  },
};

// ─── Form metadata (display names, process names) ───
export const FORM_INFO = {
  'I-589': { name: 'Application for Asylum', process: 'Asylum' },
  'I-765': { name: 'Application for Employment Authorization', process: 'Employment Authorization' },
  'N-400': { name: 'Application for Naturalization', process: 'Naturalization' },
  'I-130': { name: 'Petition for Alien Relative', process: 'Family-Based Immigration' },
  'I-485': { name: 'Application to Adjust Status', process: 'Adjustment of Status' },
  'I-90': { name: 'Application to Replace Permanent Resident Card', process: 'Green Card Renewal' },
  'I-360': { name: 'Petition for Amerasian, Widow(er), or Special Immigrant', process: 'Special Immigrant' },
};

/**
 * Get Pathway recommendations for a form.
 *
 * @param {Object} params
 * @param {string} params.currentForm - The form the customer/participant selected (e.g. 'I-765')
 * @param {string[]} [params.ownedForms=[]] - Forms the customer already owns (don't recommend these)
 * @param {Object} params.activeCatalog - Catalog of released forms/SKUs. Must have a way to check if a form is released.
 *   Accepts either:
 *   - A FORMS object: { 'I-765': { released: true, ... }, ... }
 *   - An array of released form codes: ['I-765', 'I-589', ...]
 *   - A CATALOG object with SKUs that have `forms` arrays and `released` flags
 * @param {string} [params.context='dtc'] - 'dtc' | 'bronxworks' (drives copy, not logic)
 * @returns {Array<{ form: string, reason_key: string, sku_id: string | null }>}
 *   Empty array if no recommendations, current form unknown, or all related forms filtered out.
 */
export function getRecommendations({ currentForm, ownedForms = [], activeCatalog, context = 'dtc' }) {
  if (!currentForm || typeof currentForm !== 'string') return [];
  if (!activeCatalog) return [];

  // Never recommend I-360 — identified, not built
  if (currentForm === 'I-360') return [];

  const related = PATHWAY_GRAPH[currentForm];
  if (!related || related.length === 0) return [];

  const owned = new Set(ownedForms || []);

  return related
    .filter(({ form }) => {
      // Never recommend I-360
      if (form === 'I-360') return false;
      // Don't recommend a form the customer already owns
      if (owned.has(form)) return false;
      // Only recommend forms that are released in the active catalog
      if (!isFormReleased(form, activeCatalog)) return false;
      return true;
    })
    .map(({ form, reason_key }) => ({
      form,
      reason_key,
      sku_id: formPrepSkuId(form),
      // context is accepted for future copy variation but does not change logic
      context,
    }));
}

/**
 * Check if a form is released in the active catalog.
 * Handles three catalog shapes (FORMS object, array of codes, CATALOG with SKUs).
 */
export function isFormReleased(formCode, activeCatalog) {
  if (!formCode || !activeCatalog) return false;
  // I-360 is never released (not built)
  if (formCode === 'I-360') return false;

  // Shape 1: array of released form codes
  if (Array.isArray(activeCatalog)) {
    return activeCatalog.includes(formCode);
  }

  // Shape 2: FORMS object { 'I-765': { released: true } }
  if (activeCatalog[formCode] && typeof activeCatalog[formCode] === 'object') {
    return activeCatalog[formCode].released === true;
  }

  // Shape 3: CATALOG object with SKU entries { sku: { forms: [...], released: true } }
  if (typeof activeCatalog === 'object') {
    return Object.values(activeCatalog).some(
      (entry) =>
        entry &&
        entry.released === true &&
        Array.isArray(entry.forms) &&
        entry.forms.includes(formCode)
    );
  }

  return false;
}

/**
 * Derive the form-prep SKU id for a form code.
 * Convention: `iru-formprep-<form-lowercase>` (e.g. iru-formprep-i-765).
 * Returns null if no convention applies (caller resolves via catalog).
 */
export function formPrepSkuId(formCode) {
  if (!formCode || typeof formCode !== 'string') return null;
  return `iru-formprep-${formCode.toLowerCase()}`;
}

/**
 * Get the display info for a form.
 */
export function getFormInfo(formCode) {
  return FORM_INFO[formCode] || { name: formCode, process: 'Immigration' };
}

/**
 * Get the reason copy for a reason_key.
 */
export function getReasonCopy(reason_key) {
  return REASON_COPY[reason_key] || REASON_COPY.asylum_ead;
}
