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
            { fields: { entry_place: 'MIA', entry_date: '03/03/2022' } },
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

  // CORRECTED 2026-11-12: the entry table's DATE boxes are one per row —
  // DateTimeField2[0] / DateTimeField3[0] / DateTimeField4[0]. The old
  // mapping used DateTimeField3[0..2], putting entry 1's date in row 2's
  // box and entries 2-3 in fields that do not exist in the template.
  const d1 = await getFieldText(result.pdfBytes, 'form1[0].#subform[0].DateTimeField2[0]');
  const d2 = await getFieldText(result.pdfBytes, 'form1[0].#subform[0].DateTimeField3[0]');
  const d3 = await getFieldText(result.pdfBytes, 'form1[0].#subform[0].DateTimeField4[0]');
  assert.strictEqual(d1, '01/01/2024', 'Entry 1 date in row 1 date box');
  assert.strictEqual(d2, '06/01/2023', 'Entry 2 date in row 2 date box');
  assert.strictEqual(d3, '03/03/2022', 'Entry 3 date in row 3 date box');
  assert.strictEqual(result.plan.fillErrors.length, 0, 'no fill errors from entry dates');
});

test('last address: populates PDF fields from group data', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        last_address: {
          items: [
            { fields: { street: '123 Main St', city: 'TestCity', region: 'TestRegion', country: 'TestCountry', from_date: '2020-01-01', to_date: '2022-12-31' } },
          ]
        }
      }
    }
  });

  // CORRECTED 2026-11-12: Q1 is TWO rows (row 1 = TextField13[0,2,4,6]).
  // The old mapping read [0..7] as 8 fields of one address and put the
  // city in TextField13[1] — which is row 2's STREET box.
  const street = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[0]');
  assert.strictEqual(street, '123 Main St', 'Last address street should populate');

  const city = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[2]');
  assert.strictEqual(city, 'TestCity', 'Last address city should populate');

  const region = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[4]');
  assert.strictEqual(region, 'TestRegion', 'Last address region should populate');

  const country = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[6]');
  assert.strictEqual(country, 'TestCountry', 'Last address country should populate');

  const from = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField21[0]');
  assert.strictEqual(from, '01/01/2020', 'Last address from date (MM/DD/YYYY)');
  const to = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField20[0]');
  assert.strictEqual(to, '12/31/2022', 'Last address to date (MM/DD/YYYY)');

  // Row 2 must stay empty for a single-item record.
  const row2street = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[1]');
  assert.ok(!row2street, 'Row 2 street stays empty');
});

test('last address: second address fills row 2', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        last_address: {
          items: [
            { fields: { street: '123 Main St', city: 'CityOne', region: 'RegionOne', country: 'CountryOne', from_date: '2020-01-01', to_date: '2021-01-01' } },
            { fields: { street: '456 Second St', city: 'CityTwo', region: 'RegionTwo', country: 'CountryTwo', from_date: '2018-05-01', to_date: '2019-05-01' } },
          ]
        }
      }
    }
  });

  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[0]'), '123 Main St', 'Row 1 street');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[2]'), 'CityOne', 'Row 1 city');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[1]'), '456 Second St', 'Row 2 street');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[3]'), 'CityTwo', 'Row 2 city');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[5]'), 'RegionTwo', 'Row 2 region');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[7]'), 'CountryTwo', 'Row 2 country');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField22[0]'), '05/01/2018', 'Row 2 from date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField23[0]'), '05/01/2019', 'Row 2 to date');
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
            { fields: { school_name: 'Test University', field_of_study: 'Engineering', school_city: 'TestCity', from_date: '2015-09-01', to_date: '2019-06-01' } },
            { fields: { school_name: 'Second School', field_of_study: 'Arts', school_city: 'SecondCity', from_date: '2011-09-01', to_date: '2015-06-01' } },
          ]
        }
      }
    }
  });

  // CORRECTED 2026-11-12: FOUR schools × 3 columns; rows 1-2 interleave
  // (school 1 = [28,30,32], school 2 = [29,31,33]) with From/To dates
  // (school 1 DT41/DT40, school 2 DT38/DT39). The old mapping wrote
  // school 1's degree into school 2's name box and never mapped dates.
  const name = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[28]');
  assert.strictEqual(name, 'Test University', 'School 1 name should populate');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[30]'), 'Engineering', 'School 1 type');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[32]'), 'TestCity', 'School 1 location');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField41[0]'), '09/01/2015', 'School 1 from date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField40[0]'), '06/01/2019', 'School 1 to date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[29]'), 'Second School', 'School 2 name');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[31]'), 'Arts', 'School 2 type');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[33]'), 'SecondCity', 'School 2 location');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField38[0]'), '09/01/2011', 'School 2 from date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField39[0]'), '06/01/2015', 'School 2 to date');
});

test('education: four schools fill inline', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        education: {
          items: [
            { fields: { school_name: 'School One' } },
            { fields: { school_name: 'School Two' } },
            { fields: { school_name: 'School Three' } },
            { fields: { school_name: 'School Four' } },
          ]
        }
      }
    }
  });

  // Schools 3-4 are rows 3-4 of the table ([34] and [37]); the old
  // maxInline of 2 sent them to Supplement B overflow text.
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[28]'), 'School One');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[29]'), 'School Two');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[34]'), 'School Three');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[37]'), 'School Four');
  assert.strictEqual(result.plan.repeatingSummary.itemsOverflow, 0, 'no overflow with 4 schools');
});

test('employment: populates PDF fields from group data', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        employment: {
          items: [
            { fields: { employer_name: 'Test Corp', occupation: 'Engineer', from_date: '2020-02-01', to_date: '2023-03-01' } },
            { fields: { employer_name: 'Second Corp', occupation: 'Teacher', from_date: '2018-01-01', to_date: '2020-01-01' } },
          ]
        }
      }
    }
  });

  // CORRECTED 2026-11-12: THREE employer rows (employer 1 = [40]+[42]+
  // DT42/DT44, employer 2 = [41]+[43]+DT43/DT45). The old mapping wrote
  // employer 1's city into employer 2's name box and never mapped dates.
  const name = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[40]');
  assert.strictEqual(name, 'Test Corp', 'Employer 1 name should populate');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[42]'), 'Engineer', 'Employer 1 occupation');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField42[0]'), '02/01/2020', 'Employer 1 from date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField44[0]'), '03/01/2023', 'Employer 1 to date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[41]'), 'Second Corp', 'Employer 2 name');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[43]'), 'Teacher', 'Employer 2 occupation');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField43[0]'), '01/01/2018', 'Employer 2 from date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField45[0]'), '01/01/2020', 'Employer 2 to date');
});

test('employment: three employers fill inline', async () => {
  const result = await generateFormDraft({
    formId: 'I-589',
    factRecord: {
      facts: { family_name: { value: 'Test', source: 'answer', status: 'reported' } },
      groups: {
        employment: {
          items: [
            { fields: { employer_name: 'Corp One' } },
            { fields: { employer_name: 'Corp Two' } },
            { fields: { employer_name: 'Corp Three' } },
          ]
        }
      }
    }
  });

  // Employer 3 is row 3 of the table ([44]); the old maxInline of 2
  // sent it to Supplement B overflow text.
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[40]'), 'Corp One');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[41]'), 'Corp Two');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[44]'), 'Corp Three');
  assert.strictEqual(result.plan.repeatingSummary.itemsOverflow, 0, 'no overflow with 3 employers');
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
            { fields: { street: '123 Main', city: 'TestCity', region: 'TestRegion', country: 'TestCountry', from_date: '2020-01-15', to_date: '2022-06-30' } },
            { fields: { street: '456 Second', city: 'SecondCity', region: 'SecondRegion', country: 'SecondCountry', from_date: '2018-03-01', to_date: '2019-12-01' } },
          ]
        }
      }
    }
  });

  // CORRECTED 2026-11-12: rows 1-2 INTERLEAVE (residence 1 =
  // TextField13[8,10,12,14] + From DT24 / To DT26; residence 2 =
  // [9,11,13,15] + From DT25 / To DT27). The old [8+4i] stride wrote
  // residence 1's city into residence 2's street box (TextField13[9]).
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[8]'), '123 Main', 'Residence 1 street');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[10]'), 'TestCity', 'Residence 1 city');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[12]'), 'TestRegion', 'Residence 1 region');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[14]'), 'TestCountry', 'Residence 1 country');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField24[0]'), '01/15/2020', 'Residence 1 from date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField26[0]'), '06/30/2022', 'Residence 1 to date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[9]'), '456 Second', 'Residence 2 street (not residence 1 city)');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[11]'), 'SecondCity', 'Residence 2 city');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[13]'), 'SecondRegion', 'Residence 2 region');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[15]'), 'SecondCountry', 'Residence 2 country');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField25[0]'), '03/01/2018', 'Residence 2 from date');
  assert.strictEqual(await getFieldText(result.pdfBytes, 'form1[0].#subform[4].DateTimeField27[0]'), '12/01/2019', 'Residence 2 to date');
  assert.strictEqual(result.plan.fillErrors.length, 0, 'no fill errors from residence dates');
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
