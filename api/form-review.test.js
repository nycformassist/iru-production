import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import { getFormEntry } from './_lib/forms/registry.js';
import { buildFillPlan, buildCompletionSummary } from './_lib/formmap.js';
import { generateFormDraft, default as generateHandler } from './generate-form.js';
import blankFormHandler from './blank-form.js';
import { entitlementStore } from './_lib/entitlement.js';
import { createNarrative, addNarrativeEvent } from './_lib/narrative.js';

// B2C directive §5 — form review, blank official form, corrections,
// regeneration, version identification, and preserved approval gates.
// Tests 12–18. Synthetic data only.

const T = '2026-10-21T00:00:00.000Z';

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
  headers: { 'x-forwarded-for': `10.6.0.${++ipCounter}` },
  body: {}, socket: { remoteAddress: '127.0.0.1' }, ...over,
});

function baseRecord() {
  const r = createFactRecord(T);
  const put = (id, value, source = 'answer') => upsertFact(r, { id, value, source }, T);
  put('family_name', 'Testfamily');
  put('given_name', 'Testgiven');
  put('date_of_birth', '1990-05-17');
  put('gender', 'female');
  put('marital_status', 'married');
  put('citizenship', 'Testlandia');
  put('country_of_birth', 'Testlandia');
  put('city_of_birth', 'Test City');
  put('mailing_street', '123 Test Street');
  put('mailing_city', 'Bronx');
  put('mailing_region', 'NY');
  put('mailing_postal_code', '10451');
  put('application_reason', 'initial');
  return r;
}

async function fieldText(pdfBytes, name) {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getForm().getTextField(name).getText();
}

describe('form review experience (B2C §5)', () => {
  it('test 12: both forms carry explicit DRAFT review instructions and a final-review checklist', () => {
    for (const formId of ['I-589', 'I-765']) {
      const entry = getFormEntry(formId);
      const plan = buildFillPlan(baseRecord(), entry);
      const summary = buildCompletionSummary(entry, plan, baseRecord());
      const text = (summary.reviewInstructions || []).join(' ');
      assert.match(text, /DRAFT/);
      assert.match(text, /Verify your name, dates, addresses/);
      assert.match(text, /Correct mistakes/);
      assert.match(text, /not automatically correct/i);
      assert.ok(Array.isArray(summary.finalReviewChecklist) && summary.finalReviewChecklist.length >= 4);
      assert.equal(summary.draftDocumentLabel, 'IRU Pre-filled Draft — Review and Correct');
    }
  });

  it('test 13: the blank official form served is byte-identical to the verified template, for both forms', async () => {
    for (const formId of ['I-589', 'I-765']) {
      const entry = getFormEntry(formId);
      const res = mockRes();
      await blankFormHandler(mockReq({ method: 'GET', query: { form: formId } }), res);
      assert.equal(res.statusCode, 200);
      // Wire header must be header-safe ASCII (D3): the display label's
      // em dash can never cross a real HTTP response. The human-facing
      // label (summary below) keeps the em dash.
      assert.equal(res.headers['X-Iru-Document-Label'], 'Official Blank Form - Reference Copy');
      assert.ok([...res.headers['X-Iru-Document-Label']].every((c) => c.charCodeAt(0) < 128));
      assert.equal(res.headers['X-Iru-Form-Edition'], entry.editionDate);
      const template = await readFile(new URL(`../forms/templates/${entry.templateFile}`, import.meta.url));
      const servedHash = createHash('sha256').update(res.sent).digest('hex');
      const templateHash = createHash('sha256').update(template).digest('hex');
      assert.equal(servedHash, templateHash, `${formId} blank must be the unmodified official template`);
      // And the summary points at exactly this document + the official source:
      const plan = buildFillPlan(baseRecord(), entry);
      const summary = buildCompletionSummary(entry, plan, baseRecord());
      assert.equal(summary.blankForm.label, 'Official Blank Form — Reference Copy');
      assert.equal(summary.blankForm.sourceUrl, `https://www.uscis.gov/${formId.toLowerCase()}`);
      assert.equal(summary.blankForm.editionDate, entry.editionDate);
    }
    const bad = mockRes();
    await blankFormHandler(mockReq({ method: 'GET', query: { form: 'I-999' } }), bad);
    assert.equal(bad.statusCode, 400);
  });

  it('test 14: downloading a blank form grants no preparation entitlement for any form', async () => {
    process.env.PAYWALL_ENABLED = 'true';
    try {
      // A paid I-589-only grant exists in the store:
      const { entitlement, token } = entitlementStore.create({
        sku: 'iru-complete-one-form', amountCents: 9895, sessionId: 'sess_blank_test',
        scope: { kind: 'forms', forms: ['I-589'] },
      });
      entitlementStore.markPaidBySession('sess_blank_test', 'evt_blank_test');
      // The buyer downloads the I-765 BLANK (a public reference copy):
      const blank = mockRes();
      await blankFormHandler(mockReq({ method: 'GET', query: { form: 'I-765' } }), blank);
      assert.equal(blank.statusCode, 200);
      // Preparation of I-765 is still refused — blank access changed nothing:
      const gen = mockRes();
      await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: baseRecord(), entitlementToken: token } }), gen);
      assert.equal(gen.statusCode, 402);
      assert.equal(gen.body.reason, 'form-not-covered');
      // And the entitlement itself was not consumed or altered by the download:
      const peek = entitlementStore.peekForForm(token, 'I-589');
      assert.equal(peek.ok, true);
      assert.equal(entitlement.id, peek.entitlement.id);
    } finally {
      delete process.env.PAYWALL_ENABLED;
    }
  });

  it('tests 15+16: a correction updates the canonical record, marks outputs stale, and the regenerated PDF carries the corrected value', async () => {
    const record = baseRecord();
    const entry = getFormEntry('I-765');
    const first = await generateFormDraft({ formId: 'I-765', factRecord: record });
    assert.equal(
      await fieldText(first.pdfBytes, 'form1[0].Page1[0].Line1a_FamilyName[0]'),
      'Testfamily',
    );
    // The applicant spots an error and corrects it through the record:
    upsertFact(record, { id: 'family_name', value: 'Correctedname', source: 'correction' }, '2026-10-21T01:00:00.000Z');
    assert.equal(record.outputsStale, true, 'the earlier draft is now stale');
    assert.equal(record.facts.family_name.value, 'Correctedname');
    // Regeneration reflects the correction — in the PDF itself and the summary:
    const second = await generateFormDraft({ formId: 'I-765', factRecord: record });
    assert.equal(
      await fieldText(second.pdfBytes, 'form1[0].Page1[0].Line1a_FamilyName[0]'),
      'Correctedname',
    );
    const populated = second.summary.populated.find((p) => /family name/i.test(p.label));
    assert.equal(populated.value, 'Correctedname');
    assert.match(second.summary.staleVersionNote, /stale/i);
    assert.equal(entry.id, 'I-765');
  });

  it('test 17: every generation is a distinguishable version; only the latest is current', async () => {
    const a = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: baseRecord() } }), a);
    assert.equal(a.statusCode, 200);
    const b = mockRes();
    await generateHandler(mockReq({ body: { formId: 'I-765', factRecord: baseRecord() } }), b);
    assert.equal(b.statusCode, 200);
    assert.ok(a.body.draftId && b.body.draftId);
    assert.notEqual(a.body.draftId, b.body.draftId, 'each draft carries a distinct version id');
    assert.ok(a.body.generatedAt && b.body.generatedAt);
    assert.equal(a.body.documentLabel, 'IRU Pre-filled Draft — Review and Correct');
    assert.equal(b.body.documentLabel, 'IRU Pre-filled Draft — Review and Correct');
  });

  it('test 18: the narrative approval gate remains enforced in form preparation', () => {
    const record = baseRecord();
    const narrative = createNarrative(T);
    addNarrativeEvent(narrative, { text: 'I entered through Test City port of entry.', date: '2023-03-04', datePrecision: 'exact', origin: 'applicant-statement' }, T);
    record.narrative = narrative; // NOT approved
    upsertFact(record, { id: 'entry_place', value: 'Test City', source: 'narrative' }, T);
    const entry = getFormEntry('I-765');
    const plan = buildFillPlan(record, entry);
    const held = plan.needsConfirmation.find((n) => n.factId === 'entry_place');
    assert.ok(held, 'narrative-sourced value is held before approval');
    assert.equal(held.reason, 'narrative-not-approved');
    assert.ok(!plan.fill.some((f) => f.factId === 'entry_place'), 'and is never filled');
    const summary = buildCompletionSummary(entry, plan, record);
    assert.ok(summary.needsConfirmation.some((n) => n.factId === 'entry_place'));
  });

  after(() => { delete process.env.PAYWALL_ENABLED; });
});
