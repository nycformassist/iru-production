/**
 * narrative.test.js — Personal Narrative as a first-class stage
 * (successive directive §4 + §11 scenarios). Tests the FULL path:
 * input → fact reconciliation → draft → correction → approval →
 * form reuse — not merely that text renders.
 *
 * Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFactRecord, upsertFact, sanitizeFactRecord,
} from './_lib/facts.js';
import {
  createNarrative, addNarrativeEvent, confirmNarrativeEvent,
  correctNarrativeEvent, analyzeNarrative, approveNarrative,
  isNarrativeApproved, narrativeForPacket, parseEventDate, sanitizeNarrative,
} from './_lib/narrative.js';
import { buildFillPlan } from './_lib/formmap.js';
import { getFormEntry } from './_lib/forms/registry.js';

const NOW = '2026-10-21T12:00:00.000Z';

/** Applicant "Ana Ejemplo" (fictional): answers + her own narrative. */
function anaRecord() {
  const rec = createFactRecord(NOW);
  upsertFact(rec, { id: 'full_name', value: 'Ana Ejemplo', source: 'answer' }, NOW);
  upsertFact(rec, { id: 'entry_date', value: '2023-03-14', source: 'answer', type: 'date' }, NOW);
  // Stated in her narrative, not in a form field: where she entered.
  upsertFact(rec, { id: 'entry_place', value: 'San Ysidro, CA', source: 'narrative' }, NOW);
  return rec;
}

function anaNarrative() {
  const n = createNarrative(NOW);
  addNarrativeEvent(n, {
    id: 'e1',
    text: 'I left my hometown after receiving threats at my shop in early 2021.',
    date: '2021-02-10', factIds: [],
  }, NOW);
  addNarrativeEvent(n, {
    id: 'e2',
    text: 'I entered the United States and presented myself to officers at the port of entry.',
    date: '2023-03-14', factIds: ['entry_date'],
  }, NOW);
  return n;
}

test('chronology: dated events sorted ascending, undated last in given order, text verbatim', () => {
  const n = createNarrative(NOW);
  addNarrativeEvent(n, { id: 'b', text: 'Second event in time, written first by the applicant here.', date: '2022-06-01' }, NOW);
  addNarrativeEvent(n, { id: 'a', text: 'First event in time, written second by the applicant here.', date: '2020-01-15' }, NOW);
  addNarrativeEvent(n, { id: 'u', text: 'An event the applicant has not dated yet at all.', date: null }, NOW);
  const { chronology, issues } = analyzeNarrative(n, createFactRecord(NOW));
  assert.deepEqual(chronology.map((e) => e.id), ['a', 'b', 'u']);
  // Verbatim: analysis never rewrites the applicant's words.
  assert.equal(chronology[0].text, 'First event in time, written second by the applicant here.');
  assert.ok(issues.some((i) => i.kind === 'missing-date' && i.eventId === 'u' && i.blocking));
});

test('issues: missing date, unclear event, unexplained gap, unconfirmed document event', () => {
  const n = createNarrative(NOW);
  addNarrativeEvent(n, { id: 'g1', text: 'I was living in my hometown and working at the market.', date: '2018-05-01' }, NOW);
  addNarrativeEvent(n, { id: 'g2', text: 'I arrived in the United States and stayed with my cousin.', date: '2023-03-14' }, NOW);
  addNarrativeEvent(n, { id: 'short', text: 'Bad things.', date: '2023-04-01' }, NOW);
  addNarrativeEvent(n, {
    id: 'doc', text: 'Document states the applicant reported to an office on 2023-05-02 for processing.',
    date: '2023-05-02', origin: 'document-extracted', sourceRef: { documentType: 'notice', page: 1 },
  }, NOW);
  const { issues } = analyzeNarrative(n, createFactRecord(NOW));
  const kinds = issues.map((i) => i.kind);
  assert.ok(kinds.includes('unexplained-gap'), 'gap > 18 months flagged, not filled in');
  assert.ok(kinds.includes('unclear-event'), 'very short event flagged as unclear');
  assert.ok(kinds.includes('unconfirmed-document-event'), 'document event must be confirmed by applicant');
  // Every issue carries a focused question; nothing is auto-resolved.
  assert.ok(issues.every((i) => typeof i.question === 'string' && i.question.length > 10));
});

test('reconciliation: narrative date inconsistent with the fact record is flagged, never overwritten', () => {
  const rec = anaRecord(); // entry_date on record: 2023-03-14
  const n = createNarrative(NOW);
  addNarrativeEvent(n, {
    id: 'x', text: 'I entered the United States through the port of entry that morning.',
    date: '2023-03-20', factIds: ['entry_date'],
  }, NOW);
  const { issues } = analyzeNarrative(n, rec);
  assert.ok(issues.some((i) => i.kind === 'date-inconsistency' && i.factId === 'entry_date' && i.blocking));
  // Neither side was silently changed.
  assert.equal(rec.facts.entry_date.value, '2023-03-14');
  assert.equal(n.events[0].date, '2023-03-20');
});

test('reconciliation: a conflicting fact linked to an event blocks approval until resolved', () => {
  const rec = anaRecord();
  upsertFact(rec, { id: 'entry_date', value: '2023-03-20', source: 'document', sourceRef: { documentType: 'I-94', page: 1 } }, NOW);
  assert.equal(rec.facts.entry_date.status, 'conflicting');
  const n = anaNarrative();
  const { issues } = analyzeNarrative(n, rec);
  assert.ok(issues.some((i) => i.kind === 'fact-conflict' && i.blocking));
  assert.throws(() => approveNarrative(n, rec, NOW), /approval refused/);
});

test('form gate: narrative-sourced facts are NOT used before applicant approval', () => {
  const rec = anaRecord();
  rec.narrative = anaNarrative(); // status: draft/needs-review — not approved
  const plan = buildFillPlan(rec, getFormEntry('I-765'));
  assert.ok(!plan.fill.some((f) => f.factId === 'entry_place'), 'entry_place must not be filled pre-approval');
  const held = plan.needsConfirmation.find((f) => f.factId === 'entry_place');
  assert.ok(held && held.reason === 'narrative-not-approved');
  // And it is not "missing" either — IRU does not re-ask what the applicant already stated.
  assert.ok(!plan.missing.some((f) => f.factId === 'entry_place'));
});

test('full path: input → reconciliation → draft → correction → approval → form reuse', () => {
  const rec = anaRecord();
  const n = anaNarrative();
  // One event starts undated (missing-date blocks approval).
  addNarrativeEvent(n, { id: 'e3', text: 'I reported to the immigration office as instructed.', date: null }, NOW);
  rec.narrative = n;
  assert.throws(() => approveNarrative(n, rec, NOW), /missing-date/);

  // Applicant corrects: supplies the date in her own words.
  correctNarrativeEvent(n, rec, 'e3', { date: '2023-04-02' }, NOW);
  assert.equal(rec.outputsStale, true, 'correction marks derived outputs stale');
  const after = analyzeNarrative(n, rec);
  assert.ok(!after.issues.some((i) => i.blocking), 'no blocking issues remain after correction');

  // Applicant approves.
  approveNarrative(n, rec, NOW);
  assert.ok(isNarrativeApproved(n));

  // Form reuse: the narrative-stated fact now fills I-765 Item 22 with
  // no re-asking, through the SANITIZED server-side record (the path
  // /api/generate-form actually takes).
  const serverRec = sanitizeFactRecord(JSON.parse(JSON.stringify(rec)));
  assert.ok(isNarrativeApproved(serverRec.narrative), 'approval survives the server sanitizer');
  const plan = buildFillPlan(serverRec, getFormEntry('I-765'));
  const filled = plan.fill.find((f) => f.factId === 'entry_place');
  assert.ok(filled && filled.value === 'San Ysidro, CA');
  assert.ok(!plan.missing.some((f) => f.factId === 'entry_place'));
});

test('correction after approval revokes approval and closes the form gate again', () => {
  const rec = anaRecord();
  const n = anaNarrative();
  rec.narrative = n;
  approveNarrative(n, rec, NOW);
  assert.ok(isNarrativeApproved(n));
  correctNarrativeEvent(n, rec, 'e1', { text: 'I left my hometown after the second threat at my shop in early 2021.' }, NOW);
  assert.equal(n.status, 'needs-review');
  assert.ok(!isNarrativeApproved(n));
  const plan = buildFillPlan(rec, getFormEntry('I-765'));
  assert.ok(!plan.fill.some((f) => f.factId === 'entry_place'));
});

test('document-extracted events: confirmation by the applicant unblocks approval; origin stays traceable', () => {
  const rec = anaRecord();
  const n = anaNarrative();
  addNarrativeEvent(n, {
    id: 'd1', text: 'A notice in the file says a hearing was scheduled for the applicant.',
    date: '2023-06-10', origin: 'document-extracted', sourceRef: { documentType: 'hearing notice', page: 2 },
  }, NOW);
  assert.throws(() => approveNarrative(n, rec, NOW), /unconfirmed-document-event/);
  confirmNarrativeEvent(n, 'd1', NOW);
  approveNarrative(n, rec, NOW);
  const pkt = narrativeForPacket(n, rec);
  assert.equal(pkt.approved, true);
  assert.equal(pkt.chronology.find((c) => c.text.startsWith('A notice')).origin, 'document-extracted');
});

test('no fabrication: approval refuses empty narratives; verified origin cannot be claimed; dates never guessed', () => {
  const rec = anaRecord();
  assert.throws(() => approveNarrative(createNarrative(NOW), rec, NOW), /nothing to approve/);
  const n = createNarrative(NOW);
  assert.throws(() => addNarrativeEvent(n, { text: 'Something happened to the applicant.', origin: 'verified' }, NOW), /reserved/);
  assert.equal(parseEventDate('sometime in March'), null, 'vague dates stay unparsed, not guessed');
  assert.deepEqual(parseEventDate('2023-03'), { iso: '2023-03-01', precision: 'month' });
  // Packet export of an unapproved narrative is labeled DRAFT and unused in forms.
  const n2 = anaNarrative();
  const pkt = narrativeForPacket(n2, rec);
  assert.equal(pkt.approved, false);
  assert.match(pkt.label, /DRAFT/);
});

test('narrative is optional: records without a narrative behave exactly as before', () => {
  const rec = anaRecord(); // no rec.narrative attached
  const plan = buildFillPlan(rec, getFormEntry('I-765'));
  assert.ok(plan.fill.some((f) => f.factId === 'entry_place' && f.value === 'San Ysidro, CA'));
  assert.equal(sanitizeNarrative(null), null);
  assert.equal(narrativeForPacket(null, rec), null);
});

test('sanitizer: client narrative is re-parsed and capped; verified events cannot be smuggled in', () => {
  const clean = sanitizeNarrative({
    status: 'approved', approvedAt: NOW,
    events: [{ id: 's1', text: 'I entered the United States on that date.', date: '03/14/2023', origin: 'verified', factIds: ['entry_date'] }],
  });
  assert.equal(clean.events[0].origin, 'applicant-statement', 'verified origin downgraded — never accepted from input');
  assert.equal(clean.events[0].dateIso, '2023-03-14', 'date re-parsed server-side');
});
