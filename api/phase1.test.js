/**
 * api/phase1.test.js — Phase 1 shared platform tests.
 *
 * Tests for: repeating groups, person records, conditional logic, validators.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Groups
import { createGroups, addGroupItem, updateGroupItem, removeGroupItem, getGroupItems, GROUP_DEFINITIONS } from './_lib/groups.js';

// Persons
import { createPersons, addPerson, updatePerson, removePerson, getPersonsByRole, getSpouse, getChildrenSplit } from './_lib/persons.js';

// Conditions
import { evaluateCondition, appliesWhen, filterApplicable } from './_lib/conditions.js';

// Validators
import { validateField, normalizeField, normalizeDateMDY, normalizeDigits } from './_lib/validators.js';

describe('repeating groups', () => {
  it('creates empty groups container', () => {
    const groups = createGroups();
    assert.deepEqual(groups, {});
  });

  it('adds an entry to the entries group', () => {
    const groups = createGroups();
    const itemId = addGroupItem(groups, 'entries', {
      entry_date: '2023-03-10',
      entry_place: 'JFK',
    });
    assert.ok(itemId, 'returns itemId');
    const items = getGroupItems(groups, 'entries');
    assert.equal(items.length, 1);
    assert.equal(items[0].fields.entry_date, '2023-03-10');
    assert.equal(items[0].fields.entry_place, 'JFK');
  });

  it('adds multiple entries (repeating)', () => {
    const groups = createGroups();
    addGroupItem(groups, 'entries', { entry_date: '2020-01-15' });
    addGroupItem(groups, 'entries', { entry_date: '2023-03-10' });
    const items = getGroupItems(groups, 'entries');
    assert.equal(items.length, 2);
    assert.equal(items[0].fields.entry_date, '2020-01-15');
    assert.equal(items[1].fields.entry_date, '2023-03-10');
  });

  it('updates a group item field', () => {
    const groups = createGroups();
    const itemId = addGroupItem(groups, 'entries', { entry_date: '2023-03-10' });
    updateGroupItem(groups, 'entries', itemId, 'entry_place', 'Newark');
    const items = getGroupItems(groups, 'entries');
    assert.equal(items[0].fields.entry_place, 'Newark');
  });

  it('removes a group item', () => {
    const groups = createGroups();
    const itemId = addGroupItem(groups, 'entries', { entry_date: '2023-03-10' });
    assert.equal(removeGroupItem(groups, 'entries', itemId), true);
    assert.equal(getGroupItems(groups, 'entries').length, 0);
  });

  it('rejects unknown group', () => {
    const groups = createGroups();
    assert.throws(() => addGroupItem(groups, 'nonexistent', {}), /unknown group/);
  });

  it('group definitions exist for all Phase 1 groups', () => {
    assert.ok(GROUP_DEFINITIONS.entries, 'entries defined');
    assert.ok(GROUP_DEFINITIONS.other_names, 'other_names defined');
    assert.ok(GROUP_DEFINITIONS.addresses, 'addresses defined');
    assert.ok(GROUP_DEFINITIONS.employment, 'employment defined');
    assert.ok(GROUP_DEFINITIONS.education, 'education defined');
  });
});

describe('person records', () => {
  it('creates empty persons container', () => {
    const persons = createPersons();
    assert.deepEqual(persons, {});
  });

  it('adds a spouse', () => {
    const persons = createPersons();
    const id = addPerson(persons, 'spouse', {
      full_name: 'Juan Rodriguez',
      date_of_birth: '1988-07-20',
    });
    assert.ok(id, 'returns personId');
    const spouse = getSpouse(persons);
    assert.ok(spouse, 'spouse found');
    assert.equal(spouse.facts.full_name, 'Juan Rodriguez');
  });

  it('adds multiple children', () => {
    const persons = createPersons();
    addPerson(persons, 'child', { full_name: 'Child One' });
    addPerson(persons, 'child', { full_name: 'Child Two' });
    const children = getPersonsByRole(persons, 'child');
    assert.equal(children.length, 2);
  });

  it('splits children into inline and supplement (max 4 inline)', () => {
    const persons = createPersons();
    for (let i = 1; i <= 6; i++) {
      addPerson(persons, 'child', { full_name: `Child ${i}` });
    }
    const split = getChildrenSplit(persons);
    assert.equal(split.inline.length, 4, '4 inline');
    assert.equal(split.supplement.length, 2, '2 supplement');
    assert.equal(split.needsSupplementA, true);
  });

  it('no supplement needed for 4 or fewer children', () => {
    const persons = createPersons();
    addPerson(persons, 'child', { full_name: 'Child 1' });
    const split = getChildrenSplit(persons);
    assert.equal(split.needsSupplementA, false);
  });

  it('updates a person field', () => {
    const persons = createPersons();
    const id = addPerson(persons, 'spouse', { full_name: 'Juan' });
    updatePerson(persons, id, 'full_name', 'Juan Carlos Rodriguez');
    assert.equal(persons[id].facts.full_name, 'Juan Carlos Rodriguez');
  });

  it('removes a person', () => {
    const persons = createPersons();
    const id = addPerson(persons, 'child', { full_name: 'Child' });
    assert.equal(removePerson(persons, id), true);
    assert.equal(getPersonsByRole(persons, 'child').length, 0);
  });

  it('rejects unknown role', () => {
    const persons = createPersons();
    assert.throws(() => addPerson(persons, 'cousin', {}), /unknown role/);
  });
});

describe('conditional logic', () => {
  it('no condition always applies', () => {
    assert.equal(appliesWhen(null, {}), true);
    assert.equal(appliesWhen(undefined, {}), true);
  });

  it('equals condition', () => {
    const cond = { fact: 'marital_status', operator: 'equals', value: 'married' };
    assert.equal(evaluateCondition(cond, { marital_status: 'married' }), true);
    assert.equal(evaluateCondition(cond, { marital_status: 'single' }), false);
  });

  it('not_equals condition', () => {
    const cond = { fact: 'marital_status', operator: 'not_equals', value: 'married' };
    assert.equal(evaluateCondition(cond, { marital_status: 'single' }), true);
    assert.equal(evaluateCondition(cond, { marital_status: 'married' }), false);
  });

  it('in condition', () => {
    const cond = { fact: 'status', operator: 'in', value: ['a', 'b'] };
    assert.equal(evaluateCondition(cond, { status: 'a' }), true);
    assert.equal(evaluateCondition(cond, { status: 'c' }), false);
  });

  it('exists condition', () => {
    const cond = { fact: 'phone', operator: 'exists' };
    assert.equal(evaluateCondition(cond, { phone: '2125550147' }), true);
    assert.equal(evaluateCondition(cond, { phone: '' }), false);
    assert.equal(evaluateCondition(cond, {}), false);
  });

  it('AND compound condition', () => {
    const cond = {
      and: [
        { fact: 'a', operator: 'equals', value: '1' },
        { fact: 'b', operator: 'equals', value: '2' },
      ],
    };
    assert.equal(evaluateCondition(cond, { a: '1', b: '2' }), true);
    assert.equal(evaluateCondition(cond, { a: '1', b: '3' }), false);
  });

  it('OR compound condition', () => {
    const cond = {
      or: [
        { fact: 'a', operator: 'equals', value: '1' },
        { fact: 'b', operator: 'equals', value: '2' },
      ],
    };
    assert.equal(evaluateCondition(cond, { a: '1' }), true);
    assert.equal(evaluateCondition(cond, { b: '2' }), true);
    assert.equal(evaluateCondition(cond, { a: '9', b: '9' }), false);
  });

  it('filterApplicable returns only matching items', () => {
    const items = [
      { id: '1', appliesWhen: { fact: 'x', operator: 'equals', value: 'yes' } },
      { id: '2', appliesWhen: null },
      { id: '3', appliesWhen: { fact: 'x', operator: 'equals', value: 'no' } },
    ];
    const result = filterApplicable(items, { x: 'yes' });
    assert.equal(result.length, 2);
    assert.ok(result.find(i => i.id === '1'));
    assert.ok(result.find(i => i.id === '2'));
  });

  it('spouse condition: married', () => {
    const cond = { fact: 'marital_status', operator: 'equals', value: 'married' };
    assert.equal(appliesWhen(cond, { marital_status: 'married' }), true);
    assert.equal(appliesWhen(cond, { marital_status: 'single' }), false);
    assert.equal(appliesWhen(cond, { marital_status: 'divorced' }), false);
  });

  it('mailing address condition: Item 6 = no', () => {
    const cond = { fact: 'mailing_same_as_residence', operator: 'equals', value: 'no' };
    assert.equal(appliesWhen(cond, { mailing_same_as_residence: 'no' }), true);
    assert.equal(appliesWhen(cond, { mailing_same_as_residence: 'yes' }), false);
  });
});

describe('validators and normalizers', () => {
  it('normalizeDigits strips non-digits', () => {
    assert.equal(normalizeDigits('212-555-0147'), '2125550147');
    assert.equal(normalizeDigits('(212) 555-0147'), '2125550147');
  });

  it('normalizeDateMDY converts ISO to MDY', () => {
    assert.equal(normalizeDateMDY('1990-05-15'), '05/15/1990');
    assert.equal(normalizeDateMDY('05/15/1990'), '05/15/1990');
    assert.equal(normalizeDateMDY('05-15-1990'), '05/15/1990');
  });

  it('validateField phone accepts 10 digits', () => {
    assert.equal(validateField('phone', '2125550147').valid, true);
    assert.equal(validateField('phone', '(212) 555-0147').valid, true);
    assert.equal(validateField('phone', '123').valid, false);
  });

  it('validateField date accepts MM/DD/YYYY', () => {
    assert.equal(validateField('date', '05/15/1990').valid, true);
    assert.equal(validateField('date', '1990-05-15').valid, true);
    assert.equal(validateField('date', 'not-a-date').valid, false);
  });

  it('validateField zip accepts 5 digits', () => {
    assert.equal(validateField('zip', '10451').valid, true);
    assert.equal(validateField('zip', '10451-1234').valid, true);
    assert.equal(validateField('zip', '123').valid, false);
  });

  it('validateField a_number accepts 8-9 digits', () => {
    assert.equal(validateField('a_number', '123456789').valid, true);
    assert.equal(validateField('a_number', 'A123456789').valid, true);
    assert.equal(validateField('a_number', '123').valid, false);
  });

  it('validateField email basic check', () => {
    assert.equal(validateField('email', 'test@example.com').valid, true);
    assert.equal(validateField('email', 'not-an-email').valid, false);
  });

  it('validateField empty always passes (optional)', () => {
    assert.equal(validateField('phone', '').valid, true);
    assert.equal(validateField('date', null).valid, true);
  });

  it('normalizeField phone strips formatting', () => {
    assert.equal(normalizeField('phone', '(212) 555-0147'), '2125550147');
  });

  it('normalizeField date converts to MDY', () => {
    assert.equal(normalizeField('date', '1990-05-15'), '05/15/1990');
  });

  it('unknown field type passes validation', () => {
    assert.equal(validateField('unknown_type', 'anything').valid, true);
    assert.equal(normalizeField('unknown_type', 'value'), 'value');
  });
});
