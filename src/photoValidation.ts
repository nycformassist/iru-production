// Pure, framework-free validation + error-message helpers for the PHOTO
// (document photo review) step. Kept free of React so the rules are
// unit-testable under the existing node test harness.
//
// Background (IRU mobile diagnosis 2026-10-26): the client previously
// allowed files up to 4 MiB, but base64 inflates a file to ~4/3 of its
// size, so files roughly 3.4-4 MB passed client validation and then died
// at the serverless platform's ~4.5 MB request-body limit before the
// review function ever ran. The effective cap below is the largest file
// whose base64 payload plus JSON overhead still fits that platform
// limit. Do NOT raise it beyond platform capabilities.

export const SUPPORTED_PHOTO_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

/** Serverless platform request-body limit (bytes). */
export const PLATFORM_REQUEST_BODY_LIMIT_BYTES = 4_500_000;

/** JSON-envelope slack (mimeType, keys, relatedEvidenceKey, lang). */
const JSON_OVERHEAD_BYTES = 2048;

/**
 * Largest file (bytes) whose base64 payload still fits the platform
 * body limit: floor((4_500_000 - 2048) * 3 / 4) = 3_373_464 (~3.3 MB).
 */
export const MAX_PHOTO_FILE_BYTES = Math.floor(
  ((PLATFORM_REQUEST_BODY_LIMIT_BYTES - JSON_OVERHEAD_BYTES) * 3) / 4,
);

/** Base64 payload size for a file of `fileBytes` bytes. */
export function base64PayloadBytes(fileBytes: number): number {
  return Math.ceil((fileBytes * 4) / 3);
}

export type PhotoValidation =
  | { ok: true }
  | { ok: false; reason: 'heic' | 'unsupported' | 'oversize'; message: string };

/**
 * Validate a selected file BEFORE any FileReader read or network
 * submission. HEIC/HEIF (common from phone Files-app picks) and empty
 * or unrecognized MIME types are refused with a specific, actionable
 * message instead of a request the server would reject.
 */
export function validatePhotoFile(file: {
  name: string;
  type: string;
  size: number;
}): PhotoValidation {
  const name = file.name || '';
  const type = (file.type || '').toLowerCase();
  if (
    type === 'image/heic' ||
    type === 'image/heif' ||
    /\.hei[cf]$/i.test(name)
  ) {
    return {
      ok: false,
      reason: 'heic',
      message:
        'This photo is in HEIC format, which can’t be reviewed. Please choose a JPEG, PNG, or PDF version of the document, or skip this step.',
    };
  }
  if (!type || SUPPORTED_PHOTO_MIME_TYPES.indexOf(type) === -1) {
    return {
      ok: false,
      reason: 'unsupported',
      message:
        'This file type can’t be reviewed. Please choose a JPEG, PNG, WebP, GIF, or PDF file, or skip this step.',
    };
  }
  if (file.size > MAX_PHOTO_FILE_BYTES) {
    return {
      ok: false,
      reason: 'oversize',
      message:
        'This photo is too large to review (over about 3.3 MB). Please choose a smaller photo, or skip this step — you can continue without it.',
    };
  }
  return { ok: true };
}

/**
 * Distinguishable, safe client message for a /api/review-image HTTP
 * status. Never surfaces server internals, document contents, or
 * stack traces — only the failure class and the recoverable next step.
 */
export function messageForReviewStatus(status: number): string {
  if (status === 400) {
    return 'This file couldn’t be reviewed. Please choose a JPEG, PNG, WebP, GIF, or PDF file, or skip this step.';
  }
  if (status === 413) {
    return 'This photo is too large for the review service. Please choose a smaller photo, or skip this step.';
  }
  if (status === 429) {
    return 'Too many review attempts. Please wait a few minutes and try again, or continue without this step.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'The review service is unavailable right now. You can continue without this step and try again later.';
  }
  return 'Review unavailable. You can continue without it.';
}

/** FileReader failure (file unreadable on the device). */
export const MESSAGE_PHOTO_READ_FAILURE =
  'This file couldn’t be read. Please try a different photo, or continue without this step.';

/** Malformed review response (server answered, but unusable). */
export const MESSAGE_PHOTO_BAD_RESPONSE =
  'The review service returned an unexpected result. You can continue without this step.';
