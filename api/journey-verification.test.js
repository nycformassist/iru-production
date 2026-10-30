/**
 * journey-verification.test.js — Workstream 7: consolidated journey
 * verification (directive §9). LOCAL only, module/handler level, in the
 * repo's established style. Synthetic data only; AI clients are mocked
 * exactly as in the neighboring suites; no browser, no network, no
 * real keys, no money.
 *
 * PURPOSE: compose the already-proven building blocks into COMPLETE
 * journeys — intake answers → limited evaluation / fallback output in
 * the applicant's language → canonical fact record → form draft →
 * packet next steps → location-matched resources (and, where the
 * persona demands it, document conflict → correction → regeneration,
 * the paywall entitlement chain, and language persistence across a
 * failed analysis). Assertions that belong to one building block are
 * NOT duplicated here; they live in, and are cited to:
 *  - api/language-continuity.test.js — dictionary parity, localized
 *    builders, review-image prompt language, ES draft guidance.
 *  - api/language-completion.test.js — KB/resource/country i18n parity,
 *    the persistence validation matrix, and the COMBINED checkout-
 *    return case (persisted language + server-derived purchase state).
 *  - api/r5-correction-verification.test.js — per-form draft store,
 *    version counters, correction invalidation on real PDFs.
 *  - api/pricing-acceptance.test.js / api/b2c-pricing.test.js —
 *    pricing-table enforcement, duplicate/void rules, webhook forgery.
 *  - api/reports-nextsteps.test.js — packet next-steps per persona,
 *    blank-form edition integrity (incl. pdftotext on the templates),
 *    DRAFT stamp spot-check.
 *  - api/image-integration.test.js — image-review → gap integration
 *    and the independently-verified prohibitions.
 *  - api/resource-resolution.test.js / api/location-international.
 *    test.js — the layered resource model and city/state matching.
 *  - api/form-review.test.js — blank-form byte identity, narrative
 *    gate, per-form delivery consumption.
 *
 * PDF INSPECTION POLICY (stated for the WS7 report): journeys P1, P3
 * and P4 assert on REAL generated PDF bytes — pdf-lib AcroForm field
 * readback + the drawn DRAFT stamp decoded from page-1 content
 * streams (the r5 pattern) + pdftotext extraction of the written
 * file (the reports-nextsteps pattern). P2, P5 and P6 assert pdf-lib
 * field readback on real bytes plus builder/handler output; their
 * stamp/edition deep-checks are cited to r5/reports above.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import analyzeHandler from './analyze.js';
import reviewImageHandler from './review-image.js';
import { handler as checkoutHandler } from './checkout.js';
import { handler as webhookHandler } from './webhook.js';
import generateHandler, { generateFormDraft } from './generate-form.js';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import { sanitizeAnswers, minimizeForModel } from './_lib/privacy.js';
import { fallbackAssessment } from './_lib/prompt.js';
import { buildGapRecords, KB_I18N } from './_lib/evidence.js';
import { buildLimitedEvaluation } from './_lib/evaluation.js';
import { buildPacketNextSteps } from './_lib/nextsteps.js';
import { getFormEntry } from './_lib/forms/registry.js';
import { createNarrative, addNarrativeEvent } from './_lib/narrative.js';
import { signStripePayload } from './_lib/stripewebhook.js';
import { SKUS } from './_lib/pricing.js';

const { resolveResourcesForLocation } = await import('../src/resources.ts');

const T0 = '2026-10-23T09:00:00.000Z';
const T1 = '2026-10-23T09:05:00.000Z';
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

const F589 = {
  family: 'form1[0].#subform[0].PtAILine4_LastName[0]',
  given: 'form1[0].#subform[0].PtAILine5_FirstName[0]',
  dob: 'form1[0].#subform[0].DateTimeField1[0]',
};
const F765 = {
  family: 'form1[0].Page1[0].Line1a_FamilyName[0]',
  dob: 'form1[0].Page3[0].Line19_DOB[0]',
};
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Mocks / helpers (patterns from analyze.test.js, pricing-acceptance.test.js)
// ---------------------------------------------------------------------------
function mockReq(ip, body = {}, over = {}) {
  return {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body,
    socket: { remoteAddress: ip },
    ...over,
  };
}
function jsonRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
function sseRes() {
  return {
    statusCode: 200, headers: {}, chunks: [], jsonBody: null, ended: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(o) { this.jsonBody = o; this.ended = true; return this; },
    write(s) { this.chunks.push(s); },
    end() { this.ended = true; },
  };
}
function sseEvents(res) {
  return res.chunks.join('').split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

/** Canonical record the way App.tsx buildFactRecord composes it. */
function makeRecord(facts) {
  const r = createFactRecord(T0);
  for (const [id, value] of Object.entries(facts)) {
    if (value !== undefined && value !== null && value !== '') {
      upsertFact(r, { id, value, source: 'answer' }, T0);
    }
  }
  return r;
}
function baseAnswers(over = {}) {
  return {
    country_of_origin: 'Haiti', residence_country: 'US',
    country_of_birth: 'Haiti', citizenship: 'Haiti',
    entry_date: '2023-03-01', case_type: 'asylum',
    has_passport: 'no', has_i94: 'unknown', has_lease: 'no',
    has_persecution_proof: 'no', has_green_card: 'no',
    has_tax_transcripts: 'no', has_marriage_cert: 'unknown',
    has_proof_of_relationship: 'no', has_arrests: 'no',
    ...over,
  };
}
/** Limited evaluation through the real analyze handler (paywall off). */
async function limitedViaHandler({ answers, lang, ip }) {
  const res = jsonRes();
  await analyzeHandler(mockReq(ip, { mode: 'limited', answers, lang }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'limited');
  return res.body.evaluation;
}
/** Deterministic fallback for the same answers, in-language. */
function fallbackFor(answers, lang) {
  const clean = sanitizeAnswers(answers);
  assert.equal(clean.ok, true);
  const min = minimizeForModel(clean.answers, []);
  return {
    min,
    fb: fallbackAssessment(min, buildGapRecords(min, [], lang), [], lang),
  };
}

// --- PDF inspection on real bytes -------------------------------------------
async function fieldText(pdfBytes, name) {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getForm().getTextField(name).getText();
}
async function drawnTextOnPage1(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes);
  const contents = doc.getPages()[0].node.Contents();
  const refs = contents && typeof contents.asArray === 'function' ? contents.asArray() : [contents];
  let out = '';
  for (const ref of refs) {
    const obj = doc.context.lookup(ref);
    if (obj instanceof PDFRawStream) {
      const streamText = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
      for (const m of streamText.matchAll(/<([0-9A-Fa-f]{4,})>/g)) {
        out += Buffer.from(m[1], 'hex').toString('latin1');
      }
    }
  }
  return out;
}
function pdfText(pdfBytes, slug) {
  const p = join(tmpdir(), `iru-journey-${slug}.pdf`);
  writeFileSync(p, pdfBytes);
  try {
    return execFileSync('pdftotext', [p, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch {
    assert.fail('pdftotext unavailable in this environment — PDF text extraction could not run');
  }
}
/**
 * Deep inspection of a generated draft's REAL bytes: DRAFT banner
 * (drawn stamp + pdftotext), applicant values verbatim (never
 * translated), no 'undefined'/'NaN' artifacts, page count > 0.
 */
async function inspectDraftBytes(pdfBytes, { slug, familyField, family, givenField, given, dobField, dob }) {
  const doc = await PDFDocument.load(pdfBytes);
  assert.ok(doc.getPageCount() > 0, `${slug}: page count > 0`);
  assert.match(doc.getTitle(), /DRAFT/, `${slug}: PDF title carries DRAFT`);
  assert.equal(await fieldText(pdfBytes, familyField), family, `${slug}: family name verbatim in AcroForm`);
  if (givenField) assert.equal(await fieldText(pdfBytes, givenField), given, `${slug}: given name verbatim`);
  if (dobField) assert.equal(await fieldText(pdfBytes, dobField), dob, `${slug}: DOB verbatim`);
  const drawn = await drawnTextOnPage1(pdfBytes);
  assert.ok(drawn.includes('DRAFT'), `${slug}: page 1 drawn DRAFT stamp`);
  assert.ok(drawn.includes('FOR REVIEW ONLY') && drawn.includes('NOT SIGNED') && drawn.includes('NOT SUBMITTED'),
    `${slug}: full stamp wording`);
  const text = pdfText(pdfBytes, slug);
  assert.ok(text.includes('DRAFT — FOR REVIEW ONLY'), `${slug}: pdftotext sees the DRAFT banner`);
  assert.ok(text.includes(family), `${slug}: pdftotext sees the family name verbatim`);
  if (dob) assert.ok(text.includes(dob), `${slug}: pdftotext sees the DOB verbatim`);
  assert.ok(!/undefined|NaN/.test(text), `${slug}: no undefined/NaN artifacts in extracted text`);
  return { pageCount: doc.getPageCount(), text };
}
function assertSummaryClean(summary) {
  for (const p of summary.populated) {
    assert.ok(p.value && p.value !== 'undefined' && p.value !== 'NaN',
      `populated value is a real value: ${p.label}`);
  }
  assert.ok(!JSON.stringify(summary.nextSteps).includes('undefined'), 'next steps carry no undefined artifacts');
}

// ===========================================================================
// P1 — EN, U.S. with ZIP (Brooklyn 11201): the full spine
// ===========================================================================
describe('P1 journey — EN, Brooklyn with ZIP 11201', () => {
  it('intake → EN evaluation/fallback → fact record → I-589 draft (PDF-inspected) → EN packet steps → Brooklyn local match by ZIP', async () => {
    const answers = baseAnswers();
    // 1. Limited evaluation + deterministic fallback, in English.
    const evaluation = await limitedViaHandler({ answers, lang: 'EN', ip: '10.21.1.1' });
    assert.equal(evaluation.kind, 'limited-evaluation');
    assert.match(evaluation.headline, /preparation areas need attention/);
    assert.equal(evaluation.gapCategories[0].label, 'Identity documents');
    const { fb } = fallbackFor(answers, 'EN');
    assert.ok(fb.readinessSummary.startsWith('The automated readiness review could not be completed.'));

    // 2. Canonical fact record (approved narrative rides along, as in
    // the language-continuity draft test).
    const record = makeRecord({
      full_name: 'Marie Claire Toussaint', family_name: 'Toussaint',
      given_name: 'Marie', middle_name: 'Claire', date_of_birth: '05/14/1990',
      gender: 'female', marital_status: 'single', citizenship: 'Haiti',
      country_of_birth: 'Haiti', city_of_birth: 'Port-au-Prince',
      country_of_origin: 'Haiti', residence_country: 'US',
      residence_street: '123 Test Street', residence_city: 'Brooklyn',
      residence_region: 'NY', residence_postal_code: '11201',
      mailing_street: '123 Test Street', mailing_city: 'Brooklyn',
      mailing_region: 'NY', mailing_postal_code: '11201',
      application_reason: 'initial', has_passport: 'no',
    });
    const narrative = createNarrative(T0);
    addNarrativeEvent(narrative, { id: 'story_main', text: 'I arrived in 2023 and fear return.', date: '2023-03-01', factIds: [] }, T0);
    narrative.status = 'approved';
    record.narrative = narrative;

    // 3. I-589 draft + deep inspection of the real PDF bytes.
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-589', factRecord: record, lang: 'EN' });
    assert.equal(summary.nextSteps.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
    assert.equal(summary.draftDocumentLabel, 'IRU Pre-filled Draft — Review and Correct');
    assertSummaryClean(summary);
    const { pageCount } = await inspectDraftBytes(pdfBytes, {
      slug: 'p1-i589', familyField: F589.family, family: 'Toussaint',
      givenField: F589.given, given: 'Marie', dobField: F589.dob, dob: '05/14/1990',
    });
    assert.equal(pageCount, 12, 'I-589 template is 12 pages');

    // 4. Packet next steps in EN, tailored to the generated form.
    const packet = buildPacketNextSteps({
      caseType: 'asylum', readinessPercent: 60, evidenceItemCount: 3,
      conflicts: 0, unconfirmed: 0,
      form: { id: 'I-589', editionDate: getFormEntry('I-589').editionDate, sourceUrl: 'https://www.uscis.gov/i-589' },
      resourcesKind: 'verified', localResourcesName: 'Local Resources',
    }, 'EN');
    assert.equal(packet.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
    assert.ok(packet.review.join(' ').includes('I-589'));
    assert.ok(packet.searchPaths.some((p) => p.name === 'USCIS' && p.url === 'https://www.uscis.gov/'));

    // 5. Resources: the Brooklyn local match, established by ZIP.
    const res = resolveResourcesForLocation({ country: 'US', postalCode: '11201', city: 'Brooklyn', region: 'NY' });
    assert.equal(res.matchedBy, 'zip');
    assert.equal(res.fallback, false);
    assert.ok(res.local.some((o) => o.id === 'nyc-brooklyn-legal'), 'Brooklyn Legal Services is the local match');
  });
});

// ===========================================================================
// P2 — AR, U.S. city+state only (no ZIP): same spine, city-matched resources
// ===========================================================================
describe('P2 journey — AR, Brooklyn city+state, no ZIP', () => {
  it('intake → AR evaluation/fallback → record without any postal fact → I-589 draft → AR packet steps → Brooklyn match by city (matchedBy != zip)', async () => {
    const answers = baseAnswers({
      country_of_origin: 'Syria', country_of_birth: 'Syria', citizenship: 'Syria',
    });
    const evaluation = await limitedViaHandler({ answers, lang: 'AR', ip: '10.21.2.1' });
    assert.equal(evaluation.gapCategories[0].label, 'مستندات الهوية', 'first gap category in Arabic');
    assert.ok(evaluation.headline.includes('مجالات إعداد'), 'headline in Arabic');
    const { fb } = fallbackFor(answers, 'AR');
    assert.ok(fb.readinessSummary.startsWith('تعذر إكمال مراجعة الجاهزية الآلية.'));

    const record = makeRecord({
      full_name: 'Layla Haddad', family_name: 'Haddad', given_name: 'Layla',
      date_of_birth: '03/02/1992', gender: 'female', marital_status: 'married',
      citizenship: 'Syria', country_of_birth: 'Syria', city_of_birth: 'Aleppo',
      country_of_origin: 'Syria', residence_country: 'US',
      residence_street: '456 Test Avenue', residence_city: 'Brooklyn',
      residence_region: 'NY',
      mailing_street: '456 Test Avenue', mailing_city: 'Brooklyn', mailing_region: 'NY',
      application_reason: 'initial',
    });
    assert.equal(record.facts.residence_postal_code, undefined, 'no postal fact exists on this record');
    assert.equal(record.facts.mailing_postal_code, undefined);

    // Draft generates despite the missing postal code; the form's own
    // ZIP item is surfaced as missing, never a blocker or an error.
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-589', factRecord: record, lang: 'AR' });
    assert.equal(summary.nextSteps.title, 'خطواتك التالية — كيفية استخدام هذا التقرير');
    assert.notEqual(summary.draftDocumentLabel, 'IRU Pre-filled Draft — Review and Correct');
    assert.ok(summary.missingRequired.some((m) => /ZIP/i.test(m.label)), 'ZIP item surfaced as missing');
    assertSummaryClean(summary);
    assert.equal(await fieldText(pdfBytes, F589.family), 'Haddad', 'real bytes: family name verbatim');
    assert.equal(await fieldText(pdfBytes, F589.dob), '03/02/1992', 'real bytes: DOB verbatim');

    const packet = buildPacketNextSteps({
      caseType: 'asylum', readinessPercent: 50, evidenceItemCount: 3,
      conflicts: 0, unconfirmed: 0,
      form: { id: 'I-589', editionDate: getFormEntry('I-589').editionDate, sourceUrl: 'https://www.uscis.gov/i-589' },
      resourcesKind: 'verified', localResourcesName: 'Local Resources',
    }, 'AR');
    assert.equal(packet.title, 'خطواتك التالية — كيفية استخدام هذا التقرير');

    const res = resolveResourcesForLocation({ country: 'US', postalCode: '', city: 'Brooklyn', region: 'New York' });
    assert.equal(res.matchedBy, 'city');
    assert.notEqual(res.matchedBy, 'zip');
    assert.ok(res.local.some((o) => o.id === 'nyc-brooklyn-legal'),
      'Brooklyn Legal Services resolves via the city match');
  });
});

// ===========================================================================
// P3 — HT, non-U.S. residence (Haiti), no postal: core flow is not U.S.-gated
// ===========================================================================
describe('P3 journey — HT, residence country HT, language HT', () => {
  it('intake → HT evaluation/fallback → record → I-589 draft still generated (PDF-inspected, name never translated) → HT packet steps → national fallback + isInternational', async () => {
    const answers = baseAnswers({ residence_country: 'HT' });
    const evaluation = await limitedViaHandler({ answers, lang: 'HT', ip: '10.21.3.1' });
    assert.equal(evaluation.gapCategories[0].label, 'Dokiman idantite');
    assert.ok(evaluation.headline.includes('domèn preparasyon'));
    const { fb } = fallbackFor(answers, 'HT');
    assert.ok(fb.readinessSummary.startsWith('Revizyon preparasyon otomatik la pa t ka konplete.'));

    const record = makeRecord({
      full_name: 'Marie Claire Toussaint', family_name: 'Toussaint',
      given_name: 'Marie', middle_name: 'Claire', date_of_birth: '05/14/1990',
      gender: 'female', marital_status: 'single', citizenship: 'Haiti',
      country_of_birth: 'Haiti', city_of_birth: 'Port-au-Prince',
      country_of_origin: 'Haiti', residence_country: 'HT',
      residence_street: '12 Rue Test', residence_city: 'Port-au-Prince',
      application_reason: 'initial',
    });
    assert.equal(record.facts.residence_postal_code, undefined, 'no postal code exists or is required');

    // Form preparation is NOT gated on U.S. residence.
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-589', factRecord: record, lang: 'HT' });
    assert.equal(summary.nextSteps.title, 'PWOSHEN ETAP OU YO — KIJAN POU ITILIZE RAPÒ SA A');
    assertSummaryClean(summary);
    await inspectDraftBytes(pdfBytes, {
      slug: 'p3-i589-ht', familyField: F589.family, family: 'Toussaint',
      givenField: F589.given, given: 'Marie', dobField: F589.dob, dob: '05/14/1990',
    });

    const packet = buildPacketNextSteps({
      caseType: 'asylum', readinessPercent: null, evidenceItemCount: 4,
      conflicts: 0, unconfirmed: 0,
      form: { id: 'I-589', editionDate: getFormEntry('I-589').editionDate, sourceUrl: 'https://www.uscis.gov/i-589' },
      resourcesKind: 'international', localResourcesName: 'Local Resources',
    }, 'HT');
    assert.equal(packet.title, 'PWOSHEN ETAP OU YO — KIJAN POU ITILIZE RAPÒ SA A');
    assert.match(packet.resourcesIntro, /andeyò zòn kouvèti resous Etazini/,
      'HT packet carries the isInternational messaging');

    const res = resolveResourcesForLocation({ country: 'HT', city: 'Port-au-Prince' });
    assert.equal(res.isInternational, true);
    assert.equal(res.local.length, 0, 'no U.S. organization is presented as local');
    assert.equal(res.fallback, true);
    assert.ok(res.national.length >= 3, 'national fallback directories remain available');
  });
});

// ===========================================================================
// P4 — ES, missing + conflicting evidence: document review → conflict →
// correction → outputsStale → regenerated draft (PDF-inspected)
// ===========================================================================
describe('P4 journey — ES, conflicting document evidence', () => {
  it('mocked vision review extracts a conflicting DOB → fact conflicts → draft withholds it → ES next steps name conflict resolution → correction → regenerated PDF shows the corrected value', async () => {
    const answers = baseAnswers({
      country_of_origin: 'El Salvador', country_of_birth: 'El Salvador', citizenship: 'El Salvador',
    });
    const record = makeRecord({
      full_name: 'Carmen Vega', family_name: 'Vega', given_name: 'Carmen',
      date_of_birth: '07/22/1991', gender: 'female', marital_status: 'single',
      citizenship: 'El Salvador', country_of_birth: 'El Salvador',
      city_of_birth: 'San Salvador', country_of_origin: 'El Salvador',
      residence_country: 'US', residence_street: '789 Test Road',
      residence_city: 'Brooklyn', residence_region: 'NY', residence_postal_code: '11201',
      mailing_street: '789 Test Road', mailing_city: 'Brooklyn',
      mailing_region: 'NY', mailing_postal_code: '11201',
      application_reason: 'initial', has_passport: 'no',
    });
    // Missing evidence is part of this persona: the passport gap exists.
    const { min } = fallbackFor(answers, 'ES');
    assert.ok(buildGapRecords(min, [], 'ES').some((g) => g.key === 'has_passport'));

    // 1. Document review through the real handler, vision mocked (the
    // language-continuity pattern): the document shows a DIFFERENT DOB.
    const capture = {};
    globalThis.__IRU_VISION_CLIENT__ = {
      async reviewImage(args) {
        capture.args = args;
        return JSON.stringify({
          documentCategory: 'pasaporte', legibility: 'legible',
          fieldsVisible: ['name', 'date of birth'], appearsComplete: 'yes',
          inconsistencies: [], relatedReadinessItem: 'has_passport', limitations: [],
          extractedFields: [{ field: 'date_of_birth', value: '07/23/1991', page: 1 }],
        });
      },
    };
    let review;
    try {
      const res = jsonRes();
      await reviewImageHandler(mockReq('10.21.4.1', {
        imageBase64: TINY_PNG_B64, mimeType: 'image/png', lang: 'ES', relatedEvidenceKey: 'has_passport',
      }), res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      review = res.body.review;
    } finally {
      delete globalThis.__IRU_VISION_CLIENT__;
    }
    assert.ok(/Spanish/i.test(capture.args.prompt), 'vision prompt targets Spanish');
    assert.ok(review.limitations.some((l) => l.includes('no establece autenticidad')), 'ES disclaimer appended');
    const extracted = review.extractedFields.find((f) => f.field === 'date_of_birth');
    assert.equal(extracted.value, '07/23/1991', 'document DOB differs from the answer DOB');

    // 2. Extraction lands exactly as App.tsx applies it (source
    // 'document') → the fact is now CONFLICTING, primary value kept.
    for (const ef of review.extractedFields) {
      upsertFact(record, {
        id: ef.field, value: ef.value, source: 'document',
        sourceRef: { documentType: review.documentCategory, page: ef.page },
      }, T1);
    }
    const conflicted = record.facts.date_of_birth;
    assert.equal(conflicted.status, 'conflicting');
    assert.equal(conflicted.value, '07/22/1991', 'the applicant-reported value stays primary');
    assert.equal(conflicted.alternatives[0].value, '07/23/1991', 'the document value is preserved as the alternative');
    assert.equal(conflicted.needsConfirmation, true);

    // 3. A draft generated NOW withholds the conflicted DOB, and its
    // ES next steps name the conflict-resolution step.
    const before = await generateFormDraft({ formId: 'I-589', factRecord: record, lang: 'ES' });
    assert.ok(before.summary.conflicts.some((c) => c.factId === 'date_of_birth'),
      'summary surfaces the DOB conflict');
    assert.ok(!before.summary.populated.some((p) => p.pdfField === F589.dob),
      'conflicted DOB is never populated');
    const dobBefore = await fieldText(before.pdfBytes, F589.dob);
    assert.ok(!dobBefore || dobBefore === '', 'conflicted DOB is blank in the PDF itself');
    assert.equal(before.summary.nextSteps.title, 'SUS PRÓXIMOS PASOS — CÓMO USAR ESTE INFORME');
    assert.ok(before.summary.nextSteps.checklist.join(' ')
      .includes('Decida qué valor en conflicto es correcto'),
      'form next steps name the conflict-resolution step (ES)');
    const packet = buildPacketNextSteps({
      caseType: 'asylum', readinessPercent: 30, evidenceItemCount: 5,
      conflicts: 1, unconfirmed: 0,
      form: { id: 'I-589', editionDate: getFormEntry('I-589').editionDate, sourceUrl: 'https://www.uscis.gov/i-589' },
      resourcesKind: 'none', localResourcesName: 'Local Resources',
    }, 'ES');
    assert.match(packet.checklist.join(' '), /Resuelva los 1 elemento\(s\) en conflicto/,
      'packet next steps name the conflict-resolution step (ES)');

    // 4. The applicant corrects the record (the UI's own code path,
    // source 'correction') → conflict clears, outputs go stale.
    upsertFact(record, { id: 'date_of_birth', value: '07/23/1991', source: 'correction' }, T1);
    assert.equal(record.facts.date_of_birth.status, 'reported');
    assert.deepEqual(record.facts.date_of_birth.alternatives, []);
    assert.equal(record.outputsStale, true, 'the pre-correction draft is stale');

    // 5. Regeneration: the real PDF bytes carry the corrected value.
    const after2 = await generateFormDraft({ formId: 'I-589', factRecord: record, lang: 'ES' });
    assert.deepEqual(after2.summary.conflicts, []);
    assertSummaryClean(after2.summary);
    await inspectDraftBytes(after2.pdfBytes, {
      slug: 'p4-i589-es-corrected', familyField: F589.family, family: 'Vega',
      givenField: F589.given, given: 'Carmen', dobField: F589.dob, dob: '07/23/1991',
    });
  });
});

// ===========================================================================
// P5 — EN, evaluation → upgrade entitlement journey (paywall ON, one test)
// ===========================================================================
describe('P5 journey — EN, $1 evaluation → one-form upgrade → add-on', () => {
  let evt = 0;
  async function paySession(entitlementId) {
    const payload = JSON.stringify({
      id: `evt_journey_${++evt}`, type: 'checkout.session.completed',
      data: { object: { id: `sess_${entitlementId}`, payment_status: 'paid' } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const res = jsonRes();
    await webhookHandler(mockReq(`10.21.5.${100 + evt}`, {}, {
      rawBody: payload,
      headers: { 'x-forwarded-for': `10.21.5.${100 + evt}`, 'stripe-signature': signStripePayload(payload, process.env.STRIPE_WEBHOOK_SECRET, ts) },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.applied, true);
    return res;
  }
  async function checkout(body, ip) {
    const res = jsonRes();
    await checkoutHandler(mockReq(ip, body), res);
    return res;
  }
  async function buyAndPay(body, ip) {
    const res = await checkout(body, ip);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    await paySession(res.body.entitlementId);
    return { token: res.body.entitlementToken, id: res.body.entitlementId, checkout: res.body };
  }
  async function generateViaHandler(formId, token, record, ip) {
    const res = jsonRes();
    await generateHandler(mockReq(ip, { formId, factRecord: record, entitlementToken: token, lang: 'EN' }), res);
    return res;
  }

  before(() => {
    process.env.IRU_STRIPE_KEY = 'sk_test_local_only';
    // Payment-hardening gate: paid handlers require an explicit store backend.
    process.env.IRU_STORE_BACKEND = 'memory';
    process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_local';
    globalThis.__IRU_STRIPE_GATEWAY__ = {
      async createCheckoutSession({ entitlementId }) {
        return { id: `sess_${entitlementId}`, url: 'https://checkout.stripe.test/pay' };
      },
    };
  });
  after(() => {
    delete globalThis.__IRU_STRIPE_GATEWAY__;
    delete process.env.PAYWALL_ENABLED;
  });

  it('the full sequence in one journey: $1 evaluation delivered → I-589 upgrade generates, I-765 refused 402 → $50 add-on → I-765 generates; chain totals $149.95', async () => {
    process.env.PAYWALL_ENABLED = 'true';
    try {
      const record = makeRecord({
        full_name: 'Alex Ellis', family_name: 'Ellis', given_name: 'Alex',
        date_of_birth: '05/17/1990', gender: 'female', marital_status: 'married',
        citizenship: 'Testlandia', country_of_birth: 'Testlandia', city_of_birth: 'Test City',
        residence_street: '123 Test Street', residence_city: 'Brooklyn',
        residence_region: 'NY', residence_postal_code: '11201',
        mailing_street: '123 Test Street', mailing_city: 'Brooklyn',
        mailing_region: 'NY', mailing_postal_code: '11201',
        application_reason: 'initial',
      });

      // Step 1: $1 evaluation purchase (mocked gateway, signed webhook).
      const evaluation = await buyAndPay({ sku: SKUS.EVALUATION }, '10.21.5.1');
      assert.equal(evaluation.checkout.amountCents, 100);
      assert.deepEqual(evaluation.checkout.scope, { kind: 'evaluation' });

      // Step 2: the paid evaluation is delivered through /api/analyze
      // (mode 'limited', paywall on) and consumed exactly once.
      const evalRes = jsonRes();
      await analyzeHandler(mockReq('10.21.5.2', {
        mode: 'limited', answers: baseAnswers(), lang: 'EN', entitlementToken: evaluation.token,
      }), evalRes);
      assert.equal(evalRes.statusCode, 200, JSON.stringify(evalRes.body));
      assert.equal(evalRes.body.evaluation.kind, 'limited-evaluation');

      // Step 3: one-form upgrade for I-589 ($98.95 after the $1 credit).
      const oneForm = await buyAndPay(
        { sku: SKUS.ONE_FORM, formId: 'I-589', entitlementToken: evaluation.token }, '10.21.5.3');
      assert.equal(oneForm.checkout.amountCents, 9895);
      assert.equal(oneForm.checkout.totalCents, 9995);
      assert.deepEqual(oneForm.checkout.scope, { kind: 'forms', forms: ['I-589'] });

      // Step 4: the OTHER form is refused while the paywall is on —
      // before any delivery the scope reason is 'form-not-covered'
      // (a failed peek consumes nothing).
      const refused = await generateViaHandler('I-765', oneForm.token, record, '10.21.5.4');
      assert.equal(refused.statusCode, 402);
      assert.equal(refused.body.reason, 'form-not-covered');

      // Step 5: the purchased form generates through the gated handler.
      const gen589 = await generateViaHandler('I-589', oneForm.token, record, '10.21.5.5');
      assert.equal(gen589.statusCode, 200, JSON.stringify(gen589.body));
      assert.ok(gen589.body.draftId && gen589.body.pdfBase64.length > 1000);
      const bytes589 = Buffer.from(gen589.body.pdfBase64, 'base64');
      assert.equal(await fieldText(bytes589, F589.family), 'Ellis', 'I-589 draft carries the persona name');

      // Delivering the one covered form exhausts the one-form token:
      // the other form is still refused 402, now as 'state-CONSUMED'.
      const refusedAfter = await generateViaHandler('I-765', oneForm.token, record, '10.21.5.8');
      assert.equal(refusedAfter.statusCode, 402);
      assert.equal(refusedAfter.body.reason, 'state-CONSUMED');

      // Step 6: second-form add-on ($50.00) covers exactly the other form.
      const addon = await buyAndPay({ sku: SKUS.SECOND_FORM, entitlementToken: oneForm.token }, '10.21.5.6');
      assert.equal(addon.checkout.amountCents, 5000);
      assert.deepEqual(addon.checkout.scope, { kind: 'forms', forms: ['I-765'] });
      assert.equal(addon.checkout.totalCents, 14995);

      // Step 7: both forms have now generated end-to-end.
      const gen765 = await generateViaHandler('I-765', addon.token, record, '10.21.5.7');
      assert.equal(gen765.statusCode, 200, JSON.stringify(gen765.body));
      const bytes765 = Buffer.from(gen765.body.pdfBase64, 'base64');
      assert.equal(await fieldText(bytes765, F765.family), 'Ellis', 'I-765 draft carries the persona name');
      assert.equal(await fieldText(bytes765, F765.dob), '05/17/1990');

      // The paid chain is exactly $149.95 — never two forms for $99.95.
      assert.equal(
        evaluation.checkout.amountCents + oneForm.checkout.amountCents + addon.checkout.amountCents,
        14995);
    } finally {
      delete process.env.PAYWALL_ENABLED;
    }
  });
});

// ===========================================================================
// P6 — ZH, refresh/persistence + failed analysis keeps the language
// (The combined checkout-return behavior — persisted language restored
// AND purchase state server-derived together — is proven in
// language-completion.test.js and cited, not duplicated, here.)
// ===========================================================================
describe('P6 journey — ZH, persistence and AI failure', () => {
  // The WS2 mechanism, extracted from App.tsx exactly as
  // language-completion.test.js extracts it (full validation matrix
  // lives there; here only the journey's restore is exercised).
  function extractPersistenceFns(localStorageStub) {
    const key = appSrc.match(/export const LANG_STORAGE_KEY = '([^']+)'/)[1];
    const langs = appSrc.match(/export const SUPPORTED_LANGS = \[([^\]]+)\]/)[1]
      .split(',').map((s) => s.trim().replace(/'/g, ''));
    const extractFn = (name) => {
      const start = appSrc.indexOf(`export function ${name}`);
      let depth = 0; let end = -1;
      for (let i = appSrc.indexOf('{', start); i < appSrc.length; i++) {
        if (appSrc[i] === '{') depth++;
        if (appSrc[i] === '}' && --depth === 0) { end = i + 1; break; }
      }
      return appSrc.slice(start, end)
        .replace(`export function ${name}`, `function ${name}`)
        .replace(/: string/g, '').replace(/: void/g, '');
    };
    const factory = new Function('localStorage', 'LANG_STORAGE_KEY', 'SUPPORTED_LANGS',
      `${extractFn('loadPersistedLang')}\n${extractFn('persistLang')}\nreturn { loadPersistedLang, persistLang };`);
    return factory(localStorageStub, key, langs);
  }
  function fakeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  }

  it('persisted ZH restores → ZH spine completes → a failed analyze returns the ZH fallback (ai_unavailable) and the persisted language is still ZH', async () => {
    delete process.env.PAYWALL_ENABLED;
    // 1. Refresh simulation: the stored language code restores ZH.
    const store = fakeStorage();
    const { loadPersistedLang, persistLang } = extractPersistenceFns(store);
    persistLang('ZH');
    assert.equal(loadPersistedLang(), 'ZH', 'persisted ZH restores after a simulated reload');

    // 2. The ZH spine: limited evaluation + a generated draft.
    const answers = baseAnswers({
      country_of_origin: 'China', country_of_birth: 'China', citizenship: 'China',
    });
    const evaluation = await limitedViaHandler({ answers, lang: 'ZH', ip: '10.21.6.1' });
    assert.equal(evaluation.gapCategories[0].label, '身份证件');
    assert.ok(evaluation.headline.includes('需要关注'));
    // Builder-level parity for the same answers (deterministic path):
    assert.equal(buildLimitedEvaluation(
      minimizeForModel(sanitizeAnswers(answers).answers, []), 'ZH').gapCategories[0].label, '身份证件');

    const record = makeRecord({
      full_name: 'Mei Wang', family_name: 'Wang', given_name: 'Mei',
      date_of_birth: '04/09/1988', gender: 'female', marital_status: 'single',
      citizenship: 'China', country_of_birth: 'China', city_of_birth: 'Beijing',
      country_of_origin: 'China', residence_country: 'US',
      residence_street: '123 Test Street', residence_city: 'Brooklyn',
      residence_region: 'NY', residence_postal_code: '11201',
      mailing_street: '123 Test Street', mailing_city: 'Brooklyn',
      mailing_region: 'NY', mailing_postal_code: '11201',
      application_reason: 'initial',
    });
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-765', factRecord: record, lang: 'ZH' });
    assert.equal(summary.nextSteps.title, '您的后续步骤 — 如何使用本报告');
    assert.equal(await fieldText(pdfBytes, F765.family), 'Wang', 'real bytes: family name verbatim');
    assert.equal(await fieldText(pdfBytes, F765.dob), '04/09/1988');
    const packet = buildPacketNextSteps({
      caseType: 'asylum', readinessPercent: 45, evidenceItemCount: 3,
      conflicts: 0, unconfirmed: 0,
      form: { id: 'I-765', editionDate: getFormEntry('I-765').editionDate, sourceUrl: 'https://www.uscis.gov/i-765' },
      resourcesKind: 'verified', localResourcesName: 'Local Resources',
    }, 'ZH');
    assert.equal(packet.title, '您的后续步骤 — 如何使用本报告');

    // 3. A failed analyze request (mocked client throws) returns the
    // deterministic fallback — in ZH — with ai_unavailable status.
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() { throw new Error('provider down (synthetic)'); },
    };
    let events;
    try {
      const res = sseRes();
      await analyzeHandler(mockReq('10.21.6.2', { answers, lang: 'ZH', narrativeStarters: [] }), res);
      assert.equal(res.statusCode, 200);
      events = sseEvents(res);
    } finally {
      delete globalThis.__IRU_AI_CLIENT__;
    }
    const errEvent = events.find((e) => e.type === 'error');
    assert.ok(errEvent, 'the failure surfaces as an error event, not a crash');
    assert.equal(errEvent.status, 'ai_unavailable');
    assert.ok(errEvent.assessment.readinessSummary.startsWith('自动准备审核无法完成。'),
      'the fallback assessment after the failure is in ZH');
    assert.ok(errEvent.assessment.notLegalAdvice.startsWith('这是信息准备摘要'),
      'the fallback disclaimer is in ZH');
    const passportGap = errEvent.assessment.evidenceGaps.find((g) => g.key === 'has_passport');
    assert.ok(passportGap, 'the passport gap is present in the fallback');
    assert.equal(passportGap.targetFact, KB_I18N.ZH.has_passport.targetFact,
      'fallback gap content is the localized ZH KB text');

    // 4. The failure did not reset the language: persistence is intact
    // and still holds only the language code.
    assert.equal(loadPersistedLang(), 'ZH');
    assert.deepEqual([...store.map.entries()], [['iru_lang', 'ZH']]);
  });
});
