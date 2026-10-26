import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFactRecord, upsertFact, confirmFact, resolveConflict,
  markOutputsFresh, getBlockingIssues, projectForForm, sanitizeFactRecord,
} from './facts.js';

const T = '2026-10-21T00:00:00.000Z';

describe('canonical fact record', () => {
  it('answer-sourced fact is consumer-reported', () => {
    const r = createFactRecord(T);
    const f = upsertFact(r, { id: 'full_name', value: 'Test Alpha', source: 'answer' }, T);
    assert.equal(f.status, 'reported');
    assert.equal(f.needsConfirmation, false);
  });

  it('document-extracted fact is unconfirmed, never verified', () => {
    const r = createFactRecord(T);
    const f = upsertFact(r, {
      id: 'date_of_birth', value: '1990-05-01', source: 'document',
      sourceRef: { documentId: 'doc1', page: 1 }, confidence: 0.9,
    }, T);
    assert.equal(f.status, 'extracted-unconfirmed');
    assert.equal(f.needsConfirmation, true);
    assert.equal(f.sourceRef.page, 1);
  });

  it('refuses to set verified from consumer/document input', () => {
    const r = createFactRecord(T);
    assert.throws(() => upsertFact(r, { id: 'x', value: 'y', source: 'answer', status: 'verified' }, T));
  });

  it('document agreeing with an answer does NOT verify it', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'entry_date', value: '2023-01-15', source: 'answer' }, T);
    const f = upsertFact(r, { id: 'entry_date', value: '2023-01-15', source: 'document', sourceRef: { documentId: 'i94' } }, T);
    assert.equal(f.status, 'reported'); // unchanged — corroboration ≠ verification
  });

  it('disagreement between answer and document creates a traceable conflict', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'date_of_birth', value: '1990-05-01', source: 'answer' }, T);
    const f = upsertFact(r, { id: 'date_of_birth', value: '1990-05-02', source: 'document', sourceRef: { documentId: 'passport', page: 1 } }, T);
    assert.equal(f.status, 'conflicting');
    assert.equal(f.value, '1990-05-01'); // primary preserved
    assert.equal(f.alternatives.length, 1);
    assert.equal(f.alternatives[0].value, '1990-05-02');
    assert.equal(f.history.length, 1); // prior state traceable
  });

  it('consumer correction wins, clears conflict, marks outputs stale', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'date_of_birth', value: '1990-05-01', source: 'answer' }, T);
    upsertFact(r, { id: 'date_of_birth', value: '1990-05-02', source: 'document' }, T);
    const f = upsertFact(r, { id: 'date_of_birth', value: '1990-05-02', source: 'correction' }, T);
    assert.equal(f.status, 'reported');
    assert.equal(f.value, '1990-05-02');
    assert.equal(f.alternatives.length, 0);
    assert.equal(r.outputsStale, true);
    markOutputsFresh(r, T);
    assert.equal(r.outputsStale, false);
  });

  it('resolveConflict picks the chosen source value as a correction', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'full_name', value: 'Test Alpha', source: 'answer' }, T);
    upsertFact(r, { id: 'full_name', value: 'Alpha Test', source: 'document' }, T);
    const f = resolveConflict(r, 'full_name', 'document', T);
    assert.equal(f.value, 'Alpha Test');
    assert.equal(f.status, 'reported');
    assert.equal(f.source, 'correction');
  });

  it('confirmFact turns extracted-unconfirmed into reported (not verified)', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'passport_number', value: 'X1234567', source: 'document', confidence: 0.8 }, T);
    const f = confirmFact(r, 'passport_number', T);
    assert.equal(f.status, 'reported');
    assert.equal(f.needsConfirmation, false);
  });

  it('getBlockingIssues surfaces conflicts and unconfirmed required facts', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'a', value: '1', source: 'answer' }, T);
    upsertFact(r, { id: 'a', value: '2', source: 'document' }, T);
    const issues = getBlockingIssues(r);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'conflict');
  });

  it('projectForForm separates populated / unconfirmed / missing / conflicts', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'full_name', value: 'Test Alpha', source: 'answer' }, T);
    upsertFact(r, { id: 'date_of_birth', value: '1990-05-01', source: 'document' }, T);
    const entry = {
      id: 'I-TEST',
      fields: [
        { pdfField: 'name', factId: 'full_name', required: true },
        { pdfField: 'dob', factId: 'date_of_birth', required: true },
        { pdfField: 'a#', factId: 'a_number', required: true },
      ],
    };
    const p = projectForForm(r, entry);
    assert.equal(p.populated.length, 1);
    assert.equal(p.unconfirmed.length, 1);
    assert.equal(p.missing.length, 1);
    assert.equal(p.conflicts.length, 0);
  });

  it('sanitizeFactRecord drops client-claimed verified facts', () => {
    const clean = sanitizeFactRecord({
      facts: {
        full_name: { value: 'Test', source: 'answer', status: 'verified' },
        entry_date: { value: '2023-01-15', source: 'answer', status: 'reported' },
      },
    });
    assert.equal(clean.facts.full_name, undefined);
    assert.equal(clean.facts.entry_date.value, '2023-01-15');
  });

  it('sanitizeFactRecord returns null for non-objects', () => {
    assert.equal(sanitizeFactRecord(null), null);
    assert.equal(sanitizeFactRecord('nope'), null);
  });
});

describe('phantom-conflict fix 2026-10-24: case-only agreement', () => {
  it('questionnaire "female" + document "Female" is agreement, not a conflict', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'gender', value: 'female', source: 'answer' }, T);
    const f = upsertFact(r, { id: 'gender', value: 'Female', source: 'document', sourceRef: { documentType: 'birth_record', page: 1 } }, T);
    assert.equal(f.status, 'reported'); // unchanged — same value, different case
    assert.equal(f.value, 'female'); // primary preserved verbatim
    assert.equal(f.alternatives.length, 0);
    assert.equal(f.needsConfirmation, false);
  });

  it('surrounding-whitespace-only difference is also agreement', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'gender', value: 'female', source: 'answer' }, T);
    const f = upsertFact(r, { id: 'gender', value: ' Female ', source: 'document' }, T);
    assert.equal(f.status, 'reported');
    assert.equal(f.alternatives.length, 0);
  });

  it('genuine contradiction still conflicts with provenance intact', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'gender', value: 'female', source: 'answer' }, T);
    const f = upsertFact(r, { id: 'gender', value: 'male', source: 'document', sourceRef: { documentType: 'passport', page: 1 } }, T);
    assert.equal(f.status, 'conflicting');
    assert.equal(f.value, 'female');
    assert.equal(f.alternatives.length, 1);
    assert.equal(f.alternatives[0].value, 'male');
    assert.equal(f.alternatives[0].source, 'document');
    assert.equal(f.history.length, 1);
  });

  it('already-conflicting fact does not accumulate a case-variant duplicate alternative', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'gender', value: 'female', source: 'answer' }, T);
    upsertFact(r, { id: 'gender', value: 'male', source: 'document' }, T);
    const f = upsertFact(r, { id: 'gender', value: 'Male', source: 'document' }, T);
    assert.equal(f.status, 'conflicting');
    assert.equal(f.alternatives.length, 1);
    assert.equal(f.alternatives[0].value, 'male');
  });

  it('correction after case-agreement still wins and marks outputs stale', () => {
    const r = createFactRecord(T);
    upsertFact(r, { id: 'gender', value: 'female', source: 'answer' }, T);
    upsertFact(r, { id: 'gender', value: 'Female', source: 'document' }, T);
    const f = upsertFact(r, { id: 'gender', value: 'male', source: 'correction' }, T);
    assert.equal(f.status, 'reported');
    assert.equal(f.value, 'male');
    assert.equal(f.alternatives.length, 0);
    assert.equal(r.outputsStale, true);
  });
});
