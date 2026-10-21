// api/review-image.js — Temporary document image review (Vercel Serverless Function)
//
// Optional, privacy-minimizing workflow: the applicant may upload a photo of
// a document for a one-time automated review. The image is processed IN MEMORY
// and NEVER persisted: no filesystem writes, no database, no logging of image
// bytes or extracted personal details. Only the structured result (category,
// legibility, limitations, next action) is returned to the client.
//
// What this endpoint does NOT do:
// - It does NOT establish authenticity or legal sufficiency of any document.
// - It does NOT retain the image after the response is sent (see
//   PRIVACY_REVIEW.md for what is verified vs. what cannot be proven,
//   including provider-side retention).
//
// The Gemini API key lives here only. Never reaches the client bundle.

export const maxDuration = 60;

import { GoogleGenAI } from "@google/genai";
import { createLimiter, clientIp } from "./lib/ratelimit.js";
import { EVIDENCE_KEYS } from "./lib/evidence.js";
import { sanitizeVisionReview } from "./lib/vision.js";

// Re-exported for tests and for /api/analyze (shared validation contract).
export { sanitizeVisionReview };

// Stricter than /api/analyze: image review is more expensive per call.
const limiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB decoded
const MAX_BODY_BYTES = 6 * 1024 * 1024; // base64 overhead + JSON
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
// PDF page limit: controls Gemini token costs (each page is processed as images)
const MAX_PDF_PAGES = 20;

const AUTHENTICITY_DISCLAIMER =
  'This automated review does not establish authenticity or legal sufficiency. ' +
  'A qualified human reviewer must examine the original document.';

/**
 * Test hook: globalThis.__IRU_VISION_CLIENT__ may provide
 * { reviewImage({ imageBase64, mimeType, prompt }) } resolving to text.
 * Production always uses the real Gemini client.
 */
function getVisionClient(apiKey) {
  if (globalThis.__IRU_VISION_CLIENT__) return globalThis.__IRU_VISION_CLIENT__;
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  return {
    async reviewImage({ imageBase64, mimeType, prompt }) {
      const resp = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      });
      return resp.text || '';
    },
  };
}

function buildVisionPrompt(relatedEvidenceKey) {
  const related = relatedEvidenceKey
    ? `The applicant believes this image relates to: ${relatedEvidenceKey}.`
    : 'The applicant did not specify which checklist item this relates to.';
  return `
You are a document-image triage assistant. ${related}
Examine the image ONCE and return a single JSON object with exactly these keys:
{
  "documentCategory": "best-guess category, e.g. 'passport photo page', 'utility bill', 'court notice', or 'unrecognized'",
  "legibility": "legible | partially-legible | illegible",
  "fieldsVisible": ["list field labels you can actually read, e.g. 'name', 'date of birth' — never transcribe values"],
  "appearsComplete": "yes | no | unclear — whether all pages/fields appear present",
  "inconsistencies": ["anything that warrants human attention, or empty array"],
  "relatedReadinessItem": "which evidence checklist item this may help address, or 'none'",
  "limitations": ["what this review cannot determine"],
  "extractedFields": [{"field": "one of: full_name, date_of_birth, country_of_birth, city_of_birth, citizenship, gender, marital_status, passport_number, passport_country, a_number, entry_date, employer_name", "value": "the value exactly as it appears on the document", "page": 1}]
}
HARD RULES:
- NEVER claim the document is authentic, genuine, verified, or legally sufficient. Looking plausible proves nothing.
- "fieldsVisible" lists LABELS only. Separately, "extractedFields" transcribes values ONLY for the allowlisted fields above, ONLY when the value is actually legible on the document. These values are unverified document contents for the applicant's own review — never present them as established facts anywhere else in your output.
- If a value is not legible or not present, omit that field. Do not guess, infer, or complete partial values.
- If you cannot determine something, say so. Do not guess.
`.trim();
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('vision provider timeout')), ms);
  });
  // Clear the timer when the work settles so no dangling handle keeps the
  // process (or the test runner) alive.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !globalThis.__IRU_VISION_CLIENT__) {
    return res.status(500).json({ error: 'Analysis service is not configured.' });
  }

  const rawBody = req.body;
  const bodySize = typeof rawBody === 'string' ? Buffer.byteLength(rawBody) : JSON.stringify(rawBody || {}).length;
  if (bodySize > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large.' });
  }

  const body = typeof rawBody === 'string' ? safeParse(rawBody) : (rawBody || {});
  if (!body) return res.status(400).json({ error: 'Invalid submission.' });

  const { imageBase64, mimeType, relatedEvidenceKey } = body;
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return res.status(400).json({ error: 'Invalid submission.', details: ['imageBase64 is required'] });
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: 'Invalid submission.', details: ['unsupported file type'] });
  }

  // Validate file signatures (magic bytes) — do not trust MIME type alone
  const isPdf = mimeType === 'application/pdf';
  if (relatedEvidenceKey !== undefined && relatedEvidenceKey !== null && !EVIDENCE_KEYS.includes(relatedEvidenceKey)) {
    return res.status(400).json({ error: 'Invalid submission.', details: ['unknown relatedEvidenceKey'] });
  }

  // Decode in memory only to check size. The buffer is never written anywhere.
  let imageBytes;
  try {
    imageBytes = Buffer.from(imageBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid submission.', details: ['malformed image data'] });
  }
  if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: isPdf ? 'PDF too large. Maximum 4 MB.' : 'Image too large. Maximum 4 MB.' });
  }

  // PDF-specific validation: check magic bytes and page count
  if (isPdf) {
    // Validate PDF signature: must start with %PDF-
    const header = imageBytes.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      return res.status(400).json({ error: 'Invalid submission.', details: ['file is not a valid PDF'] });
    }
    // Count pages by scanning for /Type /Page (not /Pages)
    // This is a heuristic; exact count requires a PDF parser
    const pdfText = imageBytes.toString('latin1');
    const pageMatches = pdfText.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageMatches ? pageMatches.length : 0;
    if (pageCount === 0) {
      return res.status(400).json({ error: 'Invalid submission.', details: ['PDF appears to have no pages or is corrupted'] });
    }
    if (pageCount > MAX_PDF_PAGES) {
      return res.status(413).json({ error: `PDF has ${pageCount} pages. Maximum ${MAX_PDF_PAGES} pages.` });
    }
    // Check for encryption
    if (pdfText.includes('/Encrypt')) {
      return res.status(400).json({ error: 'Invalid submission.', details: ['encrypted PDFs are not supported'] });
    }
  }
  // Drop the decoded buffer reference as early as possible; only the
  // original base64 string is forwarded to the provider in this request.
  imageBytes = null;

  try {
    const client = getVisionClient(apiKey);
    const text = await withTimeout(
      client.reviewImage({ imageBase64, mimeType, prompt: buildVisionPrompt(relatedEvidenceKey) }),
      50000
    );
    const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.log('[iru] image review: vision output was not valid JSON');
      return res.status(502).json({ error: 'Review unavailable. Please try again later.' });
    }
    const sanitized = sanitizeVisionReview(parsed);
    if (!sanitized.ok) {
      console.log(`[iru] image review: schema validation failed (${sanitized.error})`);
      return res.status(502).json({ error: 'Review unavailable. Please try again later.' });
    }
    // Audit log: status + category only. Never image bytes, never extracted PII.
    console.log(`[iru] image review complete: category=${sanitized.data.documentCategory.slice(0, 60)}`);
    return res.status(200).json({ ok: true, review: sanitized.data });
  } catch (err) {
    console.error('[iru] image review provider error:', err && err.message ? err.message : err);
    return res.status(502).json({ error: 'Review unavailable. Please try again later.' });
  }
  // NOTE: no finally-block retention — the image existed only in request
  // memory. See PRIVACY_REVIEW.md for provider-side retention limits.
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
