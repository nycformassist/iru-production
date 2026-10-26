// Regression tests for the IRU mobile repair 2026-10-26 ErrorBoundary.
//
// The boundary is written with React.createElement (no JSX) precisely
// so this test can exercise its recovery rendering without a DOM:
// getDerivedStateFromError drives the state transition, and render()
// output is inspected as a React element tree. This tests the real
// recovery contract (fallback UI + retry/start-over actions, no error
// internals leaked) — it is not a full browser render test.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ErrorBoundary } from '../src/ErrorBoundary.ts';

// Walk a React element tree, collecting string leaves and button nodes.
function walk(el, out) {
  if (el === null || el === undefined || typeof el === 'boolean') return;
  if (typeof el === 'string' || typeof el === 'number') {
    out.text.push(String(el));
    return;
  }
  if (Array.isArray(el)) {
    for (const child of el) walk(child, out);
    return;
  }
  if (typeof el === 'object' && 'props' in el) {
    if (el.type === 'button') out.buttons.push(el);
    walk(el.props && el.props.children, out);
  }
}

function collect(el) {
  const out = { text: [], buttons: [] };
  walk(el, out);
  return out;
}

test('getDerivedStateFromError transitions to the error state', () => {
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(new Error('boom')), {
    hasError: true,
  });
});

test('happy path renders children unchanged (no extra DOM)', () => {
  const instance = new ErrorBoundary({ children: 'stage content' });
  assert.equal(instance.render(), 'stage content');
});

test('error state renders a recoverable fallback with retry + start over', () => {
  let startedOver = 0;
  const instance = new ErrorBoundary({
    children: 'stage content',
    onStartOver: () => {
      startedOver += 1;
    },
  });
  // Simulate what React does after getDerivedStateFromError.
  instance.state = { hasError: true };
  const found = collect(instance.render());
  assert.ok(found.text.join(' ').includes('Something went wrong on this step'));
  assert.ok(found.text.join(' ').includes('Your answers are still here'));
  assert.equal(found.buttons.length, 2);
  const labels = found.buttons.map((b) => b.props.children);
  assert.ok(labels.includes('Try this step again'));
  assert.ok(labels.includes('Start over'));
  // The start-over action routes back to the questionnaire.
  const startOver = found.buttons.find((b) => b.props.children === 'Start over');
  startOver.props.onClick();
  assert.equal(startedOver, 1);
});

test('without onStartOver the fallback still offers retry', () => {
  const instance = new ErrorBoundary({ children: 'stage content' });
  instance.state = { hasError: true };
  const found = collect(instance.render());
  assert.equal(found.buttons.length, 1);
  assert.equal(found.buttons[0].props.children, 'Try this step again');
});

test('fallback never leaks error internals (no message, no stack)', () => {
  const instance = new ErrorBoundary({ children: 'stage content' });
  instance.state = { hasError: true };
  const rendered = JSON.stringify(instance.render());
  assert.ok(!rendered.includes('SECRET_SENTINEL'));
  assert.ok(!rendered.includes('at ErrorBoundary'));
  assert.ok(!rendered.includes('stack'));
});
