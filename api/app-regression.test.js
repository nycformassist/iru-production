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
