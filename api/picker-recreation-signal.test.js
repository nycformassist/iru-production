// Recreation-notice signal after the picker-testing cleanup (2026-10-29).
//
// The Android picker defect was resolved on-device (phone restart; root
// cause was device memory pressure, not app code). The testing-only
// instrumentation is gone: the persisted diagnostics event store, the
// picker-attempt marker (iru_picker_attempt_v1), the debug-only Picker
// experiments box, and the picker-route harness (FSA/camera/reload).
//
// What remains for normal users: the recreation notice. Its signal is
// now the recovery snapshot's pickerOpened flag (src/assessmentRecovery.ts),
// written synchronously at the photo input's onClick and consumed on the
// restore boot. These tests pin that wiring. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDiagnostics,
  getBuildSha,
  isDiagnosticsEnabled,
} from '../src/diagnostics.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, '../src/App.tsx'), 'utf8');
const constants = fs.readFileSync(path.join(dir, '../src/constants.tsx'), 'utf8');

test('no trace of the removed testing instrumentation remains in App.tsx', () => {
  for (const token of [
    'iru_picker_attempt_v1',
    'pickerAttemptStore',
    'markPickerOpened',
    'readPickerAttempt',
    'clearPickerAttempt',
    'fsaPicker',
    'pickViaFsa',
    'hasFsaPicker',
    'saveFsaHandle',
    'clearFsaHandle',
    'regrantStoredHandle',
    'probeStoredHandle',
    'pickerRoutesVisible',
    'picker-experiments',
    'iru-photo-camera-input',
    'iru_diagnostics_v1',
    'persistDiagnosticEvents',
    'loadPersistedDiagnostics',
    'summarizeFileForDiagnostics',
  ]) {
    assert.ok(!app.includes(token), `removed instrumentation token must be gone: ${token}`);
  }
});

test('recreation notice is derived from the recovery pickerOpened flag, not a separate marker', () => {
  // The restore boot sets the candidate ref from the recovery snapshot.
  assert.ok(
    app.includes('if (restored.pickerOpened && restored.stage === \'PHOTO\')'),
    'restore boot must read pickerOpened from the recovery snapshot',
  );
  assert.ok(app.includes('pickerRecreatedCandidateRef.current = true'), 'candidate ref must be set');
  // The photo restore effect shows the notice on the candidate ref alone.
  const effectStart = app.indexOf('pickerRecreatedCandidateRef.current = true');
  const photoBlock = app.slice(effectStart);
  assert.ok(photoBlock.includes('if (pickerRecreatedCandidateRef.current)'), 'notice must be gated on the candidate ref');
  assert.ok(
    photoBlock.includes("t('pickerRecreated', 'The page was recreated while the picker was open, before your photo arrived. Your answers are saved. Please pick the photo again.')"),
    'notice wording must be byte-identical (no translation churn)',
  );
  // The snapshot is re-saved with the flag consumed so a later reload
  // does not repeat the notice.
  assert.ok(
    photoBlock.includes('pickerOpened: false'),
    'restore boot must consume the picker-opened flag',
  );
});

test('picker lifecycle clears the picker-opened flag on every resolved path', () => {
  const onClick = app.slice(app.indexOf('onClick={() => {'), app.indexOf('onCancel={'));
  assert.ok(onClick.includes('pickerOpened: true'), 'input onClick must set the flag before the picker opens');
  const cancel = app.slice(app.indexOf('onCancel={() => {'), app.indexOf('onChange={handlePhotoChange}'));
  assert.ok(cancel.includes('pickerOpened: false'), 'cancel must clear the flag');
  const changeStart = app.indexOf('const handlePhotoChange');
  const changeEnd = app.indexOf('/** One-time document photo review.', changeStart);
  const change = app.slice(changeStart, changeEnd);
  assert.ok(change.includes('pickerOpened: false'), 'a landed pick must clear the flag');
  assert.ok(!change.includes('setStage'), 'change handler must never reset stage');
});

test('the recovery payload (the signal) stays privacy-safe', () => {
  const rec = fs.readFileSync(path.join(dir, '../src/assessmentRecovery.ts'), 'utf8');
  assert.ok(rec.includes('pickerOpened'), 'recovery payload carries the picker-opened flag');
  assert.ok(!rec.includes('fileName'), 'recovery payload must not carry file names');
});

test('debug panel still reports buildSha (the kept ?debug=1 route)', () => {
  assert.equal(getBuildSha(), 'local-dev', 'build SHA falls back under the test harness');
  const diag = createDiagnostics();
  assert.equal(diag.buildSha, 'local-dev');
  const snap = JSON.parse(diag.snapshot());
  assert.equal(snap.buildSha, 'local-dev', 'snapshot must carry buildSha for the panel');
  assert.ok(isDiagnosticsEnabled('?debug=1'), '?debug=1 still enables the panel');
  assert.ok(!isDiagnosticsEnabled(''), 'panel stays invisible to normal users');
  assert.ok(app.includes('isDiagnosticsEnabledFromLocation()'), 'overlay mount still gated on ?debug=1');
  assert.ok(app.includes("diag.record('boot'"), 'boot event (counters + navigation type) still recorded');
});

test('recreation notice wording is unchanged in all five languages', () => {
  assert.equal((constants.match(/pickerRecreated:/g) || []).length, 5);
  assert.equal((constants.match(/pickerRecreatedWhy:/g) || []).length, 5);
  const en = /pickerRecreated: "([^"]+)"/.exec(constants)[1];
  assert.equal(
    en,
    'The page was recreated while the picker was open, before your photo arrived. Your answers are saved. Please pick the photo again.',
    'EN notice must be byte-identical',
  );
});
