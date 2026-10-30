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
  // Standing entitlement guards (see also language-completion +
  // pricing-acceptance source guards): App.tsx must never GRANT
  // entitlement from the return URL. Phase 2 reads ?checkout=success
  // only as a trigger for server-side verification via
  // /api/entitlement-status — the URL alone grants nothing.
  // The ?debug=1 read lives in the diagnostics module, which only
  // gates the debug overlay.
  assert.ok(appSrc.includes("fetch('/api/entitlement-status'"), 'return-URL handling must verify via the server');
  assert.ok(!/setPurchaseState\(\{\s*hasEvaluation:\s*true/.test(appSrc), 'no client-side paid marking from URL');
  const recordLines = appSrc.split('\n').filter((l) => l.includes('.record('));
  // Picker-testing instrumentation removed 2026-10-29: the only
  // remaining debug record is the boot event (buildSha + counters +
  // navigation type for the ?debug=1 panel).
  assert.ok(recordLines.length >= 1, `expected diagnostics record calls, found ${recordLines.length}`);
  const forbidden = ['answers', 'photoFile', 'full_name', 'token', 'imageReview', 'fileName', 'reviewError', 'factRecord'];
  for (const line of recordLines) {
    for (const token of forbidden) {
      assert.ok(!line.includes(token), `diagnostics record must not pass ${token}: ${line.trim()}`);
    }
  }
});

test('persisted diagnostics store is gone (picker-testing instrumentation removed 2026-10-29)', () => {
  const diagSrc = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/diagnostics.ts'),
    'utf8',
  );
  assert.ok(!diagSrc.includes('iru_diagnostics_v1'), 'persisted diagnostics key must be removed');
  assert.ok(!diagSrc.includes('persistDiagnosticEvents'), 'persist function must be removed');
  assert.ok(!diagSrc.includes('loadPersistedDiagnostics'), 'load function must be removed');
  assert.ok(!diagSrc.includes('summarizeFileForDiagnostics'), 'file summarizer must be removed');
  assert.ok(!appSrc.includes('iru_diagnostics_v1'), 'App must not reference the persisted diagnostics key');
  assert.ok(!appSrc.includes('pickerAttemptStore'), 'picker-attempt marker module must not be imported');
  assert.ok(!appSrc.includes('fsaPicker'), 'picker-routes harness module must not be imported');
});

// ── Debug-overlay minimize/expand behavior (2026-10-26 fix) ──────────
// The overlay opens minimized as a small pill; there is no DOM harness,
// so these tests drive mountOverlay against a minimal fake document and
// assert on the elements/styles it produces — the same structural style
// as the guards above. They do NOT prove real-browser tap behavior; the
// owner phone test remains the arbiter for that.

function fakeElement(tag) {
  const el = {
    tag,
    style: {},
    textContent: null,
    children: [],
    _listeners: {},
    _removed: false,
    appendChild(child) {
      // Real DOM append re-attaches a detached node; model that so the
      // pill/panel can be appended again after minimize/expand.
      child._removed = false;
      this.children.push(child);
    },
    remove() { this._removed = true; },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    click() { (this._listeners.click || []).forEach((fn) => fn()); },
  };
  return el;
}

function fakeDocument() {
  const bodyChildren = [];
  const body = {
    children: bodyChildren,
    // Same re-attach semantics as fakeElement.appendChild: appending a
    // detached node (e.g. the pill on minimize) makes it visible again.
    appendChild(child) { child._removed = false; bodyChildren.push(child); },
  };
  return {
    body,
    createElement: (tag) => fakeElement(tag),
    visibleChildren: () => bodyChildren.filter((c) => !c._removed),
  };
}

// Runs fn with a fake document global and a fake clipboard, then restores
// the real ones. Note: globalThis.navigator is getter-only in Node 22,
// so the clipboard is patched onto the existing navigator object rather
// than replacing navigator itself. The callback's return value is passed
// through; element references captured inside remain usable after restore
// (they are plain objects).
function withFakeDom(fn) {
  const doc = fakeDocument();
  let clipboardText = null;
  const prevDoc = globalThis.document;
  const nav = globalThis.navigator;
  const prevClipboard = nav ? nav.clipboard : undefined;
  globalThis.document = doc;
  if (nav) nav.clipboard = { writeText: async (t) => { clipboardText = t; } };
  try {
    return fn(doc, () => clipboardText);
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (nav) {
      if (prevClipboard === undefined) delete nav.clipboard;
      else nav.clipboard = prevClipboard;
    }
  }
}

function findDescendant(el, predicate) {
  if (predicate(el)) return el;
  for (const child of el.children || []) {
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

function collectText(el, out = []) {
  if (typeof el.textContent === 'string') out.push(el.textContent);
  for (const child of el.children || []) collectText(child, out);
  return out;
}

test('overlay opens minimized as a small pill, never the full panel', () => {
  withFakeDom((doc) => {
    const diag = createDiagnostics();
    const mounted = diag.mountOverlay();
    assert.ok(mounted, 'mountOverlay must succeed with a document');
    const visible = doc.visibleChildren();
    assert.equal(visible.length, 1, 'exactly one overlay element may exist');
    const pill = visible[0];
    assert.equal(pill.tag, 'button', 'minimized control must be a tappable button');
    assert.ok(pill.textContent.includes('Debug'), 'pill must advertise the debug log');
    assert.equal(pill.style.position, 'fixed', 'pill must be outside document flow');
    assert.equal(pill.style.top, '8px');
    assert.equal(pill.style.right, '8px');
    assert.equal(pill.style.boxSizing, 'border-box');
    assert.equal(pill.style.maxWidth, '50vw');
    assert.equal(pill.style.minHeight, '44px', 'pill must meet a 44px touch target');
    assert.equal(findDescendant(pill, (el) => el.tag === 'pre'), null, 'no log panel may be shown by default');
  });
});

test('logging continues while minimized and the pill count grows', () => {
  withFakeDom((doc) => {
    const diag = createDiagnostics();
    diag.mountOverlay();
    diag.record('boot', { stage: 'LANG' });
    diag.record('stage', { stage: 'PHOTO', reason: 'next' });
    diag.record('stage', { stage: 'PHOTO', reason: 'navigation' });
    assert.equal(diag.log.events.length, 3, 'records must accumulate while minimized');
    const pill = doc.visibleChildren()[0];
    assert.ok(pill.textContent.includes('(3)'), `pill must show the live count, got: ${pill.textContent}`);
  });
});

test('expanding shows every event accumulated while minimized, with Copy and Minimize', () => {
  withFakeDom((doc) => {
    const diag = createDiagnostics();
    diag.record('boot', { stage: 'LANG' });
    diag.record('stage', { stage: 'PHOTO', reason: 'next' });
    diag.mountOverlay();
    diag.record('stage', { stage: 'TRIAGE', reason: 'back' });
    doc.visibleChildren()[0].click();
    const panel = doc.visibleChildren()[0];
    assert.equal(panel.tag, 'div', 'expanded overlay must be the panel');
    const pre = findDescendant(panel, (el) => el.tag === 'pre');
    assert.ok(pre, 'expanded panel must contain the log');
    const snap = JSON.parse(pre.textContent);
    assert.equal(snap.events.length, 3, 'reopening must show all accumulated entries');
    assert.deepEqual(snap.events.map((e) => e.type), ['boot', 'stage', 'stage']);
    const texts = collectText(panel);
    assert.ok(texts.includes('Copy'), 'Copy Logs function must be retained');
    assert.ok(texts.includes('Minimize'), 'an obvious minimize control must exist');
    assert.ok(!texts.includes('Hide'), 'the one-way Hide control must be gone');
  });
});

test('minimize returns to the pill and reopening retains the full log', () => {
  withFakeDom((doc) => {
    const diag = createDiagnostics();
    diag.mountOverlay();
    diag.record('boot', { stage: 'LANG' });
    doc.visibleChildren()[0].click();
    const panel = doc.visibleChildren()[0];
    findDescendant(panel, (el) => el.textContent === 'Minimize').click();
    assert.equal(doc.visibleChildren()[0].tag, 'button', 'minimize must return to the pill');
    diag.record('stage', { stage: 'PHOTO', reason: 'next' });
    diag.record('stage', { stage: 'TRIAGE', reason: 'back' });
    assert.ok(doc.visibleChildren()[0].textContent.includes('(3)'), 'pill count must include post-minimize events');
    doc.visibleChildren()[0].click();
    const reopened = doc.visibleChildren()[0];
    const snap = JSON.parse(findDescendant(reopened, (el) => el.tag === 'pre').textContent);
    assert.equal(snap.events.length, 3, 'reopening must retain the full accumulated log');
    assert.deepEqual(snap.events.map((e) => e.detail.stage || e.type), ['LANG', 'PHOTO', 'TRIAGE']);
  });
});

test('Copy writes the accumulated snapshot to the clipboard', async () => {
  let copyBtn;
  let getClipboard;
  withFakeDom((doc, getText) => {
    getClipboard = getText;
    const diag = createDiagnostics();
    diag.record('boot', { stage: 'LANG' });
    diag.record('stage', { stage: 'PHOTO', reason: 'next' });
    diag.mountOverlay();
    doc.visibleChildren()[0].click();
    const panel = doc.visibleChildren()[0];
    copyBtn = findDescendant(panel, (el) => el.textContent === 'Copy');
    copyBtn.click();
  });
  await Promise.resolve();
  assert.equal(copyBtn.textContent, 'Copied!');
  const snap = JSON.parse(getClipboard());
  assert.equal(snap.events.length, 2, 'copied snapshot must contain the accumulated events');
});

test('expanded panel and pill cannot overflow a 320px viewport', () => {
  withFakeDom((doc) => {
    const diag = createDiagnostics();
    diag.mountOverlay();
    const pill = doc.visibleChildren()[0];
    // Border-box arithmetic: total footprint = maxWidth + right offset.
    // Pill: 50vw + 8px < 100vw at any width (at 320px: 160 + 8 = 168 < 320).
    assert.equal(pill.style.boxSizing, 'border-box');
    assert.equal(pill.style.maxWidth, '50vw');
    assert.equal(pill.style.right, '8px');
    pill.click();
    const panel = doc.visibleChildren()[0];
    // Panel: 92vw + 8px < 100vw at any width (at 320px: 294.4 + 8 = 302.4
    // < 320). The old panel lacked boxSizing, so its 12px padding pushed
    // it ~6px past the left edge on a 320px screen.
    assert.equal(panel.style.position, 'fixed', 'panel must be outside document flow (no layout shift)');
    assert.equal(panel.style.top, '8px');
    assert.equal(panel.style.right, '8px');
    assert.equal(panel.style.boxSizing, 'border-box');
    assert.equal(panel.style.maxWidth, '92vw');
    assert.equal(panel.style.maxHeight, '50vh');
  });
});

test('no backdrop or wrapper exists to intercept taps outside the control', () => {
  withFakeDom((doc) => {
    const diag = createDiagnostics();
    diag.mountOverlay();
    assert.equal(doc.visibleChildren().length, 1, 'minimized: exactly one element (the pill)');
    doc.visibleChildren()[0].click();
    const visible = doc.visibleChildren();
    assert.equal(visible.length, 1, 'expanded: exactly one element (the panel)');
    const panel = visible[0];
    const fixedDescendants = [];
    const walk = (el) => {
      for (const child of el.children || []) {
        if (child.style && child.style.position === 'fixed') fixedDescendants.push(child);
        walk(child);
      }
    };
    walk(panel);
    assert.equal(fixedDescendants.length, 0, 'no descendant may be a fixed tap-intercepting layer');
  });
});

test('mountOverlay returns null without a document', () => {
  assert.equal(createDiagnostics().mountOverlay(), null);
});
