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

import { sanitizeNarrative } from './narrative.js';

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
    narrative: null,    // lib/narrative.js object when a narrative exists
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
 * Agreement comparison for conflict detection (phantom-conflict fix
 * 2026-10-24): two sources stating the same value with different
 * casing or surrounding whitespace AGREE — a questionnaire radio value
 * "female" and a document extraction "Female" are the same answer, not
 * a conflict. Stored values are never rewritten by this comparison;
 * only the equality test is normalized. Case is not a meaningful
 * distinction for any IRU fact value (names, places, enumerated
 * answers, dates), so folding it cannot merge two genuinely different
 * values.
 */
export function sameFactValue(a, b) {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return String(a) === String(b);
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
  } else if (sameFactValue(fact.value, incoming.value)) {
    // Agreement: record provenance, change nothing about status.
    // Agreement between sources is corroboration, NOT verification.
    // (Normalized: a case/whitespace-only difference is agreement.)
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
    // A case/whitespace variant of the primary or of an existing
    // candidate is agreement with that candidate, not a new one.
    const alreadyKnown = sameFactValue(fact.value, incoming.value)
      || (fact.alternatives || []).some((a) => sameFactValue(a.value, incoming.value));
    if (!alreadyKnown) fact.alternatives.push(incoming);
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

const cloneFact = (fact) => JSON.parse(JSON.stringify(fact));

/**
 * Correction-to-output propagation (defect-closure directive
 * 2026-10-23, Priority 2).
 *
 * THE DEFECT: re-running the analysis rebuilt the canonical record
 * from the original questionnaire answers alone, silently discarding
 * every consumer action taken on the record since — corrections,
 * conflict state, confirmations, and facts entered in the
 * form-preparation panel (which never lived in the questionnaire
 * answers). The rebuilt record then drove gaps, findings, and form
 * preparation, so corrected values reverted and stale findings
 * returned.
 *
 * THE PRECEDENCE RULE (defined here, applied on every rebuild):
 *   1. CORRECTION beats ANSWER. A fact whose current value was set by
 *      a consumer correction (source 'correction') is re-imposed on
 *      the rebuilt record with the corrected value. An older
 *      questionnaire answer can never silently overwrite it.
 *   2. CONFLICTS are preserved, never resolved by the rebuild. When
 *      the rebuilt record still rests on the same primary value, the
 *      prior conflict state (both candidates + provenance) is carried
 *      over verbatim. If the consumer re-answered with a different
 *      value, the rebuilt record's own state stands.
 *   3. CONFIRMATION is preserved. A document-extracted fact the
 *      consumer confirmed (status 'reported', source 'document')
 *      stays confirmed when the rebuild reproduces the same value.
 *   4. PANEL facts are preserved. A consumer-entered fact that the
 *      questionnaire rebuild cannot reproduce (it was entered in the
 *      form-preparation panel, source 'answer'/'narrative', and its id
 *      is not questionnaire-derived) is carried over when the rebuild
 *      has no value for it.
 *   5. NARRATIVE state is preserved when the story text is unchanged:
 *      approvals, event corrections and confirmations carry over. A
 *      changed story text produces a fresh narrative (the consumer
 *      re-answered).
 * Everything else — facts the rebuild derives from the CURRENT
 * answers and document review — stands as rebuilt.
 *
 * @param {object} freshRecord record rebuilt from current answers/review
 * @param {object} priorRecord the live record holding consumer state
 * @param {object} [options] { answerFactIds: string[] } — fact ids the
 *   rebuild derived from questionnaire answers (rule 4 exclusion list)
 * @returns {{record, correctedFactIds, preservedConflictIds,
 *   confirmedFactIds, preservedFactIds, narrativePreserved}}
 */
export function overlayConsumerState(freshRecord, priorRecord, options = {}, nowIso) {
  const report = {
    correctedFactIds: [],
    preservedConflictIds: [],
    confirmedFactIds: [],
    preservedFactIds: [],
    narrativePreserved: false,
  };
  if (!freshRecord || !freshRecord.facts || !priorRecord || !priorRecord.facts) {
    return { record: freshRecord, ...report };
  }
  const now = nowIso || null;
  const answerFactIds = new Set(Array.isArray(options.answerFactIds) ? options.answerFactIds : []);
  let changed = false;

  for (const [id, prior] of Object.entries(priorRecord.facts)) {
    if (!prior || typeof prior !== 'object') continue;
    const fresh = freshRecord.facts[id];

    // Rule 1 — correction wins over the rebuilt answer.
    if (prior.source === 'correction' && prior.value !== null && prior.value !== undefined && prior.value !== '') {
      if (!fresh || String(fresh.value ?? '') !== String(prior.value) || fresh.source !== 'correction') {
        upsertFact(freshRecord, { id, value: prior.value, source: 'correction', type: prior.type }, now);
        report.correctedFactIds.push(id);
        changed = true;
      }
      continue;
    }

    // Rule 2 — preserve an unresolved conflict resting on the same
    // primary value; both candidates and their provenance survive.
    if (prior.status === 'conflicting') {
      const samePrimary = fresh && String(fresh.value ?? '') === String(prior.value ?? '');
      if (!fresh || samePrimary) {
        if (!fresh || fresh.status !== 'conflicting'
          || JSON.stringify(fresh.alternatives || []) !== JSON.stringify(prior.alternatives || [])) {
          freshRecord.facts[id] = cloneFact(prior);
          report.preservedConflictIds.push(id);
          changed = true;
        }
      }
      continue;
    }

    // Rule 3 — a confirmed document fact stays confirmed when the
    // rebuild reproduces the same extracted value.
    if (prior.source === 'document' && prior.status === 'reported') {
      if (fresh && fresh.status === 'extracted-unconfirmed'
        && String(fresh.value ?? '') === String(prior.value ?? '')) {
        confirmFact(freshRecord, id, now);
        report.confirmedFactIds.push(id);
        changed = true;
      }
      continue;
    }

    // Rule 4 — panel-entered facts the rebuild cannot reproduce.
    if ((prior.source === 'answer' || prior.source === 'narrative')
      && !answerFactIds.has(id)
      && prior.value !== null && prior.value !== undefined && prior.value !== ''
      && (!fresh || fresh.value === null || fresh.value === undefined || fresh.value === '')) {
      freshRecord.facts[id] = cloneFact(prior);
      report.preservedFactIds.push(id);
      changed = true;
    }
  }

  // Rule 5 — narrative approvals/corrections survive an unchanged story.
  if (priorRecord.narrative && freshRecord.narrative) {
    const mainText = (n) => {
      const ev = (n.events || []).find((e) => e && e.id === 'story_main') || (n.events || [])[0];
      return ev ? String(ev.text || '') : '';
    };
    if (mainText(priorRecord.narrative) !== '' && mainText(priorRecord.narrative) === mainText(freshRecord.narrative)) {
      freshRecord.narrative = JSON.parse(JSON.stringify(priorRecord.narrative));
      report.narrativePreserved = true;
    }
  }

  if (changed) {
    // The outputs the consumer is looking at were derived from the
    // pre-overlay record; they are stale until regenerated from this
    // one (the caller regenerates and then calls markOutputsFresh).
    freshRecord.outputsStale = true;
    freshRecord.updatedAt = now;
  }
  return { record: freshRecord, ...report };
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
  record.narrative = sanitizeNarrative(raw.narrative);
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
