/**
 * IRU Nationwide Resource Directory — Layered resource model
 *
 * Implements the local → statewide/regional → national → fallback hierarchy
 * from NATIONWIDE_RESOURCE_IMPLEMENTATION_PLAN_2026-10-19.md.
 *
 * Data integrity rules (hard):
 * - Never represent an org as local unless its verified service area covers the user's location.
 * - Never invent missing details. Unverified fields are omitted, not guessed.
 * - Eligibility restrictions are surfaced inline; legal vs nonlegal assistance is distinguished.
 * - Each record carries sourceOfVerification and lastVerified.
 *
 * Architecture note (2026-10-19 product principle): client-side is the simplest
 * effective implementation for the current dataset size. The resolveResources()
 * interface is designed to allow migration to a server-side API without changing
 * the UI contract when 50-state scale justifies it.
 */

export type ResourceLayer = 'local' | 'statewide' | 'national';

export interface ResourceOrg {
  id: string;
  name: string;
  website: string;
  phone: string;
  address: string;
  /** 3-digit ZIP prefixes this org serves (verified). */
  zipPrefixes: string[];
  /** 2-letter state code. */
  state: string;
  /** Verified service area description (not inferred). */
  serviceArea: string;
  layer: ResourceLayer;
  /** What the org actually offers (verified; no assumptions). */
  servicesOffered: string;
  /** True only if verified to provide direct legal representation. */
  legalRepresentation: boolean;
  /** Eligibility restrictions, if any. Must be shown in UI. */
  eligibility?: string;
  /** NYC-specific transit directions (preserved from original dataset). */
  borough?: string;
  transit?: string;
  exit?: string;
  mapUrl?: string;
  sourceOfVerification: string;
  lastVerified: string; // YYYY-MM-DD
}

export interface NationalDirectory {
  name: string;
  url: string; // may include {zip} placeholder
  description: string;
}

export interface ResourceResult {
  /** Verified orgs serving the user's ZIP area. */
  local: ResourceOrg[];
  /** Verified orgs serving the user's state/region (beyond local). */
  statewide: ResourceOrg[];
  /** National directory links (always provided). */
  national: NationalDirectory[];
  /** True when no verified local/statewide match was found. */
  fallback: boolean;
  /** Preserved for NYC regression behavior. True if ZIP is in NYC coverage. */
  isNycCoverage: boolean;
  /** The normalized 3-digit prefix, or empty string. */
  prefix: string;
  /** Country the resolution was performed for (ISO alpha-2 or 'US'). */
  country: string;
  /** True when the user is outside the U.S. — no U.S. org is "local" to them. */
  isInternational: boolean;
  /** How the local/statewide match was established: ZIP prefix, the
   *  user's stated city, their state (statewide layer), or none. Lets the
   *  UI describe the match honestly instead of blaming a missing ZIP. */
  matchedBy: 'zip' | 'city' | 'state' | 'none';
}

export interface LocationInput {
  /** ISO 3166-1 alpha-2 country of residence. Absent/empty means U.S. (legacy). */
  country?: string;
  /** Postal code in the country's own format (ZIP for the U.S.). */
  postalCode?: string;
  /** State / province / region, when known. */
  region?: string;
  /** City or locality, when known. */
  city?: string;
}

const LAST_VERIFIED = '2026-10-19';

/**
 * NYC resources — preserved verbatim from the original NYC_RESOURCES dataset,
 * including transit/exit instructions. These are the regression baseline.
 */
const NYC_ORGS: ResourceOrg[] = [
  {
    id: 'nyc-legal-aid-society',
    name: 'The Legal Aid Society',
    website: 'https://www.legalaidnyc.org',
    phone: '(212) 577-3300',
    address: '199 Water St, New York, NY 10038',
    zipPrefixes: ['100'],
    state: 'NY',
    serviceArea: 'Manhattan, New York City',
    layer: 'local',
    servicesOffered: 'Free civil legal services including immigration assistance.',
    legalRepresentation: true,
    borough: 'Manhattan',
    transit: 'Take the 2/3 to Wall St.',
    exit: 'Use the Wall St exit and walk south.',
    mapUrl: 'https://maps.google.com/?q=199+Water+St,+New+York,+NY+10038',
    sourceOfVerification: 'Original IRU dataset (pre-existing production data)',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'nyc-bronx-defenders',
    name: 'The Bronx Defenders',
    website: 'https://www.bronxdefenders.org',
    phone: '(718) 838-7878',
    address: '360 E 161st St, Bronx, NY 10451',
    zipPrefixes: ['104'],
    state: 'NY',
    serviceArea: 'The Bronx, New York City',
    layer: 'local',
    servicesOffered: 'Immigration Defense Practice: fights detention and deportation; NYIFUP universal-representation provider.',
    legalRepresentation: true,
    eligibility: 'Low-income Bronx residents; serves regardless of immigration status.',
    borough: 'Bronx',
    transit: 'Take the 4/B/D to 161st-Yankee Stadium.',
    exit: 'Front of Train exit for Grand Concourse.',
    mapUrl: 'https://maps.google.com/?q=360+E+161st+St,+Bronx,+NY+10451',
    sourceOfVerification: 'bronxdefenders.org; NYC NYIFUP materials (re-verified 2026-10-19)',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'nyc-minkwon',
    name: 'MinKwon Center',
    website: 'https://www.minkwon.org',
    phone: '(718) 460-5600',
    address: '133-29 41st Ave, Flushing, NY 11355',
    zipPrefixes: ['111'],
    state: 'NY',
    serviceArea: 'Queens, New York City',
    layer: 'local',
    servicesOffered: 'Immigration legal services and community advocacy.',
    legalRepresentation: true,
    borough: 'Queens',
    transit: 'Take the 7 train to Flushing-Main St.',
    exit: 'Exit at Main St and walk south.',
    mapUrl: 'https://maps.google.com/?q=133-29+41st+Ave,+Flushing,+NY+11355',
    sourceOfVerification: 'Original IRU dataset (pre-existing production data)',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'nyc-brooklyn-legal',
    name: 'Brooklyn Legal Services',
    website: 'https://www.legalservicesnyc.org',
    phone: '(718) 237-5500',
    address: '105 Court St, Brooklyn, NY 11201',
    zipPrefixes: ['112'],
    state: 'NY',
    serviceArea: 'Brooklyn, New York City',
    layer: 'local',
    servicesOffered: 'Free civil legal services including immigration assistance.',
    legalRepresentation: true,
    borough: 'Brooklyn',
    transit: 'Take the 2/3/4/5 or R to Borough Hall/Court St.',
    exit: 'Exit at Court St.',
    mapUrl: 'https://maps.google.com/?q=105+Court+St,+Brooklyn,+NY+11201',
    sourceOfVerification: 'Original IRU dataset (pre-existing production data)',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'nyc-project-hospitality',
    name: 'Project Hospitality',
    website: 'https://www.projecthospitality.org',
    phone: '(718) 448-1544',
    address: '100 Park Ave, Staten Island, NY 10302',
    zipPrefixes: ['103'],
    state: 'NY',
    serviceArea: 'Staten Island, New York City',
    layer: 'local',
    servicesOffered: 'Community services including immigration assistance.',
    legalRepresentation: false,
    borough: 'Staten Island',
    transit: 'Take the S48/S98 bus to Richmond Terrace/Park Ave.',
    exit: 'Exit at Park Ave.',
    mapUrl: 'https://maps.google.com/?q=100+Park+Ave,+Staten+Island,+NY+10302',
    sourceOfVerification: 'Original IRU dataset (pre-existing production data)',
    lastVerified: LAST_VERIFIED,
  },
];

/**
 * Nationwide expansion — verified 2026-10-19 via official websites and the
 * Immigration Advocates Network directory. See
 * docs/RESOURCE_DIRECTORY_RESEARCH_2026-10-19.md for full verification tables.
 */
const NATIONAL_ORGS: ResourceOrg[] = [
  // ——— Los Angeles, CA 90012 ———
  {
    id: 'la-lafla',
    name: 'Legal Aid Foundation of Los Angeles (LAFLA)',
    website: 'https://www.lafla.org',
    phone: '(323) 801-7989',
    address: '1550 W 8th St, Los Angeles, CA 90017',
    zipPrefixes: ['900'],
    state: 'CA',
    serviceArea: 'Los Angeles and Orange counties',
    layer: 'local',
    servicesOffered: 'Full immigration legal services including Immigration Court and BIA representation.',
    legalRepresentation: true,
    eligibility: 'Low-income residents.',
    sourceOfVerification: 'immigrationadvocates.org directory; 211LA',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'la-advancing-justice',
    name: 'Asian Americans Advancing Justice Southern California (AJSOCAL)',
    website: 'https://www.ajsocal.org',
    phone: '(213) 977-7500',
    address: '1145 Wilshire Blvd, 2nd Fl, Los Angeles, CA 90017',
    zipPrefixes: ['900'],
    state: 'CA',
    serviceArea: 'Los Angeles area',
    layer: 'local',
    servicesOffered: 'Immigration services including court representation: adjustment, DACA, family petitions, naturalization, removal defense, T/U/VAWA.',
    legalRepresentation: true,
    sourceOfVerification: 'immigrationadvocates.org directory',
    lastVerified: LAST_VERIFIED,
  },
  // ——— Columbus, OH 43215 ———
  {
    id: 'oh-cris',
    name: 'Community Refugee & Immigration Services (CRIS)',
    website: 'https://www.crisohio.org',
    phone: '(614) 235-5747',
    address: '4645 Executive Drive, Columbus, OH 43220',
    zipPrefixes: ['432'],
    state: 'OH',
    serviceArea: 'Central Ohio',
    layer: 'local',
    servicesOffered: 'Immigration legal services including representation: asylum, family petitions, naturalization, DACA, TPS, U/VAWA. Note: CRIS does not currently handle immigration court cases.',
    legalRepresentation: true,
    sourceOfVerification: 'immigrationadvocates.org directory; columbus.gov',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'oh-lasco',
    name: 'Legal Aid of Southeast and Central Ohio (LASCO)',
    website: 'https://www.lasco.org',
    phone: '(888) 246-4420',
    address: '1108 City Park Ave, Columbus, OH 43206',
    zipPrefixes: ['432'],
    state: 'OH',
    serviceArea: 'Franklin and Madison counties (Columbus office)',
    layer: 'local',
    servicesOffered: 'Free civil legal help including immigration-related issues.',
    legalRepresentation: true,
    eligibility: 'Low-income residents and seniors.',
    sourceOfVerification: 'columbus.gov',
    lastVerified: LAST_VERIFIED,
  },
  // ——— Houston, TX 77002 ———
  {
    id: 'tx-catholic-charities-houston',
    name: 'Catholic Charities Galveston-Houston — St. Frances Cabrini Center',
    website: 'https://www.catholiccharities.org',
    phone: '(713) 595-4100',
    address: '5599 San Felipe St, Ste 300, Houston, TX 77056',
    zipPrefixes: ['770'],
    state: 'TX',
    serviceArea: 'Greater Houston / Galveston-Houston archdiocese',
    layer: 'local',
    servicesOffered: 'Full immigration legal services including Immigration Court representation.',
    legalRepresentation: true,
    sourceOfVerification: 'immigrationadvocates.org directory',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'tx-tahirih-houston',
    name: 'Tahirih Justice Center (Houston)',
    website: 'https://www.tahirih.org',
    phone: '(713) 496-0100',
    address: '1717 Saint James Pl, Ste 450, Houston, TX 77056',
    zipPrefixes: ['770'],
    state: 'TX',
    serviceArea: 'Houston area',
    layer: 'local',
    servicesOffered: 'Free legal representation: asylum, VAWA, T/U visas, SIJS; plus social services.',
    legalRepresentation: true,
    eligibility: 'Immigrant survivors of gender-based violence (primarily women and girls). Not general immigration services.',
    sourceOfVerification: 'tahirih.org; texaslawhelp.org; immigrationadvocates.org',
    lastVerified: LAST_VERIFIED,
  },
  // ——— Miami, FL 33130 ———
  {
    id: 'fl-ai-justice',
    name: 'Americans for Immigrant Justice (AI Justice)',
    website: 'https://www.aijustice.org',
    phone: '(305) 573-1106',
    address: '6355 NW 36th St, Ste 2201, Miami, FL 33166',
    zipPrefixes: ['331'],
    state: 'FL',
    serviceArea: 'Miami-Dade and Broward counties',
    layer: 'local',
    servicesOffered: 'Free direct legal services: asylum, unaccompanied children, trafficking/DV survivors, detention.',
    legalRepresentation: true,
    eligibility: 'Low-income immigrants.',
    sourceOfVerification: 'aijustice.org; Charity Navigator EIN 65-0610872',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'fl-ccls-miami',
    name: 'Catholic Legal Services, Archdiocese of Miami',
    website: 'https://www.cclsmiami.org',
    phone: '(305) 373-1073',
    address: '1469 NW 13th Terrace, Ste 100, Miami, FL 33125',
    zipPrefixes: ['331'],
    state: 'FL',
    serviceArea: 'Broward, Miami-Dade, and Monroe counties',
    layer: 'local',
    servicesOffered: 'Pro bono/low-cost immigration services including representation before USCIS, Immigration Courts, and BIA.',
    legalRepresentation: true,
    sourceOfVerification: 'cclsmiami.org; immigrationadvocates.org',
    lastVerified: LAST_VERIFIED,
  },
  // ——— Chicago, IL 60601 ———
  {
    id: 'il-nijc',
    name: 'National Immigrant Justice Center (NIJC)',
    website: 'https://www.immigrantjustice.org',
    phone: '(312) 660-1370',
    address: '111 W Jackson Blvd, Suite 800, Chicago, IL 60604',
    zipPrefixes: ['606'],
    state: 'IL',
    serviceArea: 'Illinois and Indiana',
    layer: 'local',
    servicesOffered: 'Low-cost/free immigration legal services including full representation: asylum, SIJS, removal defense, VAWA/U/T, DACA, family petitions, TPS, naturalization; free Immigration Court Help Desk.',
    legalRepresentation: true,
    eligibility: 'Low-income immigrants; Chicago residents eligible for free services via City Legal Protection Fund.',
    sourceOfVerification: 'immigrationadvocates.org directory (address verified 2026-10-19)',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'il-resurrection-project',
    name: 'The Resurrection Project',
    website: 'https://www.trpimmigrantjustice.org',
    phone: '(312) 666-3062',
    address: '1805 S Ashland Ave, Chicago, IL 60608',
    zipPrefixes: ['606'],
    state: 'IL',
    serviceArea: 'Chicago area',
    layer: 'local',
    servicesOffered: 'Immigration legal services including court representation: family-based, DACA, TPS, naturalization, removal defense, U/T/VAWA/SIJS/asylum.',
    legalRepresentation: true,
    sourceOfVerification: 'immigrationadvocates.org; Archdiocese of Chicago',
    lastVerified: LAST_VERIFIED,
  },
  // ——— Atlanta, GA 30303 ———
  {
    id: 'ga-gain',
    name: 'Georgia Asylum and Immigration Network (GAIN)',
    website: 'https://www.georgiaasylum.org',
    phone: '(678) 335-6040',
    address: 'PO Box 56268, Atlanta, GA 30343',
    zipPrefixes: ['303'],
    state: 'GA',
    serviceArea: 'Georgia (statewide)',
    layer: 'statewide',
    servicesOffered: 'Free immigration legal services including direct representation: asylum, U/T visas, VAWA; pro bono attorney recruitment and training.',
    legalRepresentation: true,
    eligibility: 'Asylum seekers and immigrant survivors of crime/persecution ONLY. Not general immigration services.',
    sourceOfVerification: 'georgiaasylum.org (phone verified on official site 2026-10-19); AILA; UGA Law',
    lastVerified: LAST_VERIFIED,
  },
  {
    id: 'ga-laa',
    name: 'Latin American Association',
    website: 'https://www.thelaa.org',
    phone: '(404) 471-1889',
    address: '2750 Buford Hwy NE, Atlanta, GA 30324',
    zipPrefixes: ['303'],
    state: 'GA',
    serviceArea: 'Atlanta area',
    layer: 'local',
    servicesOffered: 'Affordable immigration legal services: family-based, adjustment, consular processing, DACA, TPS, naturalization, work permits, VAWA, non-detained removal defense.',
    legalRepresentation: true,
    eligibility: 'Excludes employment/student/tourist visas and detained cases.',
    sourceOfVerification: 'immigrationadvocates.org; GSU Law Library guide',
    lastVerified: LAST_VERIFIED,
  },
  // ——— Bronx additional (complements existing Bronx Defenders) ———
  {
    id: 'nyc-bronx-legal-services',
    name: 'Bronx Legal Services (Legal Services NYC)',
    website: 'https://www.legalservicesnyc.org',
    phone: '(917) 661-4500',
    address: '349 E 149th St, 10th Fl, Bronx, NY 10451',
    zipPrefixes: ['104'],
    state: 'NY',
    serviceArea: 'Bronx County',
    layer: 'local',
    servicesOffered: 'Free civil legal services; Family & Immigration Unit: U/T visas, VAWA, SIJS, asylum, removal defense, family petitions, naturalization.',
    legalRepresentation: true,
    eligibility: 'Low-income Bronx County residents.',
    borough: 'Bronx',
    sourceOfVerification: 'immigrationadvocates.org directory (verified 2026-10-19)',
    lastVerified: LAST_VERIFIED,
  },
];

const ALL_ORGS: ResourceOrg[] = [...NYC_ORGS, ...NATIONAL_ORGS];

const NYC_PREFIXES = ['100', '104', '111', '112', '103'];

function buildNationalDirectories(zip: string): NationalDirectory[] {
  const encodedZip = encodeURIComponent(zip);
  return [
    {
      name: 'ImmigrationLawHelp.org',
      url: `https://www.immigrationlawhelp.org/search?zip=${encodedZip}`,
      description:
        'National Immigration Legal Services Directory — search 1,000+ nonprofit immigration legal providers by ZIP code.',
    },
    {
      name: 'DOJ Recognized Organizations & Accredited Representatives',
      url: 'https://www.justice.gov/eoir/recognition-accreditation-roster-reports',
      description:
        'U.S. Department of Justice roster of recognized organizations and accredited representatives (public domain). EOIR does not endorse listed organizations.',
    },
    {
      name: 'LawHelp.org',
      url: 'https://www.lawhelp.org/find-help',
      description: 'State-by-state directory of free legal aid providers.',
    },
  ];
}

/**
 * Resolve resources for a user ZIP code using the layered model:
 * local → statewide → national directories → honest fallback.
 *
 * Never returns an org as "local" unless its verified service area covers
 * the user's ZIP prefix. When no verified match exists, `fallback` is true
 * and the UI must show the honest fallback notice (never silent substitution).
 */
export function resolveResources(zip: string): ResourceResult {
  return resolveResourcesForLocation({ country: 'US', postalCode: zip });
}

/**
 * Country-aware layered resolution (directive §3.3):
 * local → regional/statewide → national → broader/international fallback.
 *
 * - U.S. users: verified ZIP-prefix matching first (unchanged behavior).
 * - U.S. users with no (or an unmatched) ZIP but a known city/state:
 *   city/state matching against the orgs' verified locality data (D7) —
 *   an org is local only when its verified service area names the city.
 * - Otherwise: national directories only, honest fallback.
 *   Federal readiness is NEVER blocked by a missing location.
 * - Non-U.S. users: NO U.S. organization is represented as local to them.
 *   They receive the U.S. national directories (relevant to U.S.
 *   immigration help) with `isInternational: true` so the UI labels them
 *   honestly as U.S.-based national resources, plus fallback = true.
 *   IRU does not invent providers in other countries.
 */
export function resolveResourcesForLocation(loc: LocationInput): ResourceResult {
  const country = String(loc?.country || 'US').trim().toUpperCase() || 'US';
  const postal = String(loc?.postalCode || '').trim();

  if (country !== 'US') {
    return {
      local: [],
      statewide: [],
      national: buildNationalDirectories(''),
      fallback: true,
      isNycCoverage: false,
      prefix: '',
      country,
      isInternational: true,
      matchedBy: 'none',
    };
  }

  const prefix = postal.substring(0, 3);
  let isNycCoverage = NYC_PREFIXES.includes(prefix);

  let matched = prefix
    ? ALL_ORGS.filter((org) => org.zipPrefixes.includes(prefix))
    : [];
  let matchedBy: ResourceResult['matchedBy'] = matched.length > 0 ? 'zip' : 'none';

  if (matched.length === 0) {
    // City/state fallback (D7): the interview collects city + state even
    // when the user gives no ZIP — ZIP is optional by design, so a blank
    // ZIP must not zero out a known city/state. Matching uses ONLY each
    // org's own verified locality data (borough, serviceArea, state) and
    // never invents coverage: an org is "local" only when its verified
    // service area names the user's city, and "statewide" only for orgs
    // whose verified layer is statewide in the user's state.
    const stateCode = normalizeUsState(loc?.region || '');
    const cityLower = String(loc?.city || '').trim().toLowerCase();
    const cityMatched = cityLower
      ? ALL_ORGS.filter((org) => org.layer === 'local' && cityMatchesOrg(org, cityLower, stateCode))
      : [];
    const stateMatched = stateCode
      ? ALL_ORGS.filter((org) => org.layer === 'statewide' && org.state === stateCode
          && !cityMatched.some((o) => o.id === org.id))
      : [];
    matched = [...cityMatched, ...stateMatched];
    if (cityMatched.length > 0) matchedBy = 'city';
    else if (stateMatched.length > 0) matchedBy = 'state';
    if (cityMatched.some((org) => org.borough)) isNycCoverage = true;
  }

  const local = matched.filter((org) => org.layer === 'local');
  const statewide = matched.filter((org) => org.layer === 'statewide');

  return {
    local,
    statewide,
    national: buildNationalDirectories(postal),
    fallback: matched.length === 0,
    isNycCoverage,
    prefix,
    country: 'US',
    isInternational: false,
    matchedBy,
  };
}

/** US state name (any case) or 2-letter code → 2-letter code, else ''. */
const US_STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

export function normalizeUsState(region: string): string {
  const r = String(region || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!r) return '';
  if (/^[a-z]{2}$/.test(r)) return r.toUpperCase();
  return US_STATE_CODES[r] || '';
}

/**
 * Does this org's OWN verified locality data place it in the user's city?
 * - NYC orgs carry an explicit borough — exact match.
 * - Others: the verified serviceArea text must begin with the city name
 *   at a word boundary ("Brooklyn, New York City", "Houston area",
 *   "Atlanta area").
 * When the user's state is known, the org must also be in that state —
 * a same-named city in another state never matches.
 */
function cityMatchesOrg(org: ResourceOrg, cityLower: string, stateCode: string): boolean {
  if (stateCode && org.state !== stateCode) return false;
  if (org.borough && org.borough.trim().toLowerCase() === cityLower) return true;
  const area = (org.serviceArea || '').trim().toLowerCase();
  if (!area.startsWith(cityLower)) return false;
  const next = area.charAt(cityLower.length);
  return next === '' || next === ',' || next === ' ' || next === '(' || next === '/';
}

export type I18nLang = 'ES' | 'ZH' | 'HT' | 'AR';
export interface ResourceTextI18n { servicesOffered?: string; eligibility?: string; serviceArea?: string; transit?: string; exit?: string }

/** Localized IRU explanatory prose for resources (G13). Translates ONLY the
 * verified EN text on each org; names/addresses/phones stay verbatim. */
export const RESOURCE_I18N: Record<string, Partial<Record<I18nLang, ResourceTextI18n>>> = {
'nyc-legal-aid-society': {
ES: { servicesOffered: 'Servicios legales civiles gratuitos, incluida asistencia en inmigración.', serviceArea: 'Manhattan, Ciudad de Nueva York', transit: 'Tome el 2/3 hasta Wall St.', exit: 'Use la salida de Wall St y camine hacia el sur.' },
ZH: { servicesOffered: '免费民事法律服务，包括移民援助。', serviceArea: '纽约市曼哈顿', transit: '乘坐 2/3 线到 Wall St.。', exit: '使用 Wall St 出口并向南步行。' },
HT: { servicesOffered: 'Sèvis legal sivil gratis, enkli asistans imigrasyon.', serviceArea: 'Manhattan, Vil New York', transit: 'Pran 2/3 a rive Wall St.', exit: 'Itilize sòti Wall St la epi mache ale sid.' },
AR: { servicesOffered: 'خدمات قانونية مدنية مجانية تشمل مساعدة الهجرة.', serviceArea: 'مانهاتن، مدينة نيويورك', transit: 'خذ القطار 2/3 إلى Wall St.', exit: 'استخدم مخرج Wall St وامشِ جنوبًا.' } },
'nyc-bronx-defenders': {
ES: { servicesOffered: 'Práctica de Defensa de Inmigración: combate la detención y la deportación; proveedor de representación universal de NYIFUP.', eligibility: 'Residentes del Bronx de bajos ingresos; atiende sin importar el estatus migratorio.', serviceArea: 'El Bronx, Ciudad de Nueva York', transit: 'Tome el 4/B/D hasta 161st-Yankee Stadium.', exit: 'Salida del frente del tren hacia Grand Concourse.' },
ZH: { servicesOffered: '移民辩护业务：抗争拘留和驱逐；NYIFUP 全民代理提供者。', eligibility: '布朗克斯低收入居民；无论移民身份均提供服务。', serviceArea: '纽约市布朗克斯', transit: '乘坐 4/B/D 线到 161st-Yankee Stadium。', exit: '从列车前部出口前往 Grand Concourse。' },
HT: { servicesOffered: 'Pratik Defans Imigrasyon: li goumen kont detansyon ak depòtasyon; founisè reprezantasyon inivèsèl NYIFUP.', eligibility: 'Rezidan Bronx ki gen revni ba; li sèvi kèlkeswa estati imigrasyon.', serviceArea: 'Bronx, Vil New York', transit: 'Pran 4/B/D a rive 161st-Yankee Stadium.', exit: 'Sòti devan tren an pou Grand Concourse.' },
AR: { servicesOffered: 'ممارسة الدفاع عن الهجرة: تحارب الاحتجاز والترحيل؛ مقدم تمثيل شامل تابع لـ NYIFUP.', eligibility: 'سكان برونكس ذوو الدخل المنخفض؛ يخدم بغض النظر عن وضع الهجرة.', serviceArea: 'برونكس، مدينة نيويورك', transit: 'خذ القطار 4/B/D إلى 161st-Yankee Stadium.', exit: 'مخرج مقدمة القطار إلى Grand Concourse.' } },
'nyc-minkwon': {
ES: { servicesOffered: 'Servicios legales de inmigración y defensa comunitaria.', serviceArea: 'Queens, Ciudad de Nueva York', transit: 'Tome el tren 7 hasta Flushing-Main St.', exit: 'Salga en Main St y camine hacia el sur.' },
ZH: { servicesOffered: '移民法律服务和社区倡导。', serviceArea: '纽约市皇后区', transit: '乘坐 7 线到 Flushing-Main St.。', exit: '在 Main St 出口下车并向南步行。' },
HT: { servicesOffered: 'Sèvis legal imigrasyon ak defans kominote.', serviceArea: 'Queens, Vil New York', transit: 'Pran tren 7 la rive Flushing-Main St.', exit: 'Sòti nan Main St epi mache ale sid.' },
AR: { servicesOffered: 'خدمات قانونية للهجرة ومناصرة مجتمعية.', serviceArea: 'كوينز، مدينة نيويورك', transit: 'خذ القطار 7 إلى Flushing-Main St.', exit: 'اخرج عند Main St وامشِ جنوبًا.' } },
'nyc-brooklyn-legal': {
ES: { servicesOffered: 'Servicios legales civiles gratuitos, incluida asistencia en inmigración.', serviceArea: 'Brooklyn, Ciudad de Nueva York', transit: 'Tome el 2/3/4/5 o la R hasta Borough Hall/Court St.', exit: 'Salga en Court St.' },
ZH: { servicesOffered: '免费民事法律服务，包括移民援助。', serviceArea: '纽约市布鲁克林', transit: '乘坐 2/3/4/5 或 R 线到 Borough Hall/Court St.。', exit: '在 Court St. 出口下车。' },
HT: { servicesOffered: 'Sèvis legal sivil gratis, enkli asistans imigrasyon.', serviceArea: 'Brooklyn, Vil New York', transit: 'Pran 2/3/4/5 oswa R a rive Borough Hall/Court St.', exit: 'Sòti nan Court St.' },
AR: { servicesOffered: 'خدمات قانونية مدنية مجانية تشمل مساعدة الهجرة.', serviceArea: 'بروكلين، مدينة نيويورك', transit: 'خذ القطار 2/3/4/5 أو R إلى Borough Hall/Court St.', exit: 'اخرج عند Court St.' } },
'nyc-project-hospitality': {
ES: { servicesOffered: 'Servicios comunitarios, incluida asistencia en inmigración.', serviceArea: 'Staten Island, Ciudad de Nueva York', transit: 'Tome el autobús S48/S98 hasta Richmond Terrace/Park Ave.', exit: 'Salga en Park Ave.' },
ZH: { servicesOffered: '社区服务，包括移民援助。', serviceArea: '纽约市斯塔滕岛', transit: '乘坐 S48/S98 巴士到 Richmond Terrace/Park Ave.。', exit: '在 Park Ave. 下车。' },
HT: { servicesOffered: 'Sèvis kominotè, enkli asistans imigrasyon.', serviceArea: 'Staten Island, Vil New York', transit: 'Pran bis S48/S98 a rive Richmond Terrace/Park Ave.', exit: 'Sòti nan Park Ave.' },
AR: { servicesOffered: 'خدمات مجتمعية تشمل مساعدة الهجرة.', serviceArea: 'جزيرة ستاتن، مدينة نيويورك', transit: 'خذ الحافلة S48/S98 إلى Richmond Terrace/Park Ave.', exit: 'اخرج عند Park Ave.' } },
'la-lafla': {
ES: { servicesOffered: 'Servicios legales de inmigración completos, incluida representación ante el Tribunal de Inmigración y la BIA.', eligibility: 'Residentes de bajos ingresos.', serviceArea: 'Condados de Los Ángeles y Orange' },
ZH: { servicesOffered: '全面的移民法律服务，包括在移民法院和 BIA 的代理。', eligibility: '低收入居民。', serviceArea: '洛杉矶县和橙县' },
HT: { servicesOffered: 'Sèvis legal imigrasyon konplè, enkli reprezantasyon devan Tribinal Imigrasyon ak BIA.', eligibility: 'Rezidan ki gen revni ba.', serviceArea: 'Konte Los Angeles ak Orange' },
AR: { servicesOffered: 'خدمات قانونية كاملة للهجرة تشمل التمثيل أمام محكمة الهجرة وBIA.', eligibility: 'السكان ذوو الدخل المنخفض.', serviceArea: 'مقاطعتا لوس أنجلوس وأورانج' } },
'la-advancing-justice': {
ES: { servicesOffered: 'Servicios de inmigración, incluida representación judicial: ajuste, DACA, peticiones familiares, naturalización, defensa contra deportación, T/U/VAWA.', serviceArea: 'Área de Los Ángeles' },
ZH: { servicesOffered: '移民服务，包括法院代理：调整身份、DACA、家庭申请、入籍、驱逐辩护、T/U/VAWA。', serviceArea: '洛杉矶地区' },
HT: { servicesOffered: 'Sèvis imigrasyon, enkli reprezantasyon nan tribinal: ajisteman, DACA, petisyon fanmi, natiralizasyon, defans depòtasyon, T/U/VAWA.', serviceArea: 'Zòn Los Angeles' },
AR: { servicesOffered: 'خدمات هجرة تشمل التمثيل أمام المحكمة: تعديل الوضع، DACA، التماسات الأسرة، التجنس، الدفاع ضد الترحيل، T/U/VAWA.', serviceArea: 'منطقة لوس أنجلوس' } },
'oh-cris': {
ES: { servicesOffered: 'Servicios legales de inmigración, incluida representación: asilo, peticiones familiares, naturalización, DACA, TPS, U/VAWA. Nota: CRIS actualmente no maneja casos ante el tribunal de inmigración.', serviceArea: 'Ohio central' },
ZH: { servicesOffered: '移民法律服务，包括代理：庇护、家庭申请、入籍、DACA、TPS、U/VAWA。注意：CRIS 目前不处理移民法院案件。', serviceArea: '俄亥俄州中部' },
HT: { servicesOffered: 'Sèvis legal imigrasyon, enkli reprezantasyon: azil, petisyon fanmi, natiralizasyon, DACA, TPS, U/VAWA. Nòt: CRIS pa trete ka tribinal imigrasyon kounye a.', serviceArea: 'Ohio santral' },
AR: { servicesOffered: 'خدمات قانونية للهجرة تشمل التمثيل: اللجوء، التماسات الأسرة، التجنس، DACA، TPS، U/VAWA. ملاحظة: لا تتعامل CRIS حاليًا مع قضايا محكمة الهجرة.', serviceArea: 'وسط أوهايو' } },
'oh-lasco': {
ES: { servicesOffered: 'Ayuda legal civil gratuita, incluidos asuntos relacionados con inmigración.', eligibility: 'Residentes de bajos ingresos y adultos mayores.', serviceArea: 'Condados de Franklin y Madison (oficina de Columbus)' },
ZH: { servicesOffered: '免费民事法律帮助，包括与移民相关的事务。', eligibility: '低收入居民和老年人。', serviceArea: '富兰克林县和麦迪逊县（哥伦布办公室）' },
HT: { servicesOffered: 'Èd legal sivil gratis, enkli zafè ki gen rapò ak imigrasyon.', eligibility: 'Rezidan ki gen revni ba ak granmoun aje.', serviceArea: 'Konte Franklin ak Madison (biwo Columbus)' },
AR: { servicesOffered: 'مساعدة قانونية مدنية مجانية تشمل مسائل متعلقة بالهجرة.', eligibility: 'السكان ذوو الدخل المنخفض وكبار السن.', serviceArea: 'مقاطعتا فرانكلين وماديسون (مكتب كولومبوس)' } },
'tx-catholic-charities-houston': {
ES: { servicesOffered: 'Servicios legales de inmigración completos, incluida representación ante el Tribunal de Inmigración.', serviceArea: 'Gran Houston / arquidiócesis de Galveston-Houston' },
ZH: { servicesOffered: '全面的移民法律服务，包括在移民法院的代理。', serviceArea: '大休斯顿地区 / 加尔维斯顿-休斯顿总教区' },
HT: { servicesOffered: 'Sèvis legal imigrasyon konplè, enkli reprezantasyon devan Tribinal Imigrasyon.', serviceArea: 'Gran Houston / achidyosèz Galveston-Houston' },
AR: { servicesOffered: 'خدمات قانونية كاملة للهجرة تشمل التمثيل أمام محكمة الهجرة.', serviceArea: 'هيوستن الكبرى / أبرشية غالفستون-هيوستن' } },
'tx-tahirih-houston': {
ES: { servicesOffered: 'Representación legal gratuita: asilo, VAWA, visas T/U, SIJS; además de servicios sociales.', eligibility: 'Sobrevivientes inmigrantes de violencia de género (principalmente mujeres y niñas). No son servicios generales de inmigración.', serviceArea: 'Área de Houston' },
ZH: { servicesOffered: '免费法律代理：庇护、VAWA、T/U 签证、SIJS；另有社会服务。', eligibility: '基于性别的暴力移民幸存者（主要是妇女和女孩）。不是一般移民服务。', serviceArea: '休斯顿地区' },
HT: { servicesOffered: 'Reprezantasyon legal gratis: azil, VAWA, viza T/U, SIJS; plis sèvis sosyal.', eligibility: 'Sivivan imigran vyolans ki baze sou sèks (pwensipalman fanm ak tifi). Se pa sèvis imigrasyon jeneral.', serviceArea: 'Zòn Houston' },
AR: { servicesOffered: 'تمثيل قانوني مجاني: اللجوء، VAWA، تأشيرات T/U، SIJS؛ بالإضافة إلى خدمات اجتماعية.', eligibility: 'الناجيات المهاجرات من العنف القائم على النوع الاجتماعي (بشكل أساسي النساء والفتيات). ليست خدمات هجرة عامة.', serviceArea: 'منطقة هيوستن' } },
'fl-ai-justice': {
ES: { servicesOffered: 'Servicios legales directos gratuitos: asilo, menores no acompañados, sobrevivientes de trata/violencia doméstica, detención.', eligibility: 'Inmigrantes de bajos ingresos.', serviceArea: 'Condados de Miami-Dade y Broward' },
ZH: { servicesOffered: '免费直接法律服务：庇护、无人陪伴儿童、贩运/家庭暴力幸存者、拘留。', eligibility: '低收入移民。', serviceArea: '迈阿密-戴德县和布劳沃德县' },
HT: { servicesOffered: 'Sèvis legal dirèk gratis: azil, timoun ki pa akonpaye, sivivan trafik/vyolans domestik, detansyon.', eligibility: 'Imigran ki gen revni ba.', serviceArea: 'Konte Miami-Dade ak Broward' },
AR: { servicesOffered: 'خدمات قانونية مباشرة مجانية: اللجوء، الأطفال غير المصحوبين، الناجون من الاتجار/العنف الأسري، الاحتجاز.', eligibility: 'المهاجرون ذوو الدخل المنخفض.', serviceArea: 'مقاطعتا ميامي-ديد وبراورد' } },
'fl-ccls-miami': {
ES: { servicesOffered: 'Servicios de inmigración pro bono/de bajo costo, incluida representación ante USCIS, tribunales de inmigración y la BIA.', serviceArea: 'Condados de Broward, Miami-Dade y Monroe' },
ZH: { servicesOffered: '无偿/低费用移民服务，包括在 USCIS、移民法院和 BIA 的代理。', serviceArea: '布劳沃德县、迈阿密-戴德县和门罗县' },
HT: { servicesOffered: 'Sèvis imigrasyon pro bono/ti pri, enkli reprezantasyon devan USCIS, Tribinal Imigrasyon, ak BIA.', serviceArea: 'Konte Broward, Miami-Dade, ak Monroe' },
AR: { servicesOffered: 'خدمات هجرة مجانية/منخفضة التكلفة تشمل التمثيل أمام USCIS ومحاكم الهجرة وBIA.', serviceArea: 'مقاطعات براورد وميامي-ديد ومونرو' } },
'il-nijc': {
ES: { servicesOffered: 'Servicios legales de inmigración de bajo costo/gratuitos, incluida representación completa: asilo, SIJS, defensa contra deportación, VAWA/U/T, DACA, peticiones familiares, TPS, naturalización; mesa de ayuda gratuita del Tribunal de Inmigración.', eligibility: 'Inmigrantes de bajos ingresos; los residentes de Chicago pueden recibir servicios gratuitos a través del Fondo de Protección Legal de la Ciudad.', serviceArea: 'Illinois e Indiana' },
ZH: { servicesOffered: '低费用/免费移民法律服务，包括全面代理：庇护、SIJS、驱逐辩护、VAWA/U/T、DACA、家庭申请、TPS、入籍；免费移民法院帮助台。', eligibility: '低收入移民；芝加哥居民可通过城市法律保护基金获得免费服务。', serviceArea: '伊利诺伊州和印第安纳州' },
HT: { servicesOffered: 'Sèvis legal imigrasyon ti pri/gratis, enkli reprezantasyon konplè: azil, SIJS, defans depòtasyon, VAWA/U/T, DACA, petisyon fanmi, TPS, natiralizasyon; Biwo Èd Tribinal Imigrasyon gratis.', eligibility: 'Imigran ki gen revni ba; rezidan Chicago ka jwenn sèvis gratis atravè Fon Pwoteksyon Legal Vil la.', serviceArea: 'Illinois ak Indiana' },
AR: { servicesOffered: 'خدمات قانونية للهجرة منخفضة التكلفة/مجانية تشمل تمثيلًا كاملًا: اللجوء، SIJS، الدفاع ضد الترحيل، VAWA/U/T، DACA، التماسات الأسرة، TPS، التجنس؛ مكتب مساعدة مجاني لمحكمة الهجرة.', eligibility: 'المهاجرون ذوو الدخل المنخفض؛ يمكن لسكان شيكاغو الحصول على خدمات مجانية عبر صندوق الحماية القانونية للمدينة.', serviceArea: 'إلينوي وإنديانا' } },
'il-resurrection-project': {
ES: { servicesOffered: 'Servicios legales de inmigración, incluida representación judicial: familiares, DACA, TPS, naturalización, defensa contra deportación, U/T/VAWA/SIJS/asilo.', serviceArea: 'Área de Chicago' },
ZH: { servicesOffered: '移民法律服务，包括法院代理：家庭类、DACA、TPS、入籍、驱逐辩护、U/T/VAWA/SIJS/庇护。', serviceArea: '芝加哥地区' },
HT: { servicesOffered: 'Sèvis legal imigrasyon, enkli reprezantasyon nan tribinal: fanmi, DACA, TPS, natiralizasyon, defans depòtasyon, U/T/VAWA/SIJS/azil.', serviceArea: 'Zòn Chicago' },
AR: { servicesOffered: 'خدمات قانونية للهجرة تشمل التمثيل أمام المحكمة: الأسرة، DACA، TPS، التجنس، الدفاع ضد الترحيل، U/T/VAWA/SIJS/اللجوء.', serviceArea: 'منطقة شيكاغو' } },
'ga-gain': {
ES: { servicesOffered: 'Servicios legales de inmigración gratuitos, incluida representación directa: asilo, visas U/T, VAWA; reclutamiento y capacitación de abogados pro bono.', eligibility: 'SOLO solicitantes de asilo y sobrevivientes inmigrantes de delitos/persecución. No son servicios generales de inmigración.', serviceArea: 'Georgia (todo el estado)' },
ZH: { servicesOffered: '免费移民法律服务，包括直接代理：庇护、U/T 签证、VAWA；无偿律师招募和培训。', eligibility: '仅限庇护申请者和犯罪/迫害的移民幸存者。不是一般移民服务。', serviceArea: '佐治亚州（全州）' },
HT: { servicesOffered: 'Sèvis legal imigrasyon gratis, enkli reprezantasyon dirèk: azil, viza U/T, VAWA; rekritman ak fòmasyon avoka pro bono.', eligibility: 'SÈLMAN moun k ap chèche azil ak sivivan imigran krim/pèsekisyon. Se pa sèvis imigrasyon jeneral.', serviceArea: 'Georgia (tout eta a)' },
AR: { servicesOffered: 'خدمات قانونية مجانية للهجرة تشمل تمثيلًا مباشرًا: اللجوء، تأشيرات U/T، VAWA؛ تجنيد وتدريب المحامين المتطوعين.', eligibility: 'طالبو اللجوء والناجون المهاجرون من الجريمة/الاضطهاد فقط. ليست خدمات هجرة عامة.', serviceArea: 'جورجيا (على مستوى الولاية)' } },
'ga-laa': {
ES: { servicesOffered: 'Servicios legales de inmigración asequibles: familiares, ajuste, proceso consular, DACA, TPS, naturalización, permisos de trabajo, VAWA, defensa contra deportación de no detenidos.', eligibility: 'Excluye visas de empleo/estudiante/turista y casos de detenidos.', serviceArea: 'Área de Atlanta' },
ZH: { servicesOffered: '价格合理的移民法律服务：家庭类、调整身份、领事处理、DACA、TPS、入籍、工作许可、VAWA、未拘留驱逐辩护。', eligibility: '不包括就业/学生/旅游签证和被拘留案件。', serviceArea: '亚特兰大地区' },
HT: { servicesOffered: 'Sèvis legal imigrasyon abòdab: fanmi, ajisteman, pwosesis konsila, DACA, TPS, natiralizasyon, pèmi travay, VAWA, defans depòtasyon pou moun ki pa nan detansyon.', eligibility: 'Li pa enkli viza travay/etidyan/touris ak ka detansyon.', serviceArea: 'Zòn Atlanta' },
AR: { servicesOffered: 'خدمات قانونية للهجرة بأسعار معقولة: الأسرة، تعديل الوضع، المعالجة القنصلية، DACA، TPS، التجنس، تصاريح العمل، VAWA، الدفاع ضد ترحيل غير المحتجزين.', eligibility: 'يستثني تأشيرات العمل/الدراسة/السياحة وقضايا المحتجزين.', serviceArea: 'منطقة أتلانتا' } },
'nyc-bronx-legal-services': {
ES: { servicesOffered: 'Servicios legales civiles gratuitos; Unidad de Familia e Inmigración: visas U/T, VAWA, SIJS, asilo, defensa contra deportación, peticiones familiares, naturalización.', eligibility: 'Residentes del condado del Bronx de bajos ingresos.', serviceArea: 'Condado del Bronx' },
ZH: { servicesOffered: '免费民事法律服务；家庭与移民部门：U/T 签证、VAWA、SIJS、庇护、驱逐辩护、家庭申请、入籍。', eligibility: '布朗克斯县低收入居民。', serviceArea: '布朗克斯县' },
HT: { servicesOffered: 'Sèvis legal sivil gratis; Inite Fanmi ak Imigrasyon: viza U/T, VAWA, SIJS, azil, defans depòtasyon, petisyon fanmi, natiralizasyon.', eligibility: 'Rezidan Konte Bronx ki gen revni ba.', serviceArea: 'Konte Bronx' },
AR: { servicesOffered: 'خدمات قانونية مدنية مجانية؛ وحدة الأسرة والهجرة: تأشيرات U/T، VAWA، SIJS، اللجوء، الدفاع ضد الترحيل، التماسات الأسرة، التجنس.', eligibility: 'سكان مقاطعة برونكس ذوو الدخل المنخفض.', serviceArea: 'مقاطعة برونكس' } },
};

export const NATIONAL_I18N: Record<string, Partial<Record<I18nLang, string>>> = {
'ImmigrationLawHelp.org': {
ES: 'Directorio Nacional de Servicios Legales de Inmigración — busque más de 1,000 proveedores sin fines de lucro de servicios legales de inmigración por código postal.',
ZH: '全国移民法律服务目录——按邮政编码搜索 1,000 多家非营利移民法律服务提供者。',
HT: 'Anyè Nasyonal Sèvis Legal Imigrasyon — chèche plis pase 1,000 founisè sèvis legal imigrasyon san bi likratif pa kòd postal.',
AR: 'الدليل الوطني لخدمات الهجرة القانونية — ابحث في أكثر من 1,000 مقدم خدمات قانونية غير ربحي للهجرة حسب الرمز البريدي.' },
'DOJ Recognized Organizations & Accredited Representatives': {
ES: 'Lista del Departamento de Justicia de EE. UU. de organizaciones reconocidas y representantes acreditados (dominio público). EOIR no respalda a las organizaciones listadas.',
ZH: '美国司法部认可组织和认可代表名单（公共领域）。EOIR 不对所列组织作背书。',
HT: 'Lis Depatman Jistis Etazini òganizasyon rekonèt ak reprezantan akredite (domèn piblik). EOIR pa andose òganizasyon ki liste yo.',
AR: 'قائمة وزارة العدل الأمريكية للمنظمات المعترف بها والممثلين المعتمدين (المجال العام). لا تؤيد EOIR المنظمات المدرجة.' },
'LawHelp.org': {
ES: 'Directorio estado por estado de proveedores gratuitos de ayuda legal.',
ZH: '按州列出的免费法律援助提供者目录。',
HT: 'Anyè eta pa eta founisè èd legal gratis.',
AR: 'دليل حسب الولاية لمقدمي المساعدة القانونية المجانية.' },
};

/** The org's IRU explanatory prose in `lang` (EN original when absent). */
export function localizedResourceText(org: ResourceOrg, field: 'servicesOffered' | 'eligibility' | 'serviceArea' | 'transit' | 'exit', lang: string): string {
  const en = (org as any)[field] as string | undefined;
  if (!lang || lang === 'EN') return en || '';
  const tr = RESOURCE_I18N[org.id]?.[lang as I18nLang];
  return (tr && tr[field]) || en || '';
}

export function localizedNationalDescription(dir: NationalDirectory, lang: string): string {
  if (!lang || lang === 'EN') return dir.description;
  return NATIONAL_I18N[dir.name]?.[lang as I18nLang] || dir.description;
}

/** All organizations in the dataset (for tests and auditing). */
export function getAllOrgs(): ResourceOrg[] {
  return [...ALL_ORGS];
}
