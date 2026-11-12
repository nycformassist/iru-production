/**
 * src/FullAssessmentEntry.rtl.test.tsx — Full-readiness-assessment entry
 * + inline date warnings (defects found by the 2026-11-12 live walk of
 * the institutional Preview).
 *
 * Defect 1 (entry): the Staff Dashboard's "Open full assessment"
 * button routed to the LANG screen, whose language buttons
 * unconditionally went to DASHBOARD — in institutional mode that
 * renders the staff dashboard again. The full assessment (PHASE1…
 * PHOTO, incl. document/photo upload) was unreachable: a closed loop
 * with no forward path to PHASE1 anywhere in the app. The fix is a
 * pending-intent flag: the entry sets it, LANG consumes it and
 * advances to PHASE1.
 *
 * Defect 2 (dates): a future date of birth (2027-01-15) and a
 * last-entry date before that birth date were accepted silently at
 * entry and only flagged as a CONFLICT on the report. The fix is an
 * inline warning at entry time (never blocking) in both the Tier 1
 * staff questionnaires and the full-assessment phases.
 *
 * Run with: npx tsx --test src/FullAssessmentEntry.rtl.test.tsx
 *
 * NOTE: a full-App render test is not possible in this harness —
 * INSTITUTIONAL_MODE() resolves from import.meta.env (undefined
 * under tsx) or the generated build-mode.ts, which is 'consumer' in
 * the worktree. The App-level wiring is therefore guarded by the
 * source-level assertions below, following the established precedent
 * in api/app-regression.test.js; the definitive end-to-end proof is
 * the browser walk of the institutional Preview after deployment.
 *
 * NOTE 2: imports MUST be dynamic (top-level await) AFTER the jsdom
 * setup below — the Phase3Integration pattern. Static imports hoist
 * above the setup, so react-dom evaluates before the jsdom globals
 * exist and React's event system never receives input events (a
 * controlled input then never updates state).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// --- jsdom setup (same as Phase3Integration.rtl.test.tsx) ---
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
const g = global as any;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.window.confirm = () => true;
g.window.alert = () => {};
g.window.matchMedia = g.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// Dynamic imports AFTER jsdom setup (see NOTE 2 above).
const React = (await import('react')).default;
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { default: StaffDashboard } = await import('./components/StaffDashboard.js');
const { default: Tier1Flow } = await import('./Tier1Flow.js');

// ── Defect 1: the dashboard button must fire the entry handler ────────

test('staff dashboard "Open full assessment" calls onFullAssessment', () => {
  let calls = 0;
  render(
    <StaffDashboard
      lang="EN"
      onLanguageChange={() => {}}
      onStartForm={() => {}}
      onOpenCase={() => {}}
      onFullAssessment={() => { calls += 1; }}
    />,
  );
  fireEvent.click(screen.getByTestId('staff-full-assessment'));
  assert.equal(calls, 1, 'clicking "Open full assessment" must invoke onFullAssessment exactly once');
  cleanup();
});

// ── Defect 1: App-level wiring (source guards, per app-regression precedent) ──

const appSrc = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

test('App: the staff entry sets the pending flag before opening LANG', () => {
  const at = appSrc.indexOf('onFullAssessment={() =>');
  assert.ok(at >= 0, 'onFullAssessment handler must exist in App.tsx');
  const body = appSrc.slice(at, at + 400);
  assert.ok(body.includes('setFullAssessmentPending(true)'), 'entry must set the pending flag');
  assert.ok(body.includes("setStage('LANG')"), 'entry must open the LANG screen');
  // handleStartOver (which clears the flag) must run FIRST, so the
  // flag set after it survives — the wipe is the Carbon Pass 2 H-2
  // cross-participant protection.
  assert.ok(
    body.indexOf('handleStartOver()') < body.indexOf('setFullAssessmentPending(true)'),
    'handleStartOver must run before the flag is set',
  );
});

test('App: LANG language selection advances to PHASE1 when an assessment is pending', () => {
  assert.ok(
    appSrc.includes("if (fullAssessmentPending) { setFullAssessmentPending(false); setStage('PHASE1'); } else { setStage('DASHBOARD'); }"),
    'LANG language buttons must branch to PHASE1 when a full assessment is pending, DASHBOARD otherwise',
  );
});

test('App: Start Over clears the pending flag (no stale entry intent)', () => {
  const start = appSrc.indexOf('const handleStartOver');
  assert.ok(start >= 0, 'handleStartOver must exist');
  const end = appSrc.indexOf('// ── Facts:', start);
  const body = appSrc.slice(start, end >= 0 ? end : start + 4000);
  assert.ok(body.includes('setFullAssessmentPending(false)'), 'handleStartOver must clear the pending flag');
});

test('App: the DTC dashboard full-assessment button sets the pending flag too', () => {
  const at = appSrc.indexOf('I-589 / I-765 — Full Readiness Assessment');
  assert.ok(at >= 0, 'DTC dashboard full-assessment button must exist');
  const body = appSrc.slice(Math.max(0, at - 400), at);
  assert.ok(body.includes('setFullAssessmentPending(true)'), 'the DTC entry must set the pending flag (same LANG gateway, same loop)');
});

test('App: the phase-question input renders the inline date warning', () => {
  assert.ok(appSrc.includes('dateEntryWarning(question.id'), 'phase questions must consult dateEntryWarning');
  assert.ok(appSrc.includes('data-testid="date-warning"'), 'phase questions must render the warning element');
});

test('Tier1Flow: the questionnaire renders the inline date warning', () => {
  const src = readFileSync(new URL('./Tier1Flow.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('dateEntryWarning(q.id, textVal, answers)'), 'Tier1Flow must consult dateEntryWarning with the typed value and saved answers');
  assert.ok(src.includes('data-testid="date-warning"'), 'Tier1Flow must render the warning element');
});

// ── Defect 2: Tier 1 questionnaire warns at entry time (rendered) ────

const I589_MINIMAL = [
  {
    id: 'i589_dob',
    step: 'personal',
    type: 'date',
    labels: { EN: 'What is your date of birth?' },
    shortLabel: 'Date of birth',
  },
  {
    id: 'i589_entry_date',
    step: 'eligibility',
    type: 'date',
    labels: { EN: 'When did you last enter the United States?' },
    shortLabel: 'Entry date',
  },
] as any;
const STEPS = [
  { id: 'personal', title: { EN: 'Personal' } },
  { id: 'eligibility', title: { EN: 'Eligibility' } },
] as any;
const INFO = { formNumber: 'I-589', title: { EN: 'Asylum' }, pdfUrl: '', instructionsUrl: '' } as any;
const ASSESS = () => ({ blockers: [], warnings: [], complete: [], ready: false }) as any;

function renderI589() {
  return render(
    <Tier1Flow
      formKey="i589"
      questions={I589_MINIMAL}
      steps={STEPS}
      info={INFO}
      lang="EN"
      assess={ASSESS}
      onExit={() => {}}
    />,
  );
}

test('Tier1Flow: a future date of birth warns the moment it is typed', () => {
  renderI589();
  fireEvent.change(screen.getByTestId('question-input-i589_dob'), { target: { value: '2027-01-15' } });
  const warning = screen.getByTestId('date-warning');
  assert.ok(warning.textContent!.includes('in the future'), 'future DOB must warn at entry time');
  cleanup();
});

test('Tier1Flow: a last-entry date before the birth date warns at entry time', () => {
  renderI589();
  // Answer the DOB first.
  fireEvent.change(screen.getByTestId('question-input-i589_dob'), { target: { value: '2015-06-01' } });
  fireEvent.click(screen.getByTestId('btn-next'));
  // Now on the entry-date question: an entry before the birth date warns.
  fireEvent.change(screen.getByTestId('question-input-i589_entry_date'), { target: { value: '2010-01-01' } });
  const warning = screen.getByTestId('date-warning');
  assert.ok(warning.textContent!.includes('before the date of birth'), 'entry before DOB must warn at entry time');
  cleanup();
});

test('Tier1Flow: valid dates show no warning', () => {
  renderI589();
  fireEvent.change(screen.getByTestId('question-input-i589_dob'), { target: { value: '1990-05-20' } });
  assert.equal(screen.queryByTestId('date-warning'), null, 'a past DOB must not warn');
  fireEvent.click(screen.getByTestId('btn-next'));
  fireEvent.change(screen.getByTestId('question-input-i589_entry_date'), { target: { value: '2020-01-01' } });
  assert.equal(screen.queryByTestId('date-warning'), null, 'an entry after the DOB must not warn');
  cleanup();
});
