/**
 * lib/formmap.js — Map canonical facts to official-form fields (§7.3).
 *
 * Principles:
 * - Map existing facts FIRST; ask only for what is missing.
 * - Only consumer-reported facts (stated, confirmed, or corrected by the
 *   consumer) are written into a form. Document-extracted values that the
 *   consumer has NOT confirmed are never silently written — they are
 *   listed as needing confirmation.
 * - Conflicting facts are never written; both candidates are surfaced.
 * - Missing values stay blank. IRU never invents a form answer.
 * - Signature fields are never filled (registry denylist + pattern guard).
 */

import { isNarrativeApproved } from './narrative.js';
import { buildFormNextSteps } from './nextsteps.js';

/**
 * Pre-download review instructions (B2C directive §5.A). Shown with
 * every generated draft. A generated form is a DRAFT to be checked by
 * the applicant — never presented as automatically correct, legally
 * sufficient, or guaranteed to be accepted.
 */
export const FORM_REVIEW_INSTRUCTIONS = [
  'This is a DRAFT. It has not been signed, submitted, or filed, and it must be checked by you before any use.',
  'Verify your name, dates, addresses, identifying information, and every other populated field against your own records and supporting documents.',
  'Review anything listed as unanswered, inconsistent, uncertain, or needing confirmation in the completion summary.',
  'Confirm that every applicable question has been answered accurately — questions left blank were left blank because the information was not provided, not because they do not apply.',
  'Correct mistakes in your information and regenerate the draft before signing, submitting, or otherwise using the form.',
  'A form prepared with software assistance is not automatically correct or legally sufficient, and no outcome is guaranteed.',
];

/** Explicit final-review checklist (B2C directive §5.D) — a review aid, not a legal certification. */
export const FINAL_REVIEW_CHECKLIST = [
  'I checked every populated field on the draft against my own records and documents.',
  'I reviewed the supporting material and the items listed as missing, inconsistent, or unconfirmed.',
  'I addressed the known inconsistencies, or I understand they remain unresolved.',
  'I understand this draft is not signed, filed, or submitted, and that signing and filing are my responsibility.',
];

export const TRANSFORMS = {
  /** A-Number: official fields hold digits only (max 9). Strip a leading "A". */
  aNumber(value) {
    return String(value || '').trim().replace(/^[Aa][- ]?/, '').replace(/[^0-9]/g, '').slice(0, 9);
  },
  /** 'YYYY-MM-DD' → 'MM/DD/YYYY'; passes through values already in MDY form. */
  dateMDY(value) {
    const v = String(value || '').trim();
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
    return v;
  },
  /** US phone → 3-digit area code. */
  phoneAreaCode(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    return local.length >= 3 ? local.slice(0, 3) : '';
  },
  /** US phone → XXX-XXXX remainder. */
  phoneNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (local.length === 10) return `${local.slice(3, 6)}-${local.slice(6)}`;
    return local.slice(3);
  },
  /** I-589 Item 13 is one field: "City and Country of Birth". */
  cityCountryOfBirth(value, record) {
    const country = String(record?.facts?.country_of_birth?.value || '').trim();
    const city = String(value || '').trim();
    if (city && country) {
      // The city value often already carries the country — applicants
      // answer the combined question ("Port-au-Prince, Haiti") and
      // document extraction produces the same shape. Never print the
      // country twice ("Port-au-Prince, Haiti, Haiti"). The applicant's
      // own casing is preserved. (The I-765 needs no such guard: it maps
      // city and country to separate fields, 18.a and 18.c.)
      const cityTail = city.replace(/[\s.,;]+$/, '').toLowerCase();
      if (cityTail.endsWith(country.toLowerCase())) return city;
      return `${city}, ${country}`;
    }
    return city || country;
  },
};

export function applyTransform(field, value, record) {
  if (!field.transform) return String(value);
  const fn = TRANSFORMS[field.transform];
  return fn ? fn(value, record) : String(value);
}

/**
 * Best-effort split of a free-text full name into form name parts.
 * The result is a PROPOSAL the consumer reviews — never silently trusted:
 * callers mark derived parts so the UI can ask for correction.
 */
export function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { family_name: parts[0] };
  if (parts.length === 2) return { given_name: parts[0], family_name: parts[1] };
  return {
    given_name: parts[0],
    middle_name: parts.slice(1, -1).join(' '),
    family_name: parts[parts.length - 1],
  };
}

const norm = (v) => String(v || '').trim().toLowerCase();

/**
 * Build the fill plan for one form from the canonical record.
 * Returns everything the generator and the completion summary need.
 */
export function buildFillPlan(record, entry) {
  const fill = [];
  const needsConfirmation = [];
  const missing = [];
  const conflicts = [];
  const notFilled = [];
  const seenMissingFacts = new Set();
  const seenConfirmFacts = new Set();

  for (const field of entry.fields) {
    const fact = record?.facts?.[field.factId];
    const hasValue = fact && fact.value !== null && fact.value !== undefined && String(fact.value).trim() !== '';

    if (!hasValue) {
      if (field.required && !seenMissingFacts.has(field.factId)) {
        seenMissingFacts.add(field.factId);
        missing.push({
          factId: field.factId,
          label: field.label,
          question: field.question || `Please provide: ${field.label}`,
        });
      } else if (!field.required) {
        notFilled.push({ pdfField: field.pdfField, label: field.label, reason: 'no-value-optional' });
      }
      continue;
    }

    if (fact.status === 'conflicting') {
      conflicts.push({
        factId: field.factId,
        label: field.label,
        values: [fact.value, ...(fact.alternatives || []).map((a) => a.value)],
      });
      continue;
    }

    if (fact.status === 'extracted-unconfirmed') {
      if (!seenConfirmFacts.has(field.factId)) {
        seenConfirmFacts.add(field.factId);
        needsConfirmation.push({
          factId: field.factId,
          label: field.label,
          value: fact.value,
          sourceRef: fact.sourceRef || null,
        });
      }
      continue;
    }

    // Narrative gate (successive directive §4): a fact whose source is
    // the applicant's narrative may be used in form preparation ONLY
    // after the applicant has reviewed and approved the narrative.
    // Until then it is surfaced as needing that approval — never
    // silently written, never re-asked as if unknown.
    if (fact.source === 'narrative' && record?.narrative && !isNarrativeApproved(record.narrative)) {
      if (!seenConfirmFacts.has(field.factId)) {
        seenConfirmFacts.add(field.factId);
        needsConfirmation.push({
          factId: field.factId,
          label: field.label,
          value: fact.value,
          sourceRef: null,
          reason: 'narrative-not-approved',
        });
      }
      continue;
    }

    // Consumer-reported value (answer / narrative / correction / confirmed).
    if (field.kind === 'checkbox') {
      if (norm(fact.value) === norm(field.matchValue)) {
        fill.push({ pdfField: field.pdfField, kind: 'checkbox', label: field.label, factId: field.factId });
      }
      // A different option of the same group: this box correctly stays
      // unchecked — not an error, not missing.
      continue;
    }

    const value = applyTransform(field, fact.value, record);
    if (value === '') {
      notFilled.push({ pdfField: field.pdfField, label: field.label, reason: 'transform-produced-empty' });
      continue;
    }
    fill.push({ pdfField: field.pdfField, kind: 'text', value, label: field.label, factId: field.factId });
  }

  return { formId: entry.id, fill, needsConfirmation, missing, conflicts, notFilled };
}

/** The consumer-facing completion summary (§7.5) for a fill plan. */
export function buildCompletionSummary(entry, plan, record) {
  return {
    formId: entry.id,
    formName: entry.name,
    editionDate: entry.editionDate,
    registryCheckedDate: entry.checkedDate,
    draftLabel: 'DRAFT — for consumer review only. Not signed, not submitted, not legal advice.',
    // The two documents in a form package, labeled exactly (B2C §5.B).
    draftDocumentLabel: 'IRU Pre-filled Draft — Review and Correct',
    blankForm: {
      label: 'Official Blank Form — Reference Copy',
      formId: entry.id,
      editionDate: entry.editionDate,
      // The blank served alongside the draft is the same verified
      // official template the draft was generated from — unfilled.
      downloadPath: `/api/blank-form?form=${encodeURIComponent(entry.id)}`,
      sourceUrl: entry.sourceUrl,
      instructionsUrl: entry.instructionsUrl,
      note: 'The blank official form is a reference for checking the draft\u2019s answers and noting corrections. Downloading it does not grant preparation of any form.',
    },
    reviewInstructions: [...FORM_REVIEW_INSTRUCTIONS],
    finalReviewChecklist: [...FINAL_REVIEW_CHECKLIST],
    nextSteps: buildFormNextSteps(entry, plan),
    staleVersionNote: 'If you correct any information after downloading this draft, the download is stale. Regenerate the draft and use only the latest version.',
    populated: plan.fill.map((f) => ({ label: f.label, pdfField: f.pdfField, value: f.kind === 'text' ? f.value : '✓ checked' })),
    fillErrors: (plan.fillErrors || []).map((e) => ({ label: e.label, reason: e.reason })),
    needsConfirmation: plan.needsConfirmation,
    missingRequired: plan.missing,
    conflicts: plan.conflicts,
    optionalLeftBlank: plan.notFilled.filter((n) => n.reason === 'no-value-optional').map((n) => n.label),
    consumerCompletedSections: entry.consumerCompletedSections || [],
    documentsUsedAsSources: collectDocumentSources(record),
    signatureStatus: 'No signature was added. No form was submitted. Signing and filing are the consumer\u2019s responsibility, after review.',
  };
}

function collectDocumentSources(record) {
  const seen = new Map();
  for (const fact of Object.values(record?.facts || {})) {
    if (fact?.source === 'document' && fact.sourceRef?.documentType) {
      seen.set(fact.sourceRef.documentType, true);
    }
    for (const alt of fact?.alternatives || []) {
      if (alt?.sourceRef?.documentType) seen.set(alt.sourceRef.documentType, true);
    }
  }
  return [...seen.keys()];
}
