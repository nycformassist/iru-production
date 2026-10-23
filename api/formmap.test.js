import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import { getFormEntry, FORM_REGISTRY } from './_lib/forms/registry.js';
import { buildFillPlan, buildCompletionSummary, splitFullName, TRANSFORMS } from './_lib/formmap.js';
import { generateFormDraft } from './generate-form.js';

const T = '2026-10-21T00:00:00.000Z';

function syntheticRecord() {
  const r = createFactRecord(T);
  const put = (id, value, source = 'answer', extra = {}) =>
    upsertFact(r, { id, value, source, ...extra }, T);
  put('family_name', 'Testfamily');
  put('given_name', 'Testgiven');
  put('a_number', 'A123456789'); // exercises aNumber transform
  put('date_of_birth', '1990-05-17');
  put('gender', 'female');
  put('marital_status', 'married');
  put('citizenship', 'Testlandia');
  put('country_of_birth', 'Testlandia');
  put('city_of_birth', 'Test City');
  put('residence_street', '123 Test Street');
  put('residence_city', 'Bronx');
  put('residence_region', 'NY');
  put('residence_postal_code', '10451');
  put('mailing_street', '123 Test Street');
  put('mailing_city', 'Bronx');
  put('mailing_region', 'NY');
  put('mailing_postal_code', '10451');
  put('phone', '(212) 555-0147');
  put('entry_date', '2023-03-04');
  put('passport_number', 'XTEST1234', 'document', { sourceRef: { documentType: 'passport', page: 1 } });
  put('application_reason', 'initial');
  return r;
}

describe('form registry integrity', () => {
  it('both initial target forms are registered with verified editions', () => {
    assert.equal(FORM_REGISTRY.length, 2);
    assert.equal(getFormEntry('I-589').editionDate, '07/28/26');
    assert.equal(getFormEntry('I-765').editionDate, '08/21/25');
    assert.equal(getFormEntry('I-999'), null);
  });

  it('no registry field is a signature field', () => {
    for (const entry of FORM_REGISTRY) {
      for (const f of entry.fields) {
        assert.ok(!/signature/i.test(f.pdfField), f.pdfField);
      }
    }
  });

  it('every mapped pdfField exists in the shipped template', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const entry of FORM_REGISTRY) {
      const bytes = await readFile(new URL(`../forms/templates/${entry.templateFile}`, import.meta.url));
      const doc = await PDFDocument.load(bytes);
      const names = new Set(doc.getForm().getFields().map((f) => f.getName()));
      for (const f of entry.fields) {
        assert.ok(names.has(f.pdfField), `${entry.id}: template missing field ${f.pdfField}`);
      }
    }
  });
});

describe('fill plan (§7.3 map-first behavior)', () => {
  it('maps confirmed facts, withholds unconfirmed extractions, reports them for confirmation', () => {
    const plan = buildFillPlan(syntheticRecord(), getFormEntry('I-589'));
    const filled = plan.fill.map((f) => f.pdfField);
    assert.ok(filled.some((n) => n.includes('PtAILine4_LastName')));
    // passport_number came from a document, unconfirmed → never filled
    assert.ok(!filled.some((n) => n.includes('TextField5[1]')));
    assert.ok(plan.needsConfirmation.some((n) => n.factId === 'passport_number'));
  });

  it('checkbox groups: exactly the matching box is planned', () => {
    const plan = buildFillPlan(syntheticRecord(), getFormEntry('I-765'));
    const checks = plan.fill.filter((f) => f.kind === 'checkbox');
    // gender=female → I-765 Line9_Checkbox[0]; marital=married → Line10_Checkbox[3]; reason=initial → Part1_Checkbox[0]
    assert.ok(checks.some((c) => c.pdfField.endsWith('Line9_Checkbox[0]')));
    assert.ok(checks.some((c) => c.pdfField.endsWith('Line10_Checkbox[3]')));
    assert.ok(checks.some((c) => c.pdfField.endsWith('Part1_Checkbox[0]')));
    assert.equal(checks.length, 3);
  });

  it('conflicting facts are never filled and are surfaced', () => {
    const r = syntheticRecord();
    upsertFact(r, { id: 'date_of_birth', value: '1990-05-18', source: 'document', sourceRef: { documentType: 'passport' } }, T);
    const plan = buildFillPlan(r, getFormEntry('I-765'));
    assert.ok(!plan.fill.some((f) => f.factId === 'date_of_birth'));
    assert.ok(plan.conflicts.some((c) => c.factId === 'date_of_birth'));
  });

  it('missing required facts become focused questions only for what is missing', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'family_name', value: 'Testfamily', source: 'answer' }, T);
    const plan = buildFillPlan(r, getFormEntry('I-765'));
    const missingIds = plan.missing.map((m) => m.factId);
    assert.ok(!missingIds.includes('family_name'));
    assert.ok(missingIds.includes('given_name'));
    assert.ok(missingIds.includes('date_of_birth'));
    // gender group reported once, not per-checkbox
    assert.equal(missingIds.filter((x) => x === 'gender').length, 1);
  });

  it('transforms: dateMDY and phone splitting', () => {
    assert.equal(TRANSFORMS.dateMDY('1990-05-17'), '05/17/1990');
    assert.equal(TRANSFORMS.phoneAreaCode('(212) 555-0147'), '212');
    assert.equal(TRANSFORMS.phoneNumber('(212) 555-0147'), '555-0147');
  });

  it('D6: cityCountryOfBirth never prints the country twice (I-589 Item 13)', () => {
    const recWith = (country) => ({ facts: { country_of_birth: { value: country } } });
    // The E2E persona's exact values: the city value already carries the
    // country ("Port-au-Prince, Haiti" + country "Haiti").
    assert.equal(TRANSFORMS.cityCountryOfBirth('Port-au-Prince, Haiti', recWith('Haiti')), 'Port-au-Prince, Haiti');
    assert.equal(TRANSFORMS.cityCountryOfBirth('Port-au-Prince, haiti', recWith('Haiti')), 'Port-au-Prince, haiti',
      'case-insensitive: still not duplicated, applicant casing preserved');
    // City alone still gains the country.
    assert.equal(TRANSFORMS.cityCountryOfBirth('Port-au-Prince', recWith('Haiti')), 'Port-au-Prince, Haiti');
    // Country alone (no city) still fills the combined field.
    assert.equal(TRANSFORMS.cityCountryOfBirth('', recWith('Haiti')), 'Haiti');
    // Through the fill plan, exactly as the draft generator composes it:
    const rec = syntheticRecord();
    rec.facts.city_of_birth.value = 'Port-au-Prince, Haiti';
    rec.facts.country_of_birth.value = 'Haiti';
    const plan = buildFillPlan(rec, getFormEntry('I-589'));
    const item13 = plan.fill.find((f) => f.label.includes('Item 13'));
    assert.ok(item13, 'Item 13 is filled');
    assert.equal(item13.value, 'Port-au-Prince, Haiti');
  });

  it('splitFullName proposes parts for consumer review', () => {
    assert.deepEqual(splitFullName('Testgiven Middlename Testfamily'), {
      given_name: 'Testgiven', middle_name: 'Middlename', family_name: 'Testfamily',
    });
  });
});

describe('PDF draft generation (§7.5)', () => {
  it('generates an I-765 draft with values in the official fields and no signature', async () => {
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-765', factRecord: syntheticRecord() });
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();
    assert.equal(form.getTextField('form1[0].Page1[0].Line1a_FamilyName[0]').getText(), 'Testfamily');
    assert.equal(form.getTextField('form1[0].Page3[0].Line19_DOB[0]').getText(), '05/17/1990');
    assert.equal(form.getCheckBox('form1[0].Page2[0].Line9_Checkbox[0]').isChecked(), true); // female
    assert.equal(form.getCheckBox('form1[0].Page2[0].Line9_Checkbox[1]').isChecked(), false); // male stays blank
    // Signature field exists on the form and must remain empty.
    const sig = form.getTextField('form1[0].Page4[0].Pt3Line7a_Signature[0]');
    assert.ok(!sig.getText());
    assert.equal(doc.getPageCount(), 7);
    assert.equal(summary.editionDate, '08/21/25');
    assert.ok(summary.populated.length >= 10);
    assert.ok(summary.needsConfirmation.some((n) => n.factId === 'passport_number'));
  });

  it('generates an I-589 draft (12 pages) with residence + DOB + combined birth place', async () => {
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-589', factRecord: syntheticRecord() });
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();
    assert.equal(doc.getPageCount(), 12);
    assert.equal(form.getTextField('form1[0].#subform[0].PtAILine4_LastName[0]').getText(), 'Testfamily');
    assert.equal(form.getTextField('form1[0].#subform[0].DateTimeField1[0]').getText(), '05/17/1990');
    assert.equal(form.getTextField('form1[0].#subform[0].TextField1[4]').getText(), 'Test City, Testlandia');
    assert.equal(form.getTextField('form1[0].#subform[0].TextField1[2]').getText(), 'Bronx'); // residence city
    assert.equal(form.getCheckBox('form1[0].#subform[0].PartALine9Sex[1]').isChecked(), true); // female on I-589 is [1]
    assert.equal(summary.editionDate, '07/28/26');
  });

  it('regeneration after correction: the regenerated PDF itself carries the corrected value', async () => {
    const rec = syntheticRecord();
    const first = await generateFormDraft({ formId: 'I-765', factRecord: rec });
    const doc1 = await PDFDocument.load(first.pdfBytes);
    assert.equal(doc1.getForm().getTextField('form1[0].Page1[0].Line1a_FamilyName[0]').getText(), 'Testfamily');
    // Consumer corrects the fact; the record marks outputs stale.
    upsertFact(rec, { id: 'family_name', value: 'Correctedname', source: 'correction' }, T);
    assert.equal(rec.outputsStale, true);
    const second = await generateFormDraft({ formId: 'I-765', factRecord: rec });
    const doc2 = await PDFDocument.load(second.pdfBytes);
    assert.equal(doc2.getForm().getTextField('form1[0].Page1[0].Line1a_FamilyName[0]').getText(), 'Correctedname');
  });

  it('rejects unknown forms and invalid records', async () => {
    await assert.rejects(() => generateFormDraft({ formId: 'I-999', factRecord: syntheticRecord() }), /unknown form/);
    await assert.rejects(() => generateFormDraft({ formId: 'I-765', factRecord: null }), /invalid fact record/);
  });

  it('a client-claimed "verified" fact is dropped, not filled', async () => {
    const forged = {
      facts: {
        family_name: { value: 'Forged', source: 'answer', status: 'verified' },
      },
    };
    const { summary } = await generateFormDraft({ formId: 'I-765', factRecord: forged });
    assert.ok(!summary.populated.some((p) => p.value === 'Forged'));
    assert.ok(summary.missingRequired.some((m) => m.factId === 'family_name'));
  });
});
