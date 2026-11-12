/**
 * src/dateValidation.ts — Inline date-entry warnings.
 *
 * Shared by the Tier 1 staff questionnaires (Tier1Flow) and the full
 * readiness assessment phases (App.tsx). A warning is shown AT ENTRY
 * TIME, the moment an impossible date is typed — the report-level
 * CONFLICT already blocks filing, but the applicant/staff should not
 * have to wait for the report to learn a date cannot be right.
 *
 * Two checks only (2026-11-12 live-walk defect):
 *   1. future-dob — a date of birth in the future.
 *   2. entry-before-dob — a last-entry / entry date before the
 *      applicant's date of birth.
 *
 * Warnings never block entry: the user can continue with the value
 * as typed. The report CONFLICT stays the filing gate.
 *
 * Date handling follows the DTC Premium Carbon lessons (2026-11-12):
 * dates parse as LOCAL midnight (never UTC midnight, which shifts the
 * day east/west of UTC), and rollovers are rejected (02/31 is not a
 * date, it must not silently become Mar 3).
 */

export type DateWarningKind = 'future-dob' | 'entry-before-dob';

/** A question that collects a date of birth (applicant, spouse, child). */
export function isDobQuestion(id: string): boolean {
  return id === 'date_of_birth' || id === 'dob' || /_dob$/.test(id);
}

/** A question that collects a US entry / last-entry date. */
export function isEntryDateQuestion(id: string): boolean {
  return id === 'entry_date' || id === 'last_entry' || /_entry_date$/.test(id) || /_last_entry$/.test(id);
}

/**
 * Parse a date-input value as a local-midnight Date.
 * Accepts YYYY-MM-DD (native date input), MM/DD/YYYY, and YYYY-MM.
 * Returns null for empty, unparseable, or rolled-over values.
 */
export function parseDateInput(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (match) {
      m = +match[1];
      d = +match[2];
      y = +match[3];
    } else {
      match = /^(\d{4})-(\d{2})$/.exec(s);
      if (match) {
        y = +match[1];
        m = +match[2];
        d = 1;
      } else {
        return null;
      }
    }
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  // Reject rollovers (e.g. 02/31 → Mar 3): the constructed date must
  // be exactly the date that was typed.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function localToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The applicant's date of birth from the same answer record.
 * Prefers the exact 'date_of_birth' key, then the same-form applicant
 * key ('<prefix>_dob' for an entry question like 'i485_last_entry'),
 * then any DOB key. Spouse/child/other DOBs are only a last resort —
 * the entry-vs-birth check is about the applicant.
 */
function findApplicantDob(questionId: string, answers: Record<string, unknown>): Date | null {
  const keys = Object.keys(answers || {}).filter((k) => isDobQuestion(k));
  if (!keys.length) return null;
  const exact = keys.find((k) => k === 'date_of_birth');
  if (exact) return parseDateInput(answers[exact]);
  const prefix = questionId.includes('_') ? questionId.split('_')[0] : '';
  if (prefix) {
    const sameForm = keys.find((k) => k === `${prefix}_dob`);
    if (sameForm) return parseDateInput(answers[sameForm]);
  }
  return parseDateInput(answers[keys[0]]);
}

/**
 * Inline warning for a date answer, or null when the value is fine.
 * `value` is the value just typed for `questionId`; `answers` is the
 * rest of the record (saved answers, used to find the DOB when the
 * current question is an entry date).
 */
export function dateEntryWarning(
  questionId: string,
  value: unknown,
  answers: Record<string, unknown>,
): DateWarningKind | null {
  const date = parseDateInput(value);
  if (!date) return null;
  if (isDobQuestion(questionId)) {
    return date.getTime() > localToday().getTime() ? 'future-dob' : null;
  }
  if (isEntryDateQuestion(questionId)) {
    const dob = findApplicantDob(questionId, answers);
    if (dob && date.getTime() < dob.getTime()) return 'entry-before-dob';
  }
  return null;
}
