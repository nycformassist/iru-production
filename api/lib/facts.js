/**
 * lib/facts.js — Canonical fact record for IRU (directive §4).
 *
 * ONE structured representation of the consumer's facts, shared by the
 * questionnaire, document extraction, readiness analysis, and the form
 * engine. No parallel fact stores.
 *
 * Design rules (hard):
 * - A document-extracted value is evidence of what a document contains;
 *   it is NEVER automatically proof the fact is authentic or established.
 * - Status 'verified' is RESERVED: it may only be set by an actual
 *   verification process. No function in this module sets it implicitly,
 *   and upsertFact() refuses a 'verified' claim from answer/document
 *   sources.
 * - Conflicts are preserved, never silently overwritten: both values stay
 *   traceable via `history`.
 * - A correction updates the record and marks derived outputs stale
 *   (`outputsStale: true`) so reports/forms are regenerated, never left
 *   contradictory.
 *
 * Pure functions, no I/O — fully unit-testable. Client (src/App.tsx)
 * imports this same module so browser and server share one model.
 */

export const FACT_SOURCES = ['answer', 'narrative', 'document', 'correction'];

export const FACT_STATUSES = [
  'reported',              // consumer stated it (answer / narrative / correction)
  'extracted-unconfirmed', // machine-extracted from a document, consumer has not confirmed
  'conflicting',           // two sources disagree; resolution required
  'unknown',               // known to be needed, no value yet
  'verified',              // RESERVED — set only by a real verification process
];

export const FACT_RECORD_VERSION = 1;

/**
 * Stable fact identifiers used across IRU. Form registries map official
 * form fields to these ids. Location facts are country-aware (directive
 * §3.2): residence, birth, citizenship and mailing are DISTINCT facts —
 * never one ambiguous "location" field.
 */
export const FACT_IDS = [
  // Identity
  'full_name', 'family_name', 'given_name', 'middle_name',
  'other_names_used', 'other_family_name', 'other_given_name',
  'date_of_birth', 'gender',
  'country_of_birth', 'city_of_birth', 'citizenship', 'nationality',
  'a_number', 'ssn', 'usci_number',
  'marital_status', 'spouse_name', 'spouse_date_of_birth',
  // Residence (country-aware)
  'residence_country', 'residence_region', 'residence_city',
  'residence_postal_code', 'residence_street',
  // Mailing (when different from residence)
  'mailing_country', 'mailing_region', 'mailing_city',
  'mailing_postal_code', 'mailing_street', 'mailing_same_as_residence',
  // Contact
  'phone', 'email',
  // Immigration history / case
  'country_of_origin', 'entry_date', 'entry_manner', 'entry_place', 'current_status',
  'application_reason',
  'case_type', 'has_passport', 'passport_country', 'passport_number',
  'has_i94', 'has_lease', 'has_persecution_proof', 'has_green_card',
  'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship',
  'has_arrests', 'narrative_text',
  // Employment authorization (I-765)
  'eligibility_category', 'employer_name',
];

/**
 * Create an empty canonical fact record.
 * @param {string} [nowIso] injectable clock for tests.
 */
export function createFactRecord(nowIso) {
  return {
    version: FACT_RECORD_VERSION,
    facts: {},          // factId -> Fact
    outputsStale: false,
    createdAt: nowIso || null,
    updatedAt: nowIso || null,
  };
}

/**
 * A Fact:
 * {
 *   id, value, type: 'string'|'date'|'boolean'|'text',
 *   source, sourceRef: { documentId?, page? } | null,
 *   confidence: number|null,           // machine extraction only
 *   status,                            // FACT_STATUSES
 *   updatedAt,
 *   needsConfirmation: boolean,
 *   requiredByForms: string[],         // form ids that require this fact
 *   formFields: { [formId]: string[] },// official PDF field names per form
 *   history: [{ value, source, status, updatedAt, sourceRef, confidence }],
 *   alternatives: [{ value, source, sourceRef, confidence }] // conflicting candidates
 * }
 */

function blankFact(id, nowIso) {
  return {
    id,
    value: null,
    type: 'string',
    source: null,
    sourceRef: null,
    confidence: null,
    status: 'unknown',
    updatedAt: nowIso || null,
    needsConfirmation: false,
    requiredByForms: [],
    formFields: {},
    history: [],
    alternatives: [],
  };
}

function assertSource(source) {
  if (!FACT_SOURCES.includes(source)) {
    throw new Error(`facts: unknown source "${source}"`);
  }
}

/**
 * Insert or update a fact. Conflict semantics:
 * - New value from a DIFFERENT source that disagrees with the current
 *   value → status 'conflicting'; the existing value stays primary and
 *   the new candidate is kept in `alternatives` for consumer resolution.
 * - A 'correction' source always wins and clears conflicts (the consumer
 *   is the authority on their own facts), recording history.
 * - Same value re-stated → source history appended, status unchanged
 *   (a document agreeing with an answer does NOT verify it).
 * - 'verified' can never be claimed by answer/document/correction input.
 */
export function upsertFact(record, input, nowIso) {
  if (!record || typeof record !== 'object' || !record.facts) {
    throw new Error('facts: invalid record');
  }
  const { id, value } = input || {};
  if (!id || typeof id !== 'string') throw new Error('facts: fact id required');
  assertSource(input.source);
  if (input.status === 'verified') {
    throw new Error('facts: "verified" status is reserved and cannot be set from consumer or document input');
  }
  const now = nowIso || null;
  const fact = record.facts[id] || blankFact(id, now);
  const incoming = {
    value: value === undefined ? null : value,
    source: input.source,
    sourceRef: input.sourceRef || null,
    confidence: typeof input.confidence === 'number' ? input.confidence : null,
  };

  if (fact.value === null || fact.value === undefined || fact.value === '') {
    // First value for this fact.
    fact.value = incoming.value;
    fact.source = incoming.source;
    fact.sourceRef = incoming.sourceRef;
    fact.confidence = incoming.confidence;
    fact.type = input.type || fact.type || 'string';
    fact.status = incoming.source === 'document' ? 'extracted-unconfirmed' : 'reported';
    fact.needsConfirmation = incoming.source === 'document';
  } else if (String(fact.value) === String(incoming.value)) {
    // Agreement: record provenance, change nothing about status.
    // Agreement between sources is corroboration, NOT verification.
  } else if (incoming.source === 'correction') {
    // Consumer correction wins; conflict resolved by the consumer.
    fact.history.push(snapshotOf(fact));
    fact.value = incoming.value;
    fact.source = 'correction';
    fact.sourceRef = incoming.sourceRef;
    fact.confidence = null;
    fact.status = 'reported';
    fact.needsConfirmation = false;
    fact.alternatives = [];
    record.outputsStale = true;
  } else if (fact.status === 'conflicting') {
    // Already conflicted: keep candidates traceable, primary unchanged.
    fact.alternatives.push(incoming);
  } else {
    // Genuine conflict between sources.
    fact.history.push(snapshotOf(fact));
    fact.alternatives = [incoming];
    fact.status = 'conflicting';
    fact.needsConfirmation = true;
  }

  if (input.type) fact.type = input.type;
  fact.updatedAt = now;
  record.facts[id] = fact;
  record.updatedAt = now;
  return fact;
}

function snapshotOf(fact) {
  return {
    value: fact.value,
    source: fact.source,
    status: fact.status,
    updatedAt: fact.updatedAt,
    sourceRef: fact.sourceRef,
    confidence: fact.confidence,
  };
}

/**
 * Consumer confirms an extracted-unconfirmed fact: the value becomes
 * consumer-reported. Confirmation is NOT independent verification.
 */
export function confirmFact(record, id, nowIso) {
  const fact = record.facts[id];
  if (!fact) throw new Error(`facts: unknown fact "${id}"`);
  if (fact.status === 'extracted-unconfirmed') {
    fact.status = 'reported';
    fact.needsConfirmation = false;
    fact.updatedAt = nowIso || null;
    record.updatedAt = nowIso || null;
  }
  return fact;
}

/**
 * Consumer resolves a conflict by choosing one of the candidate values
 * (identified by its source). Resolution is a consumer correction.
 */
export function resolveConflict(record, id, chosenSource, nowIso) {
  const fact = record.facts[id];
  if (!fact) throw new Error(`facts: unknown fact "${id}"`);
  if (fact.status !== 'conflicting') return fact;
  if (chosenSource === fact.source) {
    // Consumer keeps the primary value.
    fact.alternatives = [];
    fact.status = fact.source === 'document' ? 'extracted-unconfirmed' : 'reported';
    fact.needsConfirmation = fact.source === 'document';
  } else {
    const chosen = fact.alternatives.find((a) => a.source === chosenSource);
    if (!chosen) throw new Error(`facts: no conflicting candidate from source "${chosenSource}"`);
    fact.history.push(snapshotOf(fact));
    fact.value = chosen.value;
    fact.source = 'correction';
    fact.sourceRef = chosen.sourceRef;
    fact.confidence = null;
    fact.status = 'reported';
    fact.needsConfirmation = false;
    fact.alternatives = [];
  }
  fact.updatedAt = nowIso || null;
  record.outputsStale = true;
  record.updatedAt = nowIso || null;
  return fact;
}

/** Mark all derived outputs fresh again after regeneration. */
export function markOutputsFresh(record, nowIso) {
  record.outputsStale = false;
  record.updatedAt = nowIso || null;
  return record;
}

/** Facts that block form completion: conflicting or unconfirmed-required. */
export function getBlockingIssues(record) {
  const issues = [];
  for (const fact of Object.values(record.facts)) {
    if (fact.status === 'conflicting') {
      issues.push({ factId: fact.id, kind: 'conflict', values: [fact.value, ...fact.alternatives.map((a) => a.value)] });
    } else if (fact.status === 'extracted-unconfirmed' && fact.requiredByForms.length > 0) {
      issues.push({ factId: fact.id, kind: 'unconfirmed-required', values: [fact.value] });
    }
  }
  return issues;
}

/**
 * Project the record for one form: for each of the form's mapped fields,
 * report the value and provenance so the UI/PDF filler never guesses.
 * registryEntry: { id, fields: [{ pdfField, factId, required }] }.
 */
export function projectForForm(record, registryEntry) {
  const populated = [];
  const unconfirmed = [];
  const missing = [];
  const conflicts = [];
  for (const field of registryEntry.fields || []) {
    const fact = record.facts[field.factId];
    if (!fact || fact.value === null || fact.value === undefined || fact.value === '') {
      if (field.required) missing.push({ ...field, reason: 'no-value' });
      continue;
    }
    if (fact.status === 'conflicting') {
      conflicts.push({ ...field, values: [fact.value, ...fact.alternatives.map((a) => a.value)] });
    } else if (fact.status === 'extracted-unconfirmed') {
      unconfirmed.push({ ...field, value: fact.value, source: fact.source, sourceRef: fact.sourceRef });
    } else {
      populated.push({ ...field, value: fact.value, source: fact.source, status: fact.status });
    }
  }
  return { formId: registryEntry.id, populated, unconfirmed, missing, conflicts };
}

/** Validate an untrusted (client-supplied) record before server use. */
export function sanitizeFactRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = createFactRecord(raw.createdAt || null);
  const facts = raw.facts && typeof raw.facts === 'object' ? raw.facts : {};
  for (const [id, f] of Object.entries(facts)) {
    if (!f || typeof f !== 'object') continue;
    if (f.status === 'verified') continue; // never accept a client-claimed verification
    if (!FACT_STATUSES.includes(f.status)) continue;
    if (f.source !== null && !FACT_SOURCES.includes(f.source)) continue;
    record.facts[id] = {
      ...blankFact(id, f.updatedAt || null),
      value: typeof f.value === 'string' ? f.value.slice(0, 2000) : (f.value ?? null),
      type: typeof f.type === 'string' ? f.type : 'string',
      source: f.source,
      sourceRef: sanitizeSourceRef(f.sourceRef),
      confidence: typeof f.confidence === 'number' ? f.confidence : null,
      status: f.status,
      needsConfirmation: !!f.needsConfirmation,
      requiredByForms: Array.isArray(f.requiredByForms) ? f.requiredByForms.filter((x) => typeof x === 'string').slice(0, 10) : [],
      formFields: {},
      history: [],
      alternatives: Array.isArray(f.alternatives)
        ? f.alternatives.slice(0, 5).map((a) => ({
            value: typeof a?.value === 'string' ? a.value.slice(0, 2000) : (a?.value ?? null),
            source: FACT_SOURCES.includes(a?.source) ? a.source : 'answer',
            sourceRef: sanitizeSourceRef(a?.sourceRef),
            confidence: typeof a?.confidence === 'number' ? a.confidence : null,
          }))
        : [],
    };
  }
  record.outputsStale = !!raw.outputsStale;
  record.updatedAt = raw.updatedAt || null;
  return record;
}

function sanitizeSourceRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const out = {};
  if (typeof ref.documentId === 'string') out.documentId = ref.documentId.slice(0, 64);
  if (typeof ref.page === 'number') out.page = ref.page;
  if (typeof ref.documentType === 'string') out.documentType = ref.documentType.slice(0, 64);
  return Object.keys(out).length ? out : null;
}
