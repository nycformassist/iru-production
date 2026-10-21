import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFactRecord, upsertFact } from './lib/facts.js';
import { getFormEntry } from './lib/forms/registry.js';
import { buildFillPlan, buildCompletionSummary } from './lib/formmap.js';
import { generateFormDraft } from './generate-form.js';
import { NEXT_STEPS_TITLE, buildFormNextSteps } from './lib/nextsteps.js';
import { resolveResourcesForLocation } from '../src/resources.ts';

// B2C directive §6/§7 — "YOUR NEXT STEPS — HOW TO USE THIS REPORT" in
// every output, tailored to form + findings, ZIP-independent, honest
// resources, and no workflow blocked by a missing ZIP. Tests 19–25.

const T = '2026-10-21T00:00:00.000Z';
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

function recordWith({ withZip = true } = {}) {
  const r = createFactRecord(T);
  const put = (id, value) => upsertFact(r, { id, value, source: 'answer' }, T);
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
  if (withZip) put('mailing_postal_code', '10451');
  put('application_reason', 'initial');
  return r;
}

describe('next-steps guidance (B2C §6)', () => {
  it('test 19: every form output carries the section under its exact mandated title', () => {
    assert.equal(NEXT_STEPS_TITLE, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
    for (const formId of ['I-589', 'I-765']) {
      const entry = getFormEntry(formId);
      const record = recordWith();
      const plan = buildFillPlan(record, entry);
      const summary = buildCompletionSummary(entry, plan, record);
      assert.equal(summary.nextSteps.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
      for (const part of ['understand', 'reviewForm', 'professionalHelp', 'checklist']) {
        assert.ok(Array.isArray(summary.nextSteps[part]) && summary.nextSteps[part].length > 0, `${formId} nextSteps.${part}`);
      }
      assert.ok(Array.isArray(summary.nextSteps.resources.searchPaths) && summary.nextSteps.resources.searchPaths.length > 0);
    }
    // The readiness packet carries the same titled section:
    assert.ok(app.includes('YOUR NEXT STEPS — HOW TO USE THIS REPORT'), 'packet must include the exact next-steps title');
  });

  it('test 20: guidance is tailored to the selected form and the actual findings', () => {
    const record = recordWith();
    const s589 = buildFormNextSteps(getFormEntry('I-589'), buildFillPlan(record, getFormEntry('I-589')));
    const s765 = buildFormNextSteps(getFormEntry('I-765'), buildFillPlan(record, getFormEntry('I-765')));
    assert.match(s589.understand.join(' '), /I-589/);
    assert.match(s589.understand.join(' '), /07\/28\/26/);
    assert.match(s765.understand.join(' '), /I-765/);
    assert.match(s765.understand.join(' '), /08\/21\/25/);
    // A record missing a required item names that item in the guidance:
    const incomplete = createFactRecord(T);
    upsertFact(incomplete, { id: 'family_name', value: 'Onlyname', source: 'answer' }, T);
    const planInc = buildFillPlan(incomplete, getFormEntry('I-765'));
    const stepsInc = buildFormNextSteps(getFormEntry('I-765'), planInc);
    assert.ok(planInc.missing.length > 0);
    assert.match(stepsInc.understand.join(' '), new RegExp(planInc.missing[0].label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(stepsInc.checklist.join(' '), /missing required item/i);
    assert.match(s589.resources.officialFormPage, /uscis\.gov\/i-589/);
    assert.match(s765.resources.officialFormPage, /uscis\.gov\/i-765/);
  });

  it('test 25: no output implies filing, eligibility, or a guaranteed outcome', () => {
    for (const formId of ['I-589', 'I-765']) {
      const entry = getFormEntry(formId);
      const record = recordWith();
      const summary = buildCompletionSummary(entry, buildFillPlan(record, entry), record);
      const all = JSON.stringify(summary);
      assert.match(all, /does not decide whether you are eligible/);
      assert.match(all, /Nothing has been signed, filed, or submitted/);
      // No AFFIRMATIVE misrepresentation (negated disclaimers are required):
      assert.ok(!/guaranteed (approval|acceptance|success)/i.test(all));
      assert.ok(!/you qualify for/i.test(all));
      assert.ok(!/will be approved/i.test(all));
      assert.ok(!/your (application|form) has been (filed|submitted)/i.test(all));
    }
  });
});

describe('ZIP optionality and location honesty (B2C §7)', () => {
  it('test 21: a missing ZIP blocks nothing — forms generate, with the form\u2019s own ZIP question surfaced honestly', async () => {
    const record = recordWith({ withZip: false });
    for (const formId of ['I-589', 'I-765']) {
      const { pdfBytes, summary } = await generateFormDraft({ formId, factRecord: record });
      assert.ok(pdfBytes.length > 1000, `${formId} draft generated without any ZIP`);
      assert.ok(summary.missingRequired.some((m) => /ZIP/i.test(m.label)), `${formId} lists its ZIP item as missing rather than blocking`);
      assert.equal(summary.nextSteps.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
    }
  });

  it('test 22: a U.S. ZIP user receives verified local-resource handling', () => {
    const result = resolveResourcesForLocation({ country: 'US', postalCode: '10451', region: 'NY', city: 'Bronx' });
    assert.equal(result.isInternational, false);
    assert.ok(result.local.length > 0, 'Bronx ZIP matches verified local organizations');
    assert.ok(result.local.every((o) => typeof o.name === 'string' && o.name.length > 0));
  });

  it('test 23: overseas and location-unknown users receive general guidance and NO U.S. local resources', () => {
    const overseas = resolveResourcesForLocation({ country: 'CA', postalCode: 'M5V 1J1', region: 'ON', city: 'Toronto' });
    assert.equal(overseas.isInternational, true);
    assert.equal(overseas.local.length, 0, 'no U.S. organization is presented as local to a Canadian user');
    assert.equal(overseas.statewide.length, 0);
    assert.ok(overseas.national.length > 0, 'national directories remain available as a general path');
    const unknown = resolveResourcesForLocation({ country: 'US', postalCode: '', region: '', city: '' });
    assert.equal(unknown.local.length, 0);
    assert.ok(unknown.national.length > 0);
    // The packet must keep the honest international/fallback notices:
    assert.ok(app.includes('intlResourcesNote'), 'packet carries the international resources note');
  });

  it('test 24: no unverified provider is ever represented as verified', () => {
    // The form next-steps name NO local organization — only labeled
    // general directories — because the summary has no verified match:
    for (const formId of ['I-589', 'I-765']) {
      const entry = getFormEntry(formId);
      const record = recordWith();
      const steps = buildFormNextSteps(entry, buildFillPlan(record, entry));
      assert.match(steps.resources.note, /has not verified a local provider/i);
      for (const p of steps.resources.searchPaths) {
        assert.ok(p.name && p.url && p.description, 'search paths are labeled directories with descriptions');
      }
    }
    // Packet source keeps the reserved-state honesty:
    assert.ok(!app.includes("status: 'verified'"), 'client never assigns a verified status');
  });
});
