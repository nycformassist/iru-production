/**
 * src/SaveProgress.rtl.test.tsx — "Save Progress" defect (ported from
 * institutional commit ac857d1; defects found by the 2026-11-12 live
 * walk of the institutional Preview, deployment d83ae63 — the DTC
 * consumer branch had the identical defect).
 *
 * Defect 1 (Save Progress, data loss): clicking "Save Progress"
 * mid-questionnaire showed a red "Save failed", and an answer typed
 * before clicking it was LOST. Two root causes:
 *   (a) Server: the assessment-save endpoint requires Postgres, but
 *       the `assessments` table was never created in the provisioned
 *       database (DDL defined, never applied) — the INSERT threw and
 *       the handler returned a generic 500 'Save failed'. Fixed in
 *       api/_lib/assessment-store.js (ensure the table before the
 *       first query; honest 503s for an unconfigured/failing store),
 *       used by api/assessment-save.js and api/assessment-resume.js.
 *   (b) Client: handleSave built the fact record from `answers`
 *       only, but the current question's value lives in the input
 *       state until "Next" commits it — so the typed answer never
 *       reached the server payload OR the localStorage autosave, and
 *       a failed save left it only in the input state (lost on
 *       reload/resume). Fixed by committing the current input first
 *       (mergeCurrentInput, no required-field alert), so a failed
 *       server save is no longer destructive.
 *
 * Run with: npx tsx --test src/SaveProgress.rtl.test.tsx
 *
 * NOTE: imports MUST be dynamic (top-level await) AFTER the jsdom
 * setup below — the Phase3Integration pattern. Static imports hoist
 * above the setup, so react-dom evaluates before the jsdom globals
 * exist and React's event system never receives input events.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// --- jsdom setup (same as Phase3Integration.rtl.test.tsx) ---
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
const g = global as any;
g.window = dom.window;
g.document = dom.window.document;
// Tier1Flow calls bare `localStorage` (not window.localStorage) — in a
// browser the two are the same; in this harness they are not, so the
// jsdom storage must be exposed on globalThis too.
g.localStorage = dom.window.localStorage;
g.sessionStorage = dom.window.sessionStorage;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.window.confirm = () => true;
g.window.alert = () => {};
g.window.matchMedia = g.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// Dynamic imports AFTER jsdom setup (see NOTE above).
const React = (await import('react')).default;
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { default: Tier1Flow, mergeCurrentInput } = await import('./Tier1Flow.js');

const QUESTIONS = [
  {
    id: 'i589_full_name',
    step: 'personal',
    type: 'text',
    labels: { EN: 'What is your full legal name?' },
    shortLabel: 'Full name',
  },
  {
    id: 'i589_dob',
    step: 'personal',
    type: 'date',
    labels: { EN: 'What is your date of birth?' },
    shortLabel: 'Date of birth',
  },
] as any;
const STEPS = [{ id: 'personal', title: { EN: 'Personal' } }] as any;
const INFO = { formNumber: 'I-589', title: { EN: 'Asylum' }, pdfUrl: '', instructionsUrl: '' } as any;
const ASSESS = () => ({ blockers: [], warnings: [], complete: [], ready: false }) as any;

function renderI589() {
  return render(
    <Tier1Flow
      formKey="i589"
      questions={QUESTIONS}
      steps={STEPS}
      info={INFO}
      lang="EN"
      assess={ASSESS}
      onExit={() => {}}
    />,
  );
}

const realFetch = g.fetch;
beforeEach(() => {
  g.window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  g.window.localStorage.clear();
  g.fetch = realFetch;
});

function storedAnswers(): Record<string, any> {
  const raw = g.window.localStorage.getItem('iru_tier1_i589');
  if (!raw) return {};
  try {
    return JSON.parse(raw).answers || {};
  } catch {
    return {};
  }
}

// ── Defect 1: Save Progress commits the current answer and persists ──

test('Save Progress: a typed answer reaches the server payload and persists on resume', async () => {
  let capturedBody: any = null;
  g.fetch = async (_url: string, opts: any) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 201, json: async () => ({ token: 'a'.repeat(64) }) };
  };
  renderI589();
  fireEvent.change(screen.getByTestId('question-input-i589_full_name'), { target: { value: 'Test Walker' } });
  fireEvent.click(screen.getByTestId('btn-save'));
  const tokenDisplay = await screen.findByTestId('save-token-display');
  assert.ok(tokenDisplay.textContent!.includes('Progress Saved!'), 'a successful save must show the saved confirmation');
  // The typed-but-uncommitted answer must be in the server payload.
  assert.ok(capturedBody, 'the save must POST to /api/assessment-save');
  assert.equal(capturedBody.form_id, 'i589');
  assert.equal(
    capturedBody.facts?.['i589_full_name']?.value,
    'Test Walker',
    'the fact record must include the current question’s typed answer',
  );
  assert.equal(capturedBody.progress?.answers, 1, 'the progress count must include the committed answer');
  // The answer stays in the field and in the autosave (resume source).
  assert.equal(
    (screen.getByTestId('question-input-i589_full_name') as HTMLInputElement).value,
    'Test Walker',
    'the typed answer must stay in the field after saving',
  );
  assert.equal(
    storedAnswers()['i589_full_name'],
    'Test Walker',
    'the answer must be persisted to localStorage so a reload/resume restores it',
  );
});

test('Save Progress: a failed server save leaves the typed answer in the field and in storage', async () => {
  g.fetch = async () => ({
    ok: false, status: 500, json: async () => ({ error: 'Save failed' }),
  });
  renderI589();
  fireEvent.change(screen.getByTestId('question-input-i589_full_name'), { target: { value: 'Test Walker' } });
  fireEvent.click(screen.getByTestId('btn-save'));
  const err = await screen.findByTestId('save-error');
  assert.ok(err.textContent!.includes('Save failed'), 'a failed save must report the error');
  // The failure must NOT lose the typed answer.
  assert.equal(
    (screen.getByTestId('question-input-i589_full_name') as HTMLInputElement).value,
    'Test Walker',
    'the typed answer must stay in the field after a failed save',
  );
  assert.equal(
    storedAnswers()['i589_full_name'],
    'Test Walker',
    'the answer must still be persisted to localStorage after a failed save',
  );
  assert.equal(screen.queryByTestId('save-token-display'), null, 'no save token is shown on failure');
});

// ── mergeCurrentInput: the commit logic, unit-tested directly ────────

test('mergeCurrentInput: text and date values commit, empty clears', () => {
  const q = { id: 'i589_full_name', type: 'text' } as any;
  assert.deepEqual(
    mergeCurrentInput({ a: 1 }, q, { textVal: '  Test Walker  ', radioVal: '', rgData: {} }),
    { a: 1, i589_full_name: 'Test Walker' },
    'a typed text value is trimmed and committed',
  );
  assert.deepEqual(
    mergeCurrentInput({ i589_full_name: 'Old' }, q, { textVal: '   ', radioVal: '', rgData: {} }),
    {},
    'clearing the input deletes the answer',
  );
  assert.deepEqual(
    mergeCurrentInput({ a: 1 }, undefined, { textVal: 'x', radioVal: '', rgData: {} }),
    { a: 1 },
    'no current question leaves answers unchanged',
  );
});

test('mergeCurrentInput: radio/select use radioVal, repeating groups use rgData', () => {
  const radioQ = { id: 'i589_choice', type: 'radio' } as any;
  assert.deepEqual(
    mergeCurrentInput({}, radioQ, { textVal: 'ignored', radioVal: 'yes', rgData: {} }),
    { i589_choice: 'yes' },
    'a radio answer comes from radioVal, not textVal',
  );
  const rgQ = { id: 'i589_children', type: 'repeating_group', groupId: 'children' } as any;
  const entries = [{ name: 'Kid', dob: '2020-01-01' }];
  assert.deepEqual(
    mergeCurrentInput({}, rgQ, { textVal: '', radioVal: '', rgData: { children: entries } }),
    { i589_children: entries },
    'repeating-group entries commit from rgData',
  );
  assert.deepEqual(
    mergeCurrentInput({ i589_children: entries }, rgQ, { textVal: '', radioVal: '', rgData: { children: [] } }),
    {},
    'deleting all repeating-group entries deletes the answer',
  );
});
