// Client-side photo compression (2026-10-28, owner ruling: consumers
// must not have to downsize a photo themselves). An oversize IMAGE is
// shrunk in the browser at Review time until its base64 payload fits
// the existing platform cap; PDFs, HEIC, and unsupported types keep
// their existing refusals, and any compression failure falls back to
// the existing oversize refusal. No network, no new stored copy.
// Synthetic fixtures only; canvas/bitmap are faked via injected deps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compressPhotoFile,
  isCompressiblePhoto,
  fitsReviewPayload,
  compressionSteps,
  targetDimensions,
  outputMimeType,
  MAX_PHOTO_FILE_BYTES,
} from '../src/photoCompression.ts';
import { validatePhotoFile } from '../src/photoValidation.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');

const fakeImage = (w = 4000, h = 3000) => ({
  width: w,
  height: h,
  draw: () => {},
  close: () => {},
});
// Fake encoder: output size scales with area (scale^2) and quality,
// so dimension reduction shrinks the blob before quality loss does.
const fakeEncode = (seen) => async (_img, width, height, step, _mime) => {
  seen.push(step);
  void width; void height;
  return { size: Math.floor(8_000_000 * step.scale * step.scale * step.quality) };
};
const fakeFile = (over = {}) => ({ name: 'doc.jpg', type: 'image/jpeg', size: 8_000_000, ...over });

test('(a) a small image that already fits is left alone (no compression)', async () => {
  const r = await compressPhotoFile(fakeFile({ size: 500 * 1024 }), {
    decode: async () => fakeImage(),
    encode: fakeEncode([]),
  });
  assert.equal(r, null);
  assert.equal(fitsReviewPayload(500 * 1024), true);
  assert.equal(fitsReviewPayload(MAX_PHOTO_FILE_BYTES), true);
  assert.equal(fitsReviewPayload(MAX_PHOTO_FILE_BYTES + 1), false);
});

test('(b) an oversize image is reduced, dimension-first, until it fits', async () => {
  const seen = [];
  const r = await compressPhotoFile(fakeFile(), {
    decode: async () => fakeImage(),
    encode: fakeEncode(seen),
  });
  assert.ok(r, 'expected a compressed result');
  assert.equal(r.mimeType, 'image/jpeg');
  assert.equal(r.name, 'doc.jpg');
  assert.equal(r.originalSize, 8_000_000);
  assert.ok(r.compressedSize <= MAX_PHOTO_FILE_BYTES);
  assert.ok(fitsReviewPayload(r.compressedSize));
  // Dimension steps ran before any quality drop: the fitting step is
  // still at quality 0.92, reached by shrinking dimensions alone.
  assert.ok(seen.length >= 2, 'should have tried more than one step');
  assert.equal(seen[seen.length - 1].quality, 0.92);
  assert.ok(seen[seen.length - 1].scale < 1);
  assert.ok(seen.every((s, i) => i === 0 || s.scale <= seen[i - 1].scale));
});

test('(c) an oversize PDF is NOT compressed and still refuses', async () => {
  const pdf = fakeFile({ name: 'doc.pdf', type: 'application/pdf', size: 8_000_000 });
  assert.equal(isCompressiblePhoto(pdf), false);
  const r = await compressPhotoFile(pdf, {
    decode: async () => fakeImage(),
    encode: fakeEncode([]),
  });
  assert.equal(r, null);
  const v = validatePhotoFile(pdf);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'oversize');
});

test('(d) compression failure falls back to the existing refusal (never throws)', async () => {
  const noDecode = await compressPhotoFile(fakeFile(), {
    decode: async () => null,
    encode: fakeEncode([]),
  });
  assert.equal(noDecode, null);
  const noEncode = await compressPhotoFile(fakeFile(), {
    decode: async () => fakeImage(),
    encode: async () => null,
  });
  assert.equal(noEncode, null);
  const throwing = await compressPhotoFile(fakeFile(), {
    decode: async () => { throw new Error('boom'); },
    encode: fakeEncode([]),
  });
  assert.equal(throwing, null);
  // In every failure case the caller shows the unchanged oversize message.
  const v = validatePhotoFile(fakeFile());
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.message, /3\.3 MB/);
});

test('(e) HEIC and unsupported types still refuse and are never compressed', () => {
  for (const f of [
    fakeFile({ name: 'photo.heic', type: 'image/heic' }),
    fakeFile({ name: 'file.bin', type: 'application/octet-stream' }),
    fakeFile({ name: 'file', type: '' }),
  ]) {
    assert.equal(isCompressiblePhoto(f), false);
    const v = validatePhotoFile(f);
    assert.equal(v.ok, false);
    if (!v.ok) assert.notEqual(v.reason, 'oversize');
  }
});

test('pure step math: never upscale, aspect preserved, quality drops last', () => {
  assert.deepEqual(targetDimensions(4000, 3000, 0.5), { width: 2000, height: 1500 });
  assert.deepEqual(targetDimensions(4000, 3000, 2), { width: 4000, height: 3000 });
  assert.deepEqual(targetDimensions(10, 10, 0), { width: 1, height: 1 });
  const steps = compressionSteps();
  assert.ok(steps.length >= 5);
  // First six steps hold quality at 0.92 while dimensions shrink;
  // a quality drop appears only at a small scale, as a last resort.
  assert.ok(steps.slice(0, 6).every((s) => s.quality === 0.92));
  assert.ok(steps.slice(0, 6).every((s, i) => i === 0 || s.scale < steps[i - 1].scale));
  assert.equal(outputMimeType('image/jpeg'), 'image/jpeg');
  assert.equal(outputMimeType('image/webp'), 'image/webp');
  assert.equal(outputMimeType('image/png'), 'image/png');
  assert.equal(outputMimeType('image/gif'), 'image/png');
  assert.equal(isCompressiblePhoto(fakeFile({ type: 'image/png' })), true);
  assert.equal(isCompressiblePhoto(fakeFile({ type: 'image/webp' })), true);
  assert.equal(isCompressiblePhoto(fakeFile({ type: 'image/gif' })), true);
});

test('App.tsx wires compression into Review only, with a resized notice', () => {
  assert.match(app, /compressPhotoFile\(photoFile\)/);
  assert.match(app, /validation\.reason === 'oversize' && isCompressiblePhoto\(photoFile\)/);
  assert.match(app, /readAsDataURL\(reviewFile\)/);
  assert.match(app, /photoResizedNotice/);
  assert.match(app, /photoResized/);
  // The notice text exists in all 5 language blocks.
  const count = (constants.match(/photoResized: "/g) || []).length;
  assert.equal(count, 5, `expected 5 photoResized entries, got ${count}`);
  assert.match(constants, /Your photo was resized in your browser so it could be reviewed\. The original file was not changed\./);
});
