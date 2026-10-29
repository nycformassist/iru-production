// Claimed-vs-detected document mismatch detection (report gap #1, 2026-10-29).
//
// Compares the evidence item the user SELECTED (photoEvidenceKey, e.g.
// 'has_lease') against the document category the automated review DETECTED
// (documentCategory, e.g. 'utility bill'). Pure functions, no I/O.
//
// Conservative by design: a mismatch is flagged only when the detected
// category is a specific recognized document type that does not match the
// selected key. It is NEVER flagged on an empty, 'unrecognized', or
// otherwise uncertain category. The detected category may be written in
// the user's language (the vision prompt localizes it), so matching is
// best-effort English-keyword based; a non-match simply means no flag,
// which is the safe direction (no false flags, only possibly missed ones).

export interface MismatchResult {
  mismatch: boolean;
}

const UNCERTAIN_CATEGORIES = new Set([
  '',
  'unrecognized',
  'unknown',
  'unclear',
  'uncertain',
  'n/a',
  'none',
]);

// Reverse home-key map — rule (a): the detected category is a known
// document that clearly belongs to a DIFFERENT evidence item than the one
// selected.
const HOME_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /passport/, key: 'has_passport' },
  { re: /i-?94/, key: 'has_i94' },
  { re: /lease|rental|tenancy/, key: 'has_lease' },
  { re: /green card|permanent resident/, key: 'has_green_card' },
  { re: /\btax\b|\birs\b|1040|transcript|w-?2\b/, key: 'has_tax_transcripts' },
  { re: /marriage|divorce/, key: 'has_marriage_cert' },
  { re: /disposition/, key: 'has_arrests' },
];

// Strict keyword check — rule (b): for specific document types, the
// detected category must contain one of the item's own keywords.
const KEY_KEYWORDS: Record<string, string[]> = {
  has_passport: ['passport'],
  has_i94: ['i-94', 'i94', 'arrival', 'departure'],
  has_lease: ['lease', 'rental', 'tenancy'],
  has_green_card: ['green card', 'permanent resident'],
  has_tax_transcripts: ['tax', 'irs', '1040', 'transcript', 'w-2', 'w2'],
  has_marriage_cert: ['marriage', 'divorce'],
  has_arrests: ['disposition'],
};

// Broad keys are exempt from the strict keyword check (rule b): their
// supporting documents legitimately vary (e.g. a hospital record can be
// persecution evidence), so only a clear home-key conflict (rule a)
// flags them.
const BROAD_KEYS = new Set(['has_persecution_proof', 'has_proof_of_relationship']);

/**
 * Returns { mismatch: true } when the detected document category clearly
 * does not match the selected evidence key. Never throws.
 */
export function detectReviewMismatch(
  selectedKey: string | null | undefined,
  documentCategory: string | null | undefined,
): MismatchResult {
  const key = String(selectedKey || '').trim();
  const cat = String(documentCategory || '').trim().toLowerCase();
  if (!key || !cat || UNCERTAIN_CATEGORIES.has(cat)) return { mismatch: false };
  // Rule (a): the detected category is a known document belonging elsewhere.
  for (const { re, key: home } of HOME_PATTERNS) {
    if (re.test(cat) && home !== key) return { mismatch: true };
  }
  // Rule (b): specific document types must contain their own keywords.
  if (!BROAD_KEYS.has(key)) {
    const kws = KEY_KEYWORDS[key];
    if (kws && !kws.some((k) => cat.includes(k))) return { mismatch: true };
  }
  return { mismatch: false };
}
