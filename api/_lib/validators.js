/**
 * api/_lib/validators.js — Field validators and normalizers for IRU (Phase 1).
 *
 * Every field that goes into a PDF needs validation (is it well-formed?)
 * and possibly normalization (convert to the format the PDF expects).
 *
 * A VALIDATOR is: (value) => { valid: boolean, error?: string }
 * A NORMALIZER is: (value) => string (transformed value)
 *
 * Validators are pure functions — no I/O, fully testable.
 */

// ─── Normalizers ───

/**
 * Strip all non-digit characters. Used for phone numbers.
 * "212-555-0147" → "2125550147"
 */
export function normalizeDigits(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

/**
 * Normalize a date to MM/DD/YYYY format.
 * Accepts: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY
 */
export function normalizeDateMDY(value) {
  if (!value) return '';
  const str = String(value).trim();

  // Already MM/DD/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;

  // YYYY-MM-DD → MM/DD/YYYY
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  // MM-DD-YYYY → MM/DD/YYYY
  const dash = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dash) return `${dash[1]}/${dash[2]}/${dash[3]}`;

  return str; // Return as-is if unrecognized; validator will flag it
}

/**
 * Normalize a phone number to 10 digits.
 * "(212) 555-0147" → "2125550147"
 */
export function normalizePhone(value) {
  return normalizeDigits(value);
}

// ─── Validators ───

/**
 * Validate a US phone number (10 digits).
 */
export function validatePhone(value) {
  const digits = normalizeDigits(value);
  if (digits.length === 0) return { valid: true }; // Empty is ok (optional fields)
  if (digits.length === 10) return { valid: true };
  if (digits.length === 11 && digits.startsWith('1')) return { valid: true };
  return { valid: false, error: 'Phone number must be 10 digits' };
}

/**
 * Validate a date.
 */
export function validateDate(value) {
  if (!value) return { valid: true }; // Empty is ok
  const normalized = normalizeDateMDY(value);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
    const [m, d, y] = normalized.split('/').map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100) {
      return { valid: true };
    }
  }
  return { valid: false, error: 'Date must be in MM/DD/YYYY format' };
}

/**
 * Validate a ZIP code (5 digits, optional +4).
 */
export function validateZip(value) {
  if (!value) return { valid: true };
  const str = String(value).trim();
  if (/^\d{5}(-\d{4})?$/.test(str)) return { valid: true };
  return { valid: false, error: 'ZIP code must be 5 digits (optional +4)' };
}

/**
 * Validate an A-Number (8 or 9 digits, optional leading A).
 */
export function validateANumber(value) {
  if (!value) return { valid: true };
  const str = String(value).trim().toUpperCase();
  const digits = str.replace(/^A/, '');
  if (/^\d{8,9}$/.test(digits)) return { valid: true };
  return { valid: false, error: 'A-Number must be 8 or 9 digits' };
}

/**
 * Validate an email address (basic).
 */
export function validateEmail(value) {
  if (!value) return { valid: true };
  const str = String(value).trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) return { valid: true };
  return { valid: false, error: 'Invalid email address' };
}

// ─── Registry ───

/**
 * Map of field types to their validator + normalizer.
 */
export const FIELD_VALIDATORS = {
  phone: { validate: validatePhone, normalize: normalizePhone },
  date: { validate: validateDate, normalize: normalizeDateMDY },
  zip: { validate: validateZip, normalize: null },
  a_number: { validate: validateANumber, normalize: (v) => String(v).trim().toUpperCase() },
  email: { validate: validateEmail, normalize: (v) => String(v).trim().toLowerCase() },
};

/**
 * Validate a value for a given field type.
 * Returns { valid, error? }. Unknown types always pass.
 */
export function validateField(fieldType, value) {
  const entry = FIELD_VALIDATORS[fieldType];
  if (!entry) return { valid: true };
  return entry.validate(value);
}

/**
 * Normalize a value for a given field type.
 * Returns the normalized value. Unknown types return as-is.
 */
export function normalizeField(fieldType, value) {
  const entry = FIELD_VALIDATORS[fieldType];
  if (!entry || !entry.normalize) return value;
  return entry.normalize(value);
}
