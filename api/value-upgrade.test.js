/**
 * Value-upgrade directive (2026-10-22) — regression tests for the gaps
 * closed in this pass:
 *  1. Format validation in the fill plan (Priority 2): values that
 *     cannot be represented in an official field's format are flagged
 *     for correction, never printed raw into the form.
 *  2. Conditional applicability (Priority 2): consumer-completed
 *     sections whose triggering fact is KNOWN get an explicit,
 *     localized applicability note; unknown triggers assert nothing.
 *  3. Professional questions (Priority 3, §5 item 9): the next-steps
 *     builders derive specific questions for a qualified professional
 *     from the applicant's actual unresolved issues.
 *  4. Edition manifest (Priorities 2/6): registry ↔ template printed
 *     edition ↔ live USCIS monitor baseline (~/workspace/uscis-monitor/
 *     state.json) — the third leg reads the monitor file itself, so a
 *     USCIS edition move fails this suite loudly instead of drifting.
 *  5. App wiring guards: the packet next-steps wrapper must count
 *     canonical fact statuses, and the packet must render the package
 *     summary, professional questions, and per-entry verified dates.
 * All data synthetic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import { getFormEntry, FORM_REGISTRY } from './_lib/forms/registry.js';
import { buildFillPlan, buildCompletionSummary, isRecognizedDateValue } from './_lib/formmap.js';
import { buildPacketNextSteps, buildFormNextSteps } from './_lib/nextsteps.js';
import ts from 'typescript';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// src/constants.tsx is TSX — transpile with the repo's typescript and
// import as a data module (same technique as language-continuity.test.js).
const HERE = dirname(fileURLToPath(import.meta.url));
async function loadConstants() {
  const source = readFileSync(join(HERE, '..', 'src', 'constants.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

const T = '2026-10-23T00:00:00.000Z';

function recordWith(overrides = {}) {
  const r = createFactRecord(T);
  const put = (id, value, source = 'answer', extra = {}) =>
    upsertFact(r, { id, value, source, ...extra }, T);
  const base = {
    family_name: 'Testfamily', given_name: 'Testgiven',
    date_of_birth: '1990-05-17', gender: 'female', marital_status: 'single',
    citizenship: 'Testlandia', country_of_birth: 'Testlandia', city_of_birth: 'Test City',
    residence_street: '123 Test Street', residence_city: 'Bronx',
    residence_region: 'NY', residence_postal_code: '10451',
    mailing_street: '123 Test Street', mailing_city: 'Bronx',
    mailing_region: 'NY', mailing_postal_code: '10451',
    application_reason: 'initial',
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) put(k, v);
  return r;
}

describe('value-upgrade: format validation in the fill plan', () => {
  it('recognizes real calendar dates in ISO and M/D/YYYY forms only', () => {
    assert.equal(isRecognizedDateValue('1990-05-17'), true);
    assert.equal(isRecognizedDateValue('05/17/1990'), true);
    assert.equal(isRecognizedDateValue('5/4/1990'), true);
    assert.equal(isRecognizedDateValue('1990-13-17'), false, 'month 13 is not a date');
    assert.equal(isRecognizedDateValue('02/30/1990'), false, 'Feb 30 does not exist');
    assert.equal(isRecognizedDateValue('spring 1990'), false);
    assert.equal(isRecognizedDateValue('unknown'), false);
    assert.equal(isRecognizedDateValue(''), false);
  });

  it('an unparseable date of birth is flagged, never filled into the form', () => {
    const entry = getFormEntry('I-589');
    const plan = buildFillPlan(recordWith({ date_of_birth: 'spring 1990' }), entry);
    assert.ok(!plan.fill.some((f) => f.factId === 'date_of_birth'), 'garbage date must not reach the PDF');
    const issue = plan.formatIssues.find((i) => i.factId === 'date_of_birth');
    assert.ok(issue, 'format issue recorded');
    assert.equal(issue.reason, 'unrecognized-date-format');
    const summary = buildCompletionSummary(entry, plan, recordWith({ date_of_birth: 'spring 1990' }));
    assert.equal(summary.formatIssues.length, 1);
    assert.match(summary.formatIssues[0].message, /MM\/DD\/YYYY/);
    assert.match(summary.formatIssues[0].message, /regenerate/i);
  });

  it('a valid date still fills (control case)', () => {
    const entry = getFormEntry('I-589');
    const plan = buildFillPlan(recordWith({}), entry);
    const dob = plan.fill.find((f) => f.factId === 'date_of_birth');
    assert.ok(dob && dob.value === '05/17/1990');
    assert.equal(plan.formatIssues.length, 0);
  });

  it('an A-number with no digits is flagged; a digit-bearing one fills digits-only', () => {
    const entry = getFormEntry('I-589');
    const bad = buildFillPlan(recordWith({ a_number: 'unknown' }), entry);
    assert.ok(!bad.fill.some((f) => f.factId === 'a_number'));
    assert.equal(bad.formatIssues.find((i) => i.factId === 'a_number')?.reason, 'anumber-no-digits');
    const good = buildFillPlan(recordWith({ a_number: 'A123456789' }), entry);
    const an = good.fill.find((f) => f.factId === 'a_number');
    assert.ok(an && an.value === '123456789');
  });

  it('format-issue messages localize (HT differs from EN, names the format)', () => {
    const entry = getFormEntry('I-589');
    const rec = recordWith({ date_of_birth: 'spring 1990' });
    const plan = buildFillPlan(rec, entry, 'HT');
    const summary = buildCompletionSummary(entry, plan, rec, 'HT');
    assert.equal(summary.formatIssues.length, 1);
    assert.ok(!/not in a date format/.test(summary.formatIssues[0].message), 'HT message is not the English text');
    assert.match(summary.formatIssues[0].message, /MM\/JJ\/AAAA/);
  });
});

describe('value-upgrade: conditional applicability notes', () => {
  it('I-589: married applicant gets the spouse-section note; single does not', () => {
    const entry = getFormEntry('I-589');
    const married = recordWith({ marital_status: 'married' });
    const sMarried = buildCompletionSummary(entry, buildFillPlan(married, entry), married);
    assert.equal(sMarried.conditionalNotes.length, 1);
    assert.equal(sMarried.conditionalNotes[0].section, 'Part A.II (spouse and children information)');
    assert.match(sMarried.conditionalNotes[0].note, /married/i);
    // The noted section must be one of the registry's consumer sections.
    assert.ok(entry.consumerCompletedSections.includes(sMarried.conditionalNotes[0].section));

    const single = recordWith({ marital_status: 'single' });
    const sSingle = buildCompletionSummary(entry, buildFillPlan(single, entry), single);
    assert.equal(sSingle.conditionalNotes.length, 0, 'no applicability asserted when the trigger is absent');
  });

  it('I-765: renewal/replacement gets the prior-filings note; initial does not', () => {
    const entry = getFormEntry('I-765');
    const renewal = recordWith({ application_reason: 'renewal' });
    const sRenewal = buildCompletionSummary(entry, buildFillPlan(renewal, entry), renewal);
    assert.equal(sRenewal.conditionalNotes.length, 1);
    assert.ok(entry.consumerCompletedSections.includes(sRenewal.conditionalNotes[0].section));
    const initial = recordWith({ application_reason: 'initial' });
    const sInitial = buildCompletionSummary(entry, buildFillPlan(initial, entry), initial);
    assert.equal(sInitial.conditionalNotes.length, 0);
  });

  it('conditional notes localize (ES)', () => {
    const entry = getFormEntry('I-589');
    const married = recordWith({ marital_status: 'married' });
    const s = buildCompletionSummary(entry, buildFillPlan(married, entry, 'ES'), married, 'ES');
    assert.equal(s.conditionalNotes.length, 1);
    assert.match(s.conditionalNotes[0].note, /casado\/a/);
  });
});

describe('value-upgrade: professional questions derived from findings (§5 item 9)', () => {
  it('packet builder: conflict question names the actual conflicting items, deadlines question always present', () => {
    const ns = buildPacketNextSteps({
      caseType: 'asylum', readinessPercent: 60, evidenceItemCount: 2,
      conflicts: 1, conflictLabels: ['Date of birth (Item 12)'], unconfirmed: 0,
      form: { id: 'I-589', editionDate: '07/28/26', sourceUrl: 'https://www.uscis.gov/i-589' },
      resourcesKind: 'verified', localResourcesName: 'Local Resources',
    }, 'EN');
    assert.ok(Array.isArray(ns.professionalQuestions) && ns.professionalQuestions.length >= 3);
    assert.match(ns.professionalQuestions[0], /Date of birth \(Item 12\)/);
    assert.ok(ns.professionalQuestions.every((q) => q.trim().endsWith('?')), 'every item is a question');
    assert.match(ns.professionalQuestions[ns.professionalQuestions.length - 1], /deadlines/i);
    assert.equal(ns.professionalQuestionsTitle, 'Questions to ask a qualified professional');
  });

  it('packet builder: a clean record yields only the form + deadlines questions (no invented issues)', () => {
    const ns = buildPacketNextSteps({
      caseType: 'family', readinessPercent: 100, evidenceItemCount: 0,
      conflicts: 0, unconfirmed: 0, form: null, resourcesKind: 'none',
    }, 'EN');
    assert.equal(ns.professionalQuestions.length, 1, 'only the standing deadlines question');
  });

  it('packet builder: questions localize (ES interrogatives)', () => {
    const ns = buildPacketNextSteps({
      caseType: 'asilo', readinessPercent: 50, evidenceItemCount: 1,
      conflicts: 0, unconfirmed: 2, form: null, resourcesKind: 'none',
    }, 'ES');
    assert.ok(ns.professionalQuestions.some((q) => q.includes('¿')), 'Spanish questions use Spanish interrogative form');
    assert.ok(ns.professionalQuestions.some((q) => /no han sido confirmados/.test(q)), 'unconfirmed-values question present and localized');
  });

  it('form builder: questions derive from the actual plan (conflicts + missing)', () => {
    const entry = getFormEntry('I-589');
    const rec = recordWith({ marital_status: 'married' });
    // Force a conflict on date_of_birth via a document alternative.
    upsertFact(rec, { id: 'date_of_birth', value: '1990-05-15', source: 'document', sourceRef: { documentType: 'passport' } }, T);
    const plan = buildFillPlan(rec, entry);
    assert.ok(plan.conflicts.length >= 1, 'fixture produces a conflict');
    const ns = buildFormNextSteps(entry, plan, 'EN');
    assert.ok(ns.professionalQuestions.some((q) => /disagree/i.test(q)), 'conflict question present');
    assert.ok(ns.professionalQuestions.every((q) => q.trim().endsWith('?')));
  });
});

describe('value-upgrade: edition manifest — registry ↔ template ↔ USCIS monitor', () => {
  for (const entry of FORM_REGISTRY) {
    it(`${entry.id}: manifest fields complete and template file present`, () => {
      for (const k of ['editionDate', 'sourceUrl', 'pdfUrl', 'instructionsUrl', 'templateFile', 'checkedDate']) {
        assert.ok(entry[k], `${entry.id} manifest field ${k} present`);
      }
      assert.ok(existsSync(path.join(process.cwd(), 'forms', 'templates', entry.templateFile)), 'template exists');
    });

    it(`${entry.id}: printed template edition == registry == live monitor baseline`, () => {
      const templatePath = path.join(process.cwd(), 'forms', 'templates', entry.templateFile);
      let text;
      try {
        text = execFileSync('pdftotext', [templatePath, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      } catch {
        assert.fail('pdftotext unavailable — edition extraction could not run');
      }
      const printed = text.match(new RegExp(`Form ${entry.id} Edition (\\d{2}/\\d{2}/\\d{2})`));
      assert.ok(printed, `${entry.id} template prints an edition line`);
      assert.equal(printed[1], entry.editionDate, 'template == registry');

      const monitorPath = path.join(process.cwd(), '..', 'uscis-monitor', 'state.json');
      if (existsSync(monitorPath)) {
        const monitor = JSON.parse(readFileSync(monitorPath, 'utf8'));
        const m = monitor.forms[entry.id];
        assert.ok(m, `monitor tracks ${entry.id}`);
        assert.equal(m.servedPdfEdition, entry.editionDate, 'monitor served edition == registry');
        assert.equal(m.iruRegistryEdition, entry.editionDate, 'monitor iruRegistryEdition == registry');
      }
    });
  }
});

describe('value-upgrade: App wiring guards', () => {
  const appSrc = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');

  it('packet next-steps wrapper counts canonical fact statuses (regression: wrong status strings)', () => {
    assert.ok(appSrc.includes("f.status === 'conflicting'"), 'conflict count uses the canonical status');
    assert.ok(appSrc.includes("f.status === 'extracted-unconfirmed'"), 'unconfirmed count uses the canonical status');
    assert.ok(!appSrc.includes("status === 'conflicted'"), 'nonexistent status comparison is gone');
    assert.ok(!appSrc.includes("status === 'reported-unconfirmed'"), 'nonexistent status comparison is gone');
    assert.ok(appSrc.includes('conflictLabels'), 'conflict labels flow into the builder');
  });

  it('packet renders the package summary, professional questions, and verified dates', () => {
    assert.ok(appSrc.includes("t('pktPackageTitle'"), 'package summary section rendered');
    assert.ok(appSrc.includes('draftForForm(formDraftStore'), 'package rows derive from the per-form draft store');
    assert.ok(appSrc.includes('ns.professionalQuestions'), 'professional questions rendered in the packet');
    assert.ok(appSrc.includes('res.lastVerified'), 'per-entry verification date rendered');
    assert.ok(appSrc.includes('currentSummary.formatIssues'), 'format issues rendered in the form panel');
    assert.ok(appSrc.includes('currentSummary.conditionalNotes'), 'conditional notes rendered in the form panel');
  });

  it('new UI keys exist in all five dictionaries (parity)', async () => {
    const { UI_LABELS } = await loadConstants();
    const keys = ['pktVerified', 'pktPackageTitle', 'pktPackageReport', 'pktPackageDraft',
      'pktPackageNotGenerated', 'pktPackageNextSteps', 'pktPackageNote', 'formFormatIssues'];
    for (const lang of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
      for (const k of keys) {
        assert.ok(typeof UI_LABELS[lang][k] === 'string' && UI_LABELS[lang][k].length > 0, `${lang}.${k}`);
      }
    }
  });
});
