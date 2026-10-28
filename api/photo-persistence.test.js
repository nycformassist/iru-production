// Photo persistence (owner ruling 2026-10-28): a picked document photo
// must survive a page recreation on Android Chrome. The file is held
// temporarily in this browser only (IndexedDB, src/photoFileStore.ts),
// cleared on Start Over, packet completion, and after a successful
// review, and kept on review failure so Retry works. Synthetic fixtures
// only. Behavioral where the logic is a pure module; source-guarded
// where it lives in App.tsx (React/JSX cannot run under the node harness).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  savePhotoFile,
  loadPhotoFile,
  clearPhotoFile,
  PHOTO_STORE_DB_NAME,
  PHOTO_STORE_NAME,
  PHOTO_STORE_KEY,
  __testResetPhotoStoreMemory,
} from '../src/photoFileStore.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/photoFileStore.ts', import.meta.url), 'utf8');
const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');

function body(startNeedle, endNeedle) {
  const s = app.indexOf(startNeedle);
  assert.ok(s >= 0, `${startNeedle} present`);
  const e = app.indexOf(endNeedle, s + startNeedle.length);
  assert.ok(e > s, `${endNeedle} follows`);
  return app.slice(s, e);
}

test('store identity: one database, one object store, one record', () => {
  assert.equal(PHOTO_STORE_DB_NAME, 'iru-photo-store');
  assert.equal(PHOTO_STORE_NAME, 'iru-photo');
  assert.equal(PHOTO_STORE_KEY, 'current');
  assert.match(store, /createObjectStore\(PHOTO_STORE_NAME\)/);
});

test('store/restore round trip: name, type, evidence key, and blob survive', async () => {
  __testResetPhotoStoreMemory();
  const blob = new Blob(['synthetic-document-bytes'], { type: 'image/jpeg' });
  // A File carries a name; the store must keep it for the dropzone.
  const file = new File([blob], '20261026_120155.jpg', { type: 'image/jpeg' });
  assert.equal(await savePhotoFile(file, 'has_passport'), true);
  const loaded = await loadPhotoFile();
  assert.ok(loaded, 'held file loads back');
  assert.equal(loaded.name, '20261026_120155.jpg');
  assert.equal(loaded.type, 'image/jpeg');
  assert.equal(loaded.evidenceKey, 'has_passport');
  assert.equal(await loaded.blob.text(), 'synthetic-document-bytes');
  await clearPhotoFile();
});

test('choosing another file replaces the held file', async () => {
  __testResetPhotoStoreMemory();
  await savePhotoFile(new File(['first'], 'first.jpg', { type: 'image/jpeg' }), 'has_passport');
  await savePhotoFile(new File(['second'], 'second.png', { type: 'image/png' }), 'has_i94');
  const loaded = await loadPhotoFile();
  assert.ok(loaded);
  assert.equal(loaded.name, 'second.png');
  assert.equal(loaded.type, 'image/png');
  assert.equal(loaded.evidenceKey, 'has_i94');
  assert.equal(await loaded.blob.text(), 'second');
  await clearPhotoFile();
});

test('clear removes the held file; a later load returns null', async () => {
  __testResetPhotoStoreMemory();
  await savePhotoFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }), '');
  assert.ok(await loadPhotoFile());
  assert.equal(await clearPhotoFile(), true);
  assert.equal(await loadPhotoFile(), null);
});

test('store operations never throw on bad input', async () => {
  __testResetPhotoStoreMemory();
  assert.equal(await savePhotoFile(null, ''), false);
  assert.equal(await loadPhotoFile(), null);
  assert.equal(await clearPhotoFile(), true);
});

test('App: handlePhotoChange persists the picked file and keeps the input reset', () => {
  const change = body('const handlePhotoChange', 'const handlePhotoReview');
  assert.match(change, /savePhotoFile\(picked, photoEvidenceKey\)/);
  assert.match(change, /e\.target\.value = ''/, 'input value reset stays as-is');
  // An empty change (cancel) must not touch the held file.
  assert.ok(!change.includes('clearPhotoFile'), 'cancel/empty change does not clear the held file');
});

test('App: PHOTO restore loads the held file, shows a restored notice, and clears the stale select-again notice', () => {
  const restore = body('Photo-file restore after a page recreation', 'const handlePhotoChange');
  assert.match(restore, /stage !== 'PHOTO' \|\| photoFile/);
  assert.match(restore, /loadPhotoFile\(\)/);
  assert.match(restore, /setPhotoFile\(file\)/);
  assert.match(restore, /setRestoredNotice\(''\)/);
  assert.match(restore, /photoRestored/);
  assert.match(restore, /setPhotoEvidenceKey\(\(prev: string\) => prev \|\| stored\.evidenceKey/);
});

test('App: Start Over clears the held photo file alongside the recovery key, never wholesale storage', () => {
  const start = body('const handleStartOver', 'Facts: consumer confirmation');
  assert.match(start, /clearRecovery\(sessionStore\(\)\)/);
  assert.match(start, /clearPhotoFile\(\)/);
  assert.match(start, /setPhotoRestoredNotice\(''\)/);
  assert.ok(!/sessionStorage\.(clear|removeItem)/.test(start), 'Start Over never clears storage wholesale');
});

test('App: packet completion clears the held photo file (PACKET effect, outside handleInterviewComplete)', () => {
  const packet = body("if (stage === 'PACKET')", 'Android recovery diagnostics');
  assert.match(packet, /clearPhotoFile\(\)/);
  assert.match(packet, /clearRecovery\(sessionStore\(\)\)/);
  // The completion function itself is untouched by this fix
  // (handleInterviewComplete precedes handleStartOver in the file, so
  // the end needle must be the function that follows it).
  const complete = body('const handleInterviewComplete', 'const generateExecutiveSummary');
  assert.ok(!complete.includes('clearPhotoFile'), 'handleInterviewComplete is not edited for this fix');
});

test('App: successful review clears the held file; failure paths do not', () => {
  const review = body('const handlePhotoReview', 'const handleStartOver');
  assert.match(review, /void clearPhotoFile\(\);/);
  const failSegment = review.slice(review.indexOf('if (!response.ok)'), review.indexOf("phase = 'parse'"));
  assert.ok(!failSegment.includes('clearPhotoFile'), 'non-OK review response keeps the held file for Retry');
  const catchSegment = review.slice(review.indexOf('} catch (e) {'));
  assert.ok(!catchSegment.includes('clearPhotoFile'), 'review exception keeps the held file for Retry');
});

test('App: restored notice is rendered on the photo step and dismissible', () => {
  assert.match(app, /photoRestoredNotice && \(/);
  assert.match(app, /setPhotoRestoredNotice\(''\)/);
});

test('Privacy wording: held in browser only until review, then removed; never stored on IRU servers — all 5 languages', () => {
  // Old wording must be gone.
  assert.ok(!constants.includes('not stored by IRU'), 'old EN privacy claim removed');
  assert.ok(!constants.includes('IRU does not save your photo'), 'old EN photo-desc claim removed');
  assert.ok(!constants.includes('IRU keeps no copy'), 'old EN no-copy claim removed');
  // New wording present in every language.
  assert.match(constants, /held in your browser only until review, then removed/);
  assert.match(constants, /solo en su navegador hasta su revisión y luego se elimina/);
  assert.match(constants, /仅保存在您的浏览器中，直到审核完成，然后会被删除/);
  assert.match(constants, /sèlman nan navigatè ou jiskaske li revize/);
  assert.match(constants, /في متصفحك فقط حتى تتم مراجعتها، ثم تُحذف/);
  assert.match(constants, /not stored on IRU servers/);
  // The restored notice key exists in all five dictionaries.
  assert.equal((constants.match(/photoRestored:/g) || []).length, 5);
});

test('Store module: no network, no sessionStorage, no payment keys', () => {
  assert.ok(!store.includes('fetch('), 'photo store never sends anything');
  assert.ok(!store.includes('sessionStorage'), 'photo store does not use sessionStorage');
  assert.ok(!store.includes('localStorage'), 'photo store does not use localStorage');
  assert.ok(!store.includes('clearRecovery'), 'photo store does not clear recovery keys');
  assert.ok(!store.includes('purchaseIntentKey'), 'photo store never touches purchase tokens');
  assert.ok(!store.includes('ownedForms'), 'photo store never touches owned-form state');
});
