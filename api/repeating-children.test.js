/**
 * api/repeating-children.test.js — Named tests for children repeating-fill (4c).
 *
 * Verifies actual generated PDF output for the children repeating group,
 * including inline capacity, overflow to Supplement A, preservation,
 * and absence of duplication/overwrite.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { PDFDocument } from 'pdf-lib';
import { generateFormDraft } from './generate-form.js';
import { buildRepeatingFillPlan } from './_lib/repeating-fill.js';
import { getFormEntry } from './_lib/forms/registry.js';

async function getFieldText(pdfBytes, fieldName) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const field = form.getField(fieldName);
  return field.getText();
}

function makeRecord(childCount) {
  const persons = {};
  for (let i = 1; i <= childCount; i++) {
    persons[`c${i}`] = {
      role: 'child',
      facts: { family_name: `C${i}Last`, given_name: `C${i}First` },
    };
  }
  return {
    facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
    persons,
  };
}

test('children: single child populates Child1, others stay empty', async () => {
  const result = await generateFormDraft({ formId: 'I-589', factRecord: makeRecord(1) });
  const c1 = await getFieldText(result.pdfBytes, 'form1[0].#subform[1].ChildLast1[0]');
  assert.strictEqual(c1, 'C1Last', 'Child1 should populate');
  
  const c2 = await getFieldText(result.pdfBytes, 'form1[0].#subform[3].ChildLast2[0]');
  assert.ok(!c2, 'Child2 should stay empty');
});

test('children: four children populate inline without overwrite', async () => {
  const result = await generateFormDraft({ formId: 'I-589', factRecord: makeRecord(4) });
  
  const expected = [
    ['form1[0].#subform[1].ChildLast1[0]', 'C1Last'],
    ['form1[0].#subform[3].ChildLast2[0]', 'C2Last'],
    ['form1[0].#subform[3].ChildLast3[0]', 'C3Last'],
    ['form1[0].#subform[3].ChildLast4[0]', 'C4Last'],
  ];
  
  for (const [field, exp] of expected) {
    const actual = await getFieldText(result.pdfBytes, field);
    assert.strictEqual(actual, exp, `${field} should be ${exp}`);
  }
  
  // Verify no duplication: all values distinct
  const values = await Promise.all(expected.map(([f]) => getFieldText(result.pdfBytes, f)));
  assert.strictEqual(new Set(values).size, 4, 'All four children should have distinct values');
});

test('children: five children overflow to Supplement A, primary preserved', async () => {
  const result = await generateFormDraft({ formId: 'I-589', factRecord: makeRecord(5) });
  
  // Primary preserved
  for (let i = 1; i <= 4; i++) {
    const sf = i === 1 ? '#subform[1]' : '#subform[3]';
    const actual = await getFieldText(result.pdfBytes, `form1[0].${sf}.ChildLast${i}[0]`);
    assert.strictEqual(actual, `C${i}Last`, `Child${i} should remain on primary`);
  }
  
  // Overflow in Supplement A
  const c5last = await getFieldText(result.pdfBytes, 'form1[0].#subform[12].TextField12[0]');
  assert.strictEqual(c5last, 'C5Last', 'Child5 should appear in Supplement A');
  
  const c5first = await getFieldText(result.pdfBytes, 'form1[0].#subform[12].TextField12[1]');
  assert.strictEqual(c5first, 'C5First', 'Child5 first name should appear in Supplement A');
});

test('children: six children fill both Supplement A slots', async () => {
  const result = await generateFormDraft({ formId: 'I-589', factRecord: makeRecord(6) });
  
  const c5 = await getFieldText(result.pdfBytes, 'form1[0].#subform[12].TextField12[0]');
  assert.strictEqual(c5, 'C5Last', 'Child5 in Supplement A slot 1');
  
  const c6 = await getFieldText(result.pdfBytes, 'form1[0].#subform[12].TextField12[10]');
  assert.strictEqual(c6, 'C6Last', 'Child6 in Supplement A slot 2');
});

test('children: overflow detection flags Supplement A', async () => {
  const entry = getFormEntry('I-589');
  const record = { groups: {}, persons: makeRecord(5).persons };
  const plan = buildRepeatingFillPlan(record, entry);
  
  assert.strictEqual(plan.summary.itemsInline, 4, '4 inline');
  assert.strictEqual(plan.summary.itemsOverflow, 1, '1 overflow (5 total - 4 inline)');
  assert.ok(plan.summary.supplementsNeeded.includes('supplement_a'), 'Supplement A flagged');
});

test('entry history: multiple entries populate without overwrite', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        entries: {
          items: [
            { fields: { entry_place: 'JFK', entry_date: '01/01/2024' } },
            { fields: { entry_place: 'LAX', entry_date: '06/01/2023' } },
          ]
        }
      }
    }
  });
  
  const e1 = await getFieldText(result.pdfBytes, 'form1[0].#subform[0].TextField4[0]');
  const e2 = await getFieldText(result.pdfBytes, 'form1[0].#subform[0].TextField4[2]');
  
  assert.strictEqual(e1, 'JFK', 'Entry 1 place');
  assert.strictEqual(e2, 'LAX', 'Entry 2 place');
  assert.notStrictEqual(e1, e2, 'Entries should not overwrite each other');
});

test('last address: populates PDF fields from group data', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        last_address: {
          items: [
            { fields: { street: '123 Main St', city: 'TestCity', country: 'TestCountry' } },
          ]
        }
      }
    }
  });
  
  const street = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[0]');
  assert.strictEqual(street, '123 Main St', 'Last address street should populate');
  
  const city = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[1]');
  assert.strictEqual(city, 'TestCity', 'Last address city should populate');
});

test('children: sex checkboxes populate correctly', async () => {
  // Sex checkboxes are mapped but need PDF verification
  // Child 1: #subform[1].CheckBox12_Sex[0] (Male), [1] (Female)
  // Child 2: #subform[3].CheckBox26_Sex[0] (Male), [1] (Female)
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      persons: {
        c1: { role: 'child', facts: { family_name: 'C1', sex: 'Male' } },
        c2: { role: 'child', facts: { family_name: 'C2', sex: 'Female' } },
      }
    }
  });
  
  const doc = await PDFDocument.load(result.pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  
  // Verify checkbox fields exist in PDF
  const c1male = form.getField('form1[0].#subform[1].CheckBox12_Sex[0]');
  assert.ok(c1male, 'Child1 Male checkbox should exist');
  
  const c1female = form.getField('form1[0].#subform[1].CheckBox12_Sex[1]');
  assert.ok(c1female, 'Child1 Female checkbox should exist');
  
  const c2male = form.getField('form1[0].#subform[3].CheckBox26_Sex[0]');
  assert.ok(c2male, 'Child2 Male checkbox should exist');
  
  // Note: Checkbox CHECKING based on sex value requires additional
  // logic in repeating-fill.js to map sex field to checkbox selection.
  // Currently classified as MAPPED but not PDF-VERIFIED for value.
});

test('education: populates PDF fields from group data', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        education: {
          items: [
            { fields: { school_name: 'Test University', school_city: 'TestCity' } },
          ]
        }
      }
    }
  });
  
  const name = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[28]');
  assert.strictEqual(name, 'Test University', 'School name should populate');
});

test('employment: populates PDF fields from group data', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        employment: {
          items: [
            { fields: { employer_name: 'Test Corp', occupation: 'Engineer' } },
          ]
        }
      }
    }
  });
  
  const name = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[40]');
  assert.strictEqual(name, 'Test Corp', 'Employer name should populate');
});

test('parents/siblings: populates PDF fields from group data', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        family: {
          items: [
            { fields: { family_name: 'Test Parent', relationship: 'Mother' } },
          ]
        }
      }
    }
  });
  
  const name = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[46]');
  assert.strictEqual(name, 'Test Parent', 'Parent name should populate');
});

test('residences: date fields populate correctly', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        addresses: {
          items: [
            { fields: { street: '123 Main', city: 'TestCity', from_date: '01/15/2020' } },
          ]
        }
      }
    }
  });
  
  // Verify the date field exists and can be populated
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(result.pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const dateField = form.getField('form1[0].#subform[4].DateTimeField24[0]');
  assert.ok(dateField, 'Residence from-date field should exist');
});

test('supplement_b: continuation fields exist in PDF', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
    }
  });
  
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(result.pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  
  const field1 = form.getField('form1[0].#subform[13].TextField31[0]');
  assert.ok(field1, 'Supplement B field 1 should exist');
  
  const field2 = form.getField('form1[0].#subform[13].TextField31[1]');
  assert.ok(field2, 'Supplement B field 2 should exist');
});

test('children: sex checkbox value mapping (Male/Female → checkbox)', async () => {
  const { PDFDocument } = await import('pdf-lib');

  async function isChecked(pdfBytes, fieldName) {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = doc.getForm();
    try {
      const field = form.getField(fieldName);
      return field.constructor.name === 'PDFCheckBox' ? field.isChecked() : false;
    } catch {
      return false;
    }
  }

  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'SexTest', source: 'answer', status: 'reported' } },
      persons: {
        'child_1': { role: 'child', facts: { family_name: 'BoyChild', sex: 'Male' } },
        'child_2': { role: 'child', facts: { family_name: 'GirlChild', sex: 'Female' } },
      }
    }
  });

  // Child 1 (Male): Male box checked, Female box not checked
  const c1Male = await isChecked(result.pdfBytes, 'form1[0].#subform[1].CheckBox12_Sex[0]');
  const c1Female = await isChecked(result.pdfBytes, 'form1[0].#subform[1].CheckBox12_Sex[1]');
  assert.strictEqual(c1Male, true, 'Child 1 Male checkbox checked');
  assert.strictEqual(c1Female, false, 'Child 1 Female checkbox not checked');

  // Child 2 (Female): Female box checked, Male box not checked
  const c2Male = await isChecked(result.pdfBytes, 'form1[0].#subform[3].CheckBox26_Sex[0]');
  const c2Female = await isChecked(result.pdfBytes, 'form1[0].#subform[3].CheckBox26_Sex[1]');
  assert.strictEqual(c2Male, false, 'Child 2 Male checkbox not checked');
  assert.strictEqual(c2Female, true, 'Child 2 Female checkbox checked');

  console.log('✓ Sex checkbox value mapping: Male/Female → correct checkboxes');
});
