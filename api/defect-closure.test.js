// Defect-closure directive 2026-10-23 — regression tests for:
//  P1: draft↔fact-snapshot binding (stale-draft API safeguard)
//  P2: correction-to-output propagation (precedence + fallback basis)
//  P3: packet resource source + on-screen package (wiring guards)
//  P4: edition manifest vs the committed monitor snapshot fixture
// Synthetic data only. Direct-API tests drive the real HTTP handlers.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

import { createFactRecord, upsertFact, confirmFact, overlayConsumerState, sanitizeFactRecord } from './_lib/facts.js';
import { getFormEntry, FORM_REGISTRY } from './_lib/forms/registry.js';
import { sha256Hex, stableStringify, canonicalDraftSnapshot, computeDraftSnapshotHash, draftFreshness, affectedFormsForMutation } from './_lib/draftIntegrity.js';
import { emptyFormDraftStore, recordDraft, draftForForm, invalidateDrafts, invalidateDraftsForForms } from './_lib/formSelection.js';
import { generateFormDraft, default as generateHandler } from './generate-form.js';
import { buildFillPlan } from './_lib/formmap.js';
import { entitlementStore } from './_lib/entitlement.js';
import { buildGapRecords } from './_lib/evidence.js';
import { fallbackAssessment } from './_lib/prompt.js';
import { minimizeForModel } from './_lib/privacy.js';
import { createNarrative, addNarrativeEvent, approveNarrative } from './_lib/narrative.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const T = '2026-10-23T00:00:00.000Z';

function baseRecord() {
  const r = createFactRecord(T);
  const put = (id, value, source = 'answer') => upsertFact(r, { id, value, source }, T);
  put('family_name', 'Testfamily');
  put('given_name', 'Testgiven');
  put('date_of_birth', '1990-05-14');
  put('gender', 'female');
  put('marital_status', 'single');
  put('citizenship', 'Haiti');
  put('country_of_birth', 'Haiti');
  put('city_of_birth', 'Port-au-Prince');
  put('country_of_origin', 'Haiti');
  put('case_type', 'asylum');
  put('has_passport', 'no');
  put('has_i94', 'no');
  put('application_reason', 'initial');
  put('entry_date', '2023-03-01');
  return r;
}

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {}, sent: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(b) { this.sent = b; return this; },
  };
}
let ipCounter = 0;
const mockReq = (over = {}) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': `10.9.0.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

/* ── P1: the shared hash is a real SHA-256 ─────────────────────────── */
describe('draftIntegrity: sha256Hex matches node:crypto', () => {
  it('agrees on ASCII, unicode, empty, and long inputs', () => {
    const inputs = ['', 'abc', 'IRU draft binding', 'Port-au-Prince, Haïti — بوويون', 'x'.repeat(5000), JSON.stringify({ a: [1, 2, { b: '✓' }] })];
    for (const s of inputs) {
      assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), `mismatch for ${JSON.stringify(s.slice(0, 20))}`);
    }
  });
  it('stableStringify is key-order independent', () => {
    assert.equal(stableStringify({ b: 1, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 1 }));
  });
});

/* ── P1: canonical snapshot semantics ──────────────────────────────── */
describe('draftIntegrity: per-form snapshot', () => {
  const e589 = getFormEntry('I-589');
  const e765 = getFormEntry('I-765');

  it('is deterministic and form-scoped (same record, different forms → different hashes)', () => {
    const r = baseRecord();
    assert.equal(computeDraftSnapshotHash(r, e589), computeDraftSnapshotHash(r, e589));
    assert.notEqual(computeDraftSnapshotHash(r, e589), computeDraftSnapshotHash(r, e765));
  });

  it('changes when a fact feeding the form changes; unchanged when an unrelated fact changes', () => {
    const r = baseRecord();
    const before = computeDraftSnapshotHash(r, e589);
    const corrected = baseRecord();
    upsertFact(corrected, { id: 'date_of_birth', value: '1990-05-15', source: 'correction' }, T);
    assert.notEqual(computeDraftSnapshotHash(corrected, e589), before, 'DOB feeds I-589');
    const unrelated = baseRecord();
    upsertFact(unrelated, { id: 'has_passport', value: 'yes', source: 'correction' }, T);
    assert.equal(computeDraftSnapshotHash(unrelated, e589), before, 'an evidence flag feeds no form field');
    assert.equal(computeDraftSnapshotHash(unrelated, e765), computeDraftSnapshotHash(r, e765));
  });

  it('binds the edition: a different edition of the same form hashes differently', () => {
    const r = baseRecord();
    const otherEdition = { ...e589, editionDate: '01/20/25' };
    assert.notEqual(computeDraftSnapshotHash(r, otherEdition), computeDraftSnapshotHash(r, e589));
  });

  it('binds conflict state: an unresolved conflict changes the snapshot; the value alone does not capture it', () => {
    const r = baseRecord();
    const before = computeDraftSnapshotHash(r, e589);
    const conflicted = baseRecord();
    upsertFact(conflicted, { id: 'date_of_birth', value: '1990-05-15', source: 'document' }, T);
    assert.equal(conflicted.facts.date_of_birth.status, 'conflicting');
    assert.notEqual(computeDraftSnapshotHash(conflicted, e589), before);
    const snap = canonicalDraftSnapshot(conflicted, e589);
    const dobField = snap.fields.find((f) => f.factId === 'date_of_birth');
    assert.deepEqual(dobField.alternatives, ['1990-05-15'], 'both candidates are inside the binding');
  });

  it('affectedFormsForMutation scopes invalidation precisely', () => {
    const before = baseRecord();
    const dob = baseRecord();
    upsertFact(dob, { id: 'date_of_birth', value: '1990-05-15', source: 'correction' }, T);
    assert.deepEqual(affectedFormsForMutation(before, dob, FORM_REGISTRY).sort(), ['I-589', 'I-765'], 'DOB feeds both forms');
    const phone = baseRecord();
    upsertFact(phone, { id: 'phone', value: '2125550147', source: 'correction' }, T);
    assert.deepEqual(affectedFormsForMutation(before, phone, FORM_REGISTRY), ['I-589'], 'phone is an I-589-only field');
    const ssn = baseRecord();
    upsertFact(ssn, { id: 'ssn', value: '123456789', source: 'correction' }, T);
    assert.deepEqual(affectedFormsForMutation(before, ssn, FORM_REGISTRY), ['I-765'], 'ssn is an I-765-only field');
    const flag = baseRecord();
    upsertFact(flag, { id: 'has_passport', value: 'yes', source: 'correction' }, T);
    assert.deepEqual(affectedFormsForMutation(before, flag, FORM_REGISTRY), [], 'an evidence flag affects no draft');
    assert.equal(affectedFormsForMutation(null, flag, FORM_REGISTRY), null, 'undeterminable → null (withdraw everything)');
  });
});

/* ── P1: freshness verdict + per-form store invalidation ───────────── */
describe('draftIntegrity + formSelection: retained-draft freshness', () => {
  it('a draft is current until a fact it is bound to changes; an unrelated correction leaves it current', async () => {
    const r = baseRecord();
    const gen = await generateFormDraft({ formId: 'I-589', factRecord: r });
    let store = recordDraft(emptyFormDraftStore(), 'I-589', {
      summary: gen.summary, pdfBase64: Buffer.from(gen.pdfBytes).toString('base64'),
      draftId: gen.draftId, generatedAt: gen.generatedAt, snapshotHash: gen.snapshotHash,
    });
    const entry = draftForForm(store, 'I-589');
    assert.equal(entry.meta.snapshotHash, gen.snapshotHash, 'the store carries the server-issued binding');
    assert.equal(draftFreshness(entry.meta, r, getFormEntry('I-589')), 'current');

    // Unrelated correction (evidence flag): no invalidation, still current.
    const r2 = baseRecord();
    upsertFact(r2, { id: 'has_passport', value: 'yes', source: 'correction' }, T);
    store = invalidateDraftsForForms(store, affectedFormsForMutation(r, r2, FORM_REGISTRY));
    assert.ok(draftForForm(store, 'I-589'), 'unrelated correction must not withdraw the draft');
    assert.equal(draftFreshness(draftForForm(store, 'I-589').meta, r2, getFormEntry('I-589')), 'current');

    // Relevant correction (DOB): the form is affected and withdrawn;
    // even if it had not been, the freshness verdict would be 'stale'.
    const r3 = baseRecord();
    upsertFact(r3, { id: 'date_of_birth', value: '1990-05-15', source: 'correction' }, T);
    assert.equal(draftFreshness(entry.meta, r3, getFormEntry('I-589')), 'stale');
    store = invalidateDraftsForForms(store, affectedFormsForMutation(r2, r3, FORM_REGISTRY));
    assert.equal(draftForForm(store, 'I-589'), null, 'affected draft withdrawn');
  });

  it('an unbound draft (no snapshot hash) is never treated as current', () => {
    assert.equal(draftFreshness({ draftId: 'draft_legacy' }, baseRecord(), getFormEntry('I-589')), 'unbound');
    assert.equal(draftFreshness(null, baseRecord(), getFormEntry('I-589')), 'unbound');
  });

  it('invalidateDraftsForForms keeps unrelated forms and all version counters', async () => {
    const r = baseRecord();
    const g589 = await generateFormDraft({ formId: 'I-589', factRecord: r });
    const g765 = await generateFormDraft({ formId: 'I-765', factRecord: r });
    let store = emptyFormDraftStore();
    store = recordDraft(store, 'I-589', { summary: g589.summary, pdfBase64: 'AA==', draftId: g589.draftId, generatedAt: g589.generatedAt, snapshotHash: g589.snapshotHash });
    store = recordDraft(store, 'I-765', { summary: g765.summary, pdfBase64: 'AA==', draftId: g765.draftId, generatedAt: g765.generatedAt, snapshotHash: g765.snapshotHash });
    store = invalidateDraftsForForms(store, ['I-765']);
    assert.ok(draftForForm(store, 'I-589'), 'I-589 draft survives an I-765-scoped invalidation');
    assert.equal(draftForForm(store, 'I-765'), null);
    store = recordDraft(store, 'I-765', { summary: g765.summary, pdfBase64: 'AA==', draftId: 'draft_x', generatedAt: g765.generatedAt, snapshotHash: g765.snapshotHash });
    assert.equal(draftForForm(store, 'I-765').meta.version, 2, 'version counter survived invalidation (R4a)');
    const all = invalidateDrafts(store);
    assert.equal(draftForForm(all, 'I-589'), null, 'blanket invalidation still available');
  });
});

/* ── P1: direct API behavior (the real HTTP handler) ───────────────── */
describe('P1: generate-form handler — snapshot binding over HTTP', () => {
  it('issues a binding: response carries draftId + factSnapshotHash, summary matches, PDF metadata carries both', async () => {
    const r = baseRecord();
    const res = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: r, lang: 'EN' } }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.ok);
    assert.match(res.body.draftId, /^draft_[0-9a-f]{12}$/);
    assert.equal(res.body.factSnapshotHash, computeDraftSnapshotHash(r, getFormEntry('I-589')),
      'the issued hash is the shared-algorithm hash of the submitted record');
    assert.equal(res.body.summary.snapshotHash, res.body.factSnapshotHash);
    assert.equal(res.body.summary.draftId, res.body.draftId);
    const doc = await PDFDocument.load(Buffer.from(res.body.pdfBase64, 'base64'));
    assert.ok((doc.getKeywords() || '').includes(res.body.draftId), 'PDF keywords carry the draft id');
    assert.ok((doc.getKeywords() || '').includes(res.body.factSnapshotHash), 'PDF keywords carry the snapshot binding');
    assert.equal(doc.getForm().getTextField('form1[0].#subform[0].DateTimeField1[0]').getText(), '05/14/1990', 'sanity: the draft was filled from the record');
  });

  it('accepts a correct expectedSnapshotHash; repeated generation reissues the same binding with a fresh draftId', async () => {
    const r = baseRecord();
    const expected = computeDraftSnapshotHash(r, getFormEntry('I-765'));
    const res1 = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: r, lang: 'EN', expectedSnapshotHash: expected } }), res1);
    assert.equal(res1.statusCode, 200);
    const res2 = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: r, lang: 'EN', expectedSnapshotHash: expected } }), res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(res1.body.factSnapshotHash, res2.body.factSnapshotHash, 'same facts → same binding');
    assert.notEqual(res1.body.draftId, res2.body.draftId, 'each generation is a distinct draft');
  });

  it('rejects a manipulated presentation: hash of the corrected record presented with the stale record → 409 stale-fact-snapshot, no PDF', async () => {
    const stale = baseRecord();
    const corrected = baseRecord();
    upsertFact(corrected, { id: 'date_of_birth', value: '1990-05-15', source: 'correction' }, T);
    const correctedHash = computeDraftSnapshotHash(corrected, getFormEntry('I-589'));
    const res = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: stale, lang: 'HT', expectedSnapshotHash: correctedHash } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.reason, 'stale-fact-snapshot');
    assert.ok(typeof res.body.error === 'string' && res.body.error.length > 10, 'structured applicant-facing error');
    assert.ok(!res.body.pdfBase64, 'no draft is issued for a mismatched record');
  });

  it('rejects a cross-form presentation: the I-765 binding presented for I-589 → 409', async () => {
    const r = baseRecord();
    const hash765 = computeDraftSnapshotHash(r, getFormEntry('I-765'));
    const res = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: r, lang: 'EN', expectedSnapshotHash: hash765 } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.reason, 'stale-fact-snapshot');
  });

  it('legitimate regeneration from the corrected record succeeds and the PDF carries the corrected value', async () => {
    const corrected = baseRecord();
    upsertFact(corrected, { id: 'date_of_birth', value: '1990-05-15', source: 'correction' }, T);
    const hash = computeDraftSnapshotHash(corrected, getFormEntry('I-589'));
    const res = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-589', factRecord: corrected, lang: 'EN', expectedSnapshotHash: hash } }), res);
    assert.equal(res.statusCode, 200);
    const doc = await PDFDocument.load(Buffer.from(res.body.pdfBase64, 'base64'));
    const dob = doc.getForm().getTextField('form1[0].#subform[0].DateTimeField1[0]').getText();
    assert.equal(dob, '05/15/1990', 'the regenerated draft is filled from the corrected record');
  });

  it('the summary carries the cannot-be-recalled notice in all five languages', async () => {
    for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
      const { summary } = await generateFormDraft({ formId: 'I-765', factRecord: baseRecord(), lang });
      assert.ok(typeof summary.downloadedDraftNote === 'string' && summary.downloadedDraftNote.length > 20, `${lang} downloadedDraftNote present`);
      assert.ok(!/cannot be recalled/.test(summary.downloadedDraftNote) || lang === 'EN', `${lang} note is localized`);
    }
  });
});

/* ── P2: precedence overlay (facts.js) ─────────────────────────────── */
describe('P2: overlayConsumerState precedence', () => {
  const ANSWER_IDS = ['has_passport', 'has_i94', 'full_name', 'date_of_birth'];

  function rebuildFromAnswers(answers) {
    const r = createFactRecord(T);
    for (const [id, v] of Object.entries(answers)) upsertFact(r, { id, value: v, source: 'answer' }, T);
    return r;
  }

  it('rule 1: a correction beats the original questionnaire answer on rebuild', () => {
    const prior = rebuildFromAnswers({ has_passport: 'no' });
    upsertFact(prior, { id: 'has_passport', value: 'yes', source: 'correction' }, T);
    const fresh = rebuildFromAnswers({ has_passport: 'no' }); // original answers, unchanged
    const { record, correctedFactIds } = overlayConsumerState(fresh, prior, { answerFactIds: ANSWER_IDS }, T);
    assert.equal(record.facts.has_passport.value, 'yes', 'corrected value survives the rebuild');
    assert.equal(record.facts.has_passport.source, 'correction');
    assert.deepEqual(correctedFactIds, ['has_passport']);
    assert.equal(record.outputsStale, true, 'outputs derived from the pre-overlay record are stale until regenerated');
  });

  it('rule 2: an unresolved conflict is preserved with both candidates and provenance', () => {
    const prior = rebuildFromAnswers({ date_of_birth: '1990-05-14' });
    upsertFact(prior, { id: 'date_of_birth', value: '1990-05-15', source: 'document', sourceRef: { documentType: 'passport' } }, T);
    assert.equal(prior.facts.date_of_birth.status, 'conflicting');
    const fresh = rebuildFromAnswers({ date_of_birth: '1990-05-14' });
    const { record, preservedConflictIds } = overlayConsumerState(fresh, prior, { answerFactIds: ANSWER_IDS }, T);
    const f = record.facts.date_of_birth;
    assert.equal(f.status, 'conflicting');
    assert.deepEqual(f.alternatives.map((a) => a.value), ['1990-05-15']);
    assert.deepEqual(preservedConflictIds, ['date_of_birth']);
    // …and the conflicted value is still never filled into a form:
    // it is surfaced as a conflict, not settled by the rebuild.
    const plan = buildFillPlan(record, getFormEntry('I-589'));
    assert.ok(plan.conflicts.some((c) => c.factId === 'date_of_birth'), 'conflict stays visible in the fill plan');
    assert.ok(!plan.fill.some((f) => f.factId === 'date_of_birth'), 'conflicted value is not filled');
  });

  it('rule 3: a confirmed document fact stays confirmed across a rebuild', () => {
    const prior = createFactRecord(T);
    upsertFact(prior, { id: 'date_of_birth', value: '1990-05-14', source: 'document' }, T);
    confirmFact(prior, 'date_of_birth', T);
    assert.equal(prior.facts.date_of_birth.status, 'reported');
    const fresh = createFactRecord(T);
    upsertFact(fresh, { id: 'date_of_birth', value: '1990-05-14', source: 'document' }, T);
    assert.equal(fresh.facts.date_of_birth.status, 'extracted-unconfirmed', 'rebuild alone would lose the confirmation');
    const { record, confirmedFactIds } = overlayConsumerState(fresh, prior, { answerFactIds: ANSWER_IDS }, T);
    assert.equal(record.facts.date_of_birth.status, 'reported');
    assert.deepEqual(confirmedFactIds, ['date_of_birth']);
  });

  it('rule 4: a form-panel fact the rebuild cannot reproduce is preserved', () => {
    const prior = rebuildFromAnswers({ has_passport: 'no' });
    upsertFact(prior, { id: 'a_number', value: '123456789', source: 'answer' }, T); // panel-entered
    const fresh = rebuildFromAnswers({ has_passport: 'no' });
    const { record, preservedFactIds } = overlayConsumerState(fresh, prior, { answerFactIds: ANSWER_IDS }, T);
    assert.equal(record.facts.a_number.value, '123456789');
    assert.deepEqual(preservedFactIds, ['a_number']);
  });

  it('rule 5: narrative approval survives a rebuild with unchanged story text; a changed story resets it', () => {
    const story = 'I entered in March 2023 after events in my home country that I describe here in detail.';
    const mkNarrative = (text) => {
      const n = createNarrative(T);
      addNarrativeEvent(n, { id: 'story_main', text, date: '2023-03-01', factIds: ['entry_date'] }, T);
      return n;
    };
    const prior = rebuildFromAnswers({ entry_date: '2023-03-01' });
    prior.narrative = mkNarrative(story);
    approveNarrative(prior.narrative, prior, T);
    assert.equal(prior.narrative.status, 'approved');

    const freshSame = rebuildFromAnswers({ entry_date: '2023-03-01' });
    freshSame.narrative = mkNarrative(story);
    const r1 = overlayConsumerState(freshSame, prior, { answerFactIds: ANSWER_IDS }, T);
    assert.equal(r1.narrativePreserved, true);
    assert.equal(r1.record.narrative.status, 'approved', 'approval carries over when the story is unchanged');

    const freshChanged = rebuildFromAnswers({ entry_date: '2023-03-01' });
    freshChanged.narrative = mkNarrative('A completely different account of what happened, rewritten by the applicant.');
    const r2 = overlayConsumerState(freshChanged, prior, { answerFactIds: ANSWER_IDS }, T);
    assert.equal(r2.narrativePreserved, false);
    assert.notEqual(r2.record.narrative.status, 'approved');
  });

  it('no consumer state → rebuild stands untouched and nothing is marked stale by the overlay', () => {
    const prior = rebuildFromAnswers({ has_passport: 'no' });
    const fresh = rebuildFromAnswers({ has_passport: 'no' });
    const { record, correctedFactIds, preservedFactIds } = overlayConsumerState(fresh, prior, { answerFactIds: ANSWER_IDS }, T);
    assert.deepEqual(correctedFactIds, []);
    assert.deepEqual(preservedFactIds, []);
    assert.equal(record.outputsStale, false);
  });
});

/* ── P2: fallback assessment retains the gap basis ─────────────────── */
describe('P2: fallbackAssessment retains currentState (the gap basis)', () => {
  it('EN: reported-absence vs unknown bases survive into evidenceGaps, verbatim and distinct', () => {
    const min = minimizeForModel({ case_type: 'asylum', has_passport: 'no', has_i94: 'unknown' });
    const gaps = buildGapRecords(min, []);
    const fb = fallbackAssessment(min, gaps, [], 'EN');
    const pp = fb.evidenceGaps.find((g) => g.key === 'has_passport');
    const i94 = fb.evidenceGaps.find((g) => g.key === 'has_i94');
    assert.equal(pp.currentState, 'Applicant reported they do not have this document.');
    assert.match(i94.currentState, /does not know/);
    assert.notEqual(pp.currentState, i94.currentState, 'the two bases are distinguishable in the fallback output');
  });

  it('HT: localized basis sentences flow through the deterministic fallback', () => {
    const min = minimizeForModel({ case_type: 'asylum', has_passport: 'no' });
    const gaps = buildGapRecords(min, [], 'HT');
    const fb = fallbackAssessment(min, gaps, [], 'HT');
    const pp = fb.evidenceGaps.find((g) => g.key === 'has_passport');
    assert.equal(pp.currentState, gaps.find((g) => g.key === 'has_passport').currentState);
    assert.notEqual(pp.currentState, 'Applicant reported they do not have this document.', 'HT basis is not the English sentence');
  });
});

/* ── P2: the REAL analyze path — handler + correction overlay ──────── */
describe('P2: /api/analyze integration — corrections drive gaps server-side', () => {
  let analyzeHandler;
  function mockAnalyzeReqRes({ body = {}, ip } = {}) {
    const req = { method: 'POST', body, headers: {}, socket: { remoteAddress: ip } };
    const res = {
      statusCode: 200, headers: {}, chunks: [], ended: false,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      json(o) { this.jsonBody = o; this.ended = true; return this; },
      write(s) { this.chunks.push(s); },
      end() { this.ended = true; },
    };
    return { req, res };
  }
  const sseEvents = (res) => res.chunks.join('').split('\n')
    .filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));

  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() { yield { text: 'not json' }; }, // force the fallback path
    };
    analyzeHandler = (await import('./analyze.js')).default;
  });

  it('a corrected has_passport removes the passport gap; an uncorrected gap remains WITH its basis', async () => {
    const record = baseRecord(); // has_passport 'no' by answer…
    upsertFact(record, { id: 'has_passport', value: 'yes', source: 'correction' }, T); // …then corrected
    const { req, res } = mockAnalyzeReqRes({
      ip: 'dc-p2-1',
      body: {
        answers: { country_of_origin: 'Haiti', case_type: 'asylum', has_passport: 'no', has_i94: 'no' },
        lang: 'EN',
        factRecord: record,
      },
    });
    await analyzeHandler(req, res);
    const done = sseEvents(res).find((e) => e.type === 'done');
    assert.ok(done, 'done event emitted');
    const keys = done.assessment.evidenceGaps.map((g) => g.key);
    assert.ok(!keys.includes('has_passport'), 'the corrected fact produces no gap — the old questionnaire answer did not reappear');
    const i94 = done.assessment.evidenceGaps.find((g) => g.key === 'has_i94');
    assert.ok(i94, 'the uncorrected gap remains');
    assert.equal(i94.currentState, 'Applicant reported they do not have this document.', 'basis sentence present through the real handler');
  });

  it('without a correction, the same request keeps the passport gap (control)', async () => {
    const record = baseRecord();
    const { req, res } = mockAnalyzeReqRes({
      ip: 'dc-p2-2',
      body: {
        answers: { country_of_origin: 'Haiti', case_type: 'asylum', has_passport: 'no', has_i94: 'no' },
        lang: 'EN',
        factRecord: record,
      },
    });
    await analyzeHandler(req, res);
    const done = sseEvents(res).find((e) => e.type === 'done');
    assert.ok(done.assessment.evidenceGaps.some((g) => g.key === 'has_passport'));
  });
});

/* ── P2/P1/P3: App.tsx wiring guards (the wired path, not just builders) */
describe('App.tsx wiring (defect closure)', () => {
  const app = readFileSync(join(HERE, '..', 'src', 'App.tsx'), 'utf8');

  it('P2: re-run analysis overlays consumer state and computes from corrected answers', () => {
    const start = app.indexOf('const handleInterviewComplete');
    assert.ok(start >= 0);
    const body = app.slice(start, start + 5200);
    assert.ok(body.includes('overlayConsumerState(builtRecord, factRecord'), 'rebuild is overlaid with the prior record');
    assert.ok(body.includes('answersWithCorrections(answers, record)'), 'effective answers derive from the corrected record');
    assert.ok(body.includes('stripForServer(effectiveAnswers)'), 'the analysis request carries corrected answers');
    assert.ok(body.includes('factRecord: record'), 'the overlaid record is what the server receives');
    assert.ok(body.includes('markOutputsFresh'), 'successful regeneration marks outputs fresh');
    assert.ok(!body.includes('const record = buildFactRecord(answers, imageReview);\n    setFactRecord(record);'),
      'the pre-fix pattern (rebuild discards corrections, record set directly) is gone');
  });

  it('P1: generation presents the snapshot hash, maps the stale refusal, and stores the issued binding', () => {
    assert.ok(app.includes('computeDraftSnapshotHash(factRecord, selectedFormEntry)'), 'client computes the same hash the server verifies');
    assert.ok(app.includes('expectedSnapshotHash'), 'the hash is presented with the generation request');
    assert.ok(app.includes("reason === 'stale-fact-snapshot'"), 'the 409 refusal is mapped to a localized message');
    assert.ok(app.includes("t('errStaleSnapshot'"), 'errStaleSnapshot dictionary key is used');
    assert.ok(app.includes('snapshotHash: data.factSnapshotHash'), 'the server-issued binding is stored with the draft');
  });

  it('P1: per-form invalidation is wired through the store; the blanket path survives as the safe default', () => {
    const start = app.indexOf('const applyFactMutation');
    const body = app.slice(start, start + 900);
    assert.ok(body.includes('affectedFormsForMutation(factRecord, next, FORM_REGISTRY)'), 'affected forms are computed from snapshot diffs');
    assert.ok(body.includes('invalidateDraftsForForms(prev, affected)'), 'scoped invalidation is applied');
    assert.ok(body.includes('invalidateDrafts(prev)'), 'undeterminable → blanket invalidation (also asserted by the R5 trace)');
  });

  it('P1: downloads and package enumeration are freshness-gated', () => {
    assert.ok(app.includes("if (selectedDraftFreshness !== 'current') return;"), 'downloadFormPdf refuses stale/unbound drafts');
    assert.ok(app.includes('draftFreshness(d.meta, factRecord, entry)'), 'packet + on-screen package verify each draft against the current record');
    assert.ok(app.includes("selectedDraftFreshness === 'current'"), 'the download affordance renders only for a current draft');
    assert.ok(app.includes('currentSummary.downloadedDraftNote'), 'the cannot-be-recalled notice is displayed with the draft');
  });

  it('P3A: the packet resource card shows the verification source beside the date', () => {
    assert.ok(app.includes('res.sourceOfVerification'), 'source is rendered from the resource record');
    assert.ok(app.includes("t('pktVerifiedSource'"), 'with a localized label');
    assert.ok(app.includes('res.lastVerified'), 'the date rendering is unchanged');
  });

  it('P3B: the on-screen package mirrors the packet section from the same store', () => {
    const marker = app.indexOf('Your preparation package (defect-closure P3B)');
    assert.ok(marker >= 0, 'on-screen package block exists');
    const block = app.slice(marker, marker + 2600);
    assert.ok(block.includes("t('pktPackageTitle'"), 'same title key as the packet');
    assert.ok(block.includes('draftForForm(formDraftStore, entry.id)'), 'driven by the per-form draft store for every form');
    assert.ok(block.includes("t('pktPackageNotGenerated'"), 'missing drafts show the localized not-generated state');
    assert.ok(block.includes("t('pktPackageStale'"), 'stale drafts are labeled, never presented as current');
  });
});

/* ── P3: new dictionary keys exist in all five languages ───────────── */
describe('P3: localization of new strings', () => {
  async function loadConstants() {
    const source = readFileSync(join(HERE, '..', 'src', 'constants.tsx'), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
  }

  it('errStaleSnapshot, pktVerifiedSource, pktPackageStale are non-empty ×5 and localized', async () => {
    const { UI_LABELS } = await loadConstants();
    for (const key of ['errStaleSnapshot', 'pktVerifiedSource', 'pktPackageStale']) {
      const en = UI_LABELS.EN[key];
      assert.ok(typeof en === 'string' && en.length > 0, `EN ${key}`);
      for (const lang of ['ES', 'ZH', 'HT', 'AR']) {
        assert.ok(typeof UI_LABELS[lang][key] === 'string' && UI_LABELS[lang][key].length > 0, `${lang} ${key} present`);
        assert.notEqual(UI_LABELS[lang][key], en, `${lang} ${key} is actually translated`);
      }
    }
  });

  it('every resource entry carries a verification source and date for the packet to display (data unchanged)', async () => {
    const { getAllOrgs } = await import('../src/resources.ts');
    const orgs = getAllOrgs();
    assert.ok(orgs.length > 0);
    for (const org of orgs) {
      assert.ok(typeof org.sourceOfVerification === 'string' && org.sourceOfVerification.length > 0, `${org.id} has sourceOfVerification`);
      assert.ok(typeof org.lastVerified === 'string' && org.lastVerified.length > 0, `${org.id} has lastVerified`);
    }
  });
});

/* ── P4: edition manifest vs the committed monitor snapshot fixture ─── */
// Previously this read ../../uscis-monitor/state.json (the live USCIS monitor
// baseline, outside the repo), so the whole file failed to load on any machine
// without that sibling directory. It now reads the committed fixture
// api/fixtures/uscis-monitor-state.json (synthetic, representative values).
// The three-way edition control mechanism is unchanged; only liveness moved
// out — live-drift detection is the USCIS monitor cron's job. Update the
// fixture whenever the registry editions change; never weaken the assertions.
describe('P4: three-way edition control against the committed monitor snapshot fixture', () => {
  const monitor = JSON.parse(readFileSync(join(HERE, 'fixtures', 'uscis-monitor-state.json'), 'utf8'));

  it('the monitor snapshot fixture is available and tracks both forms', () => {
    assert.ok(monitor.forms['I-589'], 'monitor tracks I-589');
    assert.ok(monitor.forms['I-765'], 'monitor tracks I-765');
  });

  it('registry edition == template-bound registry == monitor iruRegistryEdition == served PDF edition, per form', () => {
    for (const formId of ['I-589', 'I-765']) {
      const entry = getFormEntry(formId);
      const m = monitor.forms[formId];
      assert.equal(entry.editionDate, m.iruRegistryEdition, `${formId}: registry matches monitor`);
      assert.equal(entry.editionDate, m.servedPdfEdition, `${formId}: registry matches the served official PDF`);
      assert.equal(entry.editionDate, m.pageListedCurrentEdition, `${formId}: registry matches the USCIS page-listed edition`);
    }
  });

  it('the enjoined, not-accepted I-765 edition (09/15/26) is NOT what IRU offers', () => {
    assert.notEqual(getFormEntry('I-765').editionDate, '09/15/26');
    assert.match(monitor.forms['I-765'].notes, /court-enjoined/, 'the monitor records why it is not accepted');
  });
});

/* ── P6: failed / expired checkout resolution (mocked Stripe) ──────── */
describe('P6: webhook resolves failed and expired checkouts (mocks)', () => {
  const SECRET = 'whsec_defect_closure_test';
  let checkoutHandler; let webhookHandler; let statusHandler;
  const sessions = [];
  let ipSeq = 0;

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_defect_closure';
    // Payment-hardening gate: paid handlers require an explicit store backend.
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    sessions.length = 0;
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession({ amountCents, entitlementId, sku }) {
        const id = `cs_test_dc_${sessions.length + 1}_${Math.random().toString(36).slice(2, 8)}`;
        sessions.push({ id, amountCents, entitlementId, sku });
        return { id, url: `https://checkout.stripe.test/${id}` };
      },
    };
    checkoutHandler = (await import('./checkout.js')).handler;
    webhookHandler = (await import('./webhook.js')).handler;
    statusHandler = (await import('./entitlement-status.js')).handler;
  });

  async function createEvaluationCheckout() {
    const res = mockRes();
    await checkoutHandler({
      method: 'POST',
      headers: { 'x-forwarded-for': `10.10.0.${++ipSeq}` },
      body: { sku: 'iru-evaluation' },
      socket: { remoteAddress: '127.0.0.1' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amountCents, 100, 'the $1 evaluation amount comes from the server pricing table');
    return { ...res.body, sessionId: sessions[sessions.length - 1].id };
  }

  async function sendWebhook(event) {
    const { signStripePayload } = await import('./_lib/stripewebhook.js');
    const payload = JSON.stringify(event);
    const res = mockRes();
    await webhookHandler({
      method: 'POST', rawBody: payload, body: payload,
      headers: { 'stripe-signature': signStripePayload(payload, SECRET, Math.floor(Date.now() / 1000)) },
      socket: { remoteAddress: '127.0.0.1' },
    }, res);
    return res;
  }
  const evt = (id, type, sessionId, extra = {}) => ({ id, type, data: { object: { id: sessionId, ...extra } } });

  it('an expired session voids the entitlement terminally; a late paid event fulfills safely (never silently dropped); replays are duplicates', async () => {
    // SUPERSEDED 2026-10-24 (payment-hardening directive §4): the old
    // "a late paid event cannot resurrect it" rule left confirmed
    // payments silently unfulfilled. A verified late payment for a
    // record whose session and family check out is now fulfilled late
    // (fresh claim window from payment); a mismatched one becomes a
    // durable exception instead (see the next test).
    const co = await createEvaluationCheckout();
    const expiredEvt = evt('evt_dc_exp_1', 'checkout.session.expired', co.sessionId);
    const r1 = await sendWebhook(expiredEvt);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.applied, true);
    assert.equal(entitlementStore.getById(co.entitlementId).state, 'VOID');

    const r2 = await sendWebhook(expiredEvt);
    assert.equal(r2.body.duplicate, true, 'replayed event id is a duplicate, not reapplied');

    const r3 = await sendWebhook(evt('evt_dc_exp_2', 'checkout.session.completed', co.sessionId, { payment_status: 'paid' }));
    assert.equal(r3.body.applied, true, 'a verified late payment fulfills instead of being silently dropped');
    assert.equal(r3.body.lateFulfilled, true);
    assert.notEqual(entitlementStore.getById(co.entitlementId).paidAt, null);
    assert.equal(entitlementStore.getById(co.entitlementId).state, 'RESERVED');
  });

  it('a late paid event with a mismatched amount becomes a durable exception, never a grant', async () => {
    const co = await createEvaluationCheckout();
    const expiredEvt = evt('evt_dc_exp_3', 'checkout.session.expired', co.sessionId);
    const r1 = await sendWebhook(expiredEvt);
    assert.equal(r1.body.applied, true);
    const r2 = await sendWebhook(evt('evt_dc_exp_4', 'checkout.session.completed', co.sessionId, { payment_status: 'paid', amount_total: 999999, currency: 'usd' }));
    assert.equal(r2.body.applied, false);
    assert.equal(r2.body.exception, true);
    assert.equal(entitlementStore.getById(co.entitlementId).paidAt, null);
    assert.ok(entitlementStore.listExceptions().some((e) => e.entitlementId === co.entitlementId),
      'the mismatched late payment is recorded as a durable exception');
  });

  it('an expired event for an unknown session is acknowledged without burning the event id', async () => {
    const e = evt('evt_dc_exp_unknown', 'checkout.session.expired', 'cs_test_dc_late_attach');
    const r1 = await sendWebhook(e);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.applied, false);
    // The session attaches AFTER the first delivery (out-of-order Stripe
    // delivery): the same event, redelivered, must still apply.
    const { entitlement } = entitlementStore.create({ sku: 'iru-evaluation', amountCents: 100 });
    entitlementStore.attachSession(entitlement.id, 'cs_test_dc_late_attach');
    const r2 = await sendWebhook(e);
    assert.equal(r2.body.applied, true, 'redelivery after attach applies — the event id was not burned');
    assert.equal(entitlementStore.getById(entitlement.id).state, 'VOID');
  });

  it('a failed delayed payment is recorded without ending the entitlement; a later success still marks it paid', async () => {
    const co = await createEvaluationCheckout();
    const fail = await sendWebhook(evt('evt_dc_fail_1', 'checkout.session.async_payment_failed', co.sessionId));
    assert.equal(fail.body.applied, true);
    const afterFail = entitlementStore.getById(co.entitlementId);
    assert.equal(afterFail.state, 'RESERVED', 'state is unchanged by a payment failure');
    assert.equal(afterFail.paidAt, null);
    assert.equal(afterFail.failedPaymentEvents, 1, 'the failure is on the record');

    const ok = await sendWebhook(evt('evt_dc_ok_1', 'checkout.session.async_payment_succeeded', co.sessionId, { payment_status: 'paid' }));
    assert.equal(ok.body.applied, true);
    assert.ok(entitlementStore.getById(co.entitlementId).paidAt, 'retry success marks paid');
  });

  it('the entitlement ID in the success URL is not a credential: status lookup requires the token', async () => {
    const co = await createEvaluationCheckout();
    const byId = mockRes();
    await statusHandler({
      method: 'POST', headers: { 'x-forwarded-for': `10.10.1.${++ipSeq}` },
      body: { token: co.entitlementId }, socket: { remoteAddress: '127.0.0.1' },
    }, byId);
    assert.equal(byId.statusCode, 404, 'the public entitlement ID alone grants nothing');
    const byToken = mockRes();
    await statusHandler({
      method: 'POST', headers: { 'x-forwarded-for': `10.10.1.${++ipSeq}` },
      body: { token: co.entitlementToken }, socket: { remoteAddress: '127.0.0.1' },
    }, byToken);
    assert.equal(byToken.statusCode, 200);
    assert.equal(byToken.body.entitlement.paid, false, 'unpaid until the webhook says so — a browser return never marks paid');
    assert.equal(byToken.body.usable, false);
    assert.ok(!('tokenHash' in byToken.body.entitlement) && !('sessionId' in byToken.body.entitlement),
      'the public view exposes neither the token hash nor the session id');
  });
});
