import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source guards for the 2026-10-24 on-screen packet fix: the Readiness
// Score, Priority Action Table, and Safe-Landing Hub sections must
// render in the on-screen PACKET JSX — not only in the printable packet
// document template (generateHtml), where they previously lived alone
// while the on-screen header promised them and the Next Steps text
// referenced a "Safe-Landing Hub above" that did not exist on screen.
// JSX usages ({ui.…}) are distinguished from template usages
// (${ui.…}) so these guards fail if the sections retreat to the
// printable document only.

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('on-screen packet sections (2026-10-24 fix)', () => {
  it('renders the Readiness Score and Readiness Review on screen', () => {
    assert.ok(app.includes('{ui.readinessScore}'), 'on-screen packet must render the readiness score');
    assert.ok(app.includes('{renderAssessmentText(assessment)}'), 'on-screen packet must render the assessment text');
    assert.ok(app.includes('calculateReadinessScore()'), 'score must come from the shared heuristic');
  });

  it('renders the Priority Action Table on screen from the shared triage builder', () => {
    assert.ok(app.includes('const buildTriageRows'), 'shared triage builder must exist at component scope');
    assert.ok(app.includes('const { rows: triageRowData, hasAlternatives } = buildTriageRows();'),
      'generateHtml must consume the shared builder (printable output unchanged)');
    assert.ok(app.includes('{ui.triageTable}'), 'on-screen packet must render the triage table heading');
    assert.ok(app.includes('buildTriageRows()'), 'on-screen packet must render rows from the shared builder');
  });

  it('renders the Safe-Landing Hub section on screen above Next Steps', () => {
    assert.ok(app.includes('{ui.localResources}'), 'on-screen packet must render the Safe-Landing Hub heading');
    const hubAt = app.indexOf('{ui.localResources}');
    const packageAt = app.indexOf('Your preparation package (defect-closure P3B)');
    assert.ok(hubAt > 0 && hubAt < packageAt, 'Safe-Landing Hub must render above the package/Next Steps sections');
    assert.ok(app.includes('resources.map((res: any)'), 'Hub cards must render from the location-matched resources state');
  });
});

describe('printed packet carries a stale-outputs notice (value-upgrade gap 4, 2026-10-24)', () => {
  // The on-screen banner (factRecord.outputsStale + Re-run analysis)
  // previously did not travel with the printed document: a corrected
  // record printed the OLD assessment text with no stale signal, while
  // drafts were withdrawn/stale-labeled. The durable deliverable must
  // carry the same warning. Source guard on generateHtml (component
  // scope), which builds the printable packet document.
  const genStart = app.indexOf('const generateHtml = ()');
  const genEnd = app.indexOf('const openPrintablePacket = ()');
  const gen = genStart > 0 && genEnd > genStart ? app.slice(genStart, genEnd) : '';

  it('generateHtml renders a stale notice when the record is outputsStale', () => {
    assert.ok(gen.length > 0, 'generateHtml must exist in App.tsx');
    assert.ok(gen.includes('factRecord.outputsStale'), 'printable packet must check outputsStale');
    assert.ok(gen.includes("t('factsChanged'"), 'stale notice must reuse the localized factsChanged wording');
  });

  it('the stale notice precedes the Readiness Review section in the packet', () => {
    const noticeAt = gen.indexOf('factRecord.outputsStale');
    const reviewAt = gen.indexOf("ui.readinessReview || 'Readiness Review'");
    assert.ok(noticeAt > 0 && reviewAt > 0 && noticeAt < reviewAt,
      'stale notice must print above the Readiness Review findings it qualifies');
  });
});

// Source guards for the 2026-10-27 disposition-gating fix (#3): a 'no' to
// prior arrests must never produce a disposition demand anywhere in the
// client — questionnaire, triage table, or back-navigation.
describe('disposition gating on prior arrests (2026-10-27 fix #3)', () => {
  it('asks prior arrests before disposition certificates', () => {
    const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
    assert.ok(constants.includes('has_prior_arrests'), 'PHASE_3_QUESTIONS must ask about prior arrests');
    const phase3At = constants.indexOf('export const PHASE_3_QUESTIONS');
    assert.ok(phase3At > 0, 'PHASE_3_QUESTIONS must exist');
    const priorAt = constants.indexOf('has_prior_arrests', phase3At);
    const arrestsAt = constants.indexOf('has_arrests', phase3At);
    assert.ok(priorAt > 0 && arrestsAt > priorAt,
      'prior-arrests question must precede the disposition-certificates question in PHASE_3_QUESTIONS');
  });

  it('shows the disposition question only after indicated prior arrests', () => {
    assert.ok(app.includes("PHASE_3_QUESTIONS.filter(q => q.id !== 'has_arrests' || answers.has_prior_arrests === 'yes')"),
      'PHASE3 question list must filter the disposition question unless prior arrests are yes');
  });

  it('suppresses the disposition triage row on an explicit no to prior arrests', () => {
    assert.ok(app.includes("answers.has_prior_arrests !== 'no'"),
      'triage builder must gate the disposition row on the prior-arrests answer');
  });

  it('lands back-navigation on the right PHASE3 question', () => {
    assert.ok(app.includes("answers.has_prior_arrests === 'yes' ? PHASE_3_QUESTIONS.length - 1 : 0"),
      'back-navigation into PHASE3 must land on the disposition question only when prior arrests are yes');
  });
});

// Source guards for the 2026-10-27 not-applicable states fix (#9): items
// that cannot apply must render as Not applicable, never as demands, and
// must not count against the readiness score.
describe('not-applicable states (2026-10-27 fix #9)', () => {
  it('defines a not-applicable status in all languages', () => {
    const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
    assert.ok(constants.includes('notApplicable: "Not applicable"'));
    assert.ok(constants.includes('notApplicable: "No aplicable"'));
    assert.ok(constants.includes('notApplicable: "不适用"'));
    assert.ok(constants.includes('notApplicable: "Pa aplikab"'));
    assert.ok(constants.includes('notApplicable: "غير منطبق"'));
  });

  it('gates triage rows and the score on the N/A rules', () => {
    assert.ok(app.includes('notApplicableReason(key)'));
    assert.ok(app.includes("statusText: st.notApplicable || 'Not applicable'"));
    assert.ok(app.includes("eff[key] !== 'yes' && notApplicableReason(key)"));
  });

  it('defines the N/A reason strings in all languages', () => {
    const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
    assert.ok(constants.includes('pktNaSingle:'));
    assert.ok(constants.includes('pktNaGreenCard:'));
    assert.ok(constants.includes('pktNaTax:'));
  });
});

// Source guards for the 2026-10-27 upload checklist fix (#10): uploads
// accumulate per evidence key, reach the analysis together, and render
// in both packet paths with uploaded-never-verified styling.
describe('upload checklist (2026-10-27 fix #10)', () => {
  it('keeps every reviewed upload tagged to its evidence key', () => {
    assert.ok(app.includes('const [uploads, setUploads]'));
    assert.ok(app.includes("prev.filter(u => u.key !== (photoEvidenceKey || ''))"));
  });

  it('builds checklist rows from answers plus uploads', () => {
    assert.ok(app.includes('const buildChecklistItems = ()'));
    assert.ok(app.includes("state: reviewed ? 'reviewed' : anyUpload ? 'uploaded' : 'needed'"));
  });

  it('sends every reviewed upload to the analysis, not just the latest', () => {
    assert.ok(app.includes('uploads.filter(u => u.review).map(u => u.review)'));
  });

  it('renders the checklist in the printable packet and on screen', () => {
    assert.ok(app.includes("t('checklistTitle', 'Document checklist')"));
  });

  it('clears uploads on start over', () => {
    assert.ok(app.includes('setUploads([])'), 'start over must clear uploads');
  });

  it('defines checklist strings in all languages', () => {
    const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
    for (const k of ['checklistTitle', 'checklistNeeded', 'checklistUploaded', 'checklistReviewed', 'checklistUntagged', 'checklistHint']) {
      assert.ok(constants.includes(k + ':'), `missing ${k}`);
    }
  });
});

// Source guard for the 2026-10-27 asylum-flow expansion: the four
// evidence questions previously asked only in other flows must be
// asked in the asylum flow too, so their not-applicable states render.
describe('asylum flow evidence questions (2026-10-27)', () => {
  it('asks green-card, tax, marriage, and relationship questions in the asylum flow', () => {
    const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
    const phase2At = constants.indexOf('export const PHASE_2_QUESTIONS');
    assert.ok(phase2At > 0, 'PHASE_2_QUESTIONS must exist');
    const citizenshipAt = constants.indexOf('citizenship: [', phase2At);
    assert.ok(citizenshipAt > phase2At, 'citizenship array must follow asylum in PHASE_2_QUESTIONS');
    const asylumBlock = constants.slice(phase2At, citizenshipAt);
    for (const id of ['has_green_card', 'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship']) {
      assert.ok(asylumBlock.includes(`id: "${id}"`), `asylum flow must ask ${id}`);
    }
  });
});

// 2026-10-27 (owner ruling same day): single status makes proof of
// relationship not applicable, mirroring the marriage rule.
describe('not-applicable: single status and relationship proof (2026-10-27)', () => {
  it('marks marriage and relationship not applicable for single applicants', async () => {
    const { getNotApplicableReasons } = await import('./_lib/evidence.js');
    const keys = getNotApplicableReasons({ maritalStatus: 'single' }).map(r => r.key);
    assert.ok(keys.includes('has_marriage_cert'), 'marriage must be N/A for single applicants');
    assert.ok(keys.includes('has_proof_of_relationship'), 'relationship must be N/A for single applicants');
  });
  it('does not mark relationship not applicable for non-single applicants', async () => {
    const { getNotApplicableReasons } = await import('./_lib/evidence.js');
    const keys = getNotApplicableReasons({ maritalStatus: 'married' }).map(r => r.key);
    assert.ok(!keys.includes('has_proof_of_relationship'), 'relationship must stay applicable when married');
  });
  it('client mirror renders the relationship reason for single applicants', () => {
    assert.ok(app.includes("key === 'has_proof_of_relationship' && answers.marital_status === 'single'"), 'App.tsx mirror must cover relationship for singles');
    assert.ok(app.includes('pktNaRelationship'), 'App.tsx must reference the relationship N/A string key');
  });
});
