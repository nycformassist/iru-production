/**
 * r5-correction-verification.test.js — Workstream 3 verification of the
 * dff470d R5/R4 fixes, end to end at module level with REAL generated
 * PDFs (the one piece prior coverage lacked).
 *
 * Prior coverage (not duplicated here except where integration needs it):
 * - api/form-selection.test.js: the per-form store in isolation, with a
 *   fake base64 payload — retention, per-form versions, invalidation,
 *   checklist state, and App.tsx wiring strings.
 * - api/_lib/facts.test.js: upsertFact correction semantics, but only
 *   for a fact that was already in conflict.
 * - api/form-review.test.js tests 15+16: a family-name correction on
 *   I-765 reflected in a regenerated PDF — no draft store, no versions,
 *   no I-589, no DOB field.
 *
 * This file ties the three layers together exactly as the UI drives
 * them (App.tsx: handleCorrectFact → applyFactMutation →
 * upsertFact(source:'correction') + invalidateDrafts; generation →
 * recordDraft): build Marie Claire Toussaint's canonical record,
 * generate real I-589/I-765 drafts, read the AcroForm fields back out
 * of the PDF bytes with pdf-lib, correct her date of birth through the
 * UI's own code path, and prove the stale drafts are withdrawn, the
 * version counters survive, and the regenerated I-589 carries the
 * corrected DOB as version 2.
 *
 * Synthetic data only. Generated PDFs are written under os.tmpdir(),
 * never into the repo tree.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import {
  selectForm, summaryForSelection, emptyFormDraftStore, recordDraft,
  draftForForm, invalidateDrafts,
} from './_lib/formSelection.js';
import { generateFormDraft } from './generate-form.js';

const T0 = '2026-10-23T08:00:00.000Z';
const T1 = '2026-10-23T08:05:00.000Z';

// I-589 field names (registry-verified, api/_lib/forms/registry.js).
const F589 = {
  family: 'form1[0].#subform[0].PtAILine4_LastName[0]',
  given: 'form1[0].#subform[0].PtAILine5_FirstName[0]',
  middle: 'form1[0].#subform[0].PtAILine6_MiddleName[0]',
  dob: 'form1[0].#subform[0].DateTimeField1[0]',
  birthPlace: 'form1[0].#subform[0].TextField1[4]',
};
const F765 = {
  family: 'form1[0].Page1[0].Line1a_FamilyName[0]',
  dob: 'form1[0].Page3[0].Line19_DOB[0]',
};

/** Marie Claire Toussaint — DOB as the applicant reported it: 05/14/1990. */
function personaRecord() {
  const r = createFactRecord(T0);
  const put = (id, value) => upsertFact(r, { id, value, source: 'answer' }, T0);
  put('full_name', 'Marie Claire Toussaint');
  put('family_name', 'Toussaint');
  put('given_name', 'Marie');
  put('middle_name', 'Claire');
  put('date_of_birth', '05/14/1990'); // dateMDY passes MDY values through verbatim
  put('gender', 'female');
  put('marital_status', 'single');
  put('citizenship', 'Haiti');
  put('country_of_birth', 'Haiti');
  put('city_of_birth', 'Port-au-Prince');
  put('residence_street', '123 Test Street');
  put('residence_city', 'Brooklyn');
  put('residence_region', 'NY');
  put('residence_postal_code', '11201');
  put('mailing_street', '123 Test Street');
  put('mailing_city', 'Brooklyn');
  put('mailing_region', 'NY');
  put('mailing_postal_code', '11201');
  put('application_reason', 'initial');
  return r;
}

async function fieldText(pdfBytes, name) {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getForm().getTextField(name).getText();
}

/**
 * The DRAFT stamp is drawn as page content (generate-form.js drawText),
 * which pdf-lib encodes as hex strings in the page content streams —
 * decode page 1's streams and collect the drawn text.
 */
async function drawnTextOnPage(pdfBytes, pageIndex = 0) {
  const doc = await PDFDocument.load(pdfBytes);
  const contents = doc.getPages()[pageIndex].node.Contents();
  const refs = contents && typeof contents.asArray === 'function' ? contents.asArray() : [contents];
  let out = '';
  for (const ref of refs) {
    const obj = doc.context.lookup(ref);
    if (obj instanceof PDFRawStream) {
      const streamText = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
      for (const m of streamText.matchAll(/<([0-9A-Fa-f]{4,})>/g)) {
        out += Buffer.from(m[1], 'hex').toString('latin1');
      }
      out += '\n';
    }
  }
  return out;
}

async function assertDraftStamp(pdfBytes) {
  const drawn = await drawnTextOnPage(pdfBytes, 0);
  assert.ok(drawn.includes('DRAFT'), 'page 1 must carry the DRAFT stamp');
  assert.ok(drawn.includes('FOR REVIEW ONLY'), 'stamp: FOR REVIEW ONLY');
  assert.ok(drawn.includes('NOT SIGNED'), 'stamp: NOT SIGNED');
  assert.ok(drawn.includes('NOT SUBMITTED'), 'stamp: NOT SUBMITTED');
}

/** Record a generated draft in the store the way App.tsx does on a 200. */
function recordGenerated(store, formId, generated, draftId) {
  return recordDraft(store, formId, {
    summary: generated.summary,
    pdfBase64: Buffer.from(generated.pdfBytes).toString('base64'),
    draftId,
    generatedAt: T0,
  });
}

/** The summary the panel would render for a selection, per App.tsx. */
function visibleSummary(store, selectedFormId) {
  const current = draftForForm(store, selectedFormId);
  return current ? summaryForSelection(current.summary, selectedFormId) : null;
}

describe('R5/R4 verification: full correction workflow on real PDFs', () => {
  it('DOB correction (UI code path) withdraws both drafts, versions survive, regenerated I-589 is v2 with the corrected DOB in the PDF', async () => {
    const record = personaRecord();
    let store = emptyFormDraftStore();

    // --- Generate both forms from the original record -----------------
    const gen589v1 = await generateFormDraft({ formId: 'I-589', factRecord: record });
    store = recordGenerated(store, 'I-589', gen589v1, 'draft_589_v1');
    const gen765v1 = await generateFormDraft({ formId: 'I-765', factRecord: record });
    store = recordGenerated(store, 'I-765', gen765v1, 'draft_765_v1');

    // Per-form versions: each form's first generation is version 1.
    assert.equal(draftForForm(store, 'I-589').meta.version, 1);
    assert.equal(draftForForm(store, 'I-765').meta.version, 1,
      'a first-time I-765 in the same session is version 1 on its own counter');
    assert.equal(draftForForm(store, 'I-589').meta.draftId, 'draft_589_v1');

    // --- Inspect the actual v1 PDFs -----------------------------------
    const scratch589 = path.join(tmpdir(), 'iru-r5-i589-v1.pdf');
    const scratch765 = path.join(tmpdir(), 'iru-r5-i765-v1.pdf');
    writeFileSync(scratch589, gen589v1.pdfBytes);
    writeFileSync(scratch765, gen765v1.pdfBytes);
    assert.ok(statSync(scratch589).size > 100_000, 'I-589 v1 PDF written to /tmp for inspection');
    assert.ok(statSync(scratch765).size > 10_000, 'I-765 v1 PDF written to /tmp for inspection');

    const doc589 = await PDFDocument.load(gen589v1.pdfBytes);
    assert.equal(doc589.getPageCount(), 12, 'I-589 template is 12 pages');
    assert.equal(doc589.getTitle(), 'I-589 — DRAFT for review (IRU)');
    assert.equal(await fieldText(gen589v1.pdfBytes, F589.family), 'Toussaint');
    assert.equal(await fieldText(gen589v1.pdfBytes, F589.given), 'Marie');
    assert.equal(await fieldText(gen589v1.pdfBytes, F589.middle), 'Claire');
    assert.equal(await fieldText(gen589v1.pdfBytes, F589.dob), '05/14/1990',
      'v1 I-589 carries the originally reported DOB, verbatim in MDY form');
    assert.equal(await fieldText(gen589v1.pdfBytes, F589.birthPlace), 'Port-au-Prince, Haiti');
    await assertDraftStamp(gen589v1.pdfBytes);

    const doc765 = await PDFDocument.load(gen765v1.pdfBytes);
    assert.equal(doc765.getPageCount(), 7, 'I-765 template is 7 pages');
    assert.equal(await fieldText(gen765v1.pdfBytes, F765.family), 'Toussaint');
    assert.equal(await fieldText(gen765v1.pdfBytes, F765.dob), '05/14/1990');
    await assertDraftStamp(gen765v1.pdfBytes);

    const dobInSummary = gen589v1.summary.populated.find((p) => p.pdfField === F589.dob);
    assert.equal(dobInSummary.value, '05/14/1990');

    // --- Correct the DOB through the UI's code path --------------------
    // App.tsx handleCorrectFact(factId, value) →
    //   applyFactMutation(rec => upsertFact(rec,
    //     { id: factId, value: value.trim(), source: 'correction' }))
    // and applyFactMutation then runs invalidateDrafts on the store.
    upsertFact(record, { id: 'date_of_birth', value: '05/15/1990', source: 'correction' }, T1);
    store = invalidateDrafts(store);

    const dob = record.facts.date_of_birth;
    assert.equal(dob.value, '05/15/1990');
    assert.equal(dob.source, 'correction');
    assert.equal(dob.status, 'reported', 'a correction of an applicant-reported fact stays reported — no manufactured conflict');
    assert.deepEqual(dob.alternatives, []);
    assert.equal(dob.history.length, 1, 'the superseded value stays traceable');
    assert.equal(dob.history[0].value, '05/14/1990');
    assert.equal(record.outputsStale, true, 'the correction marks derived outputs stale');

    // --- The withdrawn v1 drafts can no longer render as current -----
    assert.equal(draftForForm(store, 'I-589'), null, 'I-589 draft withdrawn');
    assert.equal(draftForForm(store, 'I-765'), null, 'I-765 draft withdrawn too — invalidation is store-wide');
    assert.equal(visibleSummary(store, 'I-589'), null,
      'the render path (draftForForm → summaryForSelection) yields nothing for the stale I-589');
    assert.equal(visibleSummary(store, 'I-765'), null);
    assert.equal(summaryForSelection(null, 'I-589'), null);
    // …but the version counters survive the withdrawal (R4a).
    assert.deepEqual(store.versions, { 'I-589': 1, 'I-765': 1 });

    // --- Regenerate the I-589 from the corrected record ---------------
    const gen589v2 = await generateFormDraft({ formId: 'I-589', factRecord: record });
    store = recordGenerated(store, 'I-589', gen589v2, 'draft_589_v2');
    const v2 = draftForForm(store, 'I-589');
    assert.equal(v2.meta.version, 2, 'regeneration after a correction is version 2, not version 1 (R4a)');
    assert.equal(v2.meta.draftId, 'draft_589_v2');
    assert.notEqual(v2.meta.draftId, 'draft_589_v1');
    assert.equal(draftForForm(store, 'I-765'), null, 'I-765 stays withdrawn until it is itself regenerated');
    assert.equal(store.versions['I-765'], 1, 'its counter is untouched by the I-589 regeneration');

    const scratch589v2 = path.join(tmpdir(), 'iru-r5-i589-v2.pdf');
    writeFileSync(scratch589v2, gen589v2.pdfBytes);
    assert.ok(statSync(scratch589v2).size > 100_000);
    const doc589v2 = await PDFDocument.load(gen589v2.pdfBytes);
    assert.equal(doc589v2.getPageCount(), 12);
    assert.equal(await fieldText(gen589v2.pdfBytes, F589.dob), '05/15/1990',
      'the regenerated I-589 PDF itself carries the corrected DOB');
    assert.equal(await fieldText(gen589v2.pdfBytes, F589.family), 'Toussaint',
      'uncorrected fields are unchanged in v2');
    await assertDraftStamp(gen589v2.pdfBytes);
    const dobV2 = gen589v2.summary.populated.find((p) => p.pdfField === F589.dob);
    assert.equal(dobV2.value, '05/15/1990');
    assert.match(gen589v2.summary.staleVersionNote, /stale/i,
      'the summary still warns that a post-download correction makes a download stale');
  });

  it('an applicant-reported fact can be corrected directly (R4b caveat case: no conflict, no document involved)', () => {
    const record = personaRecord();
    const before = record.facts.date_of_birth;
    assert.equal(before.source, 'answer');
    assert.equal(before.status, 'reported');
    // This is the exact fact shape the browser tester could not correct:
    // saved by the applicant, rendered (post-dff470d) with a Correct
    // control, saved through handleCorrectFact → source 'correction'.
    upsertFact(record, { id: 'date_of_birth', value: '05/15/1990', source: 'correction' }, T1);
    assert.equal(record.facts.date_of_birth.value, '05/15/1990');
    assert.equal(record.facts.date_of_birth.status, 'reported');
    assert.equal(record.outputsStale, true);
  });
});

describe('R5 verification: switch-retention sequence with real drafts', () => {
  it('recordDraft I-589 → recordDraft I-765 → the I-589 draft is still intact at version 1; selectForm patches never touch the store', async () => {
    const record = personaRecord();
    let store = emptyFormDraftStore();
    const gen589 = await generateFormDraft({ formId: 'I-589', factRecord: record });
    store = recordGenerated(store, 'I-589', gen589, 'draft_589_keep');
    const gen765 = await generateFormDraft({ formId: 'I-765', factRecord: record });
    store = recordGenerated(store, 'I-765', gen765, 'draft_765_keep');

    // Switching forms is a patch over selection state only (App.tsx
    // applies selectForm's result to selectedFormId/formError and
    // nothing else); building those patches must not mutate the store.
    const snapshot = JSON.stringify(store);
    const to765 = selectForm('I-765');
    const backTo589 = selectForm('I-589');
    assert.deepEqual(to765, { selectedFormId: 'I-765', formError: '' });
    assert.deepEqual(backTo589, { selectedFormId: 'I-589', formError: '' });
    assert.ok(!('formSummary' in to765) && !('formPdfBase64' in to765)
      && !('formDraftMeta' in to765) && !('reviewChecks' in to765),
      'the selection patch carries no draft-clearing keys (the D4-era R5 root cause)');
    assert.equal(JSON.stringify(store), snapshot, 'selection patches never mutate the draft store');

    // Switching back redisplays the retained I-589 draft — summary,
    // meta and the real PDF bytes, no regeneration.
    const back = draftForForm(store, 'I-589');
    assert.ok(back);
    assert.equal(back.meta.draftId, 'draft_589_keep');
    assert.equal(back.meta.version, 1);
    assert.equal(back.meta.formId, 'I-589');
    assert.equal(summaryForSelection(back.summary, 'I-589'), back.summary);
    assert.equal(summaryForSelection(back.summary, 'I-765'), null,
      'the retained I-589 summary is still gated out under an I-765 selection (D4)');
    const retainedBytes = Buffer.from(back.pdfBase64, 'base64');
    assert.equal((await PDFDocument.load(retainedBytes)).getPageCount(), 12);
    assert.equal(await fieldText(retainedBytes, F589.dob), '05/14/1990');
    assert.equal(draftForForm(store, 'I-765').meta.draftId, 'draft_765_keep');
    assert.equal(draftForForm(store, 'I-765').meta.version, 1);
  });
});

describe('R4b verification: App.tsx correction chain (source trace)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('handleCorrectFact upserts with source correction through applyFactMutation, which invalidates drafts', () => {
    const start = app.indexOf('const handleCorrectFact');
    assert.ok(start >= 0, 'handleCorrectFact must exist');
    const handler = app.slice(start, start + 400);
    assert.ok(handler.includes('applyFactMutation'), 'correction must go through applyFactMutation');
    assert.ok(handler.includes("source: 'correction'"), 'correction must upsert with source correction');
    const mutStart = app.indexOf('const applyFactMutation');
    const mutation = app.slice(mutStart, mutStart + 900);
    assert.ok(mutation.includes('invalidateDrafts(prev)'),
      'applyFactMutation must withdraw every generated draft via the per-form store');
    assert.ok(app.includes('handleCorrectFact(f.id, factEditValue)'),
      'the facts-panel editor Save must call handleCorrectFact for that fact row');
  });
});
