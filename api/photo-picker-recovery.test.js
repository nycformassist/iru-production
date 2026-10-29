// Structural tests for the PHOTO picker lifecycle + recovery wiring in
// src/App.tsx and src/ErrorBoundary.ts. The repo has no DOM test
// harness, so these assert the structural facts the fix depends on
// (stable input, cancel no-op, input reset, error actions, recovery
// clears, no stage reset on any picker path). They are NOT a substitute
// for the owner's Galaxy A17 device test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(dir, '../src/App.tsx'), 'utf8');
const boundarySrc = fs.readFileSync(path.join(dir, '../src/ErrorBoundary.ts'), 'utf8');

const photoStart = appSrc.indexOf("{stage === 'PHOTO' && (");
assert.ok(photoStart !== -1, 'PHOTO stage block must exist');
const analyzingStart = appSrc.indexOf("{stage === 'ANALYZING' && (", photoStart);
const photo = appSrc.slice(photoStart, analyzingStart === -1 ? undefined : analyzingStart);

test('file input stays stable while PHOTO is mounted', () => {
  assert.ok(photo.includes('id="iru-photo-input"'), 'input keeps its id');
  assert.ok(photo.includes('ref={photoInputRef}'), 'input keeps a stable ref');
  const inputStart = photo.indexOf('id="iru-photo-input"');
  const inputEnd = photo.indexOf('/>', inputStart);
  const inputTag = photo.slice(inputStart, inputEnd);
  assert.ok(!inputTag.includes('key='), 'input must not carry a changing key');
  assert.ok(!inputTag.includes('capture'), 'input must not force camera capture');
  assert.ok(!appSrc.includes('AnimatePresence'), 'no AnimatePresence remount anywhere');
});

test('picker open saves synchronously with the picker-opened marker', () => {
  assert.ok(photo.includes('onClick={() => {'), 'input must have an open handler');
  const clickStart = photo.indexOf('onClick={() => {');
  const clickEnd = photo.indexOf('onCancel=', clickStart);
  const clickBody = photo.slice(clickStart, clickEnd);
  assert.ok(clickBody.includes('saveRecovery(sessionStore()'), 'open must save synchronously');
  assert.ok(clickBody.includes('pickerOpened: true'), 'open must set the picker marker');
  assert.ok(!clickBody.includes("diag.record("), 'open must not record a debug diagnostic (picker-testing logging removed 2026-10-29)');
});

test('picker cancellation never resets stage, language, answers, or doc type', () => {
  assert.ok(photo.includes('onCancel={() => {'), 'input must handle cancel where supported');
  const cancelStart = photo.indexOf('onCancel={() => {');
  const cancelEnd = photo.indexOf('onChange={handlePhotoChange}', cancelStart);
  const cancelBody = photo.slice(cancelStart, cancelEnd);
  assert.ok(cancelBody.includes('pickerOpened: false'), 'cancel must clear the picker-opened flag');
  assert.ok(cancelBody.includes('saveRecovery(sessionStore()'), 'cancel must persist the cleared flag');
  for (const token of ['setStage', 'setLang', 'setAnswers', 'setPhotoEvidenceKey', 'setCurrentQ']) {
    assert.ok(!cancelBody.includes(token), `cancel handler must not call ${token}`);
  }
});

test('file-change handling resets the input and never resets stage', () => {
  const fnStart = appSrc.indexOf('const handlePhotoChange');
  assert.ok(fnStart !== -1, 'handlePhotoChange must exist');
  const fnEnd = appSrc.indexOf('/** One-time document photo review', fnStart);
  const fnBody = appSrc.slice(fnStart, fnEnd);
  assert.ok(!fnBody.includes("diag.record("), 'change must not record a debug diagnostic (picker-testing logging removed 2026-10-29)');
  assert.ok(fnBody.includes('pickerOpened: false'), 'a landed pick must clear the picker-opened flag');
  assert.ok(fnBody.includes('setPhotoFile(e.target.files'), 'change must set the photo state from the selected file');
  assert.ok(fnBody.includes("e.target.value = ''"), 'input value must reset so the same file can be re-selected');
  assert.ok(!fnBody.includes('setStage'), 'change handler must never reset stage');
  assert.ok(photo.includes('onChange={handlePhotoChange}'), 'input must use handlePhotoChange');
});

test('photo errors stay on PHOTO with Retry, Choose another, Continue without', () => {
  assert.ok(photo.includes("t('photoRetry'"), 'error UI must offer Retry');
  assert.ok(photo.includes("t('photoChooseAnother'"), 'error UI must offer Choose another');
  assert.ok(photo.includes("t('photoContinueWithout'"), 'error UI must offer Continue without');
  assert.ok(photo.includes('onClick={handlePhotoReview}'), 'Retry must re-run review');
  assert.ok(photo.includes('photoInputRef.current.click()'), 'Choose another must re-open the picker');
  assert.ok(photo.includes('onClick={handleNextQuestion}'), 'Continue without must follow the Skip path');
  // The error block must not navigate away on its own: no setStage inside it.
  const errStart = photo.indexOf('{reviewError && (');
  const errEnd = photo.indexOf('{imageReview && (', errStart);
  const errBlock = photo.slice(errStart, errEnd);
  assert.ok(!errBlock.includes('setStage'), 'error UI must not change stage by itself');
});

test('Start over clears ONLY recovery data', () => {
  const fnStart = appSrc.indexOf('const handleStartOver');
  const fnEnd = appSrc.indexOf('\n  };', fnStart);
  const fnBody = appSrc.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('clearRecovery(sessionStore())'), 'Start over must clear recovery');
  for (const key of ['iru_form_tokens', 'iru_entitlement_token', 'iru_evaluation_token', 'iru_entitlement_id', 'iru_purchase_intent']) {
    assert.ok(!fnBody.includes(key), `Start over must not touch ${key}`);
  }
});

test('assessment completion clears recovery', () => {
  const pktStart = appSrc.indexOf("if (stage === 'PACKET') {");
  assert.ok(pktStart !== -1, 'PACKET effect must exist');
  const pktEnd = appSrc.indexOf('}, [stage]);', pktStart);
  const pktBody = appSrc.slice(pktStart, pktEnd);
  assert.ok(pktBody.includes('clearRecovery(sessionStore())'), 'PACKET entry must clear recovery');
});

test('boot restore + hide/pagehide saves are wired', () => {
  assert.ok(appSrc.includes('loadRecovery(store'), 'boot must attempt a restore');
  assert.ok(appSrc.includes("t('recoveryPicker'"), 'picker-return restore message must exist');
  assert.ok(appSrc.includes("t('recoveryRestored'"), 'plain restore message must exist');
  assert.ok(appSrc.includes("document.visibilityState === 'hidden'"), 'hidden must trigger a save');
  assert.ok(appSrc.includes("window.addEventListener('pagehide'"), 'pagehide must trigger a save');
  assert.ok(appSrc.includes('loadPickerMarker(sessionStore())'), 'hide/debounced saves must preserve the PHOTO picker marker');
  assert.ok(appSrc.includes('setRestoredNotice'), 'restore notice state must exist');
  assert.ok(appSrc.includes('setGlobalNotice'), 'global error notice state must exist');
});

test('ErrorBoundary Try again resets nothing but its own error flag', () => {
  assert.ok(!boundarySrc.includes('setStage'), 'boundary must never touch stage');
  assert.ok(!boundarySrc.includes('setAnswers'), 'boundary must never touch answers');
  assert.ok(boundarySrc.includes('hasError'), 'boundary must track its own error flag');
});
