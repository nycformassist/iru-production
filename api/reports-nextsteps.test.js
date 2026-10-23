import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { buildPacketNextSteps, buildFormNextSteps, nextStepsStrings } from './_lib/nextsteps.js';
import { getFormEntry } from './_lib/forms/registry.js';
import { buildFillPlan } from './_lib/formmap.js';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import { generateFormDraft } from './generate-form.js';
import { BLANK_FORM_LABEL } from './blank-form.js';
import { sanitizeAnswers } from './_lib/privacy.js';
const { resolveResourcesForLocation } = await import('../src/resources.ts');

// Workstream 6 — reports / next steps / downloads verification
// (directive §7). Builder-level assertions + source guards in the
// established style (see nextsteps-zip.test.js, language-continuity.
// test.js): the packet HTML is generated inside App.tsx generateHtml,
// so inclusion there is proven by guarding the exact wiring, while the
// CONTENT for every persona is asserted against the same builder the
// packet calls (App.tsx imports buildPacketNextSteps from this module).

const T0 = '2026-10-21T00:00:00.000Z';
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const constantsSrc = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');

// USCIS monitor baseline (~/workspace/uscis-monitor/state.json,
// lastVerified 2026-10-22): served-PDF printed editions. Duplicated
// here as constants ON PURPOSE — if USCIS moves an edition and the
// monitor baseline is updated, this test must be updated in the same
// breath as the registry/templates, so an edition change fails loudly.
const MONITOR_EDITIONS = { 'I-589': '07/28/26', 'I-765': '08/21/25' };

const PERSONAS = {
  'I-589': {
    caseType: 'asylum', readinessPercent: 60, evidenceItemCount: 3,
    conflicts: 0, unconfirmed: 1,
    form: { id: 'I-589', editionDate: '07/28/26', sourceUrl: 'https://www.uscis.gov/i-589' },
    resourcesKind: 'verified', localResourcesName: 'Local Resources',
  },
  'I-765': {
    caseType: 'family', readinessPercent: 45, evidenceItemCount: 2,
    conflicts: 0, unconfirmed: 0,
    form: { id: 'I-765', editionDate: '08/21/25', sourceUrl: 'https://www.uscis.gov/i-765' },
    resourcesKind: 'none', localResourcesName: 'Local Resources',
  },
  'non-US': {
    caseType: 'asylum', readinessPercent: null, evidenceItemCount: 4,
    conflicts: 0, unconfirmed: 0, form: null,
    resourcesKind: 'international', localResourcesName: 'Local Resources',
  },
  conflicted: {
    caseType: 'asylum', readinessPercent: 30, evidenceItemCount: 5,
    conflicts: 2, unconfirmed: 1,
    form: { id: 'I-589', editionDate: '07/28/26', sourceUrl: 'https://www.uscis.gov/i-589' },
    resourcesKind: 'none', localResourcesName: 'Local Resources',
  },
};

describe('WS6.1 packet next-steps: every persona, EN + HT', () => {
  it('App.tsx packet HTML path wires buildPacketNextSteps into generateHtml (source guards)', () => {
    assert.ok(appSrc.includes("buildPacketNextSteps as buildPacketNextStepsForLang"), 'packet imports the shared builder');
    assert.ok(appSrc.includes('const ns = buildPacketNextSteps();'), 'generateHtml builds the section from session findings');
    assert.ok(appSrc.includes('escapeHtml(ns.title)'), 'the localized title is rendered as the section heading');
    assert.ok(appSrc.includes('${nextStepsHtml}'), 'the section is embedded in the packet HTML, not a separate download');
    for (const field of ['ns.understand', 'ns.review', 'ns.professionalHelp', 'ns.searchPaths', 'ns.checklist']) {
      assert.ok(appSrc.includes(field), `packet renders ${field}`);
    }
    for (const key of ['pktNsUnderstand', 'pktNsReview', 'pktNsProfessional', 'pktNsResources', 'pktNsChecklist']) {
      assert.ok(appSrc.includes(key), `packet carries the ${key} subheading (what-it-does / review / help / resources / checklist)`);
    }
  });

  for (const [name, ctx] of Object.entries(PERSONAS)) {
    it(`${name} persona (EN): title, does/does-not-establish, correction guidance, official-resources step`, () => {
      const ns = buildPacketNextSteps(ctx, 'EN');
      assert.equal(ns.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
      const understand = ns.understand.join(' ');
      assert.match(understand, /does not decide whether you are eligible/, 'what-it-does-not-establish is present');
      assert.match(understand, /not legal advice/, 'not-legal-advice boundary is present');
      assert.match(understand, /[Nn]othing .* independently verified|nothing was independently verified/, 'no-verification honesty is present');
      const allGuidance = [...ns.review, ...ns.checklist].join(' ');
      if (ctx.form || ctx.conflicts > 0) {
        assert.match(allGuidance, /correct/i, 'correction guidance is present');
      } else {
        // No-form persona: the builder's no-draft variant carries no
        // correct/regenerate step (there is no draft to correct) — the
        // packet's correction guidance for this persona is the facts
        // note rendered by generateHtml alongside the fact table.
        assert.ok(appSrc.includes("t('pktFactsNote'"), 'packet facts note is rendered in generateHtml');
        assert.match(constantsSrc, /pktFactsNote: "Document-extracted values show[^"]*Correct anything that is wrong/, 'EN packet correction guidance present');
      }
      assert.ok(ns.searchPaths.some((p) => p.name === 'USCIS' && p.url === 'https://www.uscis.gov/'), 'official-resources step lists USCIS');
      assert.match(ns.checklist.join(' '), /uscis\.gov/, 'checklist confirms editions/fees at the official source');
      assert.ok(ns.professionalHelp.length >= 5, 'professional-help section present');
      if (ctx.form) assert.ok(ns.review.join(' ').includes(ctx.form.id), 'review guidance names the persona form');
    });

    it(`${name} persona (HT): heading and all sections localized`, () => {
      const ns = buildPacketNextSteps(ctx, 'HT');
      assert.equal(ns.title, 'PWOSHEN ETAP OU YO — KIJAN POU ITILIZE RAPÒ SA A', 'YOUR NEXT STEPS heading in Haitian Creole');
      assert.notEqual(ns.title, 'YOUR NEXT STEPS — HOW TO USE THIS REPORT');
      const understand = ns.understand.join(' ');
      assert.match(understand, /pa deside si ou elijib/, 'HT does-not-establish: eligibility not decided');
      assert.match(understand, /pa t verifye endepandamman/, 'HT does-not-establish: nothing independently verified');
      if (ctx.form || ctx.conflicts > 0) {
        assert.match([...ns.review, ...ns.checklist].join(' '), /korije/, 'HT correction guidance present');
      } else {
        // No-form persona (see EN note): HT correction guidance is the
        // localized pktFactsNote in the packet facts section.
        assert.match(constantsSrc, /pktFactsNote: "Valè yo ekstrè[^"]*Korije tout sa ki mal/, 'HT packet correction guidance present');
      }
      assert.ok(ns.searchPaths.some((p) => p.name === 'USCIS' && p.url === 'https://www.uscis.gov/'), 'HT official-resources step lists USCIS');
      assert.match(ns.checklist.join(' '), /uscis\.gov/);
    });
  }

  it('non-US persona is told no U.S. organization is local to them (EN + HT)', () => {
    const en = buildPacketNextSteps(PERSONAS['non-US'], 'EN');
    assert.match(en.resourcesIntro, /outside IRU.s U\.S\. resource coverage area/);
    assert.match(en.resourcesIntro, /no U\.S\. organization is presented as local/);
    const ht = buildPacketNextSteps(PERSONAS['non-US'], 'HT');
    assert.match(ht.resourcesIntro, /andeyò zòn kouvèti resous Etazini/);
  });

  it('conflicted-facts persona: conflicts surface in understand AND checklist (EN + HT)', () => {
    const en = buildPacketNextSteps(PERSONAS.conflicted, 'EN');
    assert.match(en.understand.join(' '), /2 item\(s\).*conflict/);
    assert.match(en.checklist.join(' '), /Resolve the 2 conflicting item\(s\)/);
    const ht = buildPacketNextSteps(PERSONAS.conflicted, 'HT');
    assert.match(ht.understand.join(' '), /an konfli/);
    assert.match(ht.checklist.join(' '), /Rezoud 2 atik ki an konfli/);
  });

  it('form-output next steps also carry the section for both forms in HT', () => {
    for (const formId of ['I-589', 'I-765']) {
      const entry = getFormEntry(formId);
      const record = createFactRecord(T0);
      upsertFact(record, { id: 'family_name', value: 'Testfamily', source: 'answer' }, T0);
      const steps = buildFormNextSteps(entry, buildFillPlan(record, entry), 'HT');
      assert.equal(steps.title, nextStepsStrings('HT').title);
      assert.match(steps.resources.officialFormPage, /uscis\.gov/);
      assert.ok(steps.resources.searchPaths.length > 0);
    }
  });
});

describe('WS6.2 ZIP optionality — no core path requires a postal code', () => {
  it('country-only input returns the national fallback (HT and FR personas)', () => {
    // Existing coverage: location-international.test.js ({country:'FR'},
    // {}), nextsteps-zip.test.js tests 22–23. Added here: country-only
    // for the HT persona and a bare US country-only call.
    for (const loc of [{ country: 'HT' }, { country: 'FR' }, { country: 'US' }]) {
      const r = resolveResourcesForLocation(loc);
      assert.ok(r.national.length > 0, `${loc.country}: national directories remain available`);
      assert.equal(r.local.length, 0, `${loc.country}: nothing invented as local without location evidence`);
    }
    const ht = resolveResourcesForLocation({ country: 'HT' });
    assert.equal(ht.isInternational, true);
  });

  it('analyze sanitizer accepts answers with no zip (zip is never required — it is not even allowlisted)', () => {
    const clean = sanitizeAnswers({ country_of_origin: 'Haiti', residence_country: 'HT', case_type: 'asylum' });
    assert.equal(clean.ok, true);
    // Handler-level proof lives in abuse-controls.test.js (WS5d).
  });

  it('generate-form works on a fact record with NO postal facts at all', async () => {
    // nextsteps-zip.test.js test 21 covers a record missing only the
    // ZIP values; this record omits every postal fact entirely.
    const record = createFactRecord(T0);
    const put = (id, value) => upsertFact(record, { id, value, source: 'answer' }, T0);
    put('family_name', 'Testfamily'); put('given_name', 'Testgiven');
    put('date_of_birth', '1990-05-17'); put('gender', 'female');
    put('marital_status', 'married'); put('citizenship', 'Testlandia');
    put('country_of_birth', 'Testlandia'); put('city_of_birth', 'Test City');
    put('mailing_street', '123 Test Street'); put('mailing_city', 'Bronx');
    put('mailing_region', 'NY'); put('application_reason', 'initial');
    const { pdfBytes, summary } = await generateFormDraft({ formId: 'I-765', factRecord: record });
    assert.ok(pdfBytes.length > 1000, 'draft generated with no postal facts');
    assert.ok(summary.missingRequired.some((m) => /ZIP/i.test(m.label)), 'the ZIP item is surfaced as missing, never a blocker');
  });
});

describe('WS6.3 blank-form edition integrity: template == registry == USCIS monitor', () => {
  for (const formId of ['I-589', 'I-765']) {
    it(`${formId}: printed edition extracted from the template PDF equals registry and monitor baseline`, () => {
      const entry = getFormEntry(formId);
      assert.equal(entry.editionDate, MONITOR_EDITIONS[formId], 'registry matches the monitor baseline');
      const templatePath = path.join(process.cwd(), 'forms', 'templates', entry.templateFile);
      let text;
      try {
        text = execFileSync('pdftotext', [templatePath, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      } catch {
        assert.fail('pdftotext unavailable in this environment — edition extraction could not run');
      }
      const printed = text.match(new RegExp(`Form ${formId} Edition (\\d{2}/\\d{2}/\\d{2})`));
      assert.ok(printed, `${formId} template prints an edition line`);
      assert.equal(printed[1], entry.editionDate, 'template printed edition == registry editionDate');
      assert.equal(printed[1], MONITOR_EDITIONS[formId], 'template printed edition == monitor servedPdfEdition');
    });
  }

  it('the blank-form download is labeled as a reference copy', () => {
    assert.equal(BLANK_FORM_LABEL, 'Official Blank Form — Reference Copy');
    assert.ok(appSrc.includes('Official Blank Form — Reference Copy') || constantsSrc.includes('Official Blank Form'),
      'the reference-copy label reaches the client');
    // Serving behavior (200, exact template bytes, ASCII-safe label
    // header) is proven over real HTTP in blank-form.test.js (D3).
  });
});

describe('WS6.4 report wording: applicant-reported facts are never rendered as verified', () => {
  it("guard: 'independently-verified' exists ONLY as the reserved definition in evidence.js", () => {
    const roots = ['src', 'api'];
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(js|ts|tsx)$/.test(name) || /\.test\.js$/.test(name)) continue;
        const src = readFileSync(p, 'utf8');
        if (src.includes('independently-verified') && p !== path.join('api', '_lib', 'evidence.js')) {
          offenders.push(p);
        }
      }
    };
    roots.forEach(walk);
    assert.deepEqual(offenders, [], 'no non-test source outside evidence.js may carry the reserved state string');
    const evidenceSrc = readFileSync(path.join('api', '_lib', 'evidence.js'), 'utf8');
    const codeLines = evidenceSrc.split('\n').filter((l) => l.includes('independently-verified') && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    assert.equal(codeLines.length, 1, 'exactly one code occurrence: the reserved EVIDENCE_STATES definition');
    assert.match(codeLines[0], /INDEPENDENTLY_VERIFIED:/);
  });

  it('guard: packet + panel fact labels come from the factStatus* keys, never a verified label', () => {
    for (const key of ['factStatusReported', 'factStatusExtracted', 'factStatusConflicting']) {
      assert.ok(appSrc.includes(`t('${key}'`) || appSrc.includes(`'${key}'`), `App.tsx renders fact status via ${key}`);
      assert.ok(constantsSrc.includes(`${key}:`), `constants.tsx defines ${key} (localized)`);
    }
    assert.ok(!/factStatus\w*:\s*["'][^"']*verif/i.test(constantsSrc), 'no factStatus* label claims verification');
    // Correction → outputsStale invalidation is covered in WS3:
    // r5-correction-verification.test.js (record.outputsStale === true
    // after a correction, drafts withdrawn) — cited, not duplicated.
  });
});

describe('WS6.5 DRAFT labeling on generated draft PDFs', () => {
  it('a generated I-765 draft carries the DRAFT banner on page 1 and a DRAFT title', async () => {
    // Both-forms coverage: r5-correction-verification.test.js
    // assertDraftStamp (I-589 + I-765). This is the WS6 spot-check on a
    // fresh synthetic record via the same extraction method.
    const record = createFactRecord(T0);
    upsertFact(record, { id: 'family_name', value: 'Testfamily', source: 'answer' }, T0);
    const { pdfBytes } = await generateFormDraft({ formId: 'I-765', factRecord: record });
    const doc = await PDFDocument.load(pdfBytes);
    assert.equal(doc.getTitle(), 'I-765 — DRAFT for review (IRU)');
    const contents = doc.getPages()[0].node.Contents();
    const refs = contents && typeof contents.asArray === 'function' ? contents.asArray() : [contents];
    let drawn = '';
    for (const ref of refs) {
      const obj = doc.context.lookup(ref);
      if (obj instanceof PDFRawStream) {
        const streamText = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
        for (const m of streamText.matchAll(/<([0-9A-Fa-f]{4,})>/g)) {
          drawn += Buffer.from(m[1], 'hex').toString('latin1');
        }
      }
    }
    assert.ok(drawn.includes('DRAFT'), 'page 1 carries the DRAFT stamp');
    assert.ok(drawn.includes('FOR REVIEW ONLY'));
    assert.ok(drawn.includes('NOT SIGNED'));
    assert.ok(drawn.includes('NOT SUBMITTED'));
  });
});
