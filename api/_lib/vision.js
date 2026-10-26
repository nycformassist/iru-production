/**
 * lib/vision.js — Shared validation for image-review findings.
 *
 * The /api/review-image endpoint produces structured findings; /api/analyze
 * may consume them as *unverified observations*. Both endpoints share the
 * sanitizer below so a client-supplied review can never smuggle extra fields,
 * oversized strings, or authenticity/verification claims into the analysis.
 *
 * SECURITY CONTRACT (never weaken):
 * - Image-review findings are observations, never facts. They may refine
 *   guidance; they may never set EVIDENCE_STATES.INDEPENDENTLY_VERIFIED,
 *   establish authenticity, legal sufficiency, eligibility, or credibility.
 * - Unknown fields are dropped, never passed through.
 * - Strings are length-capped; arrays are length-capped.
 * - relatedReadinessItem must be a known evidence key or 'none'.
 *
 * Pure functions only (no I/O, no secrets). Fully unit-testable.
 */

import { EVIDENCE_KEYS } from './evidence.js';

export const VISION_SCHEMA_KEYS = Object.freeze([
  'documentCategory',
  'legibility',
  'fieldsVisible',
  'appearsComplete',
  'inconsistencies',
  'relatedReadinessItem',
  'limitations',
]);

export const MAX_IMAGE_REVIEWS_PER_REQUEST = 3;

/**
 * Fact fields a document review may extract VALUES for (directive §5).
 * Deliberate, closed list: only fields the form/readiness workflow needs.
 * Extracted values become canonical facts with status
 * 'extracted-unconfirmed' on the consumer's own device; the server never
 * logs them, and /api/analyze excludes identifier-class values from the
 * model payload (see analyze.js IDENTIFIER_FACTS).
 */
export const EXTRACTABLE_FACT_FIELDS = Object.freeze([
  'full_name', 'date_of_birth', 'country_of_birth', 'city_of_birth',
  'citizenship', 'gender', 'marital_status', 'passport_number',
  'passport_country', 'a_number', 'entry_date', 'employer_name',
]);

/** Validate an extractedFields array from a vision review. Never throws. */
export function sanitizeExtractedFields(raw) {
  if (raw === undefined || raw === null) return { ok: true, fields: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'extractedFields must be an array' };
  const fields = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    if (!EXTRACTABLE_FACT_FIELDS.includes(item.field)) continue; // unknown field: dropped
    if (typeof item.value !== 'string' || item.value.trim() === '') continue;
    const out = { field: item.field, value: item.value.trim().slice(0, 120) };
    if (typeof item.page === 'number' && item.page >= 1 && item.page <= 99) out.page = Math.floor(item.page);
    fields.push(out);
  }
  return { ok: true, fields };
}

const AUTHENTICITY_DISCLAIMER =
  'This automated review does not establish authenticity or legal sufficiency. ' +
  'A qualified human reviewer must examine the original document.';

/**
 * The same disclaimer in every supported language (language-continuity
 * directive 2026-10-22). The sanitizer appends the disclaimer in the
 * applicant's language and recognizes it in ANY supported language —
 * a review produced for a Spanish speaker carries the Spanish text,
 * and re-sanitizing it (e.g. via /api/analyze) must not stack an
 * English copy on top.
 */
export const VISION_DISCLAIMERS = {
  EN: AUTHENTICITY_DISCLAIMER,
  ES: 'Esta revisión automatizada no establece autenticidad ni suficiencia legal. Un revisor humano calificado debe examinar el documento original.',
  ZH: '此自动审核不确立真实性或法律充分性。合格的人工审核员必须检查原始文件。',
  HT: 'Revizyon otomatik sa a pa etabli otantisite oswa sifizans legal. Yon revizè imen kalifye dwe egzamine dokiman orijinal la.',
  AR: 'لا تثبت هذه المراجعة الآلية الأصالة أو الكفاية القانونية. يجب على مراجع بشري مؤهل فحص المستند الأصلي.',
};

const DISCLAIMER_MARKERS = [
  /authenticity|legal sufficiency/i,
  /autenticidad|suficiencia legal/i,
  /真实性|法律充分性/,
  /otantisite|sifizans legal/i,
  /الأصالة|الكفاية القانونية/,
];

export function visionDisclaimer(lang) {
  return VISION_DISCLAIMERS[lang] || AUTHENTICITY_DISCLAIMER;
}

/**
 * Strip authenticity/sufficiency/verification claims; enforce the disclaimer.
 * Returns { ok, data } or { ok: false, error }. Never throws.
 */
export function sanitizeVisionReview(obj, lang = 'EN') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'vision output was not an object' };
  }
  for (const key of VISION_SCHEMA_KEYS) {
    if (!(key in obj)) return { ok: false, error: `missing key: ${key}` };
  }
  if (typeof obj.documentCategory !== 'string' ||
      typeof obj.legibility !== 'string' ||
      typeof obj.appearsComplete !== 'string' ||
      typeof obj.relatedReadinessItem !== 'string') {
    return { ok: false, error: 'string fields must be strings' };
  }
  if (!Array.isArray(obj.fieldsVisible) || !Array.isArray(obj.inconsistencies) || !Array.isArray(obj.limitations)) {
    return { ok: false, error: 'list fields must be arrays' };
  }
  // A review that claims independent verification is forged or confused:
  // the vision flow can never produce that. Reject, do not sanitize.
  const claimsVerification = /independently[- ]verified/i.test(
    `${obj.documentCategory} ${obj.legibility} ${obj.appearsComplete} ${obj.relatedReadinessItem}`
  );
  if (claimsVerification) {
    return { ok: false, error: 'review must not claim independent verification' };
  }
  const strip = (s) => String(s).replace(/\b(authentic|genuine|verified|legally sufficient|legally-sufficient)\b/gi, '[unverifiable claim removed]');
  const related = String(obj.relatedReadinessItem).trim();
  const data = {
    documentCategory: strip(obj.documentCategory).slice(0, 200),
    legibility: strip(obj.legibility).slice(0, 50),
    fieldsVisible: obj.fieldsVisible.filter(f => typeof f === 'string').map(f => strip(f).slice(0, 100)).slice(0, 30),
    appearsComplete: strip(obj.appearsComplete).slice(0, 50),
    inconsistencies: obj.inconsistencies.filter(f => typeof f === 'string').map(f => strip(f).slice(0, 300)).slice(0, 20),
    // Only known evidence keys (or 'none') survive; anything else is untrusted.
    relatedReadinessItem: (EVIDENCE_KEYS.includes(related) || related === 'none') ? related : 'none',
    limitations: obj.limitations.filter(f => typeof f === 'string').map(f => strip(f).slice(0, 300)).slice(0, 20),
  };
  if (!data.limitations.some(l => DISCLAIMER_MARKERS.some(m => m.test(l)))) {
    data.limitations.push(visionDisclaimer(lang));
  }
  // Optional structured extraction (directive §5). Absent = labels-only
  // review (the long-standing default); present = strictly allowlisted.
  if ('extractedFields' in obj) {
    const ex = sanitizeExtractedFields(obj.extractedFields);
    if (!ex.ok) return { ok: false, error: ex.error };
    data.extractedFields = ex.fields;
  }
  return { ok: true, data };
}

/**
 * Validate the optional `imageReviews` array from an /api/analyze request.
 * Returns { ok: true, reviews: [...] } with fully sanitized reviews, or
 * { ok: false, error } when the input is structurally invalid.
 *
 * - undefined/null → { ok: true, reviews: [] } (questionnaire-only flow)
 * - non-array, over-limit, or any invalid entry → rejected
 */
export function validateImageReviews(raw, lang = 'EN') {
  if (raw === undefined || raw === null) return { ok: true, reviews: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'imageReviews must be an array' };
  if (raw.length > MAX_IMAGE_REVIEWS_PER_REQUEST) {
    return { ok: false, error: `imageReviews exceeds limit of ${MAX_IMAGE_REVIEWS_PER_REQUEST}` };
  }
  const reviews = [];
  for (let i = 0; i < raw.length; i++) {
    const s = sanitizeVisionReview(raw[i], lang);
    if (!s.ok) return { ok: false, error: `imageReviews[${i}]: ${s.error}` };
    reviews.push(s.data);
  }
  return { ok: true, reviews };
}

/**
 * Return the subset of validated reviews relevant to one evidence gap key.
 * Relevance = the review's relatedReadinessItem matches the gap key.
 */
export function matchReviewsToGap(key, imageReviews) {
  if (!Array.isArray(imageReviews)) return [];
  return imageReviews.filter(r => r && r.relatedReadinessItem === key);
}
