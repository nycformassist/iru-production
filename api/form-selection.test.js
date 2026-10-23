/**
 * form-selection.test.js — D4 regression guards (browser E2E, 2026-10-22).
 *
 * Locks the two contracts that keep the form switcher honest:
 * 1. Selecting a form is ONE atomic transition that clears the previous
 *    form's draft artifacts (selectForm).
 * 2. A generated draft's summary may render only under the form it was
 *    generated for (summaryForSelection) — the pre-fix panel rendered any
 *    formSummary under any selection, so a diverged state presented the
 *    previous form's panel as if the switch had never happened.
 * Plus source guards that App.tsx actually routes through both.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectForm, summaryForSelection } from './_lib/formSelection.js';

describe('D4: form selection transitions', () => {
  it('selectForm switches selection and clears every draft artifact atomically', () => {
    const s = selectForm('I-589');
    assert.equal(s.selectedFormId, 'I-589');
    assert.equal(s.formSummary, null);
    assert.equal(s.formPdfBase64, '');
    assert.equal(s.formError, '');
    assert.equal(s.formDraftMeta, null);
    assert.deepEqual(s.reviewChecks, {});
  });

  it('summaryForSelection shows a summary only under its own form', () => {
    const summary = { formId: 'I-765', populated: [] };
    assert.equal(summaryForSelection(summary, 'I-765'), summary);
    assert.equal(summaryForSelection(summary, 'I-589'), null,
      'the I-765 draft panel must never render under an I-589 selection');
    assert.equal(summaryForSelection(null, 'I-765'), null);
    assert.equal(summaryForSelection(summary, ''), null);
  });

  it('App.tsx routes card clicks through selectForm and gates the draft panel', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.match(app, /from '\.\.\/api\/_lib\/formSelection\.js'/, 'App imports the shared selection module');
    assert.ok(app.includes('const s = selectForm(entry.id)'), 'card onClick must apply the atomic transition');
    assert.ok(app.includes('summaryForSelection(formSummary, selectedFormId)'),
      'the detail panel must gate the summary on the current selection');
  });
});
