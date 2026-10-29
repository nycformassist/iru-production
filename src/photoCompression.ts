// Client-side photo compression for the PHOTO (document photo review)
// step (2026-10-28, owner ruling: real consumers will not downsize a
// photo themselves, so IRU must shrink a large photo itself, in the
// browser, before Review).
//
// SCOPE, stated plainly. This fixes ONLY the oversize-at-Review failure:
// a file that lands but is refused because its base64 payload would
// exceed the serverless platform body limit. It does NOT fix page
// recreation during the picker — a file that never lands is never
// seen here. No network, no new stored copy: the compressed blob
// exists only in memory for the single review call, exactly like the
// original file, and the browser-local photo hold (photoFileStore) is
// untouched — compression happens at Review time, from the current
// file, and the original held file is not replaced.
//
// LIMITS. The cap is NOT invented here: it reuses MAX_PHOTO_FILE_BYTES
// from photoValidation.ts (the largest file whose base64 payload plus
// JSON overhead still fits PLATFORM_REQUEST_BODY_LIMIT_BYTES,
// 4,500,000). A compressed blob is accepted only if it fits that cap.
//
// WHAT IS COMPRESSED. Only image types IRU already accepts for review:
// image/jpeg, image/png, image/webp, image/gif. PDFs are NOT compressed
// (canvas cannot resize a PDF) and keep the current oversize refusal.
// HEIC/empty/unknown types are refused upstream by validatePhotoFile
// and never reach this module. GIF output is PNG (canvas has no GIF
// encoder); JPEG/WebP/PNG keep their type. Never upscale: a step whose
// scale is >= 1 only re-encodes at a lower quality, it never enlarges
// dimensions.
//
// STRATEGY. Dimension reduction first, quality loss last, stop as soon
// as a candidate fits:
//   scale 1.00, 0.85, 0.70, 0.55, 0.40, 0.30 at quality 0.92,
//   then scale 0.30 at quality 0.75 and 0.60, then 0.20 at 0.60.
// Quality is ignored by PNG encoding, so PNG/GIF shrink by dimension
// alone. If canvas, bitmap decoding, or every step fails, this module
// returns null and the caller falls back to the original file and the
// existing refusal message. It never throws.

import {
  MAX_PHOTO_FILE_BYTES,
  PLATFORM_REQUEST_BODY_LIMIT_BYTES,
  base64PayloadBytes,
} from './photoValidation.ts';

export const COMPRESSIBLE_PHOTO_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

/** JSON-envelope slack, kept in sync with photoValidation.ts. */
const JSON_OVERHEAD_BYTES = 2048;

/** True when this file's base64 payload fits the platform body limit. */
export function fitsReviewPayload(fileBytes: number): boolean {
  return (
    base64PayloadBytes(fileBytes) + JSON_OVERHEAD_BYTES <=
    PLATFORM_REQUEST_BODY_LIMIT_BYTES
  );
}

/** True when the file is an image this module may attempt to compress. */
export function isCompressiblePhoto(file: {
  type: string;
  size: number;
}): boolean {
  const type = (file.type || '').toLowerCase();
  return COMPRESSIBLE_PHOTO_MIME_TYPES.indexOf(type) !== -1;
}

/** One encode attempt: a dimension scale and a JPEG/WebP quality. */
export interface CompressionStep {
  scale: number;
  quality: number;
}

/**
 * The ordered step list: dimensions shrink first (quality held at
 * 0.92), quality drops only at the smallest dimensions, as a last
 * resort before giving up and refusing.
 */
export function compressionSteps(): CompressionStep[] {
  return [
    { scale: 1, quality: 0.92 },
    { scale: 0.85, quality: 0.92 },
    { scale: 0.7, quality: 0.92 },
    { scale: 0.55, quality: 0.92 },
    { scale: 0.4, quality: 0.92 },
    { scale: 0.3, quality: 0.92 },
    { scale: 0.3, quality: 0.75 },
    { scale: 0.3, quality: 0.6 },
    { scale: 0.2, quality: 0.6 },
  ];
}

/**
 * Target dimensions for one step. Aspect ratio is preserved, each
 * side is at least 1 pixel, and the result never exceeds the source
 * dimensions (never upscale).
 */
export function targetDimensions(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  const s = Math.min(1, Math.max(0, scale));
  return {
    width: Math.max(1, Math.floor(width * s)),
    height: Math.max(1, Math.floor(height * s)),
  };
}

/** Canvas output type for a source type (GIF has no canvas encoder). */
export function outputMimeType(sourceType: string): string {
  const type = (sourceType || '').toLowerCase();
  if (type === 'image/gif') return 'image/png';
  return type;
}

/** The slice of a decoded bitmap this module draws from. */
export interface DecodedImage {
  width: number;
  height: number;
  /** Draws the image into a canvas context at the given size. */
  draw: (ctx: any, width: number, height: number) => void;
  close?: () => void;
}

/** Injectable browser surface, so tests can fake canvas/bitmap. */
export interface CompressionDeps {
  /** Decode a file to a drawable image, or null if unavailable. */
  decode: (file: Blob) => Promise<DecodedImage | null>;
  /**
   * Encode one canvas-sized draw at the given step. Return the blob
   * or null when that encoder cannot produce one.
   */
  encode: (
    image: DecodedImage,
    width: number,
    height: number,
    step: CompressionStep,
    mimeType: string,
  ) => Promise<Blob | null>;
}

/**
 * Browser decode: createImageBitmap when available, else an <img>
 * over an object URL. Never throws; returns null on any failure.
 */
async function browserDecode(file: Blob): Promise<DecodedImage | null> {
  try {
    const g: any = globalThis as any;
    if (typeof g.createImageBitmap === 'function') {
      const bitmap: any = await g.createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx: any, w: number, h: number) =>
          ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => {
          try {
            bitmap.close && bitmap.close();
          } catch {
            /* ignore */
          }
        },
      };
    }
    if (typeof g.document === 'undefined' || typeof g.URL === 'undefined') {
      return null;
    }
    const url = g.URL.createObjectURL(file);
    try {
      const img: any = await new Promise((resolve, reject) => {
        const el = g.document.createElement('img');
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (!w || !h) return null;
      return {
        width: w,
        height: h,
        draw: (ctx: any, dw: number, dh: number) =>
          ctx.drawImage(img, 0, 0, dw, dh),
      };
    } finally {
      try {
        g.URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null;
  }
}

/**
 * Browser encode: draw to an off-screen canvas, then toBlob. White
 * background first, so a transparent PNG/GIF does not turn black
 * when it becomes a JPEG. Never throws; returns null on any failure.
 */
async function browserEncode(
  image: DecodedImage,
  width: number,
  height: number,
  step: CompressionStep,
  mimeType: string,
): Promise<Blob | null> {
  try {
    const g: any = globalThis as any;
    if (typeof g.document === 'undefined') return null;
    const canvas = g.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    image.draw(ctx, width, height);
    const blob: Blob | null = await new Promise((resolve) => {
      try {
        canvas.toBlob(resolve, mimeType, step.quality);
      } catch {
        resolve(null);
      }
    });
    return blob;
  } catch {
    return null;
  }
}

export interface CompressedPhoto {
  blob: Blob;
  mimeType: string;
  /** Original file name, preserved so the checklist label is unchanged. */
  name: string;
  originalSize: number;
  compressedSize: number;
}

/**
 * Compress an oversize image until it fits, or return null.
 * Null means: not compressible, no canvas/bitmap available, every
 * encode failed, or no step fit — in all cases the caller must fall
 * back to the original file and the existing refusal message.
 * A file that already fits is returned unchanged (wasCompressed false
 * is impossible here by construction: callers only call this on
 * oversize files, but the guard keeps the contract honest).
 */
export async function compressPhotoFile(
  file: { name: string; type: string; size: number } & Blob,
  deps?: Partial<CompressionDeps>,
): Promise<CompressedPhoto | null> {
  try {
    if (!isCompressiblePhoto(file)) return null;
    if (fitsReviewPayload(file.size)) return null;
    const decode = deps?.decode || browserDecode;
    const encode = deps?.encode || browserEncode;
    const image = await decode(file);
    if (!image) return null;
    try {
      const mimeType = outputMimeType(file.type);
      for (const step of compressionSteps()) {
        const { width, height } = targetDimensions(
          image.width,
          image.height,
          step.scale,
        );
        const blob = await encode(image, width, height, step, mimeType);
        if (!blob || !blob.size) continue;
        if (fitsReviewPayload(blob.size)) {
          return {
            blob,
            mimeType,
            name: file.name,
            originalSize: file.size,
            compressedSize: blob.size,
          };
        }
      }
      return null;
    } finally {
      try {
        image.close && image.close();
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null;
  }
}

// Re-exported so callers/tests name the cap from one place.
export { MAX_PHOTO_FILE_BYTES };
