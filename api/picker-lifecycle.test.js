// Issue 1 (2026-10-28) regression coverage for the mobile photo-picker
// lifecycle. Behavioral where the logic is a pure module; source-guarded
// where it lives in App.tsx (React/JSX cannot run under the node harness).
// Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  saveRecovery,
  loadRecovery,
  clearRecovery,
  loadPickerMarker,
  RECOVERY_KEY,
} from '../src/assessmentRecovery.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}
const throwing = () => ({
  getItem() { throw new Error('SecurityError (synthetic)'); },
  setItem() { throw new Error('QuotaExceededError (synthetic)'); },
  removeItem() { throw new Error('SecurityError (synthetic)'); },
});

const STATE = {
  stage: 'PHOTO',
  language: 'HT',
  answers: { marital_status: 'single', case_type: 'asylum', has_passport: 'yes' },
  docType: 'has_passport',
};

/** Source of one handler/arrow function body from App.tsx. */
function body(startNeedle, endNeedle) {
  const s = app.indexOf(startNeedle);
  assert.ok(s >= 0, `${startNeedle} present`);
  const e = app.indexOf(endNeedle, s + startNeedle.length);
  assert.ok(e > s, `${endNeedle} follows`);
  return app.slice(s, e);
}
const MUTATORS = /\b(setStage|setLang|setAnswers|setPhotoEvidenceKey|setCurrentQ|clearRecovery|setUploads)\(/;

test('picker open: the recovery snapshot (with picker marker) is written synchronously and restores exactly', () => {
  const store = fakeStorage();
  assert.equal(saveRecovery(store, { ...STATE, pickerOpened: true }), true);
  assert.ok(store._map.has(RECOVERY_KEY), 'written immediately, no timer involved');
  const r = loadRecovery(store);
  assert.ok(r);
  assert.equal(r.stage, 'PHOTO');
  assert.equal(r.language, 'HT');
  assert.equal(r.docType, 'has_passport');
  assert.equal(r.answers.marital_status, 'single');
  assert.equal(r.pickerOpened, true);
  assert.equal(loadPickerMarker(store), true);
});

test('picker open: App writes recovery in the input onClick BEFORE the OS picker can take over', () => {
  const click = body('onClick={() => {', 'onCancel={');
  assert.match(click, /saveRecovery\(sessionStore\(\), \{[^}]*pickerOpened: true/);
  assert.ok(!click.includes('diag.record('), 'no debug logging on picker open (picker-testing instrumentation removed 2026-10-29)');
});

test('picker cancel: the cancel handler cannot change stage, language, answers, or doc type', () => {
  const cancel = body('onCancel={() => {', 'onChange={handlePhotoChange}');
  assert.ok(!MUTATORS.test(cancel), 'cancel handler contains no state or recovery mutation');
  assert.match(cancel, /pickerOpened: false/, 'cancel clears the picker-opened flag');
  assert.ok(!cancel.includes('diag.record('), 'no debug logging on picker cancel');
});

test('picker cancel (no event at all): the saved snapshot alone restores stage, language, answers and doc type', () => {
  const store = fakeStorage();
  saveRecovery(store, { ...STATE, pickerOpened: true });
  // Page recreated by the browser while the picker was open; nothing else ran.
  const r = loadRecovery(store);
  assert.deepEqual({ s: r.stage, l: r.language, d: r.docType }, { s: 'PHOTO', l: 'HT', d: 'has_passport' });
  assert.equal(r.answers.has_passport, 'yes');
});

test('change with NO files (cancel reported as an empty change): state-preserving by construction', () => {
  const change = body('const handlePhotoChange =', '/** One-time document photo review.');
  assert.ok(!/\b(setStage|setLang|setAnswers|setPhotoEvidenceKey|setCurrentQ|clearRecovery)\(/.test(change), 'no stage/lang/answers/docType mutation in handlePhotoChange');
  assert.match(change, /files && e\.target\.files\[0\] \? e\.target\.files\[0\] : null/, 'empty selection becomes null, not a throw');
  assert.match(change, /e\.target\.value = ''/, 'input reset so the same file can be re-picked');
  assert.match(change, /catch \(err\)[\s\S]*setReviewError/, 'any exception becomes a recoverable message');
});

test('throwing storage layer: save, load and clear never throw and never invent state', () => {
  const t = throwing();
  assert.equal(saveRecovery(t, { ...STATE, pickerOpened: true }), false);
  assert.equal(loadRecovery(t), null);
  assert.equal(clearRecovery(t), false);
  assert.equal(loadPickerMarker(t), false);
  assert.equal(saveRecovery(null, STATE), false);
  assert.equal(loadRecovery(undefined), null);
});

test('App never touches the recovery key directly; direct sessionStorage use is payment/entitlement only', () => {
  const calls = [...app.matchAll(/sessionStorage\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  for (const arg of calls) {
    assert.ok(!/recovery/i.test(arg), `direct sessionStorage access must not use the recovery key (${arg})`);
  }
  // Entitlement/payment tokens share sessionStorage with the recovery key, which is
  // exactly why Start Over must remove only RECOVERY_KEY (next test).
  assert.ok(calls.some((a) => /entitlement|evaluation|form_tokens/.test(a)), 'payment tokens do live in sessionStorage');
});

test('Start Over clears ONLY the recovery key (payment and other keys survive)', () => {
  const store = fakeStorage({
    [RECOVERY_KEY]: JSON.stringify({ stub: true }),
    iru_purchase_intent_synthetic: 'token-123',
    iru_diag_boot_session: '4',
    unrelated_key: 'keep',
  });
  assert.equal(clearRecovery(store), true);
  assert.equal(store._map.has(RECOVERY_KEY), false);
  assert.deepEqual([...store._map.keys()].sort(), ['iru_diag_boot_session', 'iru_purchase_intent_synthetic', 'unrelated_key']);
  const start = body('const handleStartOver = () => {', 'setConsulate(null);');
  assert.match(start, /clearRecovery\(sessionStore\(\)\)/);
  assert.ok(!/(sessionStorage|localStorage)\.(clear|removeItem)/.test(start), 'Start Over never clears storage wholesale');
});


test('picker-testing diagnostics are gone from App (picker defect resolved on-device 2026-10-29)', () => {
  for (const ev of ['review-validate', 'review-start', 'review-response', 'review-error', 'picker-open', 'picker-cancel', 'picker-change', 'picker-recreation-detected', 'shared-file-received', 'review-compressed']) {
    assert.ok(!app.includes(`'${ev}'`), `${ev} debug event must be removed`);
  }
  assert.ok(!app.includes('summarizeFileForDiagnostics'), 'file summarizer must be removed');
});
