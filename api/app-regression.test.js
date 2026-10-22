import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static regression guards for src/App.tsx against the exact defect
// patterns that shipped to production in Oct 2026:
//  (a) a Start Over handler that existed but was never bound to the button;
//  (b) aiUnavailable checked AFTER the null-assessment branch, so failure
//      messaging never rendered;
//  (c) Start Over not resetting failure/form state.
// These are source-level guards (the browser E2E that would supersede
// them is tracked as an owner-authorization blocker); the behavior-level
// coverage lives in the facts/formmap/payment/analyze test suites.

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('App.tsx regression guards', () => {
  it('Start Over button is bound to handleStartOver', () => {
    assert.ok(app.includes('onClick={handleStartOver}'), 'Start Over button must call handleStartOver');
  });

  it('handleStartOver resets assessment, failure, resource and form state', () => {
    const start = app.indexOf('const handleStartOver');
    const body = app.slice(start, start + 1200);
    for (const needle of [
      'setAssessment(null)', 'setAiUnavailable(false)', 'setResourceResult(null)',
      'setFactRecord(null)', 'setFormSummary(null)', 'setFormPdfBase64(\'\')',
      "setStage('LANG')", 'setAnswers({})',
    ]) {
      assert.ok(body.includes(needle), `handleStartOver must include ${needle}`);
    }
  });

  it('failure messaging takes precedence over the null-assessment message', () => {
    const renderStart = app.indexOf('const renderAssessmentText');
    const body = app.slice(renderStart, renderStart + 500);
    assert.ok(body.indexOf('aiUnavailable') < body.indexOf('if (!a)'),
      'aiUnavailable must be checked before !a in renderAssessmentText');
  });

  it('client consumes the ai_unavailable stream status', () => {
    assert.ok(app.includes("event.status === 'ai_unavailable'"));
  });

  it('location is never a hard gate: ZIP step and new fact questions are optional', () => {
    assert.ok(app.includes("'zip_code', 'country_of_birth', 'citizenship', 'gender', 'marital_status'"),
      'Next button must not be disabled for optional questions');
  });

  it('country-aware fields are in the client→server allowlist', () => {
    for (const f of ['residence_country', 'country_of_birth', 'citizenship']) {
      assert.ok(app.includes(`'${f}'`), `allowlist must include ${f}`);
    }
  });

  it('resources resolve through the country-aware entry point', () => {
    assert.ok(app.includes('resolveResourcesForLocation'));
  });

  it('the canonical record is sent to /api/analyze', () => {
    assert.ok(app.includes('factRecord: record'));
  });
});

describe('App.tsx narrative stage guards (successive directive §4)', () => {
  it('buildFactRecord attaches a first-class narrative from the applicant\'s own words', () => {
    assert.ok(app.includes('rec.narrative = narrative'), 'record must carry the narrative object');
    assert.ok(app.includes('createNarrative(now)'), 'narrative must be built via lib/narrative.js');
    assert.ok(app.includes("text: ans.narrative_text"), 'event text must be the applicant\'s verbatim words');
  });

  it('narrative panel renders chronology, issues, and the approval gate', () => {
    assert.ok(app.includes('analyzeNarrative(factRecord.narrative, factRecord)'), 'panel must analyze the narrative');
    assert.ok(app.includes('onClick={handleApproveNarrative}'), 'approve button must be bound');
    assert.ok(app.includes('disabled={blocking.length > 0}'), 'approval must be disabled while blocking issues remain');
    assert.ok(app.includes('handleNarrativeDate(issue.eventId)'), 'missing-date issues must offer the correction path');
    assert.ok(app.includes('handleNarrativeConfirm(e.id)'), 'document-extracted events must offer applicant confirmation');
  });

  it('packet labels the narrative with its approval status', () => {
    assert.ok(app.includes('narrativeForPacket(factRecord.narrative, factRecord)'), 'packet must carry the honest narrative status label');
  });
});

describe('App.tsx B2C guards (2026-10-21 directive)', () => {
  it('the offer shows both options from the shared pricing module, before payment', () => {
    assert.ok(app.includes('buildOffer()'), 'offer must be built from api/_lib/pricing.js');
    assert.ok(app.includes('SKUS.EVALUATION'), 'evaluation purchase must use the server SKU');
    assert.ok(app.includes('SKUS.ONE_FORM') && app.includes('SKUS.BUNDLE') && app.includes('SKUS.SECOND_FORM_ADDON'), 'all B2C SKUs must be purchasable from the offer');
    assert.ok(app.includes("import { PRICING, SKUS, buildOffer, formatCents } from '../api/_lib/pricing.js'"), 'client and server share one pricing source');
  });

  it('every packet carries the mandated next-steps section', () => {
    assert.ok(app.includes('YOUR NEXT STEPS — HOW TO USE THIS REPORT'), 'exact next-steps title must be in the client');
    assert.ok(app.includes('buildPacketNextSteps()'), 'packet builder must exist');
    assert.ok(app.includes('nextStepsHtml'), 'printable packet must render the section');
    assert.ok(app.includes("from '../api/_lib/nextsteps.js'"), 'next-steps content must come from the shared module');
  });

  it('the form review experience carries both document labels and the checklist gate', () => {
    assert.ok(app.includes('IRU Pre-filled Draft — Review and Correct'), 'draft label must appear');
    assert.ok(app.includes('Official Blank Form — Reference Copy'), 'blank-form label must appear');
    assert.ok(app.includes('/api/blank-form?form='), 'blank download must use the verified-template endpoint');
    assert.ok(app.includes('finalReviewChecklist'), 'final review checklist must render from the summary');
    assert.ok(app.includes('setFormDraftMeta'), 'draft versions must be identified');
  });

  it('generation sends the token that covers the selected form', () => {
    assert.ok(app.includes('formTokens[selectedFormId]'), 'scoped form tokens must be selected per form');
    assert.ok(app.includes("sessionStorage.getItem('iru_evaluation_token')"), 'evaluation token must be kept for upgrades');
  });
});
