/**
 * startover-canada-display.test.js — 2026-10-28 release-decision fixes.
 *
 * (1) Start Over hardening: handleStartOver must clear the workflow
 *     state a packet run leaves behind (narrative edits, fact editor,
 *     in-flight busy flags) in addition to the state it already cleared,
 *     so a fresh run in the same tab cannot inherit stale state.
 *     Payment tokens are deliberately NOT cleared.
 * (2) Canada display: a stored country code ('CA') must be presented
 *     to users as its name ('Canada') in the record rows (screen +
 *     print) and in the model prompt (name + code), while the stored
 *     value and client resource matching keep using the code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minimizeForModel, RESIDENCE_NOT_PROVIDED } from './_lib/privacy.js';
import { buildPrompt } from './_lib/prompt.js';
import { countryName, residencePromptValue } from './_lib/countries.js';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const location = readFileSync(new URL('../src/location.ts', import.meta.url), 'utf8');

function handleStartOverBody() {
  const start = app.indexOf('const handleStartOver');
  assert.ok(start >= 0, 'handleStartOver must exist');
  const end = app.indexOf('const applyFactMutation', start);
  return app.slice(start, end > start ? end : start + 2500);
}

describe('Start Over clears the remaining workflow state', () => {
  it('still clears the original packet state', () => {
    const body = handleStartOverBody();
    for (const needle of [
      'setAssessment(null)', 'setAiUnavailable(false)', 'setResourceResult(null)',
      'setFactRecord(null)', 'setFormDraftStore(emptyFormDraftStore())',
      "setStage('LANG')", 'setAnswers({})', 'setRequestId',
    ]) {
      assert.ok(body.includes(needle), `handleStartOver must include ${needle}`);
    }
  });

  it('also clears narrative edits, the fact editor, and busy flags', () => {
    const body = handleStartOverBody();
    for (const needle of [
      'setNarrativeDates({})', "setNarrativeError('')", "setFactEditValue('')",
      'setFormBusy(false)', 'setCheckoutBusy(false)', 'setReviewing(false)',
    ]) {
      assert.ok(body.includes(needle), `handleStartOver must include ${needle}`);
    }
  });

  it('does not clear payment tokens', () => {
    const body = handleStartOverBody();
    assert.ok(!body.includes('iru_evaluation_token'), 'Start Over must not touch evaluation tokens');
    assert.ok(!body.includes('removeItem'), 'Start Over must not clear storage keys beyond the recovery key');
  });

  it('the Start Over button is an explicit non-submit button bound to the handler', () => {
    assert.ok(app.includes('onClick={handleStartOver}'), 'button must call handleStartOver');
    const idx = app.indexOf('onClick={handleStartOver}');
    const tag = app.slice(Math.max(0, idx - 200), idx + 100);
    assert.ok(tag.includes('type="button"'), 'Start Over button must declare type="button"');
  });
});

describe('Canada display: code stays, name is presented', () => {
  it('server country names map codes to names, unknown codes fall back to the code', () => {
    assert.equal(countryName('CA'), 'Canada');
    assert.equal(countryName('US'), 'United States');
    assert.equal(countryName('OTHER'), 'Other / not listed');
    assert.equal(countryName('XX'), 'XX');
    assert.equal(residencePromptValue('CA'), 'Canada (CA)');
    assert.equal(residencePromptValue('XX'), 'XX');
  });

  it('the stored residence value is still the code', () => {
    const base = { country_of_origin: 'Cuba', entry_date: '2026-10-13', case_type: 'asylum', narrative_text: '' };
    assert.equal(minimizeForModel({ ...base, residence_country: 'CA' }, []).residenceCountry, 'CA');
  });

  it('the prompt gives the model name + code, sentinel and Unknown paths unchanged', () => {
    const base = { country_of_origin: 'Cuba', entry_date: '2026-10-13', case_type: 'asylum', narrative_text: '' };
    const p = buildPrompt(minimizeForModel({ ...base, residence_country: 'CA' }, []));
    assert.ok(p.includes('Country of residence: Canada (CA)'), 'prompt must carry the name');
    const sentinel = buildPrompt(minimizeForModel(base, []));
    assert.ok(sentinel.includes('Country of residence: Not provided ('), 'sentinel path unchanged');
    assert.equal(RESIDENCE_NOT_PROVIDED, 'Not provided');
  });

  it('client record rows render the display name, not the raw code', () => {
    assert.ok(location.includes('export function countryDisplayName'), 'location helper must exist');
    assert.ok(app.includes('countryDisplayName'), 'App must use the display helper');
    assert.ok(app.includes('const displayFactValue'), 'display helper must be defined');
    assert.ok(app.includes('{displayFactValue(f)}'), 'on-screen record row must use the display helper');
    assert.ok(app.includes('escapeHtml(displayFactValue(f))'), 'print record row must use the display helper');
  });

  it('resource matching still uses the code, not the name', () => {
    assert.ok(app.includes("isUsCountry(answers.residence_country || 'US')"), 'US check must stay code-based');
    assert.ok(location.includes("return !code || code === 'US'"), 'isUsCountry must stay code-based');
  });
});
