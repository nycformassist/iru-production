/**
 * src/PrefilledAnswers.rtl.test.tsx — "Next appears broken" on prefilled
 * answers (live walk of DTC production, 2026-11-12).
 *
 * Symptom: answers restored from the localStorage autosave
 * (`iru_tier1_<formKey>`) are DISPLAYED in the inputs (the JSX falls
 * back to `answers[q.id]`), but the input state (`textVal`/`radioVal`)
 * starts empty and is only seeded by `loadQ`, which runs solely from
 * goNext/goBack — never on mount. `saveAnswer()` (the Next guard) and
 * `mergeCurrentInput()` (the Save Progress merge) read ONLY the input
 * state, so on a required prefilled question Next alerts "required"
 * and refuses to advance, and on a non-required one the prefilled
 * answer is actively DELETED from state.
 *
 * Fix: the commit points fall back to `answers[q.id]` when the input
 * state is empty (input state still takes precedence when the user
 * types), and the input state is seeded from the restored answers on
 * mount. Genuinely empty answers must still block Next when required
 * and stay absent when not.
 *
 * Run with: npx tsx --test src/PrefilledAnswers.rtl.test.tsx
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
// Tier1Flow calls bare `alert(...)` for the required-field guard, so
// the stub must live on globalThis as well as on the jsdom window.
const alertCalls: string[] = [];
const alertStub = (msg: string) => { alertCalls.push(String(msg)); };
g.alert = alertStub;
g.window.alert = alertStub;
g.window.matchMedia = g.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// Dynamic imports AFTER jsdom setup (see NOTE above).
const React = (await import('react')).default;
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { default: Tier1Flow, mergeCurrentInput } = await import('./Tier1Flow.js');

const QUESTIONS = [
  {
    id: 'i589_entry_date',
    step: 'personal',
    type: 'date',
    required: true,
    labels: { EN: 'When did you enter the United States?' },
    shortLabel: 'Entry date',
  },
  {
    id: 'i589_category',
    step: 'personal',
    type: 'radio',
    required: true,
    labels: { EN: 'Which category applies to you?' },
    shortLabel: 'Category',
    options: [
      { value: '(c)(8)', labels: { EN: 'Asylum pending (c)(8)' } },
      { value: '(c)(9)', labels: { EN: 'Adjustment pending (c)(9)' } },
    ],
  },
  {
    id: 'i589_full_name',
    step: 'personal',
    type: 'text',
    required: true,
    labels: { EN: 'What is your full legal name?' },
    shortLabel: 'Full name',
  },
] as any;
const STEPS = [{ id: 'personal', title: { EN: 'Personal' } }] as any;
const INFO = { formNumber: 'I-589', title: { EN: 'Asylum' }, pdfUrl: '', instructionsUrl: '' } as any;
const ASSESS = () => ({ blockers: [], warnings: [], complete: [], ready: false }) as any;

function seedAnswers(answers: Record<string, any>) {
  g.window.localStorage.setItem('iru_tier1_i589', JSON.stringify({
    answers,
    savedAt: Date.now(),
    formKey: 'i589',
  }));
}

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

beforeEach(() => {
  g.window.localStorage.clear();
  alertCalls.length = 0;
});
afterEach(() => {
  cleanup();
  g.window.localStorage.clear();
  alertCalls.length = 0;
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

function checkedRadioValue(): string | null {
  const radios = Array.from(document.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
  const checked = radios.find(r => r.checked);
  return checked ? checked.value : null;
}

// ── Prefilled date/text: Next must advance without any change ────────

test('Prefilled date: Next advances without any change and keeps the prefilled value', async () => {
  seedAnswers({ i589_entry_date: '2026-01-15' });
  renderI589();
  const input = screen.getByTestId('question-input-i589_entry_date') as HTMLInputElement;
  assert.equal(input.value, '2026-01-15', 'the restored entry date must be displayed');
  fireEvent.click(screen.getByTestId('btn-next'));
  // Must advance to the radio question, with no required alert.
  assert.equal(alertCalls.length, 0, 'Next on a prefilled required question must not alert');
  assert.equal(
    screen.queryByTestId('question-input-i589_entry_date'),
    null,
    'Next must leave the prefilled date question',
  );
  assert.ok(
    screen.getByText('Which category applies to you?'),
    'Next must advance to the following question',
  );
  assert.equal(
    storedAnswers()['i589_entry_date'],
    '2026-01-15',
    'the prefilled value must survive in answers after advancing',
  );
});

test('Prefilled radio: Next advances without any change and keeps the prefilled value', async () => {
  seedAnswers({ i589_entry_date: '2026-01-15', i589_category: '(c)(8)' });
  renderI589();
  fireEvent.click(screen.getByTestId('btn-next'));
  assert.equal(alertCalls.length, 0, 'Next on the prefilled date must not alert');
  assert.equal(
    checkedRadioValue(),
    '(c)(8)',
    'the restored (c)(8) radio must be shown checked',
  );
  fireEvent.click(screen.getByTestId('btn-next'));
  assert.equal(alertCalls.length, 0, 'Next on a prefilled required radio must not alert');
  assert.ok(
    screen.getByTestId('question-input-i589_full_name'),
    'Next must advance past the prefilled radio question',
  );
  assert.equal(
    storedAnswers()['i589_category'],
    '(c)(8)',
    'the prefilled radio value must survive in answers after advancing',
  );
  assert.equal(
    storedAnswers()['i589_entry_date'],
    '2026-01-15',
    'the earlier prefilled value must still be present',
  );
});

test('Typing a new value overrides the prefilled one', async () => {
  seedAnswers({ i589_entry_date: '2026-01-15' });
  renderI589();
  fireEvent.change(screen.getByTestId('question-input-i589_entry_date'), { target: { value: '2026-06-01' } });
  fireEvent.click(screen.getByTestId('btn-next'));
  assert.equal(alertCalls.length, 0, 'Next must not alert after typing a new value');
  assert.ok(
    screen.getByText('Which category applies to you?'),
    'Next must advance after typing a new value',
  );
  assert.equal(
    storedAnswers()['i589_entry_date'],
    '2026-06-01',
    'the typed value must replace the prefilled one',
  );
});

// ── Genuinely empty answers: the required guard must still hold ──────

test('Genuinely empty required question still blocks Next', async () => {
  renderI589();
  const input = screen.getByTestId('question-input-i589_entry_date') as HTMLInputElement;
  assert.equal(input.value, '', 'with no restore the date input must start empty');
  fireEvent.click(screen.getByTestId('btn-next'));
  assert.equal(alertCalls.length, 1, 'Next on an empty required question must alert once');
  assert.ok(
    alertCalls[0].includes('required'),
    'the alert must be the required-field message',
  );
  assert.ok(
    screen.getByTestId('question-input-i589_entry_date'),
    'Next must NOT advance past an empty required question',
  );
  assert.equal(
    storedAnswers()['i589_entry_date'],
    undefined,
    'no answer must be committed for the empty question',
  );
});

// ── mergeCurrentInput: prefilled base must be kept, empty stays absent ─

test('mergeCurrentInput: prefilled value in the base record survives empty input state', () => {
  const dateQ = { id: 'i589_entry_date', type: 'date' } as any;
  assert.deepEqual(
    mergeCurrentInput({ i589_entry_date: '2026-01-15' }, dateQ, { textVal: '', radioVal: '', rgData: {} }),
    { i589_entry_date: '2026-01-15' },
    'an untouched prefilled date must be kept, not deleted (Save Progress must not wipe it)',
  );
  const radioQ = { id: 'i589_category', type: 'radio' } as any;
  assert.deepEqual(
    mergeCurrentInput({ i589_category: '(c)(8)' }, radioQ, { textVal: '', radioVal: '', rgData: {} }),
    { i589_category: '(c)(8)' },
    'an untouched prefilled radio must be kept, not deleted',
  );
  assert.deepEqual(
    mergeCurrentInput({ i589_entry_date: '2026-01-15' }, dateQ, { textVal: '2026-06-01', radioVal: '', rgData: {} }),
    { i589_entry_date: '2026-06-01' },
    'a typed value still overrides the prefilled one',
  );
});

test('mergeCurrentInput: empty input and empty base leaves the key absent', () => {
  const dateQ = { id: 'i589_entry_date', type: 'date' } as any;
  assert.deepEqual(
    mergeCurrentInput({}, dateQ, { textVal: '', radioVal: '', rgData: {} }),
    {},
    'a genuinely empty question must stay absent',
  );
  assert.deepEqual(
    mergeCurrentInput({ other: 'kept' }, dateQ, { textVal: '   ', radioVal: '', rgData: {} }),
    { other: 'kept' },
    'whitespace-only input with no base value must not create the key',
  );
});
