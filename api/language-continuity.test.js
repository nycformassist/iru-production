/**
 * Language-continuity regression tests (owner directive 2026-10-22).
 *
 * Guards the fixes from the end-to-end language audit: every supported
 * language (EN/ES/ZH/HT/AR) must carry the FULL UI dictionary, server
 * guidance builders must localize with an explicit lang (English output
 * byte-identical when lang is omitted), the client must send lang to
 * the AI endpoints, and the official form PDF stays English while its
 * surrounding guidance localizes. Synthetic data only.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import { getFormEntry } from './_lib/forms/registry.js';
import { buildFillPlan, buildCompletionSummary } from './_lib/formmap.js';
import { buildFormNextSteps, buildPacketNextSteps } from './_lib/nextsteps.js';
import { fallbackAssessment, validateModelOutput, OUTPUT_SCHEMA_KEYS } from './_lib/prompt.js';
import { buildLimitedEvaluation } from './_lib/evaluation.js';
import { sanitizeVisionReview, visionDisclaimer } from './_lib/vision.js';
import { createNarrative, addNarrativeEvent, analyzeNarrative } from './_lib/narrative.js';
import { generateFormDraft } from './generate-form.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANGS = ['ES', 'ZH', 'HT', 'AR'];
const T = '2026-10-22T00:00:00.000Z';

// ---------------------------------------------------------------------------
// UI dictionary parity: transpile src/constants.tsx with the repo's own
// typescript and import it as a module (it has no imports of its own).
// ---------------------------------------------------------------------------
async function loadConstants() {
  const source = readFileSync(join(HERE, '..', 'src', 'constants.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

describe('UI_LABELS dictionary parity', () => {
  it('every EN key (incl. nested maps) exists and is non-empty in ES/ZH/HT/AR', async () => {
    const { UI_LABELS } = await loadConstants();
    const en = UI_LABELS.EN;
    assert.ok(en, 'EN dictionary exists');
    const flatKeys = Object.keys(en).filter((k) => typeof en[k] === 'string');
    for (const lang of LANGS) {
      const dict = UI_LABELS[lang];
      assert.ok(dict, `${lang} dictionary exists`);
      for (const key of flatKeys) {
        assert.equal(typeof dict[key], 'string', `${lang} missing string key: ${key}`);
        assert.ok(dict[key].length > 0, `${lang} key empty: ${key}`);
      }
      for (const nested of ['evidenceStates', 'factLabels', 'evidenceItemNames']) {
        assert.ok(en[nested], `EN has ${nested}`);
        for (const key of Object.keys(en[nested])) {
          assert.equal(typeof dict[nested]?.[key], 'string', `${lang} missing ${nested}.${key}`);
          assert.ok(dict[nested][key].length > 0, `${lang} ${nested}.${key} empty`);
        }
      }
    }
  });

  it('every USCIS_FORMS entry carries descI18n for ES/ZH/HT/AR', async () => {
    const { USCIS_FORMS } = await loadConstants();
    for (const [caseType, forms] of Object.entries(USCIS_FORMS)) {
      for (const form of forms) {
        for (const lang of LANGS) {
          assert.ok(form.descI18n && form.descI18n[lang], `${caseType}/${form.name} missing descI18n.${lang}`);
        }
      }
    }
  });

  it('buildExecutiveSummary localizes framing, keeps facts verbatim', async () => {
    const { buildExecutiveSummary } = await loadConstants();
    const parts = { name: 'Marie Test', country: 'Haiti', caseType: 'asylum', entryDate: '2023-03-01', residenceCountry: 'US', zip: '11226' };
    const en = buildExecutiveSummary('EN', parts);
    assert.equal(en, 'Marie Test, originally from Haiti, entered the United States on 2023-03-01 and is currently seeking asylum. They reside in the 11226 zip code area and have completed an initial evidence audit to prepare for their legal consultation.');
    for (const lang of LANGS) {
      const out = buildExecutiveSummary(lang, parts);
      assert.ok(out.includes('Marie Test') && out.includes('Haiti') && out.includes('2023-03-01'), `${lang} keeps applicant facts`);
      assert.ok(!out.includes('originally from'), `${lang} framing is localized`);
    }
  });
});

// ---------------------------------------------------------------------------
// Welcome-screen redesign (owner directive 2026-10-22): copy supersession
// in all five languages + markup-level guards for the visual redesign.
// (Live browser rendering is out of scope — no preview authorization.)
// ---------------------------------------------------------------------------
describe('welcome screen redesign', () => {
  it('headline + supporting sentence carry the approved copy in all 5 languages', async () => {
    const { UI_LABELS } = await loadConstants();
    const expected = {
      EN: ['Your immigration journey starts here.', 'Organize your information, prepare your forms, and understand your next steps.'],
      ES: ['Su viaje migratorio comienza aquí.', 'Organice su información, prepare sus formularios y comprenda sus próximos pasos.'],
      ZH: ['您的移民之旅从这里开始。', '整理您的信息，准备您的表格，并了解您的后续步骤。'],
      HT: ['Vwayaj imigrasyon ou kòmanse isit la.', 'Òganize enfòmasyon ou, prepare fòm ou yo, epi konprann pwochen etap ou yo.'],
      AR: ['رحلتك في الهجرة تبدأ هنا.', 'نظّم معلوماتك، وحضّر نماذجك، وافهم خطواتك التالية.'],
    };
    for (const [lang, [subtitle, welcomeDesc]] of Object.entries(expected)) {
      assert.equal(UI_LABELS[lang].subtitle, subtitle, `${lang} subtitle`);
      assert.equal(UI_LABELS[lang].welcomeDesc, welcomeDesc, `${lang} welcomeDesc`);
    }
  });

  it('markup: gradient + waves are LANG-only and decorative; container softens on LANG only', () => {
    const app = readFileSync(join(HERE, '..', 'src', 'App.tsx'), 'utf8');
    assert.ok(app.includes("stage === 'LANG' ? { background: 'radial-gradient("), 'LANG-only gradient background');
    assert.ok(app.includes('aria-hidden="true" focusable="false"'), 'wave svg is decorative');
    assert.ok(app.includes('pointer-events-none absolute inset-x-0 bottom-0'), 'waves cannot intercept clicks or cause scroll');
    assert.ok(app.includes("stage === 'LANG' ? 'bg-transparent border-transparent shadow-none' : 'bg-white shadow-sm border-slate-200'"), 'container softened only on LANG');
    assert.ok((app.match(/t\('welcomeDesc'/g) || []).length === 1, 'welcomeDesc rendered exactly once (in the header)');
    assert.ok(app.indexOf("t('welcomeDesc'") < app.indexOf('LANGUAGES.map'), 'welcomeDesc sits in the header, above the language grid');
    assert.ok(!app.includes('Get guided help preparing'), 'superseded copy is gone');
  });

  it('markup: all five language cards keep the existing behavior and gain the selected state + chevron', () => {
    const app = readFileSync(join(HERE, '..', 'src', 'App.tsx'), 'utf8');
    assert.ok(app.includes('LANGUAGES.map((l) => ('), 'cards still come from the LANGUAGES map');
    assert.ok(app.includes("onClick={() => { setLang(l.code); setStage('PHASE1'); setCurrentQ(0); }}"), 'selection behavior unchanged');
    assert.ok(app.includes('lang === l.code ? \'border-blue-600 bg-blue-50 shadow-sm\''), 'selected card state keyed on current lang');
    assert.ok(app.includes('aria-pressed={lang === l.code}'), 'selected state exposed to assistive tech');
    assert.ok(app.includes('<ChevronRight className="w-5 h-5 text-blue-500 shrink-0" aria-hidden="true" />'), 'chevron rendered per card');
    assert.ok(app.includes('focus-visible:ring-2 focus-visible:ring-blue-600'), 'keyboard focus is visible');
    assert.ok(app.includes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'), 'responsive grid preserved (1 / 2 / 3 columns)');
  });
});

// ---------------------------------------------------------------------------
// Client wiring guards (source-level, same style as app-regression.test.js)
// ---------------------------------------------------------------------------
describe('App.tsx language wiring', () => {
  const app = readFileSync(join(HERE, '..', 'src', 'App.tsx'), 'utf8');
  it('sends lang to /api/review-image and /api/generate-form', () => {
    assert.ok(app.includes("fetch('/api/review-image'"), 'review-image call exists');
    assert.ok(app.includes("fetch('/api/generate-form'"), 'generate-form call exists');
    assert.ok(app.includes('formId: selectedFormId, factRecord, lang'), 'generate-form body carries lang');
    assert.ok(app.includes('relatedEvidenceKey: photoEvidenceKey || undefined,\n          lang,'), 'review-image body carries lang');
  });
  it('maps server refusal reason codes to localized messages (no raw server text)', () => {
    assert.ok(app.includes("reason === 'narrative-not-approved'"), 'narrative gate mapped');
    assert.ok(app.includes("t('errNarrativeGate'"), 'narrative gate message localized');
    assert.ok(app.includes("reason === 'evaluation-required'"), 'checkout evaluation-required mapped');
    assert.ok(app.includes("reason === 'already-purchased'"), 'checkout already-purchased mapped');
    assert.ok(!app.includes('throw new Error((data && data.error)'), 'raw server error text is never thrown to the UI');
  });
});

// ---------------------------------------------------------------------------
// Server guidance builders
// ---------------------------------------------------------------------------
function baseRecord() {
  const r = createFactRecord(T);
  const put = (id, value, source = 'answer') => upsertFact(r, { id, value, source }, T);
  put('family_name', 'Testfamily');
  put('given_name', 'Testgiven');
  put('date_of_birth', '1990-05-17');
  return r;
}

describe('form completion summary localization', () => {
  const entry = getFormEntry('I-589');
  it('EN defaults are byte-identical to the original strings', () => {
    const plan = buildFillPlan(baseRecord(), entry);
    const s = buildCompletionSummary(entry, plan, baseRecord());
    assert.equal(s.draftDocumentLabel, 'IRU Pre-filled Draft — Review and Correct');
    assert.equal(s.blankForm.label, 'Official Blank Form — Reference Copy');
    assert.match(s.staleVersionNote, /stale/i);
    assert.equal(s.nextSteps.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
    assert.equal(s.finalReviewChecklist[0], 'I checked every populated field on the draft against my own records and documents.');
  });
  it('ES summary localizes guidance and the next-steps labels match the summary labels', () => {
    const plan = buildFillPlan(baseRecord(), entry, 'ES');
    const s = buildCompletionSummary(entry, plan, baseRecord(), 'ES');
    assert.equal(s.draftDocumentLabel, 'Borrador prellenado de IRU — Revisar y corregir');
    assert.equal(s.blankForm.label, 'Formulario oficial en blanco — Copia de referencia');
    assert.equal(s.nextSteps.title, 'SUS PRÓXIMOS PASOS — CÓMO USAR ESTE INFORME');
    assert.ok(s.nextSteps.reviewForm[0].includes(s.draftDocumentLabel), 'draft label quoted consistently');
    assert.ok(s.nextSteps.reviewForm[0].includes(s.blankForm.label), 'blank label quoted consistently');
    assert.ok(!s.finalReviewChecklist.join(' ').includes('I checked every populated field'), 'checklist localized');
  });
  it('buildFormNextSteps title differs from English in every supported language', () => {
    const plan = buildFillPlan(baseRecord(), entry);
    for (const lang of LANGS) {
      const ns = buildFormNextSteps(entry, plan, lang);
      assert.notEqual(ns.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT', `${lang} title localized`);
      assert.ok(ns.understand.length > 0 && ns.checklist.length > 0, `${lang} body present`);
    }
  });
  it('buildPacketNextSteps localizes and keeps the EN default identical in shape', () => {
    const ctx = { caseType: 'asylum', readinessPercent: 40, evidenceItemCount: 2, conflicts: 1, unconfirmed: 1, form: null, resourcesKind: 'none', localResourcesName: 'Local Resources' };
    const en = buildPacketNextSteps(ctx, 'EN');
    assert.equal(en.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
    assert.ok(en.understand[0].startsWith('This report organizes the information you provided'));
    for (const lang of LANGS) {
      const out = buildPacketNextSteps(ctx, lang);
      assert.notEqual(out.title, en.title, `${lang} packet title localized`);
      assert.ok(!out.understand.join(' ').includes('This report organizes'), `${lang} packet body localized`);
      assert.equal(out.checklist.length, en.checklist.length, `${lang} checklist length parity`);
    }
  });
});

describe('fallback + evaluation localization', () => {
  const min = { evidence: { has_passport: 'no' }, caseType: 'asylum', countryOfOrigin: 'Haiti', entryYear: 2023, entryDateFlag: null };
  it('fallbackAssessment EN unchanged, ES framing localized', () => {
    const en = fallbackAssessment(min, [], []);
    assert.ok(en.readinessSummary.startsWith('The automated readiness review could not be completed.'));
    const es = fallbackAssessment(min, [], [], 'ES');
    assert.ok(es.readinessSummary.startsWith('La revisión automática de preparación no pudo completarse.'));
    assert.ok(!es.readinessSummary.includes('could not be completed'));
  });
  it('buildLimitedEvaluation localizes category labels, EN default unchanged', () => {
    const en = buildLimitedEvaluation(min);
    assert.equal(en.gapCategories[0].label, 'Identity documents');
    const ht = buildLimitedEvaluation(min, 'HT');
    assert.notEqual(ht.gapCategories[0].label, 'Identity documents');
    assert.deepEqual(Object.keys(ht.gapCategories[0]).sort(), ['id', 'itemsNeedingAttention', 'label', 'status']);
  });
});

describe('narrative question localization', () => {
  it('missing-date question localizes; EN default unchanged', () => {
    const rec = createFactRecord(T);
    const n = createNarrative(T);
    addNarrativeEvent(n, { id: 'e1', text: 'Something happened to me.', date: null, factIds: [] }, T);
    const en = analyzeNarrative(n, rec);
    assert.ok(en.issues[0].question.startsWith('When did this happen?'));
    const zh = analyzeNarrative(n, rec, 'ZH');
    assert.ok(!zh.issues[0].question.includes('When did this happen?'), 'ZH question localized');
    assert.ok(zh.issues[0].question.includes('Something happened to me.'), 'applicant text kept verbatim');
  });
});

describe('vision disclaimer localization', () => {
  const review = { documentCategory: 'paspò', legibility: 'legible', fieldsVisible: [], appearsComplete: 'yes', inconsistencies: [], relatedReadinessItem: 'none', limitations: [] };
  it('appends the disclaimer in the review language', () => {
    const ht = sanitizeVisionReview({ ...review }, 'HT');
    assert.ok(ht.data.limitations.some((l) => l.includes('pa etabli otantisite')), 'HT disclaimer appended');
    const es = sanitizeVisionReview({ ...review }, 'ES');
    assert.ok(es.data.limitations.some((l) => l.includes('no establece autenticidad')), 'ES disclaimer appended');
  });
  it('does not stack a second disclaimer when one exists in any language', () => {
    const withEs = sanitizeVisionReview({ ...review, limitations: [visionDisclaimer('ES')] }, 'EN');
    assert.equal(withEs.data.limitations.length, 1);
  });
});

describe('model-output safety validation is multilingual', () => {
  function payload(summary) {
    const obj = {};
    for (const key of OUTPUT_SCHEMA_KEYS) obj[key] = [];
    obj.readinessSummary = summary;
    obj.notLegalAdvice = 'This is not legal advice.';
    return JSON.stringify(obj);
  }
  it('rejects a Spanish verification claim', () => {
    const r = validateModelOutput(payload('Su documento está verificado y su caso será aprobado.'));
    assert.equal(r.ok, false);
  });
  it('accepts a clean Spanish summary', () => {
    const r = validateModelOutput(payload('Este resumen organiza la información que usted proporcionó.'));
    assert.equal(r.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Endpoint-level: review-image prompt language + generate-form summary
// ---------------------------------------------------------------------------
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('review-image endpoint language', () => {
  let handler;
  beforeEach(async () => {
    delete globalThis.__IRU_VISION_CLIENT__;
    delete process.env.GEMINI_API_KEY;
    handler = (await import('./review-image.js')).default;
  });
  it('HT request puts a Haitian Creole instruction in the vision prompt', async () => {
    const capture = {};
    globalThis.__IRU_VISION_CLIENT__ = {
      async reviewImage(args) {
        capture.args = args;
        return JSON.stringify({ documentCategory: 'paspò', legibility: 'legible', fieldsVisible: [], appearsComplete: 'yes', inconsistencies: [], relatedReadinessItem: 'none', limitations: [] });
      },
    };
    const req = { method: 'POST', headers: {}, socket: { remoteAddress: 'lc-ht-1' }, body: { imageBase64: TINY_PNG_B64, mimeType: 'image/png', lang: 'HT' } };
    const res = { statusCode: 200, headers: {}, jsonBody: null, status(c) { this.statusCode = c; return this; }, setHeader() {}, json(o) { this.jsonBody = o; return this; } };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(/Haitian Creole/i.test(capture.args.prompt), 'prompt names the target language');
    assert.ok(res.jsonBody.review.limitations.some((l) => l.includes('pa etabli otantisite')), 'response disclaimer is in HT');
  });
});

describe('generateFormDraft language', () => {
  it('ES draft: summary guidance in Spanish; filled PDF values stay as provided', async () => {
    const narrative = createNarrative(T);
    addNarrativeEvent(narrative, { id: 'story_main', text: 'Test story.', date: '2023-03-01', factIds: [] }, T);
    narrative.status = 'approved';
    const rec = baseRecord();
    rec.narrative = narrative;
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-589', factRecord: rec, lang: 'ES' });
    assert.equal(summary.draftDocumentLabel, 'Borrador prellenado de IRU — Revisar y corregir');
    assert.equal(summary.nextSteps.title, 'SUS PRÓXIMOS PASOS — CÓMO USAR ESTE INFORME');
    const pdf = await PDFDocument.load(pdfBytes);
    const form = pdf.getForm();
    const values = form.getFields().map((f) => { try { return f.getText ? f.getText() : ''; } catch { return ''; } }).filter(Boolean).join(' | ');
    assert.ok(values.includes('Testfamily'), 'applicant surname filled verbatim');
    assert.ok(values.includes('Testgiven'), 'applicant given name filled verbatim');
  });
});
