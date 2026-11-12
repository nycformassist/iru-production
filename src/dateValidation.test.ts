/**
 * src/dateValidation.test.ts — Unit tests for the inline date-entry
 * warnings (src/dateValidation.ts).
 *
 * Run with: npx tsx --test src/dateValidation.test.ts
 *
 * Dates are computed relative to "today" so the suite stays green
 * over time; the 2027-01-15 value from the 2026-11-12 live walk is
 * also asserted literally while it is still in the future.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateEntryWarning, parseDateInput, isDobQuestion, isEntryDateQuestion } from './dateValidation.js';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

test('isDobQuestion / isEntryDateQuestion classify the real question ids', () => {
  for (const id of ['date_of_birth', 'dob', 'i589_dob', 'i765_dob', 'n400_dob', 'i485_dob', 'i130_pet_dob', 'i485_principal_dob']) {
    assert.equal(isDobQuestion(id), true, id);
  }
  for (const id of ['entry_date', 'last_entry', 'i589_entry_date', 'i765_last_entry', 'i485_last_entry']) {
    assert.equal(isEntryDateQuestion(id), true, id);
  }
  assert.equal(isDobQuestion('full_name'), false);
  assert.equal(isEntryDateQuestion('full_name'), false);
  assert.equal(isDobQuestion('i589_entry_date'), false);
  assert.equal(isEntryDateQuestion('i589_dob'), false);
});

test('parseDateInput parses the input formats as local dates', () => {
  const d = parseDateInput('2027-01-15');
  assert.ok(d);
  assert.equal(d.getFullYear(), 2027);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 15);
  assert.equal(iso(parseDateInput('01/15/2027')!), '2027-01-15');
  assert.equal(iso(parseDateInput('2024-02')!), '2024-02-01');
  assert.equal(iso(parseDateInput('02/29/2024')!), '2024-02-29');
});

test('parseDateInput rejects empty, garbage, and rolled-over dates', () => {
  assert.equal(parseDateInput(''), null);
  assert.equal(parseDateInput('not-a-date'), null);
  assert.equal(parseDateInput('2023-02-31'), null);
  assert.equal(parseDateInput('2023-02-30'), null);
  assert.equal(parseDateInput('02/29/2023'), null);
  assert.equal(parseDateInput('13/01/2020'), null);
  assert.equal(parseDateInput('2020-13-01'), null);
  assert.equal(parseDateInput(null), null);
  assert.equal(parseDateInput({ value: '2020-01-01' }), null);
});

test('future date of birth warns (the 2026-11-12 live-walk case)', () => {
  // The walk typed 2027-01-15 as a date of birth and it was accepted
  // silently; the assertions below use dates computed from "today" so
  // the suite stays green over time.
  assert.equal(dateEntryWarning('i589_dob', daysFromNow(400), {}), 'future-dob');
  assert.equal(dateEntryWarning('date_of_birth', daysFromNow(1), {}), 'future-dob');
  assert.equal(dateEntryWarning('i765_dob', daysFromNow(365), {}), 'future-dob');
  // MM/DD/YYYY form, computed so the suite stays green over time.
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const mdy = `${future.getMonth() + 1}/${future.getDate()}/${future.getFullYear()}`;
  assert.equal(dateEntryWarning('n400_dob', mdy, {}), 'future-dob');
});

test('past or present date of birth does not warn', () => {
  assert.equal(dateEntryWarning('i589_dob', '1990-05-20', {}), null);
  assert.equal(dateEntryWarning('date_of_birth', daysFromNow(0), {}), null);
  assert.equal(dateEntryWarning('i765_dob', daysFromNow(-1), {}), null);
});

test('entry date before the date of birth warns (phase + Tier 1 ids)', () => {
  assert.equal(
    dateEntryWarning('entry_date', '2010-01-01', { date_of_birth: '2015-06-01' }),
    'entry-before-dob',
  );
  assert.equal(
    dateEntryWarning('i589_entry_date', '2010-01-01', { i589_dob: '2015-06-01' }),
    'entry-before-dob',
  );
  assert.equal(
    dateEntryWarning('i765_last_entry', '2000-01-01', { i765_dob: '1990-01-01' }),
    null,
  );
  assert.equal(
    dateEntryWarning('i765_last_entry', '1980-01-01', { i765_dob: '1990-01-01' }),
    'entry-before-dob',
  );
  assert.equal(
    dateEntryWarning('i485_last_entry', '2010-01-01', { i485_dob: '2015-06-01' }),
    'entry-before-dob',
  );
});

test('entry date on or after the date of birth does not warn', () => {
  assert.equal(dateEntryWarning('entry_date', '2015-06-01', { date_of_birth: '2015-06-01' }), null);
  assert.equal(dateEntryWarning('i589_entry_date', '2020-01-01', { i589_dob: '1990-01-01' }), null);
});

test('entry date with no date of birth on file does not warn', () => {
  assert.equal(dateEntryWarning('entry_date', '2010-01-01', {}), null);
  assert.equal(dateEntryWarning('i765_last_entry', '1980-01-01', { i765_dob: 'not-a-date' }), null);
});

test('entry check prefers the applicant DOB over spouse/other DOBs', () => {
  // i485_other_dob_1 is 2010; the applicant i485_dob is 1990. An
  // entry of 2000 is after the applicant's birth (no warning) even
  // though it is before the other person's birth.
  assert.equal(
    dateEntryWarning('i485_last_entry', '2000-01-01', { i485_other_dob_1: '2010-01-01', i485_dob: '1990-01-01' }),
    null,
  );
  assert.equal(
    dateEntryWarning('i485_last_entry', '1980-01-01', { i485_other_dob_1: '2010-01-01', i485_dob: '1990-01-01' }),
    'entry-before-dob',
  );
});

test('non-date questions never warn', () => {
  assert.equal(dateEntryWarning('full_name', '2027-01-15', {}), null);
  assert.equal(dateEntryWarning('country_of_birth', '2027-01-15', {}), null);
});
