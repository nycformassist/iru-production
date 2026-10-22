/**
 * lib/legal.js — Legal grounding for IRU's evidence handling.
 *
 * IRU is an information-readiness assistant, not a legal authority. This
 * module encodes the key principles from the authorities documented in
 * LEGAL_SOURCES.md so that prompts, gap records, and tests share one
 * statement of the rules — and so that anything interpretive is flagged
 * for qualified legal review instead of being invented as a rule.
 *
 * Pure data + pure functions. No legal advice is given to applicants here;
 * these principles shape how the system talks about evidence.
 */

export const LEGAL_AUTHORITIES = [
  {
    id: 'ina-208-b1Bii-iii',
    title: 'INA § 208(b)(1)(B)(ii)–(iii) — burden of proof, corroboration, credibility (REAL ID Act)',
    citation: '8 U.S.C. § 1158(b)(1)(B)(ii)–(iii)',
    url: 'http://uscode.house.gov/view.xhtml?edition=prelim&f=&fq=&hl=false&num=0&path=&req=(title:8+section:1158+edition:prelim)',
    verifiedDate: '2026-10-16',
    workflows: ['asylum'],
    principles: [
      'The testimony of the applicant may be sufficient to sustain the burden without corroboration, but only if the trier of fact finds it credible, persuasive, and referring to specific facts sufficient to demonstrate refugee status.',
      'Where the trier of fact determines the applicant should provide corroborating evidence, it must be provided UNLESS the applicant does not have it and cannot reasonably obtain it.',
      'Credibility is assessed on the totality of the circumstances; there is no presumption of credibility, but no adverse credibility determination means a rebuttable presumption of credibility on appeal.',
    ],
    needsLegalValidation: false,
    notes: 'Statutory text. IRU application: never tell an applicant corroboration is optional in their case or required in their case — that determination belongs to the adjudicator.',
  },
  {
    id: 'cfr-1208-13a',
    title: '8 CFR § 1208.13(a) — establishing asylum eligibility',
    citation: '8 CFR § 1208.13(a)',
    url: 'https://www.govinfo.gov/content/pkg/CFR-2014-title8-vol1/pdf/CFR-2014-title8-vol1-sec1208-13.pdf',
    verifiedDate: '2026-10-16',
    workflows: ['asylum'],
    principles: [
      'The burden of proof is on the applicant.',
      'The testimony of the applicant, if credible, may be sufficient to sustain the burden of proof without corroboration.',
    ],
    needsLegalValidation: false,
    notes: 'Regulatory restatement of the credible-testimony rule. Same IRU application as INA 208.',
  },
  {
    id: 'cfr-103-2-b2',
    title: '8 CFR § 103.2(b)(2) — submitting secondary evidence and affidavits',
    citation: '8 CFR § 103.2(b)(2)(i)–(ii)',
    url: 'https://www.law.cornell.edu/cfr/text/8/103.2',
    verifiedDate: '2026-10-16',
    workflows: ['family', 'citizenship', 'asylum'],
    principles: [
      'Non-existence or unavailability of required evidence creates a presumption of ineligibility — it must be addressed, not ignored.',
      'If a required document does not exist or cannot be obtained, the applicant must demonstrate this and submit secondary evidence pertinent to the facts at issue.',
      'If secondary evidence also does not exist or cannot be obtained, the applicant must demonstrate the unavailability of both and submit two or more affidavits from non-parties with direct personal knowledge.',
      'Demonstrating unavailability generally requires an original written statement on government letterhead from the relevant authority (or evidence of repeated good-faith attempts).',
    ],
    needsLegalValidation: false,
    notes: 'This is the general USCIS rule. Asylum corroboration has its own standard (INA 208); where they overlap, counsel should reconcile them.',
  },
  {
    id: 'uscis-pm-e6',
    title: 'USCIS Policy Manual, Vol. 1, Part E, Chapter 6 — Evidence',
    citation: '1 USCIS-PM E.6',
    url: 'https://www.uscis.gov/policy-manual/volume-1-part-e-chapter-6',
    verifiedDate: '2026-10-16',
    workflows: ['family', 'citizenship', 'asylum'],
    principles: [
      'Secondary evidence and affidavits are admissible to meet the burden only after the unavailability of primary evidence is addressed (see 8 CFR 103.2(b)(2)(i)).',
      'Affidavits are generally treated as tertiary evidence — accepted when neither primary nor secondary evidence exists or can be obtained.',
    ],
    needsLegalValidation: true,
    notes: 'The "tertiary evidence" framing and 2026 RFE-policy changes were reported via secondary sources in 2026; the Policy Manual chapter itself is primary. Counsel should confirm current agency posture before relying on affidavit strategy.',
  },
  {
    id: 'uscis-pm-4c4',
    title: 'USCIS Policy Manual, Vol. 4, Part C, Chapter 4 — Documentation and Evidence (family-based)',
    citation: '4 USCIS-PM C.4',
    url: 'https://WWW.USCIS.GOV/policy-manual/volume-4-part-c-chapter-4',
    verifiedDate: '2026-10-16',
    workflows: ['family'],
    principles: [
      'If primary documentation such as a civilly registered marriage or birth certificate cannot be obtained, secondary evidence may support the qualifying relationship.',
      'Two or more sworn statements from third parties with personal knowledge may be submitted if both primary and secondary evidence are unavailable.',
    ],
    needsLegalValidation: false,
    notes: 'Benefit-specific application of the 8 CFR 103.2(b)(2) framework.',
  },
  {
    id: 'eoir-practice-manual',
    title: 'EOIR Immigration Court Practice Manual — filing and evidence procedure',
    citation: 'EOIR Practice Manual (2020 version, Ch. 3)',
    url: 'https://www.justice.gov/eoir/file/1052736/dl?inline=',
    verifiedDate: '2026-10-16',
    workflows: ['asylum'],
    principles: [
      'Evidence in removal proceedings must be filed with the Immigration Court under the manual\u2019s procedural rules (form, pagination, service, deadlines).',
      'Substantive corroboration standards come from the statute and regulations (INA 208 / 8 CFR 1208.13), not from the Practice Manual.',
    ],
    needsLegalValidation: true,
    notes: 'Cited for procedure only. Do not treat the Practice Manual as the source of corroboration rules.',
  },
];

/**
 * Prompt-ready statement of the legal principles IRU must respect.
 * Inserted into buildPrompt() HARD RULES. Written as system guidance about
 * how to talk about evidence — not as legal advice to the applicant.
 */
export function legalHardRules() {
  return [
    'TESTIMONY AND CORROBORATION (INA 208(b)(1)(B)(ii); 8 CFR 1208.13(a)): credible, persuasive, specific testimony can sustain the burden without corroboration. Corroboration is required only where the adjudicator determines it should be provided AND the applicant has it or can reasonably obtain it. Never tell the applicant corroboration is optional or required in their specific case.',
    'SECONDARY EVIDENCE (8 CFR 103.2(b)(2)): when a required document does not exist or cannot be obtained, the gap must be addressed with secondary evidence pertinent to the facts at issue, plus a documented explanation of the unavailability — not ignored, and not treated as fatal by default.',
    'NO AUTOMATIC ADVERSE INFERENCE: the absence of corroborating material does not by itself disprove the applicant\u2019s account. Missing documents are gaps to address, not findings against the applicant.',
    'NEXUS AND DISPOSITION QUESTIONS: where the facts involve a protected ground (e.g. religion) and an alleged persecutor, or where criminal history/disposition is at issue, flag the item for qualified legal review rather than resolving it.',
    'You are not the adjudicator. Do not predict whether any specific evidence will be accepted.',
  ].join('\n');
}

/** Authorities whose application to an IRU workflow is interpretive. */
export function authoritiesNeedingValidation() {
  return LEGAL_AUTHORITIES.filter(a => a.needsLegalValidation);
}
