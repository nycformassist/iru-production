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
  const clean = String(zip || '').trim();
  const prefix = clean.substring(0, 3);
  const isNycCoverage = NYC_PREFIXES.includes(prefix);

  const matched = prefix
    ? ALL_ORGS.filter((org) => org.zipPrefixes.includes(prefix))
    : [];
  const local = matched.filter((org) => org.layer === 'local');
  const statewide = matched.filter((org) => org.layer === 'statewide');

  return {
    local,
    statewide,
    national: buildNationalDirectories(clean),
    fallback: matched.length === 0,
    isNycCoverage,
    prefix,
  };
}

/** All organizations in the dataset (for tests and auditing). */
export function getAllOrgs(): ResourceOrg[] {
  return [...ALL_ORGS];
}
