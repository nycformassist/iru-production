// Picker-attempt marker + recreation notice (2026-10-28, brief A/C).
// The 72689dc IndexedDB hold only runs after handlePhotoChange fires,
// so it cannot help when the page is recreated DURING the picker.
// This patch makes that recreation visible, specific, and retryable:
// a synchronous sessionStorage marker written at onClick, persisted
// diagnostics across boots, and a specific recreation notice with a
// label-based retry control. It does NOT claim to fix the recreation
// itself. Synthetic fixtures only. Behavioural where the logic is a
// pure module; source-guarded where it lives in App.tsx (React/JSX
// cannot run under the node harness).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  markPickerOpened,
  readPickerAttempt,
  clearPickerAttempt,
  PICKER_ATTEMPT_KEY,
} from '../src/pickerAttemptStore.ts';
import {
  createDiagnostics,
  loadPersistedDiagnostics,
  persistDiagnosticEvents,
  DIAGNOSTIC_PERSIST_KEY,
} from '../src/diagnostics.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
const markerStore = readFileSync(new URL('../src/pickerAttemptStore.ts', import.meta.url), 'utf8');

function fakeStorage() {
  const map = new Map();
  let setCalls = 0;
  return {
    map,
    get setCalls() { return setCalls; },
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { setCalls += 1; map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

function body(startNeedle, endNeedle) {
  const s = app.indexOf(startNeedle);
  assert.ok(s >= 0, `${startNeedle} present`);
  const e = app.indexOf(endNeedle, s + startNeedle.length);
  assert.ok(e > s, `${endNeedle} follows`);
  return app.slice(s, e);
}

test('marker identity: sessionStorage key, no file data in the module', () => {
  assert.equal(PICKER_ATTEMPT_KEY, 'iru_picker_attempt_v1');
  assert.ok(!markerStore.includes('fileName'), 'marker never carries a file name');
  assert.ok(!markerStore.includes('mime'), 'marker never carries a MIME type');
  assert.ok(!markerStore.includes('sizeBucket'), 'marker never carries a size bucket');
  assert.ok(!markerStore.includes('.size'), 'marker never carries a file size');
  assert.ok(!markerStore.includes('indexedDB.'), 'marker never calls IndexedDB');
  assert.ok(!markerStore.includes('openDb'), 'marker never opens an IndexedDB database');
  assert.ok(!markerStore.includes('fetch('), 'marker never sends anything');
});

test('markPickerOpened writes synchronously and read returns count 1, then 2', () => {
  const store = fakeStorage();
  assert.equal(readPickerAttempt(store), null);
  markPickerOpened('has_passport', store);
  assert.equal(store.setCalls, 1, 'setItem ran synchronously inside markPickerOpened');
  const first = readPickerAttempt(store);
  assert.ok(first);
  assert.equal(first.attemptCount, 1);
  assert.equal(first.docType, 'has_passport');
  assert.equal(typeof first.openedAt, 'number');
  markPickerOpened('has_passport', store);
  assert.equal(readPickerAttempt(store).attemptCount, 2, 'unresolved attempt increments');
});

test('read returns null when absent or malformed; clear removes the key', () => {
  const store = fakeStorage();
  assert.equal(readPickerAttempt(store), null);
  store.setItem(PICKER_ATTEMPT_KEY, 'not-json');
  assert.equal(readPickerAttempt(store), null);
  store.setItem(PICKER_ATTEMPT_KEY, JSON.stringify({ openedAt: 'x', attemptCount: 1 }));
  assert.equal(readPickerAttempt(store), null);
  markPickerOpened(null, store);
  assert.ok(readPickerAttempt(store));
  clearPickerAttempt(store);
  assert.equal(readPickerAttempt(store), null);
  assert.equal(store.map.has(PICKER_ATTEMPT_KEY), false);
  // Clearing an absent marker is a no-op, never a throw.
  clearPickerAttempt(store);
  assert.equal(readPickerAttempt(store), null);
});

test('simulated reload: marker written in one call is readable in a later call from the same storage', () => {
  const store = fakeStorage();
  markPickerOpened('has_i94', store);
  // A new boot reads from the same sessionStorage, not from module state.
  const reloaded = readPickerAttempt(store);
  assert.ok(reloaded);
  assert.equal(reloaded.attemptCount, 1);
  assert.equal(reloaded.docType, 'has_i94');
});

test('marker operations never throw when storage is unavailable', () => {
  markPickerOpened('x', null);
  assert.equal(readPickerAttempt(null), null);
  clearPickerAttempt(null);
  const throwing = {
    getItem: () => { throw new Error('no storage'); },
    setItem: () => { throw new Error('no storage'); },
    removeItem: () => { throw new Error('no storage'); },
  };
  markPickerOpened('x', throwing);
  assert.equal(readPickerAttempt(throwing), null);
  clearPickerAttempt(throwing);
});

test('diagnostics persist synchronously on record and load back across boots', () => {
  const store = fakeStorage();
  const diag = createDiagnostics(store);
  diag.record('picker-open', { stage: 'PHOTO' });
  assert.ok(store.map.has(DIAGNOSTIC_PERSIST_KEY), 'record persisted');
  const loaded = loadPersistedDiagnostics(store);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].type, 'picker-open');
  assert.equal(loaded[0].detail.stage, 'PHOTO');
  // Previous-boot labelling is a detail flag, not a new event shape.
  const labelled = loaded.map((e) => ({ ...e, detail: { ...e.detail, previousBoot: true } }));
  assert.equal(labelled[0].detail.previousBoot, true);
  assert.equal(labelled[0].type, 'picker-open');
});

test('persisted diagnostics drop non-string/number/boolean detail values', () => {
  const store = fakeStorage();
  persistDiagnosticEvents(store, [
    { ts: 1, type: 'picker-change', detail: { stage: 'PHOTO', count: 2, bad: { x: 1 }, fn: () => {} } },
  ]);
  const loaded = loadPersistedDiagnostics(store);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].detail.stage, 'PHOTO');
  assert.equal(loaded[0].detail.count, 2);
  assert.ok(!('bad' in loaded[0].detail), 'object detail dropped');
  assert.ok(!('fn' in loaded[0].detail), 'function detail dropped');
  assert.equal(loadPersistedDiagnostics(fakeStorage()).length, 0, 'absent key loads empty');
  store.setItem(DIAGNOSTIC_PERSIST_KEY, 'broken');
  assert.equal(loadPersistedDiagnostics(store).length, 0, 'malformed key loads empty');
});

test('diagnostics without a persist storage keep in-memory-only behaviour', () => {
  const diag = createDiagnostics();
  diag.record('boot', { stage: 'LANG' });
  assert.equal(diag.log.events.length, 1);
  assert.equal(diag.log.events[0].type, 'boot');
});

test('App: onClick marks the picker attempt FIRST, before saveRecovery and picker-open', () => {
  const input = body('id="iru-photo-input"', 'onChange={handlePhotoChange}');
  const markAt = input.indexOf('markPickerOpened(photoEvidenceKey');
  const saveAt = input.indexOf('saveRecovery(');
  const openAt = input.indexOf("diag.record('picker-open'");
  assert.ok(markAt >= 0, 'markPickerOpened in onClick');
  assert.ok(saveAt > markAt, 'marker before saveRecovery');
  assert.ok(openAt > markAt, 'marker before picker-open diagnostic');
  assert.ok(!input.includes('className="hidden"'), 'input is not hidden');
});

test('App: picker-change with a file clears the marker; cancel clears the marker', () => {
  const change = body('const handlePhotoChange', 'const handlePhotoReview');
  const pickedBlock = change.slice(change.indexOf('if (picked) {'));
  assert.match(pickedBlock, /clearPickerAttempt\(\)/, 'picked file clears marker');
  const input = body('id="iru-photo-input"', 'onChange={handlePhotoChange}');
  const cancel = input.slice(input.indexOf('onCancel'));
  assert.match(cancel, /clearPickerAttempt\(\)/, 'cancel clears marker');
  assert.match(cancel, /picker-cancel/, 'cancel diagnostic still recorded');
});

test('App: Start Over and packet completion clear the marker', () => {
  const start = body('const handleStartOver', 'Facts: consumer confirmation');
  assert.match(start, /clearPickerAttempt\(\)/);
  assert.match(start, /setPickerRecreatedNotice\(''\)/);
  const packet = body("if (stage === 'PACKET')", 'Android recovery diagnostics');
  assert.match(packet, /clearPickerAttempt\(\)/);
  assert.match(packet, /setPickerRecreatedNotice\(''\)/);
  // handleInterviewComplete body itself is untouched by this fix.
  const complete = body('const handleInterviewComplete', 'const generateExecutiveSummary');
  assert.ok(!complete.includes('clearPickerAttempt'), 'handleInterviewComplete not edited');
  assert.ok(!complete.includes('clearPhotoFile'), 'handleInterviewComplete still untouched for photo hold');
});

test('App: restore priority — held file wins, otherwise marker/candidate shows the specific notice', () => {
  const restore = body('Photo-file restore after a page recreation', 'const handlePhotoChange');
  assert.match(restore, /readPickerAttempt\(\)/);
  assert.match(restore, /pickerRecreatedCandidateRef\.current/);
  assert.match(restore, /picker-recreation-detected/);
  assert.match(restore, /pickerRecreated/);
  assert.match(restore, /setRestoredNotice\(''\)/);
  // Held-file branch clears the marker defensively.
  const heldBranch = restore.slice(0, restore.indexOf('No held file'));
  assert.match(heldBranch, /clearPickerAttempt\(\)/);
  assert.match(heldBranch, /setPickerRecreatedNotice\(''\)/);
});

test('App: recreation notice renders only with no file, with a label retry control (no programmatic click)', () => {
  assert.match(app, /pickerRecreatedNotice && !photoFile/);
  const notice = app.slice(app.indexOf('pickerRecreatedNotice && !photoFile'));
  assert.match(notice, /htmlFor="iru-photo-input"/, 'retry is a label bound to the input');
  assert.match(notice, /pickerRetry/);
  assert.match(notice, /role="status"/);
});

test('App: boot records a showOpenFilePicker feature-detect (no API call)', () => {
  assert.match(app, /picker-api/);
  assert.match(app, /showOpenFilePicker/);
  assert.ok(!app.includes('showOpenFilePicker('), 'feature-detect only, never called');
  assert.match(app, /loadPersistedDiagnostics/);
  assert.match(app, /previousBoot: true/);
});

test('New UI wording in all 5 languages: specific recreation notice + retry label', () => {
  assert.equal((constants.match(/pickerRecreated:/g) || []).length, 5);
  assert.equal((constants.match(/pickerRetry:/g) || []).length, 5);
  assert.match(constants, /The page was recreated while the picker was open, before your photo arrived/);
  assert.match(constants, /La página se volvió a cargar mientras el selector estaba abierto/);
  assert.match(constants, /页面在选择器打开时重新加载，您的照片尚未到达/);
  assert.match(constants, /Paj la te rechaje pandan selektè a te ouvè, anvan foto ou te rive/);
  assert.match(constants, /تمت إعادة تحميل الصفحة أثناء فتح أداة الاختيار، قبل وصول صورتك/);
  assert.match(constants, /Pick photo again/);
});

test('Privacy and 72689dc hold untouched: photoPrivacy/photoDesc wording unchanged in this patch', () => {
  assert.match(constants, /held in your browser only until review, then removed/);
  assert.match(constants, /not stored on IRU servers/);
  assert.ok(!app.includes('fetch(') || app.includes('/api/review-image'), 'no new network call for the marker');
});
