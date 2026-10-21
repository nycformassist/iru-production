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
    const country = record?.facts?.country_of_birth?.value;
    const city = String(value || '').trim();
    if (city && country) return `${city}, ${country}`;
    return city || (country ? String(country) : '');
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
