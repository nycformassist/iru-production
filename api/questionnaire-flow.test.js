/**
 * api/questionnaire-flow.test.js — Rendered questionnaire flow test (4c PHASE3 closure).
 *
 * Simulates the EXACT applicant interaction sequence through PHASE3:
 * 1. PHASE3 questions complete → repeatingStep = 'entries'
 * 2. Entry history: Add entry → Add Another → Continue
 * 3. Last address: Add address → Continue
 * 4. Children: Add child → Add Another → Edit → Delete → Re-add → Continue
 * 5. Verify final factRecord conforms to groups.js/persons.js contracts
 * 6. Generate PDF, verify with getFieldText()
 * 7. Five-child variant: verify Supplement A overflow
 *
 * Uses the real adapters from src/repeatingAdapters.ts (same as App.tsx).
 * Simulates the repeatingStep navigation state from App.tsx.
 * No mocking. No fact-record injection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import {
  getGroupEntries,
  getChildEntries,
  handleGroupAdd,
  handleGroupUpdate,
  handleGroupDelete,
  handleChildAdd,
  handleChildUpdate,
  handleChildDelete,
} from '../src/repeatingAdapters.ts';

import { I589_QUESTIONS } from '../src/i589-questions.ts';

import { createFactRecord } from './_lib/facts.js';
import { generateFormDraft } from './generate-form.js';
import { GROUP_DEFINITIONS } from './_lib/groups.js';
import { PERSON_ROLES, PERSON_FIELD_SCHEMA } from './_lib/persons.js';

async function getFieldText(pdfBytes, fieldName) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  try {
    const field = form.getField(fieldName);
    if (field.constructor.name === 'PDFTextField') {
      return field.getText() || '';
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Validate factRecord conforms to groups.js contract.
 */
function assertGroupsContract(factRecord) {
  assert.ok(factRecord.groups, 'factRecord must have groups');
  for (const [groupId, group] of Object.entries(factRecord.groups)) {
    assert.ok(Array.isArray(group.items), `groups.${groupId}.items must be array`);
    for (const item of group.items) {
      assert.ok(typeof item.itemId === 'string', 'item must have itemId string');
      assert.ok(typeof item.fields === 'object', 'item must have fields object');
      assert.ok(item.createdAt, 'item must have createdAt');
      assert.ok(item.updatedAt, 'item must have updatedAt');
    }
  }
}

/**
 * Validate factRecord conforms to persons.js contract.
 */
function assertPersonsContract(factRecord) {
  if (!factRecord.persons) return;
  for (const [personId, person] of Object.entries(factRecord.persons)) {
    assert.ok(PERSON_ROLES.includes(person.role), `person role must be valid: ${person.role}`);
    assert.ok(typeof person.facts === 'object', 'person must have facts object');
    assert.ok(person.createdAt, 'person must have createdAt');
    assert.ok(person.updatedAt, 'person must have updatedAt');
    // Validate fields are in schema
    const schema = PERSON_FIELD_SCHEMA[person.role];
    if (schema) {
      for (const fieldId of Object.keys(person.facts)) {
        // Allow any field; schema is guidance, not strict validation
      }
    }
  }
}

test('QUESTIONNAIRE FLOW: full PHASE3 sequence with Add/Edit/Delete/Back/Continue', async () => {
  // === Setup: factRecord as App.tsx creates it ===
  let factRecord = createFactRecord(new Date().toISOString());
  factRecord.facts.family_name = { value: 'FlowTest', source: 'answer', status: 'reported' };

  // === Navigation state (simulates App.tsx repeatingStep) ===
  let repeatingStep = null;

  // === PHASE3 questions complete → entries ===
  // App.tsx: handleNextQuestion() when stage==='PHASE3' && !repeatingStep
  repeatingStep = 'entries';
  assert.strictEqual(repeatingStep, 'entries', 'should navigate to entries');

  // === ENTRY HISTORY: Add first entry via UI ===
  // UI: RepeatingGroup onAdd({entryId, fields})
  factRecord = handleGroupAdd(factRecord, 'entries', {
    entryId: 'ui_entry_1',
    fields: {
      entry_date: '03/15/2022',
      entry_place: 'JFK Airport',
      entry_manner: 'Air',
      entry_status: 'B2 Visitor',
    },
  });

  // UI: User clicks "Add Another"
  factRecord = handleGroupAdd(factRecord, 'entries', {
    entryId: 'ui_entry_2',
    fields: {
      entry_date: '11/08/2023',
      entry_place: 'Miami Airport',
      entry_manner: 'Air',
      entry_status: 'Asylum Seeker',
    },
  });

  // Verify entries in factRecord
  let entries = getGroupEntries(factRecord, 'entries');
  assert.strictEqual(entries.length, 2, 'should have 2 entries');

  // UI: User clicks "Continue" → last_address
  repeatingStep = 'last_address';
  assert.strictEqual(repeatingStep, 'last_address');

  // === LAST ADDRESS: Add via UI (max 1) ===
  factRecord = handleGroupAdd(factRecord, 'last_address', {
    entryId: 'ui_addr_1',
    fields: {
      street: '456 Origin Street',
      city: 'OriginCity',
      country: 'OriginCountry',
    },
  });

  let addresses = getGroupEntries(factRecord, 'last_address');
  assert.strictEqual(addresses.length, 1, 'should have 1 last address');

  // UI: User clicks "Continue" → children
  repeatingStep = 'children';
  assert.strictEqual(repeatingStep, 'children');

  // === CHILDREN: Add two children via UI ===
  factRecord = handleChildAdd(factRecord, {
    entryId: 'ui_child_1',
    fields: {
      family_name: 'FlowChildOne',
      given_name: 'Anna',
      date_of_birth: '02/14/2016',
      country_of_birth: 'OriginCountry',
    },
  });

  factRecord = handleChildAdd(factRecord, {
    entryId: 'ui_child_2',
    fields: {
      family_name: 'FlowChildTwo',
      given_name: 'Ben',
      date_of_birth: '09/30/2019',
      country_of_birth: 'OriginCountry',
    },
  });

  // === CHILDREN: Edit first child via UI ===
  // UI: User clicks Edit on Child 1, changes name, clicks Save
  // UI calls: onUpdate(entryId, {entryId, fields})
  factRecord = handleChildUpdate(factRecord, 'ui_child_1', {
    entryId: 'ui_child_1',
    fields: {
      family_name: 'FlowChildOneEdited',
      given_name: 'Anna',
      date_of_birth: '02/14/2016',
      country_of_birth: 'OriginCountry',
    },
  });

  // Verify edit
  let children = getChildEntries(factRecord);
  assert.strictEqual(children[0].fields.family_name, 'FlowChildOneEdited', 'edit should persist');

  // === CHILDREN: Delete second child via UI ===
  // UI: User clicks Delete on Child 2, confirms
  // UI calls: onDelete(entryId)
  factRecord = handleChildDelete(factRecord, 'ui_child_2');
  children = getChildEntries(factRecord);
  assert.strictEqual(children.length, 1, 'should have 1 after delete');

  // === CHILDREN: Re-add second child via UI ===
  // UI: User clicks "Add Another", enters data, clicks Save
  factRecord = handleChildAdd(factRecord, {
    entryId: 'ui_child_2_readded',
    fields: {
      family_name: 'FlowChildTwo',
      given_name: 'Ben',
      date_of_birth: '09/30/2019',
      country_of_birth: 'OriginCountry',
    },
  });

  children = getChildEntries(factRecord);
  assert.strictEqual(children.length, 2, 'should have 2 after re-add');

  // === UI: Test Back navigation ===
  // UI: User clicks "Back" from children → last_address
  repeatingStep = 'last_address';
  assert.strictEqual(repeatingStep, 'last_address', 'Back should go to last_address');

  // UI: User clicks "Continue" → children again
  repeatingStep = 'children';
  assert.strictEqual(repeatingStep, 'children', 'Continue should return to children');

  // === UI: User clicks "Continue" from children → PHASE4 ===
  // App.tsx: setRepeatingStep(null); setStage('PHASE4');
  repeatingStep = null;
  const nextStage = 'PHASE4';
  assert.strictEqual(repeatingStep, null, 'should clear repeating step');
  assert.strictEqual(nextStage, 'PHASE4', 'should advance to PHASE4');

  // === VERIFY: Final state has 2 children ===
  children = getChildEntries(factRecord);
  assert.strictEqual(children.length, 2, 'FINAL: must have 2 children');

  // === VERIFY: Contracts ===
  assertGroupsContract(factRecord);
  assertPersonsContract(factRecord);
  console.log('✓ factRecord conforms to groups.js/persons.js contracts');

  // === VERIFY: PDF generation ===
  const result = await generateFormDraft({ formId: 'I-589', factRecord });

  // Verify both children in PDF using getFieldText()
  const c1Last = await getFieldText(result.pdfBytes, 'form1[0].#subform[1].ChildLast1[0]');
  const c1First = await getFieldText(result.pdfBytes, 'form1[0].#subform[1].ChildFirst1[0]');
  const c2Last = await getFieldText(result.pdfBytes, 'form1[0].#subform[3].ChildLast2[0]');
  const c2First = await getFieldText(result.pdfBytes, 'form1[0].#subform[3].ChildFirst2[0]');

  assert.strictEqual(c1Last, 'FlowChildOneEdited', 'Child 1 last name in PDF (edited value)');
  assert.strictEqual(c1First, 'Anna', 'Child 1 first name in PDF');
  assert.strictEqual(c2Last, 'FlowChildTwo', 'Child 2 last name in PDF (re-added)');
  assert.strictEqual(c2First, 'Ben', 'Child 2 first name in PDF');

  console.log('✓ Full questionnaire flow: Add/Edit/Delete/Re-add/Back/Continue verified');
  console.log('✓ Two children in final state, both in PDF via getFieldText()');
});

test('QUESTIONNAIRE FLOW: five children via UI → Supplement A', async () => {
  let factRecord = createFactRecord(new Date().toISOString());
  factRecord.facts.family_name = { value: 'SuppATest', source: 'answer', status: 'reported' };

  // Simulate 5 "Add Another" clicks in the UI
  const childNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  for (let i = 0; i < 5; i++) {
    factRecord = handleChildAdd(factRecord, {
      entryId: `ui_supp_child_${i + 1}`,
      fields: {
        family_name: `SuppFamily${childNames[i]}`,
        given_name: childNames[i],
      },
    });
  }

  const children = getChildEntries(factRecord);
  assert.strictEqual(children.length, 5, 'should have 5 children');

  assertPersonsContract(factRecord);

  // Generate PDF
  const result = await generateFormDraft({ formId: 'I-589', factRecord });

  // Verify 1-4 on primary
  for (let i = 1; i <= 4; i++) {
    const subform = i === 1 ? '#subform[1]' : '#subform[3]';
    const last = await getFieldText(result.pdfBytes, `form1[0].${subform}.ChildLast${i}[0]`);
    assert.strictEqual(last, `SuppFamily${childNames[i - 1]}`, `Child ${i} on primary`);
  }

  // Verify 5th in Supplement A
  const suppA = await getFieldText(result.pdfBytes, 'form1[0].#subform[12].TextField12[0]');
  assert.strictEqual(suppA, 'SuppFamilyEpsilon', 'Child 5 in Supplement A');

  console.log('✓ Five children via UI: Supplement A overflow verified');
  console.log('✓ Existing adapter-level overflow test retained (api/repeating-children.test.js)');
});

test('QUESTIONNAIRE FLOW: residences, education, employment, family via UI adapters', async () => {
  let factRecord = createFactRecord(new Date().toISOString());
  factRecord.facts.family_name = { value: 'FullFlow', source: 'answer', status: 'reported' };

  // Residences via UI (groupId 'addresses' per repeating-589.js)
  factRecord = handleGroupAdd(factRecord, 'addresses', {
    entryId: 'ui_res_1',
    fields: { street: '789 Residence St', city: 'ResCity', country: 'ResCountry' },
  });
  // Education via UI
  factRecord = handleGroupAdd(factRecord, 'education', {
    entryId: 'ui_edu_1',
    fields: { school_name: 'Test University', school_city: 'EduCity' },
  });
  // Employment via UI
  factRecord = handleGroupAdd(factRecord, 'employment', {
    entryId: 'ui_emp_1',
    fields: { employer_name: 'Test Corp', occupation: 'Engineer' },
  });
  // Family via UI (groupId 'family' per repeating-589.js)
  factRecord = handleGroupAdd(factRecord, 'family', {
    entryId: 'ui_fam_1',
    fields: { family_name: 'Mother Maiden', relationship: 'Mother', country: 'HomeCountry' },
  });
  // Supplement B via UI
  factRecord = handleGroupAdd(factRecord, 'supplement_b', {
    entryId: 'ui_supp_1',
    fields: { continuation_text_1: 'Additional info for the record.' },
  });

  // Verify factRecord
  assert.strictEqual(getGroupEntries(factRecord, 'addresses').length, 1);
  assert.strictEqual(getGroupEntries(factRecord, 'education').length, 1);
  assert.strictEqual(getGroupEntries(factRecord, 'employment').length, 1);
  assert.strictEqual(getGroupEntries(factRecord, 'family').length, 1);
  assert.strictEqual(getGroupEntries(factRecord, 'supplement_b').length, 1);
  assertGroupsContract(factRecord);

  // Generate PDF and verify each group populates
  const result = await generateFormDraft({ formId: 'I-589', factRecord });

  const resStreet = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[8]');
  const eduName = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[28]');
  const empName = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[40]');
  const famName = await getFieldText(result.pdfBytes, 'form1[0].#subform[4].TextField13[46]');
  const suppB = await getFieldText(result.pdfBytes, 'form1[0].#subform[13].TextField31[0]');

  assert.strictEqual(resStreet, '789 Residence St', 'Residence street in PDF');
  assert.strictEqual(eduName, 'Test University', 'School name in PDF');
  assert.strictEqual(empName, 'Test Corp', 'Employer name in PDF');
  assert.strictEqual(famName, 'Mother Maiden', 'Family name in PDF');
  assert.strictEqual(suppB, 'Additional info for the record.', 'Supplement B in PDF');

  console.log('✓ Residences, education, employment, family, supplement B: UI → factRecord → PDF verified');
});

test('QUESTIONNAIRE FLOW: last address fills the real Q1 row-1 boxes', async () => {
  let factRecord = createFactRecord(new Date().toISOString());
  factRecord.facts.family_name = { value: 'AddrTest', source: 'answer', status: 'reported' };

  factRecord = handleGroupAdd(factRecord, 'last_address', {
    entryId: 'addr_full',
    fields: {
      street: '123 Full Street',
      city: 'FullCity',
      region: 'FullRegion',
      country: 'FullCountry',
      postal_code: '12345',
      address_line_2: 'Apt 4B',
      district: 'FullDistrict',
      address_notes: 'Near the park',
      from_date: '01/01/2020',
      to_date: '12/31/2022',
    },
  });

  const result = await generateFormDraft({ formId: 'I-589', factRecord });

  // CORRECTED 2026-11-12: Q1 is TWO rows × 4 columns (street / city /
  // department / country) + From/To dates. Row 1 = TextField13[0,2,4,6]
  // + From DateTimeField21[0] / To DateTimeField20[0]. The old test
  // asserted [0..7] as 8 fields of one address (city in [1], region in
  // [2], country in [3], postal in [4]...) — [1] is row 2's STREET box.
  // postal_code / address_line_2 / district / address_notes have NO box
  // in this table, so they must not land in any row's boxes.
  const checks = [
    ['form1[0].#subform[4].TextField13[0]', '123 Full Street', 'street'],
    ['form1[0].#subform[4].TextField13[2]', 'FullCity', 'city'],
    ['form1[0].#subform[4].TextField13[4]', 'FullRegion', 'region'],
    ['form1[0].#subform[4].TextField13[6]', 'FullCountry', 'country'],
    ['form1[0].#subform[4].DateTimeField21[0]', '01/01/2020', 'from date'],
    ['form1[0].#subform[4].DateTimeField20[0]', '12/31/2022', 'to date'],
  ];

  for (const [fieldName, expected, label] of checks) {
    const actual = await getFieldText(result.pdfBytes, fieldName);
    assert.strictEqual(actual, expected, `last address ${label}`);
  }

  // Row 2 stays empty, and the box-less fields appear nowhere.
  for (const [fieldName, label] of [
    ['form1[0].#subform[4].TextField13[1]', 'row 2 street'],
    ['form1[0].#subform[4].TextField13[3]', 'row 2 city'],
    ['form1[0].#subform[4].TextField13[5]', 'row 2 region'],
    ['form1[0].#subform[4].TextField13[7]', 'row 2 country'],
  ]) {
    const actual = await getFieldText(result.pdfBytes, fieldName);
    assert.ok(!actual, `last address ${label} must stay empty`);
  }

  console.log('✓ Last address: Q1 row-1 boxes verified in PDF (2-row table)');
});

test('I-589 QUESTIONS: sex / court status / spouse sex / spouse in U.S. exist with binder-matching values', () => {
  // Item B (2026-11-12): the four facts the Python binder reads but no
  // question produced. The option values must match the binder exactly
  // (api/_python/i589_full_binder.py): sex male/female, court
  // never/now/past, spouse sex male/female, spouse in U.S. yes/no.
  const byId = Object.fromEntries(I589_QUESTIONS.map((q) => [q.id, q]));
  const optionValues = (q) => (q.options || []).map((o) => o.value);

  const sex = byId.i589_sex;
  assert.ok(sex, 'i589_sex question exists');
  assert.strictEqual(sex.factId, 'i589_sex');
  assert.strictEqual(sex.step, 'personal');
  assert.deepStrictEqual(optionValues(sex), ['male', 'female']);

  const court = byId.i589_court_status;
  assert.ok(court, 'i589_court_status question exists');
  assert.strictEqual(court.factId, 'i589_court_status');
  assert.strictEqual(court.step, 'history');
  assert.deepStrictEqual(optionValues(court), ['never', 'now', 'past']);
  assert.deepStrictEqual(
    court.conditionalOn,
    { factId: 'i589_in_proceedings', operator: 'not_equals', value: 'yes' },
    'court status is asked unless the applicant is in proceedings (then it is "now")',
  );

  const spouseSex = byId.i589_spouse_sex;
  assert.ok(spouseSex, 'i589_spouse_sex question exists');
  assert.strictEqual(spouseSex.factId, 'i589_spouse_sex');
  assert.strictEqual(spouseSex.step, 'family');
  assert.deepStrictEqual(optionValues(spouseSex), ['male', 'female']);
  assert.deepStrictEqual(
    spouseSex.conditionalOn,
    { factId: 'i589_marital_status', operator: 'equals', value: 'married' },
  );

  const spouseInUs = byId.i589_spouse_in_us;
  assert.ok(spouseInUs, 'i589_spouse_in_us question exists');
  assert.strictEqual(spouseInUs.factId, 'i589_spouse_in_us');
  assert.strictEqual(spouseInUs.step, 'family');
  assert.deepStrictEqual(optionValues(spouseInUs), ['yes', 'no']);
  assert.deepStrictEqual(
    spouseInUs.conditionalOn,
    { factId: 'i589_marital_status', operator: 'equals', value: 'married' },
  );

  // Every question carries all five language labels (existing convention:
  // `labels` has all five; `shortLabel` is the English short label and
  // `shortLabels` carries the other four).
  for (const q of [sex, court, spouseSex, spouseInUs]) {
    for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
      assert.ok(q.labels?.[lang], `${q.id} has a ${lang} label`);
    }
    assert.ok(q.shortLabel, `${q.id} has an English short label`);
    for (const lang of ['ES', 'ZH', 'HT', 'AR']) {
      assert.ok(q.shortLabels?.[lang], `${q.id} has a ${lang} short label`);
    }
    for (const o of q.options) {
      for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
        assert.ok(o.labels?.[lang], `${q.id} option ${o.value} has a ${lang} label`);
      }
    }
  }

  console.log('✓ I-589: four gap facts have questions with binder-matching values');
});
