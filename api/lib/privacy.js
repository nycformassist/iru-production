/**
 * lib/privacy.js — Data-minimization boundary for the IRU analyze endpoint.
 *
 * Principle: the model needs *facts about the case*, not *identity of the
 * applicant*. Direct identifiers are stripped before any model submission;
 * the server allowlists exactly the fields the analysis consumes.
 *
 * Pure functions — fully unit-testable without the AI SDK.
 */

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_NARRATIVE_CHARS = 1000;
export const MAX_TEXT_FIELD_CHARS = 200;
export const MAX_STARTERS = 20;

// Fields the analysis is allowed to receive at all. Everything else
// (a_number, zip_code, unknown/future fields) is dropped at the boundary.
const ALLOWED_FIELDS = new Set([
  'country_of_origin',
  'entry_date',
  'case_type',
  'has_passport',
  'has_i94',
  'has_lease',
  'has_persecution_proof',
  'has_green_card',
  'has_tax_transcripts',
  'has_marriage_cert',
  'has_proof_of_relationship',
  'has_arrests',
  'narrative_text',
]);

const EVIDENCE_FLAGS = [
  'has_passport', 'has_i94', 'has_lease', 'has_persecution_proof',
  'has_green_card', 'has_tax_transcripts', 'has_marriage_cert',
  'has_proof_of_relationship', 'has_arrests',
];

const CASE_TYPES = new Set(['asylum', 'family', 'citizenship']);

/**
 * Keep only allowlisted fields; coerce to strings; enforce length caps.
 * Returns { ok, answers } or { ok: false, errors }.
 */
export function sanitizeAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['answers must be an object'] };
  }
  const errors = [];
  const answers = {};
  for (const key of ALLOWED_FIELDS) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string') {
      errors.push(`field ${key} must be a string`);
      continue;
    }
    const cap = key === 'narrative_text' ? MAX_NARRATIVE_CHARS : MAX_TEXT_FIELD_CHARS;
    if (v.length > cap) {
      errors.push(`field ${key} exceeds ${cap} characters`);
      continue;
    }
    answers[key] = v;
  }
  // Flag dropped sensitive fields so the boundary is auditable (never logs values).
  const dropped = Object.keys(raw).filter(k => !ALLOWED_FIELDS.has(k));
  if (dropped.length > 0) {
    answers.__droppedFields = dropped; // field names only, never values
  }
  return { ok: errors.length === 0, errors, answers };
}

/**
 * Scrub high-confidence identifier patterns from free text before model
 * submission. This is pattern-based, not NER: it catches formatted
 * identifiers (A-numbers, SSNs, phones, emails) that applicants commonly
 * paste into narratives. Names without patterns cannot be reliably scrubbed
 * without destroying meaning — the UI warns against including them.
 */
export function scrubNarrative(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\bA-?\d{8,9}\b/gi, '[A-NUMBER REDACTED]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL REDACTED]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE REDACTED]');
}

/**
 * Build the model-facing payload: no direct identifiers, generalized dates.
 * - full_name is never collected here (client keeps it for the local packet).
 * - entry_date (YYYY-MM-DD) -> entry year + entry recency band.
 * - narrative text is scrubbed for identifier patterns, then passed as
 *   delimited data, never as instructions.
 */
export function minimizeForModel(answers, narrativeStarters) {
  const entryYear = parseEntryYear(answers.entry_date);
  return {
    applicantRef: 'the applicant', // no name, no A-number, no zip
    countryOfOrigin: answers.country_of_origin || 'Unknown',
    entryYear: entryYear.year,               // e.g. "2023" or "Unknown"
    entryRecency: entryYear.recency,         // '<1y' | '1-5y' | '>5y' | 'unknown' | 'future?'
    entryDateFlag: entryYear.flag,           // null | 'future-date'
    caseType: CASE_TYPES.has(answers.case_type) ? answers.case_type : 'asylum',
    evidence: Object.fromEntries(EVIDENCE_FLAGS.map(k => [k, answers[k] || 'unknown'])),
    narrativeStarters: (narrativeStarters || []).filter(s => typeof s === 'string').slice(0, MAX_STARTERS),
    narrativeText: scrubNarrative(answers.narrative_text || ''),
  };
}

function parseEntryYear(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return { year: 'Unknown', recency: 'unknown', flag: null };
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { year: 'Unknown', recency: 'unknown', flag: 'unparseable' };
  const year = Number(m[1]);
  const now = new Date();
  const thisYear = now.getFullYear();
  if (year > thisYear) return { year: String(year), recency: 'unknown', flag: 'future-date' };
  const age = thisYear - year;
  return {
    year: String(year),
    recency: age < 1 ? '<1y' : age <= 5 ? '1-5y' : '>5y',
    flag: null,
  };
}

/** Fields that were dropped at the boundary, for audit logging (names only). */
export function droppedFieldNames(sanitized) {
  return (sanitized && sanitized.__droppedFields) || [];
}
