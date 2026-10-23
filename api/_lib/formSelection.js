/**
 * lib/formSelection.js — Form-preparation selection + draft state (client).
 * Shared by src/App.tsx and the test-suite.
 *
 * D4 (browser E2E, 2026-10-22): after an I-765 draft was generated,
 * switching to the I-589 card appeared frozen — the I-765 panel stayed
 * on screen. D4's fix made selecting a form clear every draft artifact
 * atomically and gated the draft panel on the current selection. The
 * gate was right; the destruction was not.
 *
 * R5 (retest, 2026-10-22): that clear-on-select behavior destroyed the
 * OTHER form's generated draft. Generate I-589 → switch to I-765 and
 * generate → switch back to I-589: the panel rendered correctly but the
 * I-589 draft summary, draft ID and PDF were gone (single-slot state:
 * formSummary / formPdfBase64 / formDraftMeta / reviewChecks, wiped by
 * every selectForm patch and overwritten by every generation).
 *
 * R4a (retest, 2026-10-22): the draft version was derived from that same
 * single-slot metadata, which fact corrections also reset to null — so
 * after correcting a fact and regenerating, the new draft (new ID, new
 * timestamp) was labeled "Draft version 1" again.
 *
 * Current model — per-form draft store:
 * - Drafts live in a store keyed by form id. Each entry holds the
 *   summary, the PDF, the draft metadata (id / timestamp / version) and
 *   that form's final-review checklist state. Switching forms changes
 *   ONLY the selection; every form's draft is retained and redisplayed
 *   when the user switches back — no regeneration needed.
 * - Version numbers are per-form counters kept alongside the drafts.
 *   They increment on every successful generation for that form and
 *   SURVIVE draft invalidation, so a draft regenerated after a fact
 *   correction is numbered as the next version. Only a full reset
 *   (Start Over) zeroes them.
 * - Fact mutations still invalidate every generated draft (a draft built
 *   from superseded facts must never be presented as current), and
 *   generation still starts by dropping the generating form's previous
 *   draft — the pre-existing invalidation semantics, now store-wide.
 * - summaryForSelection() remains the render gate: a summary may render
 *   only under the form it was generated for.
 */

/**
 * The complete state patch for selecting a form in the preparation
 * panel. Selection is a pure navigation transition: it never touches
 * any form's retained draft.
 */
export function selectForm(formId) {
  return {
    selectedFormId: formId,
    formError: '',
  };
}

/**
 * The generated-draft summary that may be rendered for the current
 * selection — the summary itself, when it was generated for the selected
 * form; otherwise null (render no draft panel at all).
 */
export function summaryForSelection(formSummary, selectedFormId) {
  return formSummary && selectedFormId && formSummary.formId === selectedFormId
    ? formSummary
    : null;
}

/** An empty per-form draft store (Start Over / initial state). */
export function emptyFormDraftStore() {
  return { drafts: {}, versions: {} };
}

/**
 * Record a freshly generated draft for a form. The form's version
 * counter increments (first generation = version 1); the form's
 * checklist state resets (a new draft must be reviewed afresh); other
 * forms' drafts and counters are untouched.
 */
export function recordDraft(store, formId, draft) {
  const version = ((store && store.versions && store.versions[formId]) || 0) + 1;
  return {
    drafts: {
      ...(store ? store.drafts : {}),
      [formId]: {
        summary: draft.summary,
        pdfBase64: draft.pdfBase64,
        meta: {
          draftId: draft.draftId || '',
          generatedAt: draft.generatedAt || null,
          version,
          formId,
        },
        reviewChecks: {},
      },
    },
    versions: { ...(store ? store.versions : {}), [formId]: version },
  };
}

/** The retained draft entry for a form, or null when none exists. */
export function draftForForm(store, formId) {
  if (!store || !formId || !store.drafts) return null;
  return store.drafts[formId] || null;
}

/**
 * Drop one form's draft (generation for that form is starting; the
 * previous draft is superseded whether or not the attempt succeeds —
 * the pre-R5 semantics). Its version counter is kept.
 */
export function removeDraft(store, formId) {
  if (!store || !formId || !store.drafts || !(formId in store.drafts)) return store;
  const drafts = { ...store.drafts };
  delete drafts[formId];
  return { drafts, versions: { ...store.versions } };
}

/**
 * Withdraw EVERY generated draft because the underlying fact record
 * changed (correction, confirmation, conflict resolution, panel-answer
 * save, narrative approval): no draft built from superseded facts may
 * be presented as current. Version counters survive, so the next
 * generation for each form is numbered as its next version (R4a).
 */
export function invalidateDrafts(store) {
  if (!store) return emptyFormDraftStore();
  return { drafts: {}, versions: { ...store.versions } };
}

/** Replace one form's final-review checklist state; no-op without a draft. */
export function withReviewChecks(store, formId, reviewChecks) {
  const entry = draftForForm(store, formId);
  if (!entry) return store;
  return {
    drafts: { ...store.drafts, [formId]: { ...entry, reviewChecks } },
    versions: { ...store.versions },
  };
}
