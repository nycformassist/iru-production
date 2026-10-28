/**
 * lib/countries.js — Server-side country display names (EN).
 *
 * Mirrors src/location.ts COUNTRIES (ISO 3166-1 alpha-2 codes) for the
 * model prompt only. Display-only: the stored residence value stays
 * the code, and client resource matching keeps using the code.
 * Unknown codes fall back to the code itself.
 */

export const COUNTRY_NAMES = {
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',
  GT: 'Guatemala',
  HN: 'Honduras',
  SV: 'El Salvador',
  CU: 'Cuba',
  HT: 'Haiti',
  DO: 'Dominican Republic',
  CO: 'Colombia',
  VE: 'Venezuela',
  PE: 'Peru',
  EC: 'Ecuador',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  UA: 'Ukraine',
  RU: 'Russia',
  PL: 'Poland',
  RO: 'Romania',
  DE: 'Germany',
  FR: 'France',
  GB: 'United Kingdom',
  ES: 'Spain',
  IT: 'Italy',
  PT: 'Portugal',
  IN: 'India',
  CN: 'China',
  PH: 'Philippines',
  VN: 'Vietnam',
  KR: 'South Korea',
  BD: 'Bangladesh',
  PK: 'Pakistan',
  AF: 'Afghanistan',
  IR: 'Iran',
  IQ: 'Iraq',
  SY: 'Syria',
  YE: 'Yemen',
  SO: 'Somalia',
  ET: 'Ethiopia',
  NG: 'Nigeria',
  CD: 'DR Congo',
  SD: 'Sudan',
  MM: 'Myanmar',
  NP: 'Nepal',
  LK: 'Sri Lanka',
  JM: 'Jamaica',
  TT: 'Trinidad and Tobago',
  GY: 'Guyana',
  BZ: 'Belize',
  NI: 'Nicaragua',
  CR: 'Costa Rica',
  PA: 'Panama',
  BS: 'Bahamas',
  OTHER: 'Other / not listed',
};

/** EN display name for a stored code, or the code itself when unknown. */
export function countryName(code) {
  if (!code || typeof code !== 'string') return code;
  return COUNTRY_NAMES[code] || code;
}

/**
 * Prompt presentation for a stored residence code: name + code
 * ('Canada (CA)'), so the model is given the name users see while the
 * code remains present and the stored value is unchanged. When the
 * name equals the code (unknown code), just the code is returned.
 */
export function residencePromptValue(code) {
  const name = countryName(code);
  if (!name || name === code) return code;
  return `${name} (${code})`;
}
