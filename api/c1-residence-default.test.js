/**
 * c1-residence-default.test.js — C1 A+B (residence contradiction).
 *
 * The questionnaire's location dropdown DISPLAYS 'US' but writes
 * residence_country only on change. Untouched, the server used to send the
 * model "Unknown" while the client record asserted US as an answer, so the
 * review said "country of residence is unknown" beside a record showing US.
 *
 * Fix (dropdown and resource lookup untouched, no new data to the model):
 *  - minimizeForModel: untouched -> RESIDENCE_NOT_PROVIDED, not 'Unknown'.
 *  - prompt: prints the sentinel explicitly and forbids listing it as
 *    missing/unknown.
 *  - client record: a defaulted residence fact is labelled as a form default.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minimizeForModel, RESIDENCE_NOT_PROVIDED } from './_lib/privacy.js';
import { buildPrompt } from './_lib/prompt.js';

const base = { country_of_origin: 'Cuba', entry_date: '2026-10-13', case_type: 'asylum', narrative_text: '' };

describe('C1: untouched residence is not "Unknown"', () => {
  it('minimizer uses the Not-provided sentinel when no country was selected', () => {
    assert.equal(RESIDENCE_NOT_PROVIDED, 'Not provided');
    assert.equal(minimizeForModel(base, []).residenceCountry, RESIDENCE_NOT_PROVIDED);
  });

  it('a selected country passes through unchanged', () => {
    assert.equal(minimizeForModel({ ...base, residence_country: 'MX' }, []).residenceCountry, 'MX');
    assert.equal(minimizeForModel({ ...base, residence_country: 'US' }, []).residenceCountry, 'US');
  });

  it('prompt prints the sentinel (not "Unknown") and carries the never-list-as-missing rule', () => {
    const p = buildPrompt(minimizeForModel(base, []));
    assert.ok(p.includes('Country of residence: Not provided ('), 'sentinel line must be explicit');
    assert.ok(!/Country of residence: Unknown/.test(p), 'must not tell the model residence is Unknown');
    assert.ok(/never describe residence as unknown, missing, or unclear/i.test(p));
    assert.ok(/country level BY DESIGN/i.test(p), 'existing record-fidelity rule must survive');
  });

  it('a real selection renders plainly with no default wording', () => {
    const p = buildPrompt(minimizeForModel({ ...base, residence_country: 'MX' }, []));
    assert.ok(p.includes('Country of residence: MX'));
    assert.ok(!p.includes('Country of residence: Not provided'));
  });

  it('legacy min objects without residenceCountry still print Unknown (no throw)', () => {
    const m = minimizeForModel(base, []);
    delete m.residenceCountry;
    assert.ok(buildPrompt(m).includes('Country of residence: Unknown'));
  });
});

describe('C1: client record labels a defaulted residence honestly', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const consts = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');

  it('helper exists and is used by both the on-screen record and the print packet', () => {
    assert.ok(/const isDefaultedResidence = /.test(app), 'helper must be defined');
    const uses = app.match(/isDefaultedResidence\(f\)/g) || [];
    assert.equal(uses.length, 2, `expected one on-screen use and one print use, found ${uses.length}`);
    assert.ok(/!answers\.residence_country/.test(app), 'label must clear once a country is actually selected');
    assert.ok(/f\.source === 'answer'/.test(app), 'a correction must clear the label');
  });

  it('the dropdown behavior is unchanged: still shows US, still writes only on change', () => {
    assert.ok(app.includes("value={answers.residence_country || 'US'}"));
    assert.ok(app.includes('onChange={(e) => setAnswers({ ...answers, residence_country: e.target.value })}'));
  });

  it('the new label exists in all five languages', () => {
    assert.equal((consts.match(/factStatusDefault:/g) || []).length, 5);
  });
});
