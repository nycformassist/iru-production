// Unit + structural tests for the IRU Android recovery diagnostics
// (src/diagnostics.ts, wired in src/App.tsx). The module is pure and
// framework-free, so it runs directly under the node test harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDiagnostics,
  createEventLog,
  getBuildSha,
  getNavigationInfo,
  incrementCounter,
  installDiagnosticListeners,
  isDiagnosticsEnabled,
  isDiagnosticsEnabledFromLocation,
  safeStorage,
  DIAGNOSTIC_EVENT_LIMIT,
} from '../src/diagnostics.ts';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function throwingStorage() {
  return {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
}

test('isDiagnosticsEnabled only for ?debug=1', () => {
  assert.equal(isDiagnosticsEnabled('?debug=1'), true);
  assert.equal(isDiagnosticsEnabled('?debug=1&x=2'), true);
  assert.equal(isDiagnosticsEnabled('?debug=0'), false);
  assert.equal(isDiagnosticsEnabled(''), false);
  assert.equal(isDiagnosticsEnabled('?foo=bar'), false);
});

test('getBuildSha falls back to local-dev when the Vite define is absent', () => {
  assert.equal(getBuildSha(), 'local-dev');
});

test('ring buffer keeps only the latest 30 events', () => {
  const log = createEventLog();
  for (let i = 0; i < 35; i++) log.record('e' + i, { n: i });
  assert.equal(log.events.length, DIAGNOSTIC_EVENT_LIMIT);
  assert.equal(log.events[0].type, 'e5');
  assert.equal(log.events[29].type, 'e34');
  log.clear();
  assert.equal(log.events.length, 0);
});

test('boot counters increment and survive across instances on one store', () => {
  const store = fakeStorage();
  assert.equal(incrementCounter(store, 'k'), 1);
  assert.equal(incrementCounter(store, 'k'), 2);
  assert.equal(store._map.get('k'), '2');
  assert.equal(incrementCounter(null, 'k'), 0);
  assert.equal(incrementCounter(throwingStorage(), 'k'), 0);
});

test('safeStorage rejects null, non-objects, and partial stores', () => {
  assert.equal(safeStorage(null), null);
  assert.equal(safeStorage({}), null);
  assert.equal(safeStorage({ getItem: () => null }), null);
  const ok = fakeStorage();
  assert.equal(safeStorage(ok), ok);
});

test('navigation info normalizes unknown/missing data', () => {
  assert.deepEqual(getNavigationInfo('reload', true), { type: 'reload', wasDiscarded: true });
  assert.deepEqual(getNavigationInfo('', false), { type: 'unknown', wasDiscarded: false });
  assert.deepEqual(getNavigationInfo(undefined, undefined), { type: 'unknown', wasDiscarded: false });
});

test('diagnostics snapshot contains only non-sensitive fields', () => {
  const diag = createDiagnostics();
  diag.bootSessionCount = 3;
  diag.bootTotalCount = 9;
  diag.navigationType = 'navigate';
  diag.wasDiscarded = true;
  diag.record('boot', { stage: 'LANG', navigationType: 'navigate', wasDiscarded: true, bootSession: 3 });
  diag.record('stage', { stage: 'PHOTO', reason: 'next' });
  const snap = JSON.parse(diag.snapshot());
  assert.equal(snap.buildSha, 'local-dev');
  assert.equal(snap.bootSessionCount, 3);
  assert.equal(snap.bootTotalCount, 9);
  assert.equal(snap.events.length, 2);
  assert.deepEqual(Object.keys(snap).sort(), ['bootSessionCount', 'bootTotalCount', 'buildSha', 'events', 'navigationType', 'wasDiscarded']);
});

test('listeners record lifecycle events and error names only, never messages', () => {
  const diag = createDiagnostics();
  const target = new EventTarget();
  const cleanup = installDiagnosticListeners(target, diag.record, ['pageshow', 'visibilitychange', 'error', 'unhandledrejection']);
  target.dispatchEvent(new Event('pageshow'));
  const vis = new Event('visibilitychange');
  Object.defineProperty(vis, 'target', { value: { visibilityState: 'hidden' } });
  target.dispatchEvent(vis);
  const err = new Event('error');
  err.error = { name: 'TypeError', message: 'secret answer value full_name should never appear' };
  target.dispatchEvent(err);
  const rej = new Event('unhandledrejection');
  rej.reason = { name: 'Error', message: 'payment token iru_entitlement_token leak?' };
  target.dispatchEvent(rej);
  assert.equal(diag.log.events.length, 4);
  assert.equal(diag.log.events[1].detail.visibilityState, 'hidden');
  assert.equal(diag.log.events[2].detail.errorName, 'TypeError');
  assert.equal(diag.log.events[3].detail.errorName, 'Error');
  assert.ok(!diag.snapshot().includes('secret answer value'));
  assert.ok(!diag.snapshot().includes('iru_entitlement_token'));
  cleanup();
  target.dispatchEvent(new Event('pageshow'));
  assert.equal(diag.log.events.length, 4, 'cleanup must detach listeners');
});

test('listeners tolerate a null target and an unhandled callback', () => {
  const diag = createDiagnostics();
  const cleanup = installDiagnosticListeners(null, diag.record, ['pageshow']);
  cleanup();
  let called = 0;
  const target = new EventTarget();
  const cleanup2 = installDiagnosticListeners(target, diag.record, ['error'], () => { called += 1; });
  const err = new Event('error');
  err.error = { name: 'Error' };
  target.dispatchEvent(err);
  assert.equal(called, 1);
  cleanup2();
});

// Structural: the App wiring must only ever record non-sensitive details.
const appSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/App.tsx'),
  'utf8',
);

test('isDiagnosticsEnabledFromLocation is false without a browser location', () => {
  assert.equal(isDiagnosticsEnabledFromLocation(), false);
});

test('App diagnostics wiring exists and records no sensitive identifiers', () => {
  assert.ok(appSrc.includes("from './diagnostics'"), 'App must import the diagnostics module');
  assert.ok(appSrc.includes('isDiagnosticsEnabledFromLocation()'), 'overlay must be gated on ?debug=1 via the diagnostics module');
  assert.ok(appSrc.includes("diag.record('boot'"), 'boot event must be recorded');
  assert.ok(appSrc.includes("diag.record('stage'"), 'stage transitions must be recorded');
  // Standing entitlement guards (see also language-completion +
  // pricing-acceptance source guards): App.tsx itself must never read
  // the return URL query or parse URL parameters, so ?checkout=success
  // cannot grant anything. The ?debug=1 read lives in the diagnostics
  // module, which only gates the debug overlay.
  assert.ok(!appSrc.includes('location.search'), 'App.tsx must not read location.search');
  assert.ok(!appSrc.includes('URLSearchParams'), 'App.tsx must not parse URL parameters');
  assert.ok(!appSrc.includes('checkout=success'), 'App.tsx must not handle checkout=success');
  const recordLines = appSrc.split('\n').filter((l) => l.includes('.record('));
  assert.ok(recordLines.length >= 2, `expected diagnostics record calls, found ${recordLines.length}`);
  const forbidden = ['answers', 'photoFile', 'full_name', 'token', 'imageReview', 'fileName', 'reviewError', 'factRecord'];
  for (const line of recordLines) {
    for (const token of forbidden) {
      assert.ok(!line.includes(token), `diagnostics record must not pass ${token}: ${line.trim()}`);
    }
  }
});

test('App stage reasons are attributed at navigation handlers', () => {
  for (const reason of ["'next'", "'back'", "'start-over'", "'complete'"]) {
    assert.ok(appSrc.includes(`diagReasonRef.current = ${reason}`), `missing stage reason ${reason}`);
  }
});
