/**
 * src/RepeatingGroup.rtl.test.tsx — Genuine rendered UI test (RTL + jsdom).
 *
 * Renders the ACTUAL RepeatingGroup React component and exercises REAL
 * DOM controls. Uses dynamic imports because ESM hoists static imports
 * above the jsdom global setup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// --- jsdom global setup (runs first, before any React import) ---
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

// Dynamic imports (after jsdom setup)
const React = (await import('react')).default;
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { RepeatingGroup } = await import('./RepeatingGroup.js');
type RepeatingField = import('./RepeatingGroup.js').RepeatingField;
type RepeatingEntry = import('./RepeatingGroup.js').RepeatingEntry;

const TEST_FIELDS: RepeatingField[] = [
  { id: 'family_name', label: 'Family name', type: 'text', required: true },
  { id: 'given_name', label: 'Given name', type: 'text', required: false },
  { id: 'date_of_birth', label: 'Date of birth', type: 'date', required: false },
];

function renderGroup(overrides: Record<string, any> = {}) {
  const calls: { onAdd: RepeatingEntry[]; onUpdate: Array<{ id: string; e: RepeatingEntry }>; onDelete: string[] } = {
    onAdd: [],
    onUpdate: [],
    onDelete: [],
  };
  const props = {
    groupId: 'test-children',
    title: 'Test Children',
    description: 'Test description',
    fields: TEST_FIELDS,
    entries: [] as RepeatingEntry[],
    onAdd: (e: RepeatingEntry) => { calls.onAdd.push(e); },
    onUpdate: (id: string, e: RepeatingEntry) => { calls.onUpdate.push({ id, e }); },
    onDelete: (id: string) => { calls.onDelete.push(id); },
    ...overrides,
  };
  render(React.createElement(RepeatingGroup, props));
  return { calls, props };
}

// --- Tests ---

test('RTL: renders title, description, and Add Another button', () => {
  renderGroup();
  assert.ok(screen.getByText('Test Children'), 'title rendered');
  assert.ok(screen.getByText('Test description'), 'description rendered');
  assert.ok(screen.getByText('+ Add Another Test Children'), 'Add Another button rendered');
  cleanup();
});

test('RTL: clicking Add Another opens the entry form', () => {
  renderGroup();
  fireEvent.click(screen.getByText('+ Add Another Test Children'));
  assert.ok(screen.getByLabelText(/Family name/), 'family name input shown');
  assert.ok(screen.getByLabelText(/Given name/), 'given name input shown');
  assert.ok(screen.getByText('Add Entry'), 'Add Entry button shown');
  assert.ok(screen.getByText('Cancel'), 'Cancel button shown');
  cleanup();
});

test('RTL: filling the form and clicking Add Entry calls onAdd', () => {
  const { calls } = renderGroup();
  fireEvent.click(screen.getByText('+ Add Another Test Children'));

  fireEvent.change(screen.getByLabelText(/Family name/), { target: { value: 'RTLFamily' } });
  fireEvent.change(screen.getByLabelText(/Given name/), { target: { value: 'RTLKid' } });

  fireEvent.click(screen.getByText('Add Entry'));

  assert.strictEqual(calls.onAdd.length, 1, 'onAdd called once');
  assert.strictEqual(calls.onAdd[0].fields.family_name, 'RTLFamily', 'family name passed');
  assert.strictEqual(calls.onAdd[0].fields.given_name, 'RTLKid', 'given name passed');
  assert.ok(calls.onAdd[0].entryId, 'entryId generated');
  cleanup();
});

test('RTL: required field validation blocks empty submit', () => {
  const { calls } = renderGroup();
  fireEvent.click(screen.getByText('+ Add Another Test Children'));

  let alertMsg = '';
  const alertStub = (m: string) => { alertMsg = m; };
  g.window.alert = alertStub;
  g.alert = alertStub;

  fireEvent.click(screen.getByText('Add Entry'));

  assert.strictEqual(calls.onAdd.length, 0, 'onAdd NOT called when required empty');
  assert.ok(alertMsg.includes('Family name'), 'alert mentions the required field');
  cleanup();
});

test('RTL: existing entries render in summary with Edit/Delete', () => {
  const entries: RepeatingEntry[] = [
    { entryId: 'e1', fields: { family_name: 'SummaryFam', given_name: 'SummaryKid' } },
  ];
  renderGroup({ entries });
  assert.ok(screen.getByText('1 entry'), 'summary count shown');
  assert.ok(screen.getByText('SummaryFam'), 'entry family name in summary');
  assert.ok(screen.getByText('Edit'), 'Edit button shown');
  assert.ok(screen.getByText('Delete'), 'Delete button shown');
  cleanup();
});

test('RTL: clicking Edit opens form pre-filled, Save calls onUpdate', () => {
  const entries: RepeatingEntry[] = [
    { entryId: 'e1', fields: { family_name: 'EditMe', given_name: 'Kid' } },
  ];
  const { calls } = renderGroup({ entries });
  fireEvent.click(screen.getByText('Edit'));

  const familyInput = screen.getByLabelText(/Family name/) as HTMLInputElement;
  assert.strictEqual(familyInput.value, 'EditMe', 'form pre-filled with entry data');

  fireEvent.change(familyInput, { target: { value: 'EditedFam' } });
  fireEvent.click(screen.getByText('Save Changes'));

  assert.strictEqual(calls.onUpdate.length, 1, 'onUpdate called once');
  assert.strictEqual(calls.onUpdate[0].id, 'e1', 'correct entryId');
  assert.strictEqual(calls.onUpdate[0].e.fields.family_name, 'EditedFam', 'updated value passed');
  cleanup();
});

test('RTL: clicking Delete calls onDelete (confirm stubbed true)', () => {
  const entries: RepeatingEntry[] = [
    { entryId: 'e1', fields: { family_name: 'DeleteMe' } },
  ];
  const { calls } = renderGroup({ entries });
  fireEvent.click(screen.getByText('Delete'));
  assert.deepStrictEqual(calls.onDelete, ['e1'], 'onDelete called with entryId');
  cleanup();
});

test('RTL: Cancel closes the form without calling onAdd', () => {
  const { calls } = renderGroup();
  fireEvent.click(screen.getByText('+ Add Another Test Children'));
  fireEvent.change(screen.getByLabelText(/Family name/), { target: { value: 'Nope' } });
  fireEvent.click(screen.getByText('Cancel'));

  assert.strictEqual(calls.onAdd.length, 0, 'onAdd not called on cancel');
  assert.ok(screen.getByText('+ Add Another Test Children'), 'back to summary view');
  cleanup();
});

test('RTL: maxEntries hides Add Another when limit reached', () => {
  const entries: RepeatingEntry[] = [
    { entryId: 'e1', fields: { family_name: 'Only' } },
  ];
  renderGroup({ entries, maxEntries: 1 });
  assert.strictEqual(
    screen.queryByText('+ Add Another Test Children'),
    null,
    'Add Another hidden at max'
  );
  cleanup();
});
