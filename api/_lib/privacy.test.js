import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAnswers, minimizeForModel, droppedFieldNames,
  MAX_NARRATIVE_CHARS, MAX_TEXT_FIELD_CHARS,
} from './privacy.js';

describe('sanitizeAnswers', () => {
  it('accepts a clean allowlisted payload', () => {
    const r = sanitizeAnswers({ country_of_origin: 'Colombia', case_type: 'asylum', has_passport: 'yes' });
    assert.equal(r.ok, true);
    assert.equal(r.answers.country_of_origin, 'Colombia');
  });

  it('drops a_number, zip_code, full_name and unknown fields (names recorded, values never)', () => {
    const r = sanitizeAnswers({
      country_of_origin: 'Haiti', a_number: 'A123456789',
      zip_code: '10451', full_name: 'Jane Doe', evil: 'x',
    });
    assert.equal(r.ok, true);
    assert.ok(!('a_number' in r.answers));
    assert.ok(!('zip_code' in r.answers));
    assert.ok(!('full_name' in r.answers));
    assert.ok(!('evil' in r.answers));
    const dropped = droppedFieldNames(r.answers);
    assert.ok(dropped.includes('a_number'));
    assert.ok(dropped.includes('full_name'));
  });

  it('rejects non-object answers', () => {
    assert.equal(sanitizeAnswers(null).ok, false);
    assert.equal(sanitizeAnswers('x').ok, false);
    assert.equal(sanitizeAnswers([]).ok, false);
  });

  it('rejects non-string field values', () => {
    const r = sanitizeAnswers({ has_passport: true });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /must be a string/);
  });

  it('enforces narrative length cap', () => {
    const r = sanitizeAnswers({ narrative_text: 'x'.repeat(MAX_NARRATIVE_CHARS + 1) });
    assert.equal(r.ok, false);
  });

  it('enforces text field length cap', () => {
    const r = sanitizeAnswers({ country_of_origin: 'x'.repeat(MAX_TEXT_FIELD_CHARS + 1) });
    assert.equal(r.ok, false);
  });
});

describe('minimizeForModel', () => {
  it('never includes a name, A-number, or zip', () => {
    const min = minimizeForModel({ country_of_origin: 'El Salvador', entry_date: '2021-03-15', case_type: 'asylum' }, []);
    const blob = JSON.stringify(min);
    assert.ok(!blob.includes('Jane'));
    assert.ok(!blob.includes('A123'));
    assert.ok(!blob.includes('10451'));
    assert.equal(min.applicantRef, 'the applicant');
  });

  it('generalizes entry date to year + recency band', () => {
    const min = minimizeForModel({ entry_date: '2020-06-01' }, []);
    assert.equal(min.entryYear, '2020');
    assert.ok(['<1y', '1-5y', '>5y'].includes(min.entryRecency));
    assert.equal(min.entryDateFlag, null);
    assert.ok(!JSON.stringify(min).includes('2020-06-01'));
  });

  it('flags future entry dates instead of trusting them', () => {
    const min = minimizeForModel({ entry_date: '2099-01-01' }, []);
    assert.equal(min.entryDateFlag, 'future-date');
  });

  it('flags unparseable entry dates', () => {
    const min = minimizeForModel({ entry_date: 'sometime last spring' }, []);
    assert.equal(min.entryDateFlag, 'unparseable');
    assert.equal(min.entryYear, 'Unknown');
  });

  it('normalizes unknown case types to asylum (no silent new categories)', () => {
    const min = minimizeForModel({ case_type: 'visa-lottery' }, []);
    assert.equal(min.caseType, 'asylum');
  });

  it('caps narrative starters', () => {
    const starters = Array.from({ length: 50 }, (_, i) => `s${i}`);
    const min = minimizeForModel({}, starters);
    assert.ok(min.narrativeStarters.length <= 20);
  });

  it('ignores non-string starters', () => {
    const min = minimizeForModel({}, ['ok', 42, null]);
    assert.deepEqual(min.narrativeStarters, ['ok']);
  });

  it('scrubs identifier patterns from narrative text', () => {
    const min = minimizeForModel({
      narrative_text: 'I am Maria Santos, A-number A123456789, SSN 123-45-6789, phone 212-555-0147, email a@b.com',
    }, []);
    assert.ok(!min.narrativeText.includes('A123456789'));
    assert.ok(!min.narrativeText.includes('123-45-6789'));
    assert.ok(!min.narrativeText.includes('212-555-0147'));
    assert.ok(!min.narrativeText.includes('a@b.com'));
    assert.ok(min.narrativeText.includes('[A-NUMBER REDACTED]'));
    assert.ok(min.narrativeText.includes('[PHONE REDACTED]'));
    // Non-pattern content (including names) is preserved — UI warns separately
    assert.ok(min.narrativeText.includes('Maria Santos'));
  });

  it('scrubNarrative handles empty/non-string safely', async () => {
    const { scrubNarrative } = await import('./privacy.js');
    assert.equal(scrubNarrative(''), '');
    assert.equal(scrubNarrative(null), '');
  });
});
