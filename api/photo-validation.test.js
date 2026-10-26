// Regression tests for the IRU mobile repair 2026-10-26: client-side
// photo validation (HEIC/unknown types, platform body-limit cap) and
// distinguishable review-failure messages. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePhotoFile,
  messageForReviewStatus,
  base64PayloadBytes,
  MAX_PHOTO_FILE_BYTES,
  PLATFORM_REQUEST_BODY_LIMIT_BYTES,
  MESSAGE_PHOTO_READ_FAILURE,
  MESSAGE_PHOTO_BAD_RESPONSE,
} from '../src/photoValidation.ts';

const MB = 1024 * 1024;

test('supported image uploads pass validation (jpeg/png/webp/gif/pdf)', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']) {
    const r = validatePhotoFile({ name: 'doc.jpg', type, size: 500 * 1024 });
    assert.equal(r.ok, true, type);
  }
});

test('HEIC by MIME type is refused with a specific message, before any request', () => {
  for (const type of ['image/heic', 'image/heif']) {
    const r = validatePhotoFile({ name: 'photo.heic', type, size: 100 * 1024 });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'heic');
      assert.match(r.message, /HEIC/);
      assert.match(r.message, /JPEG/);
    }
  }
});

test('HEIC by file extension is refused even when the MIME type is empty', () => {
  const r = validatePhotoFile({ name: 'IMG_1234.HEIC', type: '', size: 100 * 1024 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'heic');
});

test('empty or unrecognized MIME types are refused with a specific message', () => {
  const empty = validatePhotoFile({ name: 'file', type: '', size: 100 * 1024 });
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.reason, 'unsupported');
    assert.match(empty.message, /JPEG, PNG/);
  }
  const unknown = validatePhotoFile({ name: 'file.bin', type: 'application/octet-stream', size: 100 * 1024 });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, 'unsupported');
});

test('oversized uploads are refused at the platform-effective cap, not the old 4 MiB cap', () => {
  // The old 4 MiB cap admitted files that die at the ~4.5 MB platform
  // body limit once base64-inflated. Those must now fail client-side.
  const admittedBefore = validatePhotoFile({ name: 'big.jpg', type: 'image/jpeg', size: 4 * MB });
  assert.equal(admittedBefore.ok, false);
  if (!admittedBefore.ok) {
    assert.equal(admittedBefore.reason, 'oversize');
    assert.match(admittedBefore.message, /3\.3 MB/);
  }
  const band = validatePhotoFile({ name: 'band.jpg', type: 'image/jpeg', size: 3.4 * MB });
  assert.equal(band.ok, false);
  if (!band.ok) assert.equal(band.reason, 'oversize');
  // Boundary: exactly the cap passes; one byte over fails.
  assert.equal(validatePhotoFile({ name: 'ok.jpg', type: 'image/jpeg', size: MAX_PHOTO_FILE_BYTES }).ok, true);
  assert.equal(validatePhotoFile({ name: 'over.jpg', type: 'image/jpeg', size: MAX_PHOTO_FILE_BYTES + 1 }).ok, false);
});

test('base64 payload math keeps the cap inside the platform limit', () => {
  assert.equal(base64PayloadBytes(3), 4);
  assert.equal(base64PayloadBytes(0), 0);
  assert.ok(
    base64PayloadBytes(MAX_PHOTO_FILE_BYTES) + 2048 <= PLATFORM_REQUEST_BODY_LIMIT_BYTES,
    'max file payload + JSON overhead must fit the platform limit',
  );
});

test('server failures map to distinguishable, recoverable messages', () => {
  assert.match(messageForReviewStatus(400), /couldn’t be reviewed/);
  assert.match(messageForReviewStatus(413), /too large/);
  assert.match(messageForReviewStatus(429), /wait/);
  assert.match(messageForReviewStatus(502), /unavailable/);
  assert.match(messageForReviewStatus(503), /unavailable/);
  assert.match(messageForReviewStatus(504), /unavailable/);
  assert.match(messageForReviewStatus(500), /continue without it/);
  assert.match(messageForReviewStatus(404), /continue without it/);
});

test('read failures and malformed responses are recoverable, never a throw', () => {
  assert.match(MESSAGE_PHOTO_READ_FAILURE, /continue without/);
  assert.match(MESSAGE_PHOTO_BAD_RESPONSE, /continue without/);
});
