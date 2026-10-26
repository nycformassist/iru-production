// Structural guard for the IRU mobile repair 2026-10-26 PHOTO layout.
//
// HONEST LIMITATION, stated in the test and the repair report: jsdom
// cannot verify visual clipping, and this repo has no DOM test harness,
// so this file asserts the structural facts that the fix depends on
// (stacking classes, retained actions, zeroed motion offset). It is NOT
// visual proof — that comes from the headless screenshots at 320/390/
// desktop widths captured during the repair pass and from the owner's
// real-device retest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/App.tsx'),
  'utf8',
);
const photoStart = src.indexOf("{stage === 'PHOTO' && (");
assert.ok(photoStart !== -1, 'PHOTO stage block must exist');
const analyzingStart = src.indexOf("{stage === 'ANALYZING' && (", photoStart);
const photo = src.slice(photoStart, analyzingStart === -1 ? undefined : analyzingStart);

test('PHOTO button row stacks on narrow screens and returns to a row at sm:', () => {
  assert.ok(
    photo.includes('flex flex-col gap-3 pt-6 border-t border-slate-100 sm:flex-row'),
    'PHOTO nav row must stack vertically on phones and restore the row at sm:',
  );
  assert.ok(
    photo.includes('flex flex-col gap-3 sm:flex-row'),
    'PHOTO Review/Skip group must stack on phones',
  );
});

test('all three PHOTO controls retain their existing actions', () => {
  assert.ok(photo.includes('onClick={handlePrevQuestion}'), 'Back keeps handlePrevQuestion');
  assert.ok(photo.includes('onClick={handlePhotoReview}'), 'Review keeps handlePhotoReview');
  assert.ok(photo.includes('onClick={handleNextQuestion}'), 'Skip keeps handleNextQuestion');
  assert.ok(photo.includes('ui.photoSkip || ui.next'), 'Skip keeps its label');
  assert.ok(photo.includes('ui.photoReview'), 'Review keeps its label');
  assert.ok(photo.includes('ui.back'), 'Back keeps its label');
});

test('PHOTO panel entrance animation ends at horizontal zero', () => {
  const motion = photo.slice(0, photo.indexOf('className="p-8 sm:p-12"'));
  assert.ok(motion.includes('initial={{ opacity: 0, x: 20 }}'), 'PHOTO panel still animates in');
  assert.ok(motion.includes('animate={{ opacity: 1, x: 0, y: 0 }}'), 'PHOTO panel must end at x: 0');
});

test('PHOTO buttons are full-width on phones (tappable, no overflow)', () => {
  const buttonClasses = [...photo.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
  const navButtons = buttonClasses.filter((c) => c.includes('py-3') && (c.includes('bg-indigo-600') || c.includes('border-indigo-600') || c.includes('text-slate-600')));
  assert.ok(navButtons.length >= 3, `expected 3 PHOTO nav buttons, found ${navButtons.length}`);
  for (const c of navButtons) {
    assert.ok(c.includes('w-full sm:w-auto'), `button must be full-width on phones: ${c}`);
  }
});
