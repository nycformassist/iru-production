/**
 * form-selection.test.js — D4 + R5/R4a regression guards (browser E2E
 * 2026-10-22; retest 2026-10-22).
 *
 * Contracts locked here:
 * D4: a generated draft's summary may render only under the form it was
 *     generated for (summaryForSelection).
 * R5: drafts are retained PER FORM in a store keyed by form id. The
 *     exact retest sequence — generate I-589 → switch to I-765 →
 *     generate → switch back to I-589 — must redisplay the I-589 draft
 *     (summary, draft ID, PDF, checklist state) without regeneration.
 *     (D4's clear-on-select patch destroyed it; selection is now a pure
 *     navigation transition that touches no draft.)
 * R4a: draft versions are per-form counters that increment on every
 *     generation for that form and SURVIVE draft invalidation, so a
 *     draft regenerated after a fact correction is the next version —
 *     not "version 1" with a new ID.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  selectForm, summaryForSelection, emptyFormDraftStore, recordDraft,
  draftForForm, removeDraft, invalidateDrafts, withReviewChecks,
} from './_lib/formSelection.js';

const gen = (store, formId, draftId) => recordDraft(store, formId, {
  summary: { formId, populated: [] },
  pdfBase64: 'JVBERi0xLjc=',
  draftId,
  generatedAt: '2026-10-22T23:00:00.000Z',
});

describe('D4: summary render gate (unchanged)', () => {
  it('summaryForSelection shows a summary only under its own form', () => {
    const summary = { formId: 'I-765', populated: [] };
    assert.equal(summaryForSelection(summary, 'I-765'), summary);
    assert.equal(summaryForSelection(summary, 'I-589'), null,
      'the I-765 draft panel must never render under an I-589 selection');
    assert.equal(summaryForSelection(null, 'I-765'), null);
    assert.equal(summaryForSelection(summary, ''), null);
  });
});

describe('R5: selection is navigation only; drafts are retained per form', () => {
  it('selectForm switches selection and clears only the transient error', () => {
    assert.deepEqual(selectForm('I-589'), { selectedFormId: 'I-589', formError: '' });
    assert.deepEqual(selectForm('I-765'), { selectedFormId: 'I-765', formError: '' });
  });

  it('the retest sequence: I-589 draft survives I-765 generation and switching back', () => {
    let store = emptyFormDraftStore();
    store = gen(store, 'I-589', 'draft_d5090303d951');
    // Switch to I-765 (selection only — store untouched), generate there.
    store = gen(store, 'I-765', 'draft_765aaa');
    // Switch back to I-589: its draft must be intact, no regeneration.
    const back = draftForForm(store, 'I-589');
    assert.ok(back, 'I-589 draft must be retained after switching away and back');
    assert.equal(back.meta.draftId, 'draft_d5090303d951');
    assert.equal(back.meta.formId, 'I-589');
    assert.equal(back.pdfBase64, 'JVBERi0xLjc=');
    assert.equal(summaryForSelection(back.summary, 'I-589'), back.summary,
      'the retained I-589 summary must pass the render gate under I-589');
    assert.equal(summaryForSelection(back.summary, 'I-765'), null,
      'and must still be gated out under any other selection');
    // The I-765 draft is retained too.
    assert.equal(draftForForm(store, 'I-765').meta.draftId, 'draft_765aaa');
  });

  it('checklist state is retained per form across switches', () => {
    let store = gen(emptyFormDraftStore(), 'I-589', 'd1');
    store = withReviewChecks(store, 'I-589', { 0: true, 1: true });
    store = gen(store, 'I-765', 'd2');
    assert.deepEqual(draftForForm(store, 'I-589').reviewChecks, { 0: true, 1: true });
    assert.deepEqual(draftForForm(store, 'I-765').reviewChecks, {});
  });

  it('regenerating one form resets only that form\'s draft and checks', () => {
    let store = gen(emptyFormDraftStore(), 'I-589', 'd1');
    store = withReviewChecks(store, 'I-589', { 0: true });
    store = gen(store, 'I-765', 'd2');
    store = withReviewChecks(store, 'I-765', { 0: true });
    store = gen(store, 'I-589', 'd3');
    assert.deepEqual(draftForForm(store, 'I-589').reviewChecks, {}, 'new draft must be reviewed afresh');
    assert.equal(draftForForm(store, 'I-589').meta.draftId, 'd3');
    assert.deepEqual(draftForForm(store, 'I-765').reviewChecks, { 0: true }, 'other form untouched');
    assert.equal(draftForForm(store, 'I-765').meta.draftId, 'd2');
  });

  it('removeDraft drops only the named form (generation start)', () => {
    let store = gen(emptyFormDraftStore(), 'I-589', 'd1');
    store = gen(store, 'I-765', 'd2');
    store = removeDraft(store, 'I-765');
    assert.equal(draftForForm(store, 'I-765'), null);
    assert.equal(draftForForm(store, 'I-589').meta.draftId, 'd1');
  });

  it('withReviewChecks is a no-op when the form has no draft', () => {
    const store = emptyFormDraftStore();
    assert.equal(withReviewChecks(store, 'I-589', { 0: true }), store);
  });
});

describe('R4a: per-form draft versions', () => {
  it('versions increment per form, independently', () => {
    let store = emptyFormDraftStore();
    store = gen(store, 'I-589', 'a1');
    assert.equal(draftForForm(store, 'I-589').meta.version, 1);
    store = gen(store, 'I-765', 'b1');
    assert.equal(draftForForm(store, 'I-765').meta.version, 1, 'I-765 has its own counter');
    store = gen(store, 'I-589', 'a2');
    assert.equal(draftForForm(store, 'I-589').meta.version, 2);
    assert.equal(draftForForm(store, 'I-765').meta.version, 1);
  });

  it('a fact correction withdraws drafts but the version counter survives', () => {
    let store = gen(emptyFormDraftStore(), 'I-589', 'a1');
    store = invalidateDrafts(store); // applyFactMutation path
    assert.equal(draftForForm(store, 'I-589'), null, 'stale draft must be withdrawn');
    store = gen(store, 'I-589', 'a2'); // regenerate after correcting DOB
    assert.equal(draftForForm(store, 'I-589').meta.version, 2,
      'regeneration after a correction is version 2, not version 1 (R4a)');
    assert.equal(draftForForm(store, 'I-589').meta.draftId, 'a2');
  });

  it('invalidateDrafts withdraws every form\'s draft', () => {
    let store = gen(emptyFormDraftStore(), 'I-589', 'a1');
    store = gen(store, 'I-765', 'b1');
    store = invalidateDrafts(store);
    assert.equal(draftForForm(store, 'I-589'), null);
    assert.equal(draftForForm(store, 'I-765'), null);
  });

  it('a full reset (Start Over) zeroes the version counters', () => {
    let store = gen(emptyFormDraftStore(), 'I-589', 'a1');
    store = gen(store, 'I-589', 'a2');
    store = emptyFormDraftStore();
    store = gen(store, 'I-589', 'a3');
    assert.equal(draftForForm(store, 'I-589').meta.version, 1);
  });
});

describe('App.tsx wiring (R5/R4a)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('routes card clicks through selectForm and keeps drafts in the per-form store', () => {
    assert.match(app, /from '\.\.\/api\/_lib\/formSelection\.js'/, 'App imports the shared selection module');
    assert.ok(app.includes('const s = selectForm(entry.id)'), 'card onClick must apply the selection transition');
    assert.ok(app.includes('emptyFormDraftStore()'), 'draft store must initialize empty');
    assert.ok(app.includes('draftForForm(formDraftStore, selectedFormId)'),
      'the visible draft must derive from the per-form store by selected form');
    assert.ok(app.includes('summaryForSelection(formSummary, selectedFormId)'),
      'the detail panel must gate the summary on the current selection');
  });

  it('generation records the draft under its form; mutations invalidate via the store', () => {
    assert.ok(app.includes('recordDraft(prev, selectedFormId'), 'generation must record per-form drafts');
    assert.ok(app.includes('removeDraft(prev, selectedFormId)'), 'generation start supersedes only its own form');
    assert.ok(app.includes('invalidateDrafts(prev)'), 'fact mutations / narrative approval must withdraw stale drafts');
    assert.ok(!app.includes('setFormDraftMeta'), 'the single-slot draft metadata (R5/R4a root cause) must be gone');
    assert.ok(!app.includes('setFormSummary'), 'the single-slot summary must be gone');
  });
});
