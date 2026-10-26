// Structural + translation tests for the PHOTO document-type label and
// picker guidance (Commit 4). The repo has no DOM test harness, so these
// assert the structural facts (visible associated label, per-language
// keys) rather than rendered pixels. Narrow-width visibility (320/390px)
// still needs the owner's device check — see the final report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(dir, '../src/App.tsx'), 'utf8');
const constSrc = fs.readFileSync(path.join(dir, '../src/constants.tsx'), 'utf8');

const photoStart = appSrc.indexOf("{stage === 'PHOTO' && (");
assert.ok(photoStart !== -1, 'PHOTO stage block must exist');
const analyzingStart = appSrc.indexOf("{stage === 'ANALYZING' && (", photoStart);
const photo = appSrc.slice(photoStart, analyzingStart === -1 ? undefined : analyzingStart);

const NEW_KEYS = [
  'docTypeLabel',
  'pickerGuidance',
  'photoRetry',
  'photoChooseAnother',
  'photoContinueWithout',
  'recoveryRestored',
  'recoveryPicker',
  'globalError',
];

test('document-type dropdown has a visible, associated label above it', () => {
  assert.ok(photo.includes('<label htmlFor="iru-doc-type-select"'), 'label must target the select');
  assert.ok(photo.includes('<select'), 'select must exist');
  assert.ok(photo.includes('id="iru-doc-type-select"'), 'select must carry the matching id');
  const labelAt = photo.indexOf('<label htmlFor="iru-doc-type-select"');
  const selectAt = photo.indexOf('id="iru-doc-type-select"');
  assert.ok(labelAt !== -1 && selectAt !== -1 && labelAt < selectAt, 'label must sit directly above the select');
  const labelTag = photo.slice(labelAt, photo.indexOf('>', labelAt));
  for (const banned of ['sr-only', 'hidden', 'truncate', 'whitespace-nowrap', 'overflow-hidden']) {
    assert.ok(!labelTag.includes(banned), `label must stay visible and wrapping (found ${banned})`);
  }
  assert.ok(labelTag.includes('block'), 'label must be a block so it wraps cleanly');
  assert.ok(photo.includes("t('docTypeLabel'"), 'label text must come from the translation mechanism');
});

test('picker guidance sits near the picker and uses the translation mechanism', () => {
  assert.ok(photo.includes("t('pickerGuidance'"), 'guidance must come from the translation mechanism');
  const guideAt = photo.indexOf("t('pickerGuidance'");
  const selectAt = photo.indexOf('id="iru-doc-type-select"');
  const inputAt = photo.indexOf('id="iru-photo-input"');
  assert.ok(inputAt < guideAt && guideAt < selectAt, 'guidance must sit between the file input and the document-type select');
});

test('every new key exists in every supported language block', () => {
  const uiStart = constSrc.indexOf('export const UI_LABELS');
  assert.ok(uiStart !== -1, 'UI_LABELS must exist');
  // Language blocks inside UI_LABELS, in file order EN, ES, ZH, HT, AR.
  // The second record with EN/ES/... blocks (after UI_LABELS) bounds the AR block.
  const langs = ['EN', 'ES', 'ZH', 'HT', 'AR'];
  const starts = [];
  let from = uiStart;
  for (const lang of langs) {
    const at = constSrc.indexOf(`\n  ${lang}: {`, from);
    assert.ok(at !== -1, `missing ${lang} block in UI_LABELS`);
    starts.push(at);
    from = at + 1;
  }
  const secondRecord = constSrc.indexOf('\n  EN: {', starts[4] + 1);
  const ends = [...starts.slice(1), secondRecord === -1 ? constSrc.length : secondRecord];
  for (let i = 0; i < langs.length; i++) {
    const block = constSrc.slice(starts[i], ends[i]);
    for (const key of NEW_KEYS) {
      assert.ok(block.includes(`${key}:`), `${key} must exist in the ${langs[i]} block`);
    }
  }
});

test('each new key appears exactly once per language (5 total)', () => {
  for (const key of NEW_KEYS) {
    const count = constSrc.split(`${key}:`).length - 1;
    assert.equal(count, 5, `${key} must appear exactly 5 times (once per language), found ${count}`);
  }
});

test('directive label wording is present (EN + HT draft)', () => {
  assert.ok(constSrc.includes('docTypeLabel: "Choose the type of document or evidence."'), 'EN label must match the directive');
  assert.ok(constSrc.includes('docTypeLabel: "Chwazi kalite dokiman oswa prèv la."'), 'HT label must match the directive draft');
  assert.ok(constSrc.includes("To close the file picker, tap its X or back arrow."), 'EN guidance must match the directive');
});

test('label addition preserves the PHOTO layout repair', () => {
  assert.ok(photo.includes('flex flex-col gap-3 pt-6 border-t border-slate-100 sm:flex-row'), 'PHOTO nav row stacking must survive');
  assert.ok(photo.includes('flex flex-col gap-3 sm:flex-row'), 'PHOTO Review/Skip group stacking must survive');
  assert.ok(photo.includes('onClick={handlePhotoReview}'), 'Review action must survive');
  assert.ok(photo.includes('onClick={handleNextQuestion}'), 'Skip action must survive');
});
