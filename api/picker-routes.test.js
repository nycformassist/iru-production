// Picker-route experiments (2026-10-28 supplement, item 2).
//
// The A17 logs prove the page is recreated DURING the native picker, and
// that showOpenFilePicker is PRESENT on the phone. What is unknown is
// (Q1) whether that route avoids the recreation and (Q2) whether a stored
// handle survives one. These tests pin the experiment harness so the
// device result is trustworthy: the right route is labelled, the user
// gesture is intact, nothing leaks into diagnostics, nothing is visible
// to normal users, and the production behaviour is unchanged.
// Synthetic fixtures only. Behavioural where the logic is a pure module;
// source-guarded where it lives in App.tsx (React cannot run under node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PICKER_ROUTES_PUBLIC,
  pickerRoutesVisible,
  FSA_HANDLE_DB_NAME,
  FSA_PICKER_OPTIONS,
  hasFsaPicker,
  pickViaFsa,
  saveFsaHandle,
  loadFsaHandle,
  clearFsaHandle,
  probeStoredHandle,
  regrantStoredHandle,
} from '../src/fsaPicker.ts';
import { PHOTO_STORE_DB_NAME } from '../src/photoFileStore.ts';
import { markPickerOpened, readPickerAttempt, PICKER_ATTEMPT_KEY } from '../src/pickerAttemptStore.ts';
import { createDiagnostics } from '../src/diagnostics.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const fsaSrc = readFileSync(new URL('../src/fsaPicker.ts', import.meta.url), 'utf8');

const SECRET_NAME = 'SECRET-passport-scan.jpg';
const fakeFile = (over = {}) => ({ name: SECRET_NAME, type: 'image/jpeg', size: 500 * 1024, ...over });
const fakeHandle = (over = {}) => ({
  getFile: async () => fakeFile(),
  queryPermission: async () => 'granted',
  requestPermission: async () => 'granted',
  ...over,
});
const domErr = (name, message = 'MESSAGE-WITH-USER-DATA') => Object.assign(new Error(message), { name });

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// Minimal IndexedDB double: enough for withStore() (open/upgrade, put/get/delete,
// transaction completion). Stores object REFERENCES (a real FileSystemFileHandle
// is structured-cloned natively by the browser; function-bearing fakes cannot be).
function fakeIdb({ failOpen = false } = {}) {
  const dbs = new Map();
  return {
    _dbs: dbs,
    open(name) {
      const req = {};
      queueMicrotask(() => {
        if (failOpen) { req.error = new Error('blocked'); req.onerror && req.onerror(); return; }
        let db = dbs.get(name);
        const isNew = !db;
        if (isNew) { db = { stores: new Map() }; dbs.set(name, db); }
        req.result = {
          objectStoreNames: { contains: (n) => db.stores.has(n) },
          createObjectStore: (n) => db.stores.set(n, new Map()),
          close() {},
          transaction(n) {
            const store = db.stores.get(n);
            const tx = { oncomplete: null, onerror: null, onabort: null };
            tx.objectStore = () => ({
              put(v, k) { const r = {}; queueMicrotask(() => { store.set(k, v); r.result = k; r.onsuccess && r.onsuccess(); queueMicrotask(() => tx.oncomplete && tx.oncomplete()); }); return r; },
              get(k) { const r = {}; queueMicrotask(() => { r.result = store.get(k); r.onsuccess && r.onsuccess(); }); return r; },
              delete(k) { const r = {}; queueMicrotask(() => { store.delete(k); r.onsuccess && r.onsuccess(); queueMicrotask(() => tx.oncomplete && tx.oncomplete()); }); return r; },
            });
            return tx;
          },
        };
        if (isNew && req.onupgradeneeded) req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}

function recorder() {
  const events = [];
  const record = (type, detail = {}) => events.push({ type, detail });
  return { events, record };
}

function allPrimitive(detail) {
  return Object.values(detail).every((v) => ['string', 'number', 'boolean'].includes(typeof v));
}

// ---------------------------------------------------------------- visibility

test('routes are NOT public: only ?debug=1 reveals them', () => {
  assert.equal(PICKER_ROUTES_PUBLIC, false);
  assert.equal(pickerRoutesVisible(false), false);
  assert.equal(pickerRoutesVisible(true), true);
  assert.match(app, /const \[routesVisible\] = useState\(\(\) => pickerRoutesVisible\(isDiagnosticsEnabledFromLocation\(\)\)\)/);
  assert.match(app, /\{routesVisible && \(\s*<div[^>]*data-testid="picker-experiments"/);
});

test('the boot probe runs only under the debug gate', () => {
  const i = app.indexOf('probeStoredHandle(diag.record)');
  assert.ok(i > 0);
  const before = app.slice(Math.max(0, i - 200), i);
  assert.match(before, /if \(isDiagnosticsEnabledFromLocation\(\)\)/);
});

// ---------------------------------------------------------------- pickViaFsa

test('pickViaFsa: unsupported without the API', async () => {
  assert.equal(hasFsaPicker({}), false);
  assert.deepEqual(await pickViaFsa({}), { status: 'unsupported' });
});

test('pickViaFsa: a picked file returns handle + file; options restrict to images/PDF, single file', async () => {
  let seen;
  const h = fakeHandle();
  const g = { showOpenFilePicker: async (o) => { seen = o; return [h]; } };
  assert.equal(hasFsaPicker(g), true);
  const r = await pickViaFsa(g);
  assert.equal(r.status, 'picked');
  assert.equal(r.handle, h);
  assert.equal(r.file.type, 'image/jpeg');
  assert.equal(seen, FSA_PICKER_OPTIONS);
  assert.equal(seen.multiple, false);
  assert.ok(seen.types[0].accept['application/pdf']);
  assert.ok(seen.types[0].accept['image/jpeg']);
});

test('pickViaFsa keeps the user gesture: showOpenFilePicker is called synchronously, before any await', () => {
  let called = false;
  const g = { showOpenFilePicker: () => { called = true; return new Promise(() => {}); } };
  void pickViaFsa(g); // deliberately not awaited
  assert.equal(called, true, 'the picker call must happen inside the click turn');
});

test('pickViaFsa: cancel is AbortError; other failures return the error NAME only', async () => {
  assert.deepEqual(await pickViaFsa({ showOpenFilePicker: async () => { throw domErr('AbortError'); } }), { status: 'cancelled' });
  const sec = await pickViaFsa({ showOpenFilePicker: async () => { throw domErr('SecurityError'); } });
  assert.deepEqual(sec, { status: 'error', errorName: 'SecurityError', stage: 'picker' });
  // A name that is not a plain identifier (could embed user data) is never echoed.
  const weird = await pickViaFsa({ showOpenFilePicker: async () => { throw domErr('Failed for C:\\Users\\Maria\\passport.jpg'); } });
  assert.equal(weird.errorName, 'unknown');
  assert.ok(!JSON.stringify(sec).includes('MESSAGE-WITH-USER-DATA'));
});

test('pickViaFsa: empty/odd results and getFile failure are enumerated, never thrown', async () => {
  assert.equal((await pickViaFsa({ showOpenFilePicker: async () => [] })).errorName, 'NoHandle');
  assert.equal((await pickViaFsa({ showOpenFilePicker: async () => 'nope' })).errorName, 'NoHandle');
  const r = await pickViaFsa({ showOpenFilePicker: async () => [fakeHandle({ getFile: async () => { throw domErr('NotFoundError'); } })] });
  assert.deepEqual(r, { status: 'error', errorName: 'NotFoundError', stage: 'getFile' });
});

// ---------------------------------------------------------------- handle store

test('handle store: its own database; the 72689dc photo store is untouched', () => {
  assert.equal(FSA_HANDLE_DB_NAME, 'iru-photo-handle-store');
  assert.notEqual(FSA_HANDLE_DB_NAME, PHOTO_STORE_DB_NAME);
  assert.equal(PHOTO_STORE_DB_NAME, 'iru-photo-store');
});

test('handle store round trip: save, load, clear', async () => {
  const idb = fakeIdb();
  const h = fakeHandle();
  assert.equal(await loadFsaHandle(idb), null);
  assert.equal(await saveFsaHandle(h, 'passport', idb), true);
  const got = await loadFsaHandle(idb);
  assert.equal(got.handle, h);
  assert.equal(got.evidenceKey, 'passport');
  assert.equal(typeof got.savedAt, 'number');
  assert.equal(await clearFsaHandle(idb), true);
  assert.equal(await loadFsaHandle(idb), null);
});

test('handle store never throws: no IndexedDB, blocked open, malformed record', async () => {
  assert.equal(await saveFsaHandle(fakeHandle(), 'x', null), false);
  assert.equal(await loadFsaHandle(null), null);
  const blocked = fakeIdb({ failOpen: true });
  assert.equal(await saveFsaHandle(fakeHandle(), 'x', blocked), false);
  assert.equal(await loadFsaHandle(blocked), null);
  assert.equal(await clearFsaHandle(blocked), false);
  const idb = fakeIdb();
  await saveFsaHandle({ notAHandle: true }, 'x', idb); // stored, but unusable
  assert.equal(await loadFsaHandle(idb), null, 'a record without getFile is not a handle');
});

// ---------------------------------------------------------------- boot probe (Q2)

test('probe: no stored handle', async () => {
  const r = recorder();
  assert.equal(await probeStoredHandle(r.record, async () => null), false);
  assert.deepEqual(r.events, [{ type: 'fsa-handle-probe', detail: { found: false } }]);
});

test('probe: granted permission + working getFile', async () => {
  const r = recorder();
  const found = await probeStoredHandle(r.record, async () => ({ handle: fakeHandle(), evidenceKey: 'passport', savedAt: 1 }));
  assert.equal(found, true);
  assert.deepEqual(r.events[0].detail, { found: true, permission: 'granted', getFileOk: true, mimeClass: 'image/jpeg', sizeBucket: '<1MB' });
});

test('probe: prompt permission does NOT call getFile (that needs a re-grant tap)', async () => {
  const r = recorder();
  let getFileCalls = 0;
  const h = fakeHandle({ queryPermission: async () => 'prompt', getFile: async () => { getFileCalls++; return fakeFile(); } });
  await probeStoredHandle(r.record, async () => ({ handle: h, evidenceKey: '', savedAt: 1 }));
  assert.equal(getFileCalls, 0);
  assert.deepEqual(r.events[0].detail, { found: true, permission: 'prompt' });
});

test('probe: denied, unsupported, throwing query, and a getFile failure are all enumerated', async () => {
  const cases = [
    [fakeHandle({ queryPermission: async () => 'denied' }), { found: true, permission: 'denied' }],
    [fakeHandle({ queryPermission: undefined }), { found: true, permission: 'unsupported' }],
    [fakeHandle({ queryPermission: async () => { throw domErr('SecurityError'); } }), { found: true, permission: 'error:SecurityError' }],
    [fakeHandle({ queryPermission: async () => 'garbage' }), { found: true, permission: 'unknown' }],
    [fakeHandle({ getFile: async () => { throw domErr('NotFoundError'); } }), { found: true, permission: 'granted', getFileOk: false, errorName: 'NotFoundError' }],
  ];
  for (const [h, expected] of cases) {
    const r = recorder();
    await probeStoredHandle(r.record, async () => ({ handle: h, evidenceKey: '', savedAt: 1 }));
    assert.deepEqual(r.events[0].detail, expected);
  }
});

test('probe never throws into boot, even if the loader or recorder fails', async () => {
  const r = recorder();
  assert.equal(await probeStoredHandle(r.record, async () => { throw new Error('boom'); }), false);
  assert.equal(r.events[0].detail.probeFailed, true);
  await probeStoredHandle(() => { throw new Error('recorder broke'); }, async () => { throw new Error('boom'); });
});

// ---------------------------------------------------------------- re-grant (Q2, needs a tap)

test('regrant: granted -> file + evidence key returned, logged without any file name', async () => {
  const r = recorder();
  const got = await regrantStoredHandle(r.record, async () => ({ handle: fakeHandle(), evidenceKey: 'passport', savedAt: 1 }));
  assert.equal(got.evidenceKey, 'passport');
  assert.equal(got.file.type, 'image/jpeg');
  assert.deepEqual(r.events[0].detail, { found: true, permission: 'granted', getFileOk: true, mimeClass: 'image/jpeg', sizeBucket: '<1MB' });
});

test('regrant: user declines (prompt), unsupported, or none stored -> null and a logged reason', async () => {
  for (const [h, expected] of [
    [fakeHandle({ requestPermission: async () => 'prompt' }), { found: true, permission: 'prompt' }],
    [fakeHandle({ requestPermission: undefined }), { found: true, permission: 'unsupported' }],
    [fakeHandle({ requestPermission: async () => { throw domErr('NotAllowedError'); } }), { found: true, permission: 'error:NotAllowedError' }],
  ]) {
    const r = recorder();
    assert.equal(await regrantStoredHandle(r.record, async () => ({ handle: h, evidenceKey: '', savedAt: 1 })), null);
    assert.deepEqual(r.events[0].detail, expected);
  }
  const r = recorder();
  assert.equal(await regrantStoredHandle(r.record, async () => null), null);
  assert.deepEqual(r.events[0].detail, { found: false });
});

// ---------------------------------------------------------------- privacy contract

test('privacy: no probe/regrant/pick event ever contains the file name or an error message', async () => {
  const r = recorder();
  const loader = async () => ({ handle: fakeHandle(), evidenceKey: 'passport', savedAt: 1 });
  await probeStoredHandle(r.record, loader);
  await regrantStoredHandle(r.record, loader);
  const bad = recorder();
  const badLoader = async () => ({ handle: fakeHandle({ getFile: async () => { throw domErr('NotFoundError'); } }), evidenceKey: '', savedAt: 1 });
  await probeStoredHandle(bad.record, badLoader);
  await regrantStoredHandle(bad.record, badLoader);
  for (const e of [...r.events, ...bad.events]) {
    assert.ok(allPrimitive(e.detail), 'only string/number/boolean values');
  }
  const blob = JSON.stringify([...r.events, ...bad.events]);
  assert.ok(!blob.includes(SECRET_NAME) && !blob.includes('passport-scan'));
  assert.ok(!blob.includes('MESSAGE-WITH-USER-DATA'));
});

test('privacy: these events persist across boots through the existing sanitising log', () => {
  const storage = memStorage();
  const d = createDiagnostics(storage);
  d.record('fsa-handle-probe', { found: true, permission: 'prompt' });
  d.record('picker-open', { stage: 'PHOTO', method: 'fsa' });
  const saved = JSON.parse(storage.getItem('iru_diagnostics_v1'));
  assert.deepEqual(saved.map((e) => e.type), ['fsa-handle-probe', 'picker-open']);
  assert.equal(saved[1].detail.method, 'fsa');
});

test('fsaPicker.ts makes no network call of any kind', () => {
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/.test(fsaSrc));
});

// ---------------------------------------------------------------- marker carries the route

test('marker: the route is recorded, defaults to input, and old markers still read', () => {
  const s = memStorage();
  markPickerOpened('passport', s);
  assert.equal(readPickerAttempt(s).method, 'input');
  markPickerOpened('passport', s, 'fsa');
  assert.equal(readPickerAttempt(s).method, 'fsa');
  assert.equal(readPickerAttempt(s).attemptCount, 2, 'attempt counting is unchanged');
  markPickerOpened('passport', s, 'camera');
  assert.equal(readPickerAttempt(s).method, 'camera');
  markPickerOpened('passport', s, 'bogus');
  assert.equal(readPickerAttempt(s).method, 'input');
  s.setItem(PICKER_ATTEMPT_KEY, JSON.stringify({ openedAt: 1, attemptCount: 3, docType: null }));
  assert.equal(readPickerAttempt(s).method, 'input', 'a marker written before this field existed');
});

test('marker stays free of file data: exactly openedAt, attemptCount, docType, method', () => {
  const s = memStorage();
  markPickerOpened('passport', s, 'fsa');
  assert.deepEqual(Object.keys(JSON.parse(s.getItem(PICKER_ATTEMPT_KEY))).sort(), ['attemptCount', 'docType', 'method', 'openedAt']);
});

// ---------------------------------------------------------------- App wiring (source guards)

function fn(startNeedle, len = 2600) {
  const s = app.indexOf(startNeedle);
  assert.ok(s >= 0, `${startNeedle} present`);
  return app.slice(s, s + len);
}

test('handleFsaPick: marker FIRST, then recovery save, then the picker, with no await before it', () => {
  const b = fn('const handleFsaPick = () => {', 1500);
  const iMark = b.indexOf("markPickerOpened(photoEvidenceKey || null, undefined, 'fsa')");
  const iSave = b.indexOf('saveRecovery(');
  const iDiag = b.indexOf("diag.record('picker-open', { stage, method: 'fsa' })");
  const iPick = b.indexOf('pickViaFsa()');
  assert.ok(iMark >= 0 && iMark < iSave && iSave < iDiag && iDiag < iPick, 'order: marker, save, diag, pick');
  assert.ok(!/\bawait\b/.test(b.slice(0, iPick)), 'no await before the picker call (would spend the user activation)');
});

test('handleFsaPick: a landed file takes the same hold + clear rules as the input route', () => {
  const b = fn('const handleFsaPick = () => {', 2200);
  assert.match(b, /clearPickerAttempt\(\);/);
  assert.match(b, /setPickerRecreatedNotice\(''\)/);
  assert.match(b, /setPhotoFile\(r\.file\)/);
  assert.match(b, /void savePhotoFile\(r\.file, photoEvidenceKey\)/);
  assert.match(b, /saveFsaHandle\(r\.handle, photoEvidenceKey\)/);
  assert.match(b, /d\.record\('picker-cancel', \{ stage, method: 'fsa' \}\)/);
});

test('the stored handle is cleared wherever the photo hold is cleared (Start Over, packet, successful review)', () => {
  const photo = (app.match(/void clearPhotoFile\(\);/g) || []).length;
  const handle = (app.match(/void clearFsaHandle\(\);/g) || []).length;
  assert.equal(photo, 3);
  assert.equal(handle, photo);
});

test('camera route: sr-only (never hidden), capture set, marker first, same change handler', () => {
  const b = fn('id="iru-photo-camera-input"', 1500);
  assert.match(b, /type="file"/);
  assert.match(b, /accept="image\/\*"/);
  assert.match(b, /capture="environment"/);
  assert.match(b, /className="sr-only"/);
  assert.ok(!/className="hidden"/.test(b));
  assert.ok(b.indexOf("markPickerOpened(photoEvidenceKey || null, undefined, 'camera')") < b.indexOf('saveRecovery('));
  assert.match(b, /onChange=\{handlePhotoChange\}/);
});

test('picker-change records which route delivered the file', () => {
  assert.match(app, /method: e\.target\.id === 'iru-photo-camera-input' \? 'camera' : 'input'/);
});

test('recreation detection records the route that was in flight', () => {
  assert.match(app, /picker-recreation-detected', \{ attemptCount: attempt \? attempt\.attemptCount : 1, stage: 'PHOTO', method: attempt \? attempt\.method : 'input' \}/);
});

// ---------------------------------------------------------------- production behaviour unchanged

test('production input route is unchanged: marker first, sr-only, same retry label', () => {
  const b = fn('id="iru-photo-input"', 1600);
  assert.match(b, /className="sr-only"/);
  assert.ok(b.indexOf('markPickerOpened(photoEvidenceKey || null);') < b.indexOf('saveRecovery('));
  assert.match(app, /<label htmlFor="iru-photo-input" className="inline-block px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium cursor-pointer">/);
});

test('the review path still validates before reading or sending (selection route does not bypass it)', () => {
  const b = fn('const handlePhotoReview', 2500);
  const iValidate = b.indexOf('validatePhotoFile(');
  assert.ok(iValidate > 0);
  assert.ok(iValidate < b.indexOf('new FileReader') || b.indexOf('new FileReader') === -1);
  assert.ok(iValidate < b.indexOf("fetch('/api/review-image'") || b.indexOf("fetch('/api/review-image'") === -1);
});
