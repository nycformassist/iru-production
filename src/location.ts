/**
 * Country-aware location model (directive §3.2).
 *
 * Location is NOT one ambiguous field. IRU keeps distinct facts:
 * residence country / region / city / postal code, country of birth,
 * citizenship, and a separate mailing address when it differs.
 *
 * Rules:
 * - No location field is ever required to use IRU's federal readiness
 *   workflow. Postal codes are a resource-matching convenience only.
 * - International postal formats are accepted (letters, digits, spaces,
 *   hyphens). Countries without postal systems may omit the code.
 * - An international user is never defaulted to a U.S. location.
 */

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
}

/** Countries offered in the residence selector (plus "Other"). */
export const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'CU', name: 'Cuba' },
  { code: 'HT', name: 'Haiti' },
  { code: 'DO', name: 'Dominican Republic' },
  { code: 'CO', name: 'Colombia' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'PE', name: 'Peru' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'RU', name: 'Russia' },
  { code: 'PL', name: 'Poland' },
  { code: 'RO', name: 'Romania' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'IN', name: 'India' },
  { code: 'CN', name: 'China' },
  { code: 'PH', name: 'Philippines' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'KR', name: 'South Korea' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'AF', name: 'Afghanistan' },
  { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'SY', name: 'Syria' },
  { code: 'YE', name: 'Yemen' },
  { code: 'SO', name: 'Somalia' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'CD', name: 'DR Congo' },
  { code: 'SD', name: 'Sudan' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'NP', name: 'Nepal' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'GY', name: 'Guyana' },
  { code: 'BZ', name: 'Belize' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'PA', name: 'Panama' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'OTHER', name: 'Other / not listed' },
];

export function isUsCountry(code: string | undefined | null): boolean {
  return !code || code === 'US';
}

/** U.S. ZIP: exactly 5 digits (ZIP+4 tolerated, prefix used for matching). */
export function isValidUsZip(code: string | undefined | null): boolean {
  if (!code) return false;
  return /^\d{5}(-\d{4})?$/.test(String(code).trim());
}

/** Canadian postal code: A1A 1A1 format. */
export function isValidCanadianPostal(code: string | undefined | null): boolean {
  if (!code) return false;
  return /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(String(code).trim());
}

/**
 * General international postal validation: 3–12 chars of letters, digits,
 * spaces, hyphens. Empty is VALID (postal code optional everywhere in IRU).
 */
export function isValidPostalCode(country: string | undefined | null, code: string | undefined | null): boolean {
  const c = String(code || '').trim();
  if (c === '') return true; // optional — never a blocker
  if (isUsCountry(country)) return isValidUsZip(c);
  if (country === 'CA') return isValidCanadianPostal(c);
  return /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/.test(c) || /^[A-Za-z0-9]{3,12}$/.test(c);
}
