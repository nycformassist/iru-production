// Session-scoped assessment recovery for the IRU Android
// document-picker defect (2026-10-26). Framework-free and DOM-free at
// import time so the logic is unit-testable under the node test harness.
//
// PROBLEM (confirmed by audit, see REPORT §3): stage, answers, photo,
// and review state live only in React state, so ANY full reload or
// renderer-process recreation returns the app to Welcome. Android
// Chrome can discard/recreate the page while the system document
// picker is foreground — including when the user leaves the picker
// WITHOUT selecting a file — so the picker return cold-boots to LANG.
// This module persists the minimum restorable progress in ONE
// namespaced sessionStorage key so boot can restore it.
//
// PRIVACY — WHAT IS NEVER STORED (enforced by sanitizeAnswers + tests
// asserting on the serialized payload, not just on intent):
// - the whole application state (only whitelisted fields are serialized)
// - File, Blob, data URLs, object URLs, file names, document contents
// - review output, payment keys, entitlement tokens
// - street addresses, free-text names, free-text identification numbers
// - country/city free text, entry dates, citizenship
// WHAT IS STORED: schema version, save/expiry timestamps, language code,
// current stage (questionnaire/photo stages only), whitelisted
// choice-type answers, ZIP/postal code (short, non-identifying, and
// supported by the data model), selected document-type key, and a
// picker-opened marker. currentQ is intentionally NOT stored (the
// directive's field list); a restore lands at the saved stage's first
// question with saved answers intact.
// EXPIRY: two-hour sliding expiry — every save refreshes it.
// ROBUSTNESS: missing, malformed, blocked, or throwing storage never
// prevents boot (all functions degrade to no-op / null). Invalid or
// expired data is cleared and yields a clean Welcome state. clear()
// removes ONLY this module's own key — never payment or language keys.

export const RECOVERY_KEY = 'iru_assessment_recovery_v1';
export const RECOVERY_SCHEMA_VERSION = 1;
export const RECOVERY_TTL_MS = 2 * 60 * 60 * 1000;

export const RECOVERY_LANGS = ['EN', 'ES', 'ZH', 'HT', 'AR'];

export const RECOVERY_DOC_TYPES = [
  'has_passport',
  'has_i94',
  'has_lease',
  'has_persecution_proof',
  'has_green_card',
  'has_tax_transcripts',
  'has_marriage_cert',
  'has_proof_of_relationship',
  'has_arrests',
];

/** Choice-type answers eligible for restore (never free text). */
export const ELIGIBLE_ANSWER_KEYS = [
  'gender',
  'marital_status',
  'has_passport',
  'has_i94',
  'has_lease',
  'case_type',
  'has_persecution_proof',
  'has_green_card',
  'has_tax_transcripts',
  'has_marriage_cert',
  'has_proof_of_relationship',
  'has_arrests',
  'zip_code',
  'residence_postal_code',
];

/** Stages worth restoring. LANG (Welcome) needs no snapshot; ANALYZING
 * is transient (an analysis in flight cannot resume); PACKET means the
 * assessment completed, which clears recovery by rule. */
export const RESTORABLE_STAGES = [
  'PHASE1',
  'TRIAGE',
  'PHASE2',
  'PHASE3',
  'PHASE4',
  'PHOTO',
];

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type RecoveryInput = {
  stage: string;
  language: string;
  answers: Record<string, string>;
  docType: string;
  pickerOpened: boolean;
};

export type RecoverySnapshot = {
  version: number;
  savedAt: number;
  expiresAt: number;
  language: string;
  stage: string;
  answers: Record<string, string>;
  docType: string;
  pickerOpened: boolean;
};

export type RecoveryOptions = {
  allowedLangs?: string[];
  allowedDocTypes?: string[];
};

function shapeOk(candidate: unknown): candidate is StorageLike {
  try {
    return (
      !!candidate &&
      typeof (candidate as StorageLike).getItem === 'function' &&
      typeof (candidate as StorageLike).setItem === 'function' &&
      typeof (candidate as StorageLike).removeItem === 'function'
    );
  } catch {
    return false;
  }
}

/** Guarded sessionStorage access (throws when storage is blocked). */
export function sessionStore(): StorageLike | null {
  try {
    const s = (globalThis as unknown as { sessionStorage?: unknown })
      .sessionStorage;
    return shapeOk(s) ? (s as StorageLike) : null;
  } catch {
    return null;
  }
}

function isZipKey(key: string): boolean {
  return key === 'zip_code' || key === 'residence_postal_code';
}

/**
 * Keep only whitelisted keys with sane string values. Non-string values
 * are dropped; over-long values are dropped; ZIP values must match a
 * short postal-code charset. Everything else (names, streets, dates,
 * countries, file data, payment data) is dropped by construction —
 * callers pass the full answers object and this function is the gate.
 */
export function sanitizeAnswers(
  answers: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return out;
  }
  const allowed = new Set(ELIGIBLE_ANSWER_KEYS);
  for (const key of Object.keys(answers as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    const value = (answers as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    if (isZipKey(key)) {
      if (value.length < 1 || value.length > 20) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9 \-]{0,19}$/.test(value)) continue;
    } else if (value.length > 64) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Build a snapshot from app state, or null when the state is not
 * restorable (non-restorable stage, unknown language). Invalid docType
 * degrades to '' rather than rejecting the whole snapshot.
 */
export function createSnapshot(
  input: RecoveryInput,
  opts: RecoveryOptions = {},
  now: number = Date.now(),
): RecoverySnapshot | null {
  const langs = opts.allowedLangs || RECOVERY_LANGS;
  const docTypes = opts.allowedDocTypes || RECOVERY_DOC_TYPES;
  if (!RESTORABLE_STAGES.includes(input.stage)) return null;
  if (!langs.includes(input.language)) return null;
  return {
    version: RECOVERY_SCHEMA_VERSION,
    savedAt: now,
    expiresAt: now + RECOVERY_TTL_MS,
    language: input.language,
    stage: input.stage,
    answers: sanitizeAnswers(input.answers),
    docType: docTypes.includes(input.docType) ? input.docType : '',
    pickerOpened: input.pickerOpened === true,
  };
}

/** Serialize a snapshot (the exact bytes that reach storage). */
export function serializeSnapshot(snapshot: RecoverySnapshot): string {
  return JSON.stringify(snapshot);
}

/** Save eligible state. Returns true only when bytes were written. */
export function saveRecovery(
  storage: StorageLike | null | undefined,
  input: RecoveryInput,
  opts: RecoveryOptions = {},
  now: number = Date.now(),
): boolean {
  if (!shapeOk(storage)) return false;
  const snapshot = createSnapshot(input, opts, now);
  if (!snapshot) return false;
  try {
    (storage as StorageLike).setItem(RECOVERY_KEY, serializeSnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
}

/** Read the raw stored object without validation or side effects. */
export function readRawSnapshot(
  storage: StorageLike | null | undefined,
): Record<string, unknown> | null {
  if (!shapeOk(storage)) return null;
  try {
    const raw = (storage as StorageLike).getItem(RECOVERY_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * True only when a stored snapshot carries the picker-opened marker.
 * Never clears, never throws — used by save paths that must preserve
 * the marker across debounced/hide saves.
 */
export function loadPickerMarker(
  storage: StorageLike | null | undefined,
): boolean {
  const raw = readRawSnapshot(storage);
  return !!raw && raw.pickerOpened === true;
}

/** Remove ONLY this module's key. Returns false only when storage failed. */
export function clearRecovery(
  storage: StorageLike | null | undefined,
): boolean {
  if (!shapeOk(storage)) return false;
  try {
    (storage as StorageLike).removeItem(RECOVERY_KEY);
    return true;
  } catch {
    return false;
  }
}

function isValidSnapshotShape(
  raw: Record<string, unknown>,
  opts: RecoveryOptions,
  now: number,
): raw is RecoverySnapshot {
  const langs = opts.allowedLangs || RECOVERY_LANGS;
  const docTypes = opts.allowedDocTypes || RECOVERY_DOC_TYPES;
  if (raw.version !== RECOVERY_SCHEMA_VERSION) return false;
  if (typeof raw.savedAt !== 'number' || typeof raw.expiresAt !== 'number') {
    return false;
  }
  if (now > (raw.expiresAt as number)) return false;
  if (typeof raw.language !== 'string' || !langs.includes(raw.language)) {
    return false;
  }
  if (typeof raw.stage !== 'string' || !RESTORABLE_STAGES.includes(raw.stage)) {
    return false;
  }
  if (
    !raw.answers ||
    typeof raw.answers !== 'object' ||
    Array.isArray(raw.answers)
  ) {
    return false;
  }
  if (
    typeof raw.docType !== 'string' ||
    (raw.docType !== '' && !docTypes.includes(raw.docType))
  ) {
    return false;
  }
  if (typeof raw.pickerOpened !== 'boolean') return false;
  return true;
}

/**
 * Load and validate a snapshot. Invalid or expired data is cleared and
 * yields null (clean Welcome). Non-whitelisted answer keys are stripped
 * rather than rejecting the whole snapshot; structurally invalid data
 * (version, expiry, language, stage, non-object answers) rejects it.
 */
export function loadRecovery(
  storage: StorageLike | null | undefined,
  opts: RecoveryOptions = {},
  now: number = Date.now(),
): RecoverySnapshot | null {
  if (!shapeOk(storage)) return null;
  const raw = readRawSnapshot(storage);
  if (!raw) {
    // Present-but-unparseable data is invalid data: clear it (absent data
    // simply yields null). readRawSnapshot cannot distinguish the two,
    // so presence is checked directly here.
    try {
      const present = (storage as StorageLike).getItem(RECOVERY_KEY);
      if (present !== null) clearRecovery(storage);
    } catch {
      /* ignore */
    }
    return null;
  }
  if (!isValidSnapshotShape(raw, opts, now)) {
    clearRecovery(storage);
    return null;
  }
  return {
    version: RECOVERY_SCHEMA_VERSION,
    savedAt: raw.savedAt as number,
    expiresAt: raw.expiresAt as number,
    language: raw.language as string,
    stage: raw.stage as string,
    answers: sanitizeAnswers(raw.answers),
    docType: raw.docType as string,
    pickerOpened: raw.pickerOpened as boolean,
  };
}
