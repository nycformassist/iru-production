/**
 * lib/formSelection.js — Form-preparation selection state (client).
 * Shared by src/App.tsx and the test-suite.
 *
 * D4 (browser E2E, 2026-10-22): after an I-765 draft was generated,
 * switching to the I-589 card appeared frozen — the I-765 panel stayed
 * on screen. The selection handler itself is a plain unconditional
 * setter (verified by driving the real component through the exact E2E
 * sequence in a DOM harness: selection switches correctly). The genuine
 * fragility in this area is that the generated-draft UI — the summary
 * panel, its checklist gate, and the PDF download — was rendered keyed
 * ONLY on generation state (formSummary / formPdfBase64), with no check
 * that the draft belongs to the currently selected form. Whenever
 * selection state and generation state diverge, the previous form's
 * draft panel is what the user sees under the new selection — visually
 * indistinguishable from a frozen switcher. Two guards remove that
 * failure mode permanently:
 *
 * 1. selectForm() is the SINGLE, atomic selection transition: choosing a
 *    form always clears the previous form's draft artifacts in the same
 *    transition. It is a pure function so the contract is unit-testable.
 * 2. summaryForSelection() gates every generated-draft render: a summary
 *    is shown only for the form it was generated from.
 */

/**
 * The complete state patch for selecting a form in the preparation
 * panel. Selecting a form ALWAYS starts that form clean: no summary, no
 * PDF, no error, no draft metadata, no checklist state may leak across
 * forms.
 */
export function selectForm(formId) {
  return {
    selectedFormId: formId,
    formSummary: null,
    formPdfBase64: '',
    formError: '',
    formDraftMeta: null,
    reviewChecks: {},
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
