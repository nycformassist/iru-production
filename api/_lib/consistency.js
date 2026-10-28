/**
 * consistency.js — deterministic check that the model's review does not
 * contradict the record it was given (C2).
 *
 * WHY: validateModelOutput() inspects only the model's text. Every prose
 * contradiction so far (residence "Unknown" while the record held US,
 * entry date listed as missing, marital status unknown, an arrest-history
 * ambiguity) was caught only by a human reading a live run.
 *
 * CONTRACT
 *  - Pure and local: input is the server-side minimized record `min` (what
 *    the model already received) plus the parsed model output. No new data
 *    leaves the server, and no second model is involved.
 *  - FLAG, NEVER REWRITE: the output object is not mutated. Callers log the
 *    flags and annotate the payload with field ids only (no model text, no
 *    record values).
 *  - PRECISION OVER RECALL: it only flags a field the record actually holds
 *    a value for, and only when the claim is tightly attached to that field.
 *    A miss is acceptable; a false flag on a clean review is not.
 *
 * WHAT IT COVERS (v1)
 *   rule 'unknown-claim'  a known field is described as unknown / missing /
 *                         unclear, with the unknown-word directly attached to
 *                         the field ("X is unknown", "X (reported as Unknown)",
 *                         "X: unclear", "unknown X").
 *   rule 'listed-missing' a missingInformation item that is essentially just
 *                         the name of a known field ("Country of residence").
 *   rule 'year-mismatch'  an assertive entry statement ("entered ... in 2023")
 *                         whose year differs from the record's entry year.
 *
 * DELIBERATE GENERALIZATIONS (never flagged)
 *   - entry date is year + recency band BY DESIGN: stating the year or band
 *     is correct, and a document-date tension sentence ("a lease dated 2024
 *     predates the entry in 2026") is mandated by the prompt, not an error.
 *   - residence is country-level BY DESIGN.
 *   - a field the record holds as unknown / "Not provided" is never flagged.
 *   - not-applicable evidence (getNotApplicableReasons) and the gated
 *     has_arrests "unknown" are skipped.
 *
 * KNOWN LIMITS (documented, not hidden)
 *   - English only. Other languages return { skipped: 'lang' } so the caller
 *     can log the gap instead of pretending coverage.
 *   - Heuristic phrase matching: a contradiction phrased outside these
 *     patterns is not caught (e.g. a bare "has_arrests: unknown" ambiguity
 *     framing is handled by the prompt rule, not here).
 *   - Evidence yes/no flags use the strict unknown vocabulary only, because
 *     "no passport was provided" is a CORRECT statement for an answer of no.
 */
import { getNotApplicableReasons } from './evidence.js';
import { RESIDENCE_NOT_PROVIDED } from './privacy.js';

const NOT_KNOWN = new Set(['', 'unknown', RESIDENCE_NOT_PROVIDED.toLowerCase(), 'null', 'undefined']);

function isKnown(v) {
  if (v === undefined || v === null) return false;
  return !NOT_KNOWN.has(String(v).trim().toLowerCase());
}

// "Unknown" vocabularies. STRICT never matches a legitimate "no" statement.
const UNK_STRICT = String.raw`unknown|unclear|uncertain|unspecified|undetermined|not (?:stated|reported|indicated|specified|known|clear)`;
const UNK_BROAD = String.raw`${UNK_STRICT}|not provided|missing|undisclosed|not available`;

// The unknown-word must ATTACH to the field, not merely share a clause with
// it. Allowed shapes (all case-insensitive):
//   "<field> [status] is/was/(reported as)/: <unknown-word>"   e.g. "Country of
//       residence (reported as Unknown)", "Marital status: unknown",
//       "Passport status is unclear"
//   "<unknown-word> [the] <field>"                              e.g. "unknown
//       country of residence"
// A loose same-clause window was rejected after it flagged "certificates of
// disposition are unknown because there are no prior arrests" (the unknown
// attached to certificates, not to arrests).
const LINK_WORDS = String.raw`(?:is|are|was|were|has been|have been|remains?|appears?(?: to be)?|reported as|listed as|given as|stated as|recorded as|shown as|marked as|noted as|being|currently)`;
// Only "status" may sit between field and unknown-word: "passport details are
// unclear" is about the document's CONTENT, not whether the applicant has one.
const CONNECT = String.raw`(?:\s+status)?(?:\s*\(\s*|\s*[-\u2013\u2014:]\s*|\s+)(?:${LINK_WORDS}\s+){0,3}(?:the\s+)?`;

// A field word that is the OBJECT of a preposition ("documentation of country
// of residence", "the nationality on the passport", "its entry date") belongs
// to a different statement, so it never anchors a claim about the field.
const NOT_OBJECT_OF = String.raw`(?<!\b(?:on|of|from|in|about|with|for|to|by|at|its)\s+(?:the\s+|a\s+|an\s+|applicant'?s\s+)?)`;

/**
 * @param {boolean} allowBefore also accept "<unknown-word> <field>" ("unknown
 *   country of residence"). Off for evidence answers: "unclear passport
 *   details" must not read as "the applicant's passport status is unclear".
 */
function clauseRegexes(term, unk, allowBefore = true) {
  const rx = [new RegExp(String.raw`${NOT_OBJECT_OF}(?:${term})${CONNECT}(?:${unk})\b`, 'i')];
  if (allowBefore) rx.push(new RegExp(String.raw`\b(?:${unk})\s+(?:the\s+|applicant'?s\s+)?(?:${term})`, 'i'));
  return rx;
}

function exactItemRegex(term) {
  return new RegExp(
    String.raw`^\W*(?:the |applicant'?s )?(?:exact |specific |precise )?(?:${term})(?:\s*\([^)]*\))?\W*$`,
    'i'
  );
}

const ENTRY_TERM = String.raw`(?:entry|arrival) (?:date|year)|date of (?:entry|arrival)|year of (?:entry|arrival)`;

const IDENTITY_FIELDS = [
  { field: 'residenceCountry', term: String.raw`country of residence|residence country`, value: m => m.residenceCountry },
  { field: 'countryOfOrigin', term: String.raw`country of origin|home country`, value: m => m.countryOfOrigin },
  { field: 'countryOfBirth', term: String.raw`country of birth|birth country`, value: m => m.countryOfBirth },
  { field: 'citizenship', term: String.raw`citizenship|nationality`, value: m => m.citizenship },
  { field: 'maritalStatus', term: String.raw`marital status`, value: m => m.maritalStatus },
  { field: 'priorArrests', term: String.raw`prior arrests?|arrest history|history of arrests?|previous arrests?`, value: m => m.priorArrests },
  {
    field: 'entryYear',
    term: ENTRY_TERM,
    // Only when the year parsed cleanly: future/unparseable dates are
    // legitimately flagged by the model as needing correction.
    value: m => (m.entryDateFlag ? null : m.entryYear),
  },
];

const EVIDENCE_TERMS = {
  has_passport: String.raw`passport`,
  has_i94: String.raw`i-?94`,
  has_lease: String.raw`lease|proof of residence`,
  has_persecution_proof: String.raw`proof of persecution|persecution (?:evidence|documents?)`,
  has_green_card: String.raw`green card`,
  has_tax_transcripts: String.raw`tax transcripts?`,
  has_marriage_cert: String.raw`marriage certificate`,
  has_proof_of_relationship: String.raw`proof of relationship|relationship evidence`,
  has_arrests: String.raw`certificates? of disposition|disposition certificates?`,
};

const ENTRY_YEAR_CLAIM = /\b(?:entered|arrived|entry|arrival)\b[^.;\n]{0,40}?\b(?:in|during|year)\b[^.;\n]{0,10}?\b((?:19|20)\d{2})\b/gi;
const DOCUMENT_CONTEXT = /\b(?:predat\w*|before|earlier|prior to|documents?|dated|lease|bill|stamp|passport|i-?94|receipt|letter|record)\b/i;

const MAX_STRINGS = 400;
const MAX_STRING_LEN = 2000;

function collectStrings(node, out, inMissing = false, key = '') {
  if (out.length >= MAX_STRINGS) return;
  if (typeof node === 'string') {
    if (key === 'notLegalAdvice') return; // boilerplate, never record claims
    out.push({ text: node.slice(0, MAX_STRING_LEN), inMissing });
  } else if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out, inMissing, key);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectStrings(v, out, inMissing || k === 'missingInformation', k);
  }
}

function sentences(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

/**
 * @param {object} min   minimized record (server-side, see privacy.js)
 * @param {object} data  parsed model output (validateModelOutput().data)
 * @param {string} [lang] output language; v1 checks English only
 * @returns {{ flags: Array<{field:string, rule:string}>, skipped: string|null }}
 */
export function checkOutputConsistency(min, data, lang = 'EN') {
  if (lang && lang !== 'EN') return { flags: [], skipped: 'lang' };
  if (!min || typeof min !== 'object' || !data || typeof data !== 'object') return { flags: [], skipped: null };

  const strings = [];
  collectStrings(data, strings);

  const seen = new Set();
  const flags = [];
  const flag = (field, rule) => {
    const k = `${field}:${rule}`;
    if (!seen.has(k)) { seen.add(k); flags.push({ field, rule }); }
  };

  // 1) Identity / case fields the record actually holds.
  for (const f of IDENTITY_FIELDS) {
    if (!isKnown(f.value(min))) continue;
    const matchers = clauseRegexes(f.term, UNK_BROAD);
    const exact = exactItemRegex(f.term);
    for (const s of strings) {
      if (matchers.some(rx => rx.test(s.text))) flag(f.field, 'unknown-claim');
      else if (s.inMissing && exact.test(s.text)) flag(f.field, 'listed-missing');
    }
  }

  // 2) Evidence answers that are a definite yes/no (strict vocabulary only).
  const naKeys = new Set(getNotApplicableReasons(min).map(r => r.key));
  const evidence = min.evidence || {};
  for (const [key, term] of Object.entries(EVIDENCE_TERMS)) {
    const v = evidence[key];
    if (v !== 'yes' && v !== 'no') continue;       // unknown / absent: unknown is correct
    if (naKeys.has(key)) continue;                  // not applicable: never flagged
    if (key === 'has_arrests' && min.priorArrests === 'no') continue; // gated unknown-by-design
    const matchers = clauseRegexes(term, UNK_STRICT, false);
    for (const s of strings) {
      if (matchers.some(rx => rx.test(s.text))) { flag(key, 'unknown-claim'); break; }
    }
  }

  // 3) Entry-year contradiction (assertive statements only).
  if (!min.entryDateFlag && isKnown(min.entryYear) && /^\d{4}$/.test(String(min.entryYear))) {
    for (const s of strings) {
      for (const sentence of sentences(s.text)) {
        if (DOCUMENT_CONTEXT.test(sentence)) continue; // document-date tension is mandated, not an error
        ENTRY_YEAR_CLAIM.lastIndex = 0;
        let m;
        while ((m = ENTRY_YEAR_CLAIM.exec(sentence)) !== null) {
          if (m[1] !== String(min.entryYear)) flag('entryYear', 'year-mismatch');
        }
      }
    }
  }

  return { flags, skipped: null };
}
