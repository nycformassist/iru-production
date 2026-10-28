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

/** Localized country names (G14): standard exonyms per language.
 * EN remains COUNTRIES[].name; these tables only override display. */
export const COUNTRY_NAMES_I18N: Record<string, Partial<Record<'ES' | 'ZH' | 'HT' | 'AR', string>>> = {
  US: { ES: 'Estados Unidos', ZH: '美国', HT: 'Etazini', AR: 'الولايات المتحدة' },
  CA: { ES: 'Canadá', ZH: '加拿大', HT: 'Kanada', AR: 'كندا' },
  MX: { ES: 'México', ZH: '墨西哥', HT: 'Meksik', AR: 'المكسيك' },
  GT: { ES: 'Guatemala', ZH: '危地马拉', HT: 'Gwatemala', AR: 'غواتيمالا' },
  HN: { ES: 'Honduras', ZH: '洪都拉斯', HT: 'Ondiras', AR: 'هندوراس' },
  SV: { ES: 'El Salvador', ZH: '萨尔瓦多', HT: 'Salvadò', AR: 'السلفادور' },
  CU: { ES: 'Cuba', ZH: '古巴', HT: 'Kiba', AR: 'كوبا' },
  HT: { ES: 'Haití', ZH: '海地', HT: 'Ayiti', AR: 'هايتي' },
  DO: { ES: 'República Dominicana', ZH: '多米尼加共和国', HT: 'Repiblik Dominikèn', AR: 'جمهورية الدومينيكان' },
  CO: { ES: 'Colombia', ZH: '哥伦比亚', HT: 'Kolonbi', AR: 'كولومبيا' },
  VE: { ES: 'Venezuela', ZH: '委内瑞拉', HT: 'Venezyela', AR: 'فنزويلا' },
  PE: { ES: 'Perú', ZH: '秘鲁', HT: 'Perou', AR: 'بيرو' },
  EC: { ES: 'Ecuador', ZH: '厄瓜多尔', HT: 'Ekwatè', AR: 'الإكوادور' },
  BR: { ES: 'Brasil', ZH: '巴西', HT: 'Brezil', AR: 'البرازيل' },
  AR: { ES: 'Argentina', ZH: '阿根廷', HT: 'Ajantin', AR: 'الأرجنتين' },
  CL: { ES: 'Chile', ZH: '智利', HT: 'Chili', AR: 'تشيلي' },
  UA: { ES: 'Ucrania', ZH: '乌克兰', HT: 'Ikrèn', AR: 'أوكرانيا' },
  RU: { ES: 'Rusia', ZH: '俄罗斯', HT: 'Risi', AR: 'روسيا' },
  PL: { ES: 'Polonia', ZH: '波兰', HT: 'Polòy', AR: 'بولندا' },
  RO: { ES: 'Rumania', ZH: '罗马尼亚', HT: 'Woumani', AR: 'رومانيا' },
  DE: { ES: 'Alemania', ZH: '德国', HT: 'Almay', AR: 'ألمانيا' },
  FR: { ES: 'Francia', ZH: '法国', HT: 'Frans', AR: 'فرنسا' },
  GB: { ES: 'Reino Unido', ZH: '英国', HT: 'Wayòm Ini', AR: 'المملكة المتحدة' },
  ES: { ES: 'España', ZH: '西班牙', HT: 'Espay', AR: 'إسبانيا' },
  IT: { ES: 'Italia', ZH: '意大利', HT: 'Itali', AR: 'إيطاليا' },
  PT: { ES: 'Portugal', ZH: '葡萄牙', HT: 'Pòtigal', AR: 'البرتغال' },
  IN: { ES: 'India', ZH: '印度', HT: 'End', AR: 'الهند' },
  CN: { ES: 'China', ZH: '中国', HT: 'Chin', AR: 'الصين' },
  PH: { ES: 'Filipinas', ZH: '菲律宾', HT: 'Filipin', AR: 'الفلبين' },
  VN: { ES: 'Vietnam', ZH: '越南', HT: 'Vyètnam', AR: 'فيتنام' },
  KR: { ES: 'Corea del Sur', ZH: '韩国', HT: 'Kore di Sid', AR: 'كوريا الجنوبية' },
  BD: { ES: 'Bangladés', ZH: '孟加拉国', HT: 'Bangladèch', AR: 'بنغلاديش' },
  PK: { ES: 'Pakistán', ZH: '巴基斯坦', HT: 'Pakistan', AR: 'باكستان' },
  AF: { ES: 'Afganistán', ZH: '阿富汗', HT: 'Afganistan', AR: 'أفغانستان' },
  IR: { ES: 'Irán', ZH: '伊朗', HT: 'Iran', AR: 'إيران' },
  IQ: { ES: 'Irak', ZH: '伊拉克', HT: 'Irak', AR: 'العراق' },
  SY: { ES: 'Siria', ZH: '叙利亚', HT: 'Siri', AR: 'سوريا' },
  YE: { ES: 'Yemen', ZH: '也门', HT: 'Yemèn', AR: 'اليمن' },
  SO: { ES: 'Somalia', ZH: '索马里', HT: 'Somali', AR: 'الصومال' },
  ET: { ES: 'Etiopía', ZH: '埃塞俄比亚', HT: 'Etyopi', AR: 'إثيوبيا' },
  NG: { ES: 'Nigeria', ZH: '尼日利亚', HT: 'Nijerya', AR: 'نيجيريا' },
  CD: { ES: 'RD Congo', ZH: '刚果民主共和国', HT: 'RD Kongo', AR: 'جمهورية الكونغو الديمقراطية' },
  SD: { ES: 'Sudán', ZH: '苏丹', HT: 'Soudan', AR: 'السودان' },
  MM: { ES: 'Birmania (Myanmar)', ZH: '缅甸', HT: 'Myanma', AR: 'ميانمار' },
  NP: { ES: 'Nepal', ZH: '尼泊尔', HT: 'Nepal', AR: 'نيبال' },
  LK: { ES: 'Sri Lanka', ZH: '斯里兰卡', HT: 'Sri Lanka', AR: 'سريلانكا' },
  JM: { ES: 'Jamaica', ZH: '牙买加', HT: 'Jamayik', AR: 'جامايكا' },
  TT: { ES: 'Trinidad y Tobago', ZH: '特立尼达和多巴哥', HT: 'Trinidad ak Tobago', AR: 'ترينيداد وتوباغو' },
  GY: { ES: 'Guyana', ZH: '圭亚那', HT: 'Giyana', AR: 'غيانا' },
  BZ: { ES: 'Belice', ZH: '伯利兹', HT: 'Beliz', AR: 'بليز' },
  NI: { ES: 'Nicaragua', ZH: '尼加拉瓜', HT: 'Nikaragwa', AR: 'نيكاراغوا' },
  CR: { ES: 'Costa Rica', ZH: '哥斯达黎加', HT: 'Kosta Rika', AR: 'كوستاريكا' },
  PA: { ES: 'Panamá', ZH: '巴拿马', HT: 'Panama', AR: 'بنما' },
  BS: { ES: 'Bahamas', ZH: '巴哈马', HT: 'Bahamas', AR: 'جزر البهاما' },
  OTHER: { ES: 'Otro / no listado', ZH: '其他 / 未列出', HT: 'Lòt / pa liste', AR: 'أخرى / غير مدرجة' },
};

/** Country display name in `lang` (EN fallback: the COUNTRIES name). */
export function localizedCountryName(country: Country, lang: string): string {
  if (!country) return '';
  if (!lang || lang === 'EN') return country.name;
  return COUNTRY_NAMES_I18N[country.code]?.[lang as 'ES' | 'ZH' | 'HT' | 'AR'] || country.name;
}

/**
 * Display name for a stored ISO country code (e.g. 'CA' -> 'Canada').
 * Display-only: the stored code is never changed by this helper, and
 * resource matching keeps using the code. Unknown codes fall back to
 * the code itself so nothing renders blank.
 */
export function countryDisplayName(code: string | undefined | null, lang: string): string {
  if (!code) return '';
  const country = COUNTRIES.find((c) => c.code === code);
  if (!country) return code;
  return localizedCountryName(country, lang);
}

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
