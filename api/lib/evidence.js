/**
 * lib/evidence.js — Evidence states, knowledge base, and gap engine.
 *
 * This module is the server-side source of truth for how IRU talks about
 * evidence. It encodes one core principle:
 *
 *   A missing primary document triggers alternative-evidence analysis —
 *   never an automatic dead end, and never an unsupported declaration
 *   that the requirement is satisfied ("ready").
 *
 * Pure functions only (no I/O, no secrets). Fully unit-testable.
 * The frontend imports the state labels/KB read-only for packet rendering;
 * the authoritative resolution happens here.
 */

/** All states an evidence item can be in. Nothing here means "verified"
 *  unless an actual verification process ran (see INDEPENDENTLY_VERIFIED). */
export const EVIDENCE_STATES = Object.freeze({
  /** Applicant says they have the primary; IRU has not seen it. */
  REPORTED_NOT_VERIFIED: 'reported-not-verified',
  /** An alternative was suggested; the applicant has not obtained it. */
  SUGGESTED_NOT_OBTAINED: 'suggested-not-obtained',
  /** Applicant reports having an alternative; not obtained/reviewed.
   *  MUST NEVER be rendered as ready. */
  ALTERNATIVE_IDENTIFIED: 'alternative-identified',
  /** Primary missing and no alternative identified yet. */
  ACTION_REQUIRED: 'action-required',
  /** Applicant doesn't know / not applicable. */
  UNKNOWN: 'unknown',
  /** Item needs qualified human/legal review (e.g. persecutor nexus,
   *  court disposition questions). */
  LEGAL_REVIEW_REQUIRED: 'legal-review-required',
  /** RESERVED. Only set where an actual verification process ran.
   *  No current IRU flow sets this. */
  INDEPENDENTLY_VERIFIED: 'independently-verified',
  /** RESERVED for the upload-review flow: reviewed content supports a
   *  stated fact to a stated limited extent; authenticity NOT established. */
  REVIEWED_SUPPORTS_LIMITED: 'reviewed-supports-limited',
});

/** The 9 evidence checklist keys (matches privacy.js EVIDENCE_FLAGS). */
export const EVIDENCE_KEYS = Object.freeze([
  'has_passport',
  'has_i94',
  'has_lease',
  'has_persecution_proof',
  'has_green_card',
  'has_tax_transcripts',
  'has_marriage_cert',
  'has_proof_of_relationship',
  'has_arrests',
]);

/**
 * Resolve the state of a PRIMARY evidence item.
 *
 * @param {string} primaryAnswer 'yes' | 'no' | 'unknown' (anything else → 'unknown')
 * @param {Record<string,string>} proxyAnswers map of proxy item id → 'yes'|'no'
 * @returns {string} one of EVIDENCE_STATES
 *
 * Rules (no exceptions):
 * - "yes" to primary → reported-not-verified (NOT verified, NOT ready)
 * - "no" + ≥1 proxy "yes" → primary stays action-required
 * - "no" + no proxies → action-required
 * - "unknown" → unknown
 */
export function resolveState(primaryAnswer, proxyAnswers = {}) {
  if (primaryAnswer === 'yes') return EVIDENCE_STATES.REPORTED_NOT_VERIFIED;
  if (primaryAnswer === 'no') {
    const anyProxyYes = Object.values(proxyAnswers || {}).some(v => v === 'yes');
    // Primary is still missing regardless of alternatives.
    return EVIDENCE_STATES.ACTION_REQUIRED;
  }
  return EVIDENCE_STATES.UNKNOWN;
}

/** Resolve the state of a single PROXY/alternative item. */
export function resolveProxyState(proxyAnswer) {
  if (proxyAnswer === 'yes') return EVIDENCE_STATES.ALTERNATIVE_IDENTIFIED;
  return EVIDENCE_STATES.ACTION_REQUIRED;
}

/**
 * Keys whose subject matter requires qualified legal review as a matter of
 * course (not just when something looks wrong). The directive requires this
 * for the religious-identity/persecutor nexus and court-disposition questions.
 */
const LEGAL_REVIEW_KEYS = {
  has_persecution_proof:
    'Harm/persecution evidence and the connection between a protected ground ' +
    '(e.g. religion) and the alleged persecutor require qualified legal assessment.',
  has_arrests:
    'Criminal history and the final disposition of each arrest can affect ' +
    'eligibility. Always disclose arrests to a qualified attorney; do not ' +
    'interpret dispositions without counsel.',
};

export function requiresLegalReview(key) {
  return Object.prototype.hasOwnProperty.call(LEGAL_REVIEW_KEYS, key);
}

export function legalReviewReason(key) {
  return LEGAL_REVIEW_KEYS[key] || null;
}

/**
 * EVIDENCE_KB — alternative-evidence knowledge base.
 *
 * For each evidence key:
 * - targetFact: what fact/requirement is at issue
 * - primaryEvidence: what would ordinarily address it
 * - alternatives: [{ id, label, supports, limitations, availability,
 *     acquisition, safety, reviewNeeded }]
 *
 * `supports` = what the alternative CAN help establish.
 * `limitations` = what it CANNOT establish by itself.
 * These distinctions are mandatory and covered by regression tests:
 * birth certificate ≠ passport; dated US photo/clinic receipt ≠ entry
 * date/manner; landlord letter ≠ lease; court notice ≠ disposition;
 * country conditions ≠ individual proof; absence of corroboration ≠ disproof.
 *
 * Alternative ids match the frontend PROXIES item ids (proxy_*), so the
 * applicant's self-reported selections map 1:1 to KB entries.
 */
export const EVIDENCE_KB = Object.freeze({
  has_passport: {
    targetFact: 'Identity and nationality — who the applicant is and their country of citizenship.',
    primaryEvidence: 'Valid passport issued by the country of origin.',
    alternatives: [
      {
        id: 'proxy_passport_1', label: 'Consular ID (Matrícula)',
        supports: 'Identity and nationality as recorded by the issuing consulate.',
        limitations: 'Does not establish that a passport exists or was ever issued; acceptance varies by adjudicator and benefit type.',
        availability: 'obtainable', acquisition: 'Apply at the country-of-origin consulate serving the applicant\u2019s area; typically requires proof of nationality and a fee.',
        safety: 'Consulate contact is generally low-risk, but applicants with pending enforcement matters should discuss timing with counsel first.',
        reviewNeeded: 'Confirm the ID is current and the name matches other records.',
      },
      {
        id: 'proxy_passport_2', label: 'Birth Certificate',
        supports: 'Biographical facts: name, date and place of birth, and parentage as recorded at registration.',
        limitations: 'Does NOT establish that a passport exists or was ever issued. A birth certificate is not a travel document.',
        availability: 'varies', acquisition: 'Request from the civil registry of the place of birth; if unavailable, document the attempt (see 8 CFR 103.2(b)(2)).',
        safety: 'Requesting records from the home country can expose family members still there. Use mail intermediaries or counsel where risk exists.',
        reviewNeeded: 'Check whether the registry entry is contemporaneous or a late registration; note which.',
      },
      {
        id: 'proxy_passport_3', label: 'National ID Card',
        supports: 'Identity as recorded by the issuing national authority.',
        limitations: 'Does not establish passport issuance and may not be accepted as primary identity proof for every benefit.',
        availability: 'varies', acquisition: 'Issued by the home-country civil authority; replacements usually require an in-person or consular application.',
        safety: 'Same home-country contact caution as birth records.',
        reviewNeeded: 'Verify expiry date and that biographical details match other documents.',
      },
    ],
  },
  has_i94: {
    targetFact: 'Admission to the United States — when and how the applicant entered.',
    primaryEvidence: 'I-94 Arrival/Departure Record (retrievable at i94.cbp.dhs.gov for recent lawful entries).',
    alternatives: [
      {
        id: 'proxy_i94_1', label: 'Travel Tickets / Boarding Passes',
        supports: 'A travel itinerary consistent with the claimed route and approximate timing of entry.',
        limitations: 'Do not establish lawful admission, the exact entry date, or the manner of entry.',
        availability: 'obtainable', acquisition: 'Airline or travel-agent records, email confirmations, frequent-flyer history.',
        safety: 'Low risk; these are the applicant\u2019s own records.',
        reviewNeeded: 'Check that names, dates, and routes are internally consistent.',
      },
      {
        id: 'proxy_i94_2', label: 'Dated Photos in the US',
        supports: 'Physical presence in the United States at or around the date associated with the photo.',
        limitations: 'Do NOT establish the exact entry date or the manner of entry. Photo dates can be wrong or missing.',
        availability: 'obtainable', acquisition: 'Phone camera roll, cloud photo backups, social media archives — preserve originals with metadata where possible.',
        safety: 'Review photos for other people who may not consent to being identified; do not share publicly.',
        reviewNeeded: 'Confirm the date source (metadata vs. guess) and location cues visible in the image.',
      },
      {
        id: 'proxy_i94_3', label: 'Clinic or Hospital Receipts',
        supports: 'Presence in the United States on the date of service.',
        limitations: 'Do not establish the entry date or manner of entry.',
        availability: 'obtainable', acquisition: 'Request itemized receipts or visit summaries from the provider\u2019s medical-records office.',
        safety: 'Medical records are sensitive; share only with counsel or as required, with HIPAA-compliant handling.',
        reviewNeeded: 'Confirm the service date and that the record belongs to the applicant.',
      },
    ],
  },
  has_lease: {
    targetFact: 'Physical residence at a US address (where the applicant lives).',
    primaryEvidence: 'Formal written lease agreement for the applicant\u2019s residence.',
    alternatives: [
      {
        id: 'proxy_lease_1', label: 'School Records',
        supports: 'Residence-linked enrollment tying the applicant (or their child) to an address and date range.',
        limitations: 'Do not establish a formal lease or the applicant\u2019s own tenancy.',
        availability: 'obtainable', acquisition: 'Request enrollment verification from the school registrar.',
        safety: 'Low risk; the applicant\u2019s own records.',
        reviewNeeded: 'Check the address and enrollment dates shown.',
      },
      {
        id: 'proxy_lease_2', label: 'Notarized Letter from Landlord/Roommate',
        supports: 'Residence facts (address, dates, rent arrangement) as attested firsthand by the writer.',
        limitations: 'Does NOT establish a formal lease. Weight depends on the writer\u2019s specificity, credibility, and firsthand knowledge.',
        availability: 'obtainable', acquisition: 'Ask the landlord or roommate for a dated, signed letter stating address, move-in date, and rent terms; notarization adds formality but not legal sufficiency.',
        safety: 'The writer\u2019s immigration status or housing situation may make them reluctant; do not pressure anyone.',
        reviewNeeded: 'Confirm the writer\u2019s relationship to the applicant and that details are specific, not generic.',
      },
      {
        id: 'proxy_lease_3', label: 'Utility Bill',
        supports: 'Residence at the service address during the billing period, in the account holder\u2019s name.',
        limitations: 'Does not establish a formal lease, and means little if the account is not in the applicant\u2019s name.',
        availability: 'obtainable', acquisition: 'Utility provider online account or customer-service records request.',
        safety: 'Low risk; the applicant\u2019s own records.',
        reviewNeeded: 'Confirm the name on the account and the service address/dates.',
      },
    ],
  },
  has_persecution_proof: {
    targetFact: 'Harm or persecution suffered (or feared), and its connection to a protected ground such as religion, race, nationality, political opinion, or membership in a particular social group.',
    primaryEvidence: 'Direct evidence of the harm: police reports, medical records of injuries, photographs, written threats, detention records.',
    alternatives: [
      {
        id: 'proxy_persecution_1', label: 'Witness Letters',
        supports: 'Corroboration of events the writer personally saw or experienced.',
        limitations: 'Do not by themselves prove legal eligibility; weight depends on specificity, firsthand knowledge, and credibility. They support the account — they do not decide the case.',
        availability: 'varies', acquisition: 'Ask witnesses with direct personal knowledge for dated, signed statements describing what they saw, when, and where.',
        safety: 'Witnesses in the home country may face retaliation. Never ask anyone to take risks; discuss witness safety with counsel before requesting anything from abroad.',
        reviewNeeded: 'Confirm firsthand (not hearsay) knowledge and specific dates/places.',
      },
      {
        id: 'proxy_persecution_2', label: 'Medical Records',
        supports: 'Injuries or treatment consistent with the claimed harm, with dates.',
        limitations: 'Do not by themselves establish who caused the harm or why it happened.',
        availability: 'obtainable', acquisition: 'Request treatment records from the clinic or hospital records office, in the US or abroad.',
        safety: 'Medical records are sensitive; limit sharing to counsel and required filings. Obtaining records from the home country may expose the applicant\u2019s location or contacts.',
        reviewNeeded: 'Check that diagnoses/dates are consistent with the account; note what the records do not say.',
      },
      {
        id: 'proxy_persecution_3', label: 'News Articles / Country Conditions',
        supports: 'Context: that the type of harm claimed is reported against people like the applicant (e.g. religious minorities) in the country.',
        limitations: 'Do NOT prove that the applicant personally experienced the event. Country-condition evidence provides context — it is not individual proof.',
        availability: 'obtainable', acquisition: 'Reputable reporting (major outlets, human-rights organizations, US State Department country reports) dated near the relevant events.',
        safety: 'No personal risk in gathering public reporting.',
        reviewNeeded: 'Confirm the reporting actually concerns the applicant\u2019s group, region, and time period — not just the country in general.',
      },
    ],
  },
  has_green_card: {
    targetFact: 'Lawful permanent resident status in the United States.',
    primaryEvidence: 'Permanent Resident Card (Form I-551, "Green Card").',
    alternatives: [
      {
        id: 'proxy_greencard_1', label: 'I-551 Stamp in Passport',
        supports: 'Temporary evidence of lawful permanent resident status, valid for the period the stamp covers.',
        limitations: 'Expires; does not replace the card and is not accepted indefinitely.',
        availability: 'obtainable', acquisition: 'USCIS field-office appointment (InfoPass/ADIT stamp) if the card is lost or expired.',
        safety: 'Low risk; obtained directly from USCIS.',
        reviewNeeded: 'Check the stamp\u2019s validity dates.',
      },
      {
        id: 'proxy_greencard_2', label: 'USCIS Approval Notice (I-797)',
        supports: 'That USCIS approved the underlying immigrant petition or adjustment application.',
        limitations: 'Is not proof of current status by itself; it shows an approval, not the card.',
        availability: 'obtainable', acquisition: 'Applicant\u2019s own records; replacements via USCIS request.',
        safety: 'Low risk; the applicant\u2019s own records.',
        reviewNeeded: 'Confirm the notice relates to the applicant and the correct benefit.',
      },
      {
        id: 'proxy_greencard_3', label: 'Copy of Lost Green Card',
        supports: 'That a card was issued (front/back copy shows the number and dates).',
        limitations: 'A copy is not valid proof of status. File Form I-90 to replace a lost card.',
        availability: 'obtainable', acquisition: 'Applicant\u2019s own files; then file I-90 for a replacement.',
        safety: 'Low risk.',
        reviewNeeded: 'Confirm the copy is legible and matches the applicant\u2019s identity.',
      },
    ],
  },
  has_tax_transcripts: {
    targetFact: 'Tax compliance and, depending on the benefit, continuous residence or good moral character.',
    primaryEvidence: 'IRS tax return transcripts covering the required years (typically 3–5).',
    alternatives: [
      {
        id: 'proxy_tax_1', label: 'W-2 or 1099 Forms',
        supports: 'Reported earnings, employer, and tax year for the forms provided.',
        limitations: 'Do not establish that returns were actually filed or that taxes were paid in full.',
        availability: 'obtainable', acquisition: 'Employer payroll departments or the applicant\u2019s own records; IRS wage-and-income transcripts as a backup.',
        safety: 'Low risk; the applicant\u2019s own records.',
        reviewNeeded: 'Confirm the tax years covered and that names/SSN match.',
      },
      {
        id: 'proxy_tax_2', label: 'Pay Stubs',
        supports: 'Employment and earnings over the specific pay periods shown.',
        limitations: 'Cover only a limited window; they are not tax records and do not show filing compliance.',
        availability: 'obtainable', acquisition: 'Employer payroll system or the applicant\u2019s own records.',
        safety: 'Low risk.',
        reviewNeeded: 'Note the date range; a few stubs do not cover years.',
      },
      {
        id: 'proxy_tax_3', label: 'Bank Statements',
        supports: 'Financial activity (deposits, transfers) consistent with residence and employment over the statement period.',
        limitations: 'Do not establish tax compliance or filing.',
        availability: 'obtainable', acquisition: 'Bank online portal or branch records request.',
        safety: 'Bank statements reveal extensive personal detail; share only what counsel needs.',
        reviewNeeded: 'Confirm the account holder and statement dates.',
      },
    ],
  },
  has_marriage_cert: {
    targetFact: 'A legally recognized marital relationship.',
    primaryEvidence: 'Civil marriage certificate issued by the competent government authority.',
    alternatives: [
      {
        id: 'proxy_marriage_1', label: 'Religious Marriage Certificate',
        supports: 'That a religious marriage ceremony took place, with date and officiant.',
        limitations: 'May not establish a legally recognized marriage, depending on the jurisdiction and whether civil registration followed.',
        availability: 'varies', acquisition: 'The religious institution that performed the ceremony.',
        safety: 'Low risk; consider whether disclosure of religious affiliation creates risk in the applicant\u2019s context and discuss with counsel.',
        reviewNeeded: 'Confirm whether a civil registration exists separately.',
      },
      {
        id: 'proxy_marriage_2', label: 'Birth Certificates of Children Together',
        supports: 'Shared parentage of the listed children.',
        limitations: 'Do not establish that a legal marriage exists.',
        availability: 'varies', acquisition: 'Civil registry of the place of birth.',
        safety: 'Children\u2019s records are sensitive; share minimally.',
        reviewNeeded: 'Confirm both parents are named as claimed.',
      },
      {
        id: 'proxy_marriage_3', label: 'Affidavits from Family/Friends',
        supports: 'That people with personal knowledge observed the couple\u2019s relationship over time.',
        limitations: 'Generally treated as weaker (tertiary) evidence. Under 8 CFR 103.2(b)(2), affidavits are accepted only after showing primary and secondary evidence are unavailable — explain the unavailability in writing.',
        availability: 'obtainable', acquisition: 'Dated, signed statements from non-parties with direct personal knowledge, describing specific observations (not conclusions).',
        safety: 'Affiants should understand they are signing under penalty of perjury.',
        reviewNeeded: 'Confirm firsthand knowledge and specific facts, not generic praise.',
      },
    ],
  },
  has_proof_of_relationship: {
    targetFact: 'That the claimed family relationship is bona fide (genuine), not entered into for immigration purposes.',
    primaryEvidence: 'Direct proof: joint bank accounts, photos together over time, joint lease, children\u2019s records, shared insurance.',
    alternatives: [
      {
        id: 'proxy_relationship_1', label: 'Joint Lease or Utility Bills',
        supports: 'A shared household at the same address over the covered period.',
        limitations: 'Do not by themselves prove the relationship is bona fide.',
        availability: 'obtainable', acquisition: 'Landlord, property manager, or utility provider records.',
        safety: 'Low risk; the applicant\u2019s own records.',
        reviewNeeded: 'Confirm both names appear and the dates overlap the claimed relationship period.',
      },
      {
        id: 'proxy_relationship_2', label: 'Remittance Receipts',
        supports: 'A pattern of financial support/transfers between the parties.',
        limitations: 'Do not establish the nature of the relationship (support can exist between non-spouses).',
        availability: 'obtainable', acquisition: 'Money-transfer service history or bank transfer records.',
        safety: 'Low risk; reveals financial detail — share minimally.',
        reviewNeeded: 'Confirm sender, recipient, amounts, and regularity.',
      },
      {
        id: 'proxy_relationship_3', label: 'Communication Logs (WhatsApp, Emails)',
        supports: 'Ongoing contact and the texture of the relationship over time.',
        limitations: 'Content and context matter; logs alone do not prove bona fides, and selective excerpts can mislead.',
        availability: 'obtainable', acquisition: 'Export chat histories; preserve originals with dates.',
        safety: 'Message content can be deeply personal; the applicant should review everything before sharing and redact unrelated private material.',
        reviewNeeded: 'Confirm the participants\u2019 identities and that excerpts are representative, not cherry-picked.',
      },
    ],
  },
  has_arrests: {
    targetFact: 'Complete criminal history and the final disposition (outcome) of each arrest.',
    primaryEvidence: 'Certificate of Disposition for each arrest, from the criminal court where the case was heard.',
    alternatives: [
      {
        id: 'proxy_arrests_1', label: 'Rap Sheet (Criminal History Record)',
        supports: 'A compiled record of arrests and charges as reported by law-enforcement databases.',
        limitations: 'May be incomplete or inaccurate, and does not establish the final disposition of any case.',
        availability: 'obtainable', acquisition: 'FBI Identity History Summary or state repository request (fingerprints usually required).',
        safety: 'Requesting one\u2019s own record is low-risk, but the results must go straight to counsel — do not post or share them.',
        reviewNeeded: 'Compare against the applicant\u2019s account; flag discrepancies for counsel.',
      },
      {
        id: 'proxy_arrests_2', label: 'Court Appearance Notices',
        supports: 'That a court date existed for a given case and charge.',
        limitations: 'Do NOT establish the final disposition. A notice of appearance is not a certificate of disposition — the outcome must still be obtained from the court.',
        availability: 'obtainable', acquisition: 'Applicant\u2019s own records or the court clerk\u2019s office.',
        safety: 'Low risk.',
        reviewNeeded: 'Confirm the case number matches the arrest in question.',
      },
      {
        id: 'proxy_arrests_3', label: 'Letters from Previous Defense Attorney',
        supports: 'The attorney\u2019s professional account of how the case ended.',
        limitations: 'Not a substitute for the official court disposition record.',
        availability: 'varies', acquisition: 'Contact the former attorney\u2019s office and request a letter summarizing the disposition.',
        safety: 'Attorney-client privilege may limit what a former attorney can disclose; the applicant may need to waive privilege in writing for this purpose.',
        reviewNeeded: 'Confirm the letter addresses the specific case and outcome.',
      },
    ],
  },
});

import { matchReviewsToGap } from './vision.js';

/**
 * Build structured gap records for every evidence key the applicant did not
 * answer "yes" to. Each record has the 10 directive fields. Alternatives come
 * ONLY from EVIDENCE_KB — the engine never invents documents, dates, events,
 * witnesses, or corroboration.
 *
 * @param {object} min minimized model payload ({ evidence: {key: 'yes'|'no'|'unknown'} })
 * @param {Array} imageReviews validated image-review findings (from lib/vision.js
 *   validateImageReviews). Reviews whose relatedReadinessItem matches a gap key
 *   are attached as unverified observations. They refine guidance only — they
 *   NEVER change an evidence state and NEVER set INDEPENDENTLY_VERIFIED.
 * @returns {Array} gap records
 */
export function buildGapRecords(min, imageReviews = []) {
  const evidence = (min && min.evidence) || {};
  const reviews = Array.isArray(imageReviews) ? imageReviews : [];
  const records = [];
  for (const key of EVIDENCE_KEYS) {
    const answer = evidence[key];
    if (answer !== 'no' && answer !== 'unknown') continue;
    const kb = EVIDENCE_KB[key];
    if (!kb) continue;
    const currentState =
      answer === 'no'
        ? 'Applicant reported they do not have this document.'
        : 'Applicant does not know whether they have this document, or it does not apply as asked.';
    // Attach validated image-review observations relevant to this gap.
    // Observations refine guidance only: they never change the gap's state,
    // never mark anything ready/verified, and never set independently-verified.
    const imageObservations = matchReviewsToGap(key, reviews).map(r => ({
      documentCategory: r.documentCategory,
      legibility: r.legibility,
      appearsComplete: r.appearsComplete,
      fieldsVisible: r.fieldsVisible,
      inconsistencies: r.inconsistencies,
      limitations: r.limitations,
      // Explicit provenance marker: observation, not fact.
      source: 'automated-image-observation-not-verified',
    }));
    records.push({
      key,
      targetFact: kb.targetFact,
      currentState,
      primaryEvidence: kb.primaryEvidence,
      alternatives: kb.alternatives.map(a => ({
        id: a.id,
        label: a.label,
        availability: a.availability,
      })),
      evidentiaryConnection: kb.alternatives.map(a => ({
        id: a.id,
        supports: a.supports,
        limitations: a.limitations,
      })),
      availability: kb.alternatives.map(a => `${a.label}: ${a.availability}`).join('; '),
      acquisitionSteps: kb.alternatives.map(a => `${a.label}: ${a.acquisition}`).join(' '),
      safetyConsiderations: kb.alternatives
        .map(a => a.safety)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(' '),
      reviewRequirements: kb.alternatives.map(a => `${a.label}: ${a.reviewNeeded}`).join(' '),
      legalReviewRequired: requiresLegalReview(key),
      legalReviewReason: legalReviewReason(key),
      imageObservations,
      imageReviewed: imageObservations.length > 0,
      nextAction: nextActionFor(key, answer),
    });
  }
  return records;
}

export function nextActionFor(key, answer) {
  const base = { status: 'not-started' };
  if (key === 'has_persecution_proof' || key === 'has_arrests') {
    return {
      ...base,
      step: 'Discuss this item with a qualified immigration attorney before gathering or submitting anything.',
      responsible: 'attorney',
      priority: 'high',
    };
  }
  if (key === 'has_passport' || key === 'has_i94') {
    return {
      ...base,
      step: answer === 'unknown'
        ? 'Determine whether this document exists (check personal files, then the issuing authority).'
        : 'Work through the listed alternatives in order; gather what is obtainable and note what is not.',
      responsible: 'applicant',
      priority: 'high',
    };
  }
  return {
    ...base,
    step: answer === 'unknown'
      ? 'Determine whether this document exists (check personal files, then the issuing authority).'
      : 'Work through the listed alternatives in order; gather what is obtainable and note what is not.',
    responsible: 'applicant',
    priority: 'medium',
  };
}

/**
 * The absence of corroborating material does not disprove an applicant's
 * account. This principle is encoded here (not just in prose) so prompts,
 * tests, and gap records all share one statement of it.
 */
export const NO_ADVERSE_INFERENCE_PRINCIPLE =
  'The absence of corroborating evidence does not, by itself, disprove the ' +
  'applicant\u2019s account. Missing documents are gaps to address — through ' +
  'primary evidence, secondary evidence, or a documented explanation of ' +
  'unavailability — not findings against the applicant.';
