// Browser-compatible Tier 1 readiness assessment functions
// Simplified from api/*-tier1.js — direct answer assessment without fact records.

import type { Tier1Lang } from './Tier1Flow';

interface Finding { t: string; d: string; section?: string }
interface Assessment { blockers: Finding[]; warnings: Finding[]; complete: Finding[]; ready: boolean }

// --- Scored analysis layer (shared engine for Tier 1 + original IRU convergence) ---
// Score bands match the original IRU evidence-aware scoring:
//   Strong ≥ 0.90 / Moderate ≥ 0.60 / Developing ≥ 0.35 / Incomplete < 0.35

export type ReadinessBand = 'Strong' | 'Moderate' | 'Developing' | 'Incomplete';

export interface SectionScore {
  section: string;
  score: number;        // 0.0 – 1.0
  band: ReadinessBand;
  blockers: number;
  warnings: number;
  complete: number;
}

export interface ScoredAssessment extends Assessment {
  overallScore: number;
  overallBand: ReadinessBand;
  sections: SectionScore[];
  executiveSummary: string;
}

export function bandFor(score: number): ReadinessBand {
  if (score >= 0.90) return 'Strong';
  if (score >= 0.60) return 'Moderate';
  if (score >= 0.35) return 'Developing';
  return 'Incomplete';
}

// Section score: starts at 1.0, blockers cap at 0.35, warnings cap at 0.75,
// then proportional deduction for unresolved items within the section.
// FIX (2026-11-03): warnings count as partial credit (0.5) not zero —
// a section where all questions were answered but warnings exist floors
// at Developing, not 0%. Only truly missing information scores 0.
function scoreSection(findings: { blockers: Finding[]; warnings: Finding[]; complete: Finding[] }): number {
  const total = findings.blockers.length + findings.warnings.length + findings.complete.length;
  if (total === 0) return 1.0;
  let score = (findings.complete.length + findings.warnings.length * 0.5) / total;
  if (findings.blockers.length > 0) score = Math.min(score, 0.35);
  else if (findings.warnings.length > 0) score = Math.min(score, 0.75);
  score = Math.max(0, score - (findings.warnings.length * 0.05));
  return Math.round(score * 100) / 100;
}

function buildExecutiveSummary(
  formTitle: string,
  overallBand: ReadinessBand,
  overallScore: number,
  sections: SectionScore[],
  blockers: Finding[],
  warnings: Finding[],
): string {
  const pct = Math.round(overallScore * 100);
  const strongSections = sections.filter(s => s.band === 'Strong').map(s => s.section);
  const weakSections = sections.filter(s => s.band === 'Incomplete' || s.band === 'Developing').map(s => s.section);

  let summary = `This ${formTitle} readiness assessment scores ${pct}% (${overallBand}). `;
  if (overallBand === 'Strong') {
    summary += 'The applicant has provided complete information across all sections with no blocking issues. ';
  } else if (overallBand === 'Moderate') {
    summary += 'The application is substantially complete. ';
  } else if (overallBand === 'Developing') {
    summary += 'Significant gaps remain before this application is ready to file. ';
  } else {
    summary += 'This application is not ready to file — critical information is missing. ';
  }
  if (strongSections.length > 0) {
    summary += `Strongest areas: ${strongSections.join(', ')}. `;
  }
  if (weakSections.length > 0) {
    summary += `Areas needing attention: ${weakSections.join(', ')}. `;
  }
  if (blockers.length > 0) {
    summary += `${blockers.length} blocking issue${blockers.length > 1 ? 's' : ''} must be resolved: ${blockers.slice(0, 3).map(b => b.t).join('; ')}${blockers.length > 3 ? `, and ${blockers.length - 3} more` : ''}. `;
  }
  if (warnings.length > 0 && overallBand !== 'Strong') {
    summary += `${warnings.length} warning${warnings.length > 1 ? 's' : ''} should be reviewed before filing.`;
  }
  return summary.trim();
}

// Wraps a basic Assessment with scored analysis.
// sectionOrder defines the display order; findings without a section go to 'General'.
// factRecord (optional): when provided, section scores are confidence-weighted (evidence-aware).
export function scoreAssessment(
  assessment: Assessment,
  formTitle: string,
  sectionOrder: string[] = [],
  factRecord?: FactRecord,
): ScoredAssessment {
  const bySection = new Map<string, { blockers: Finding[]; warnings: Finding[]; complete: Finding[] }>();
  const getBucket = (name: string) => {
    if (!bySection.has(name)) bySection.set(name, { blockers: [], warnings: [], complete: [] });
    return bySection.get(name)!;
  };
  for (const b of assessment.blockers) getBucket(b.section || 'General').blockers.push(b);
  for (const w of assessment.warnings) getBucket(w.section || 'General').warnings.push(w);
  for (const c of assessment.complete) getBucket(c.section || 'General').complete.push(c);

  const sections: SectionScore[] = [];
  for (const [name, findings] of bySection) {
    const score = factRecord ? scoreSectionWeighted(findings, factRecord) : scoreSection(findings);
    sections.push({
      section: name,
      score,
      band: bandFor(score),
      blockers: findings.blockers.length,
      warnings: findings.warnings.length,
      complete: findings.complete.length,
    });
  }
  // Order sections by sectionOrder, then any extras
  sections.sort((a, b) => {
    const ai = sectionOrder.indexOf(a.section);
    const bi = sectionOrder.indexOf(b.section);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const overallScore = sections.length > 0
    ? Math.round((sections.reduce((s, x) => s + x.score, 0) / sections.length) * 100) / 100
    : 0;
  const overallBand = bandFor(overallScore);
  const executiveSummary = buildExecutiveSummary(formTitle, overallBand, overallScore, sections, assessment.blockers, assessment.warnings);

  return { ...assessment, overallScore, overallBand, sections, executiveSummary };
}

// Bilingual finding templates — EN + ES/ZH/HT/AR added by translation pass
// For now, findings are EN with structure ready for translation

export function assessN400(answers: Record<string, any>, lang: Tier1Lang): Assessment {
  const blockers: Finding[] = [], warnings: Finding[] = [], complete: Finding[] = [];
  const get = (id: string) => answers[id];

  if (get('n400_age') !== 'yes') blockers.push({ t: 'Age requirement', d: 'Must be at least 18 years old when filing Form N-400.', section: 'Eligibility' });
  else complete.push({ t: 'Age 18+', d: 'Meets the minimum age requirement.', section: 'Eligibility' });

  if (get('n400_lpr_status') !== 'yes') blockers.push({ t: 'Lawful permanent resident status', d: 'Naturalization requires a green card. Without LPR status, Form N-400 is not the right form.', section: 'Eligibility' });
  else complete.push({ t: 'Green card holder', d: 'Confirmed lawful permanent resident status.', section: 'Eligibility' });

  const dur = get('n400_lpr_years');
  if (dur === 'under_3') blockers.push({ t: 'Residency duration', d: 'Need 5 years as a green card holder (or 3 years if married to a U.S. citizen).', section: 'Eligibility' });
  else if (dur === '3_to_5' && get('n400_married_usc') !== 'yes') warnings.push({ t: 'Residency path', d: 'With 3–5 years as an LPR, the 3-year path requires marriage to a U.S. citizen.', section: 'Eligibility' });
  else if (dur) complete.push({ t: 'Residency duration', d: 'Time as a permanent resident meets the threshold.', section: 'Eligibility' });

  if (get('n400_state_months') !== 'yes') blockers.push({ t: 'State residency', d: 'Must have lived in the filing state or USCIS district for at least 3 months.', section: 'Residence' });
  else if (get('n400_state_months')) complete.push({ t: 'State residency', d: 'Three-month district residency confirmed.', section: 'Residence' });

  for (const [id, label] of [['n400_legal_name', 'Family name'], ['n400_dob', 'Date of birth'], ['n400_a_number', 'A-Number']] as const) {
    if (!get(id)) blockers.push({ t: label, d: `${label} is needed to complete the form.`, section: 'Personal Information' });
    else complete.push({ t: label, d: 'Provided.', section: 'Personal Information' });
  }

  if (get('n400_long_trip') === 'yes') warnings.push({ t: 'Extended travel', d: 'A trip over 6 months can break continuous residence. Trips over a year break it automatically unless Form N-470 was filed.', section: 'Travel History' });
  if (get('n400_arrests') === 'yes') warnings.push({ t: 'Arrest history', d: 'Disclosed arrest or citation. Gather certified court dispositions before filing.', section: 'Good Moral Character' });
  if (get('n400_taxes') === 'no') warnings.push({ t: 'Tax filings', d: 'Missing tax returns can affect the good moral character finding.', section: 'Good Moral Character' });

  const trips = get('n400_trips');
  if (get('n400_traveled') === 'yes' && (!trips || !trips.length)) blockers.push({ t: 'Trip details', d: 'Travel abroad indicated but no trips listed.', section: 'Travel History' });

  return { blockers, warnings, complete, ready: blockers.length === 0 };
}

export function assessI130(answers: Record<string, any>, lang: Tier1Lang): Assessment {
  const blockers: Finding[] = [], warnings: Finding[] = [], complete: Finding[] = [];
  const get = (id: string) => answers[id];

  const isUsc = get('i130_petitioner_status') === 'usc';
  const rel = get('i130_relationship');
  if (!isUsc && ['married_child', 'sibling', 'parent'].includes(rel)) blockers.push({ t: 'Petition eligibility', d: 'As a green card holder, you can only petition for a spouse or unmarried children.', section: 'Eligibility' });
  else if (rel) complete.push({ t: 'Eligible relationship', d: 'This relationship can be petitioned for your status.', section: 'Eligibility' });

  if (['sibling', 'parent'].includes(rel) && get('i130_petitioner_age') !== 'yes') blockers.push({ t: 'Petitioner age', d: 'Must be at least 21 to petition for a sibling or parent.', section: 'Eligibility' });
  if (rel === 'spouse' && get('i130_spouse_130a') !== 'yes') blockers.push({ t: 'Form I-130A', d: 'Every spouse petition must include Form I-130A.', section: 'Filing Requirements' });
  else if (rel === 'spouse') complete.push({ t: 'I-130A acknowledged', d: 'Spouse supplement requirement confirmed.', section: 'Filing Requirements' });

  for (const [id, label] of [['i130_pet_name', 'Petitioner name'], ['i130_ben_name', 'Beneficiary name'], ['i130_ben_dob', 'Beneficiary DOB']] as const) {
    if (!get(id)) blockers.push({ t: label, d: 'This information is required on the petition.', section: 'Personal Information' });
    else complete.push({ t: label, d: 'Provided.', section: 'Personal Information' });
  }
  if (get('i130_prior_denied') === 'yes') warnings.push({ t: 'Prior denial', d: 'A previous petition was denied or revoked. Consider consulting an immigration attorney.', section: 'Filing History' });

  return { blockers, warnings, complete, ready: blockers.length === 0 };
}

export function assessI485(answers: Record<string, any>, lang: Tier1Lang): Assessment {
  const blockers: Finding[] = [], warnings: Finding[] = [], complete: Finding[] = [];
  const get = (id: string) => answers[id];

  if (get('i485_basis_approved') !== 'yes') blockers.push({ t: 'Underlying petition', d: 'The immigrant petition must be approved before filing I-485 in most categories.', section: 'Eligibility' });
  else complete.push({ t: 'Basis approved', d: 'Underlying petition or grant is approved.', section: 'Eligibility' });

  const visa = get('i485_visa_available');
  if (visa === 'no') blockers.push({ t: 'Visa availability', d: 'No immigrant visa number is currently available. Check the Visa Bulletin.', section: 'Eligibility' });
  else if (visa === 'unsure') warnings.push({ t: 'Visa availability', d: 'Verify the priority date against the Visa Bulletin at travel.state.gov.', section: 'Eligibility' });
  else if (visa) complete.push({ t: 'Visa available', d: 'An immigrant visa number is available.', section: 'Eligibility' });

  if (get('i485_in_us') !== 'yes') blockers.push({ t: 'Physical presence', d: 'Adjustment of status requires physical presence in the United States.', section: 'Eligibility' });
  if (get('i485_last_entry') !== 'yes') warnings.push({ t: 'Manner of entry', d: 'If the last entry was not inspected, adjustment may be barred. Attorney consultation recommended.', section: 'Admissibility' });
  if (get('i485_medical') !== 'yes') blockers.push({ t: 'Medical examination', d: 'The immigration medical exam (Form I-693) by a USCIS-designated civil surgeon is required.', section: 'Supporting Documents' });
  else if (get('i485_medical')) complete.push({ t: 'Medical exam', d: 'Completed.', section: 'Supporting Documents' });
  if (get('i485_fraud') === 'yes') blockers.push({ t: 'Fraud disclosure', d: 'Disclosed fraud or misrepresentation likely makes the applicant inadmissible. Consult an attorney.', section: 'Admissibility' });
  if (get('i485_criminal') === 'yes') warnings.push({ t: 'Criminal history', d: 'Disclosed criminal history may affect admissibility. Gather court records.', section: 'Admissibility' });

  return { blockers, warnings, complete, ready: blockers.length === 0 };
}

export function assessI589(answers: Record<string, any>, lang: Tier1Lang): Assessment {
  const blockers: Finding[] = [], warnings: Finding[] = [], complete: Finding[] = [];
  const get = (id: string) => answers[id];

  // One-year filing deadline — the critical I-589 eligibility check
  const entryDate = get('i589_entry_date');
  if (entryDate) {
    const entry = new Date(entryDate);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > 365) {
      warnings.push({ t: 'One-year filing deadline', d: `Entry was ${Math.floor(daysSince / 30)} months ago. Asylum must generally be filed within one year — exceptions exist for changed or extraordinary circumstances. Consult an attorney promptly.`, section: 'Eligibility' });
    } else if (daysSince >= 0) {
      complete.push({ t: 'One-year deadline', d: `Entry was ${daysSince} days ago — within the one-year filing window.`, section: 'Eligibility' });
    }
  } else {
    blockers.push({ t: 'Entry date', d: 'Date of last entry to the U.S. is needed to assess the one-year filing deadline.', section: 'Eligibility' });
  }

  const manner = get('i589_entry_manner');
  if (manner === 'uninspected') warnings.push({ t: 'Manner of entry', d: 'Entry without inspection does not bar asylum, but it affects other forms of relief. Disclose fully to your attorney.', section: 'Eligibility' });
  else if (manner) complete.push({ t: 'Manner of entry', d: 'Entry information provided.', section: 'Eligibility' });

  for (const [id, label] of [['i589_full_name', 'Full name'], ['i589_dob', 'Date of birth'], ['i589_country_origin', 'Country of origin']] as const) {
    if (!get(id)) blockers.push({ t: label, d: `${label} is required on the application.`, section: 'Personal Information' });
    else complete.push({ t: label, d: 'Provided.', section: 'Personal Information' });
  }

  const grounds = get('i589_persecution_grounds');
  if (!grounds) blockers.push({ t: 'Persecution grounds', d: 'Asylum requires identifying a protected ground (race, religion, nationality, political opinion, or particular social group).', section: 'Basis for Asylum' });
  else complete.push({ t: 'Protected ground identified', d: `Basis: ${grounds}.`, section: 'Basis for Asylum' });

  if (get('i589_has_evidence') === 'no') warnings.push({ t: 'Persecution evidence', d: 'No documentary evidence of persecution yet. Testimony alone can support a claim, but evidence significantly strengthens it. Staff can advise on gathering documentation.', section: 'Basis for Asylum' });
  else if (get('i589_has_evidence') === 'yes') complete.push({ t: 'Evidence available', d: 'Applicant reports having evidence of persecution.', section: 'Basis for Asylum' });

  if (get('i589_has_children') === 'yes') {
    const children = get('i589_children');
    if (!children || !children.length) warnings.push({ t: 'Derivative children', d: 'Children under 21 indicated but none listed. They may qualify as derivatives — list them for staff review.', section: 'Family' });
    else complete.push({ t: 'Children listed', d: `${children.length} child(ren) listed for derivative consideration.`, section: 'Family' });
  }

  if (get('i589_prior_filing') === 'yes') warnings.push({ t: 'Prior asylum filing', d: 'A previous asylum filing was indicated. A prior denial triggers additional bars — attorney consultation is strongly recommended.', section: 'Filing History' });
  if (get('i589_in_proceedings') === 'yes') warnings.push({ t: 'In removal proceedings', d: 'Applicant is in proceedings — the I-589 must be filed with the immigration court (defensive asylum), not USCIS. Confirm the court filing procedure with staff.', section: 'Filing History' });
  else if (get('i589_in_proceedings') === 'unsure') warnings.push({ t: 'Proceedings status unclear', d: 'Uncertain whether in removal proceedings. Staff should verify — it determines where the application is filed.', section: 'Filing History' });

  return { blockers, warnings, complete, ready: blockers.length === 0 };
}

export function assessI90(answers: Record<string, any>, lang: Tier1Lang): Assessment {
  const blockers: Finding[] = [], warnings: Finding[] = [], complete: Finding[] = [];
  const get = (id: string) => answers[id];

  const reason = get('i90_reason');
  if (!reason) blockers.push({ t: 'Filing reason', d: 'Select the reason that matches the situation.', section: 'Filing Basis' });
  else complete.push({ t: 'Filing reason', d: `Reason ${reason} selected.`, section: 'Filing Basis' });
  if (['2c', '2d', '2e'].includes(reason) && get('i90_has_card') !== 'yes') blockers.push({ t: 'Card surrender', d: 'This filing reason requires surrendering the existing card.', section: 'Filing Basis' });
  for (const [id, label] of [['i90_name', 'Family name'], ['i90_a_number', 'A-Number'], ['i90_address', 'Mailing address']] as const) {
    if (!get(id)) blockers.push({ t: label, d: 'Required to complete the form.', section: 'Personal Information' });
    else complete.push({ t: label, d: 'Provided.', section: 'Personal Information' });
  }

  return { blockers, warnings, complete, ready: blockers.length === 0 };
}

// --- Premium intelligence helpers (owner directive 2026-11-10) ---
// Shared date parsing + narrative-draft assembly for the four expanded
// forms (I-485, N-400, I-130, I-90), following the detectI765Intelligence
// pattern: contradictions are CONFLICT blockers (ready=false), not soft
// warnings. Narratives are assembled ONLY from the applicant's own
// answers — never invented — and are marked DRAFT for applicant review.

/** Tolerant date parse: YYYY-MM-DD, MM/DD/YYYY, MM/YYYY, YYYY-MM, YYYY. Returns null for "D/S", "present", "n/a", empty, or invalid. */
function parseAnyDate(raw: any): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === 'd/s' || low === 'ds' || low === 'present' || low === 'current' || low === 'n/a' || low === 'na') return null;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) {
    const d = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const my = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (my) {
    const d = new Date(Number(my[2]), Number(my[1]) - 1, 1);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ym = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (ym) {
    const d = new Date(Number(ym[1]), Number(ym[2]) - 1, 1);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Carbon Pass 2 L-2: ISO date-only strings (from <input type="date">)
  // parse as UTC midnight via new Date(s), shifting a day earlier in US
  // timezones. Construct local midnight instead, consistent with the
  // local-midnight branches above and with today.setHours(0,0,0,0).
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const y = /^(\d{4})$/.exec(s);
  if (y) {
    const d = new Date(Number(y[1]), 0, 1);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse a range endpoint (MM/YYYY, full date, or "present" = today). */
function parseRangeDate(raw: any, today: Date): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.toLowerCase() === 'present' || s.toLowerCase() === 'current') return new Date(today);
  return parseAnyDate(s);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function yearsBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (365.25 * 86400000);
}

export interface ExplanationDraft {
  formSection: string;      // e.g. "I-485 Part 8" / "N-400 Part 12"
  questionId: string;
  questionRef: string;      // e.g. "i485_adm_01" / "GMC Q3"
  applicantAnswer: string;  // the applicant's own answer (e.g. "yes")
  draftText: string;        // assembled ONLY from the applicant's answers; never invented
  status: 'draft-needs-review';
}

// Narrative preparation (Premium, owner directive 2026-11-09/10):
// for each "if yes, explain" answer, assemble a reviewable draft that
// quotes the applicant's own disclosure and prompts them to supply the
// date, place, and outcome in their own words. Nothing is invented:
// a draft with no applicant-supplied details says so explicitly.
// The applicant reviews and corrects every draft before finalization.
export function buildExplanationDrafts(formKey: string, answers: Record<string, any>): ExplanationDraft[] {
  const drafts: ExplanationDraft[] = [];
  const get = (id: string) => answers[id];
  if (formKey === 'i485') {
    // Part 8 admissibility: every "yes" needs an explanation on the form.
    for (const [id, val] of Object.entries(answers)) {
      if (!/^i485_adm_\d+[a-z]?$/.test(id)) continue;
      if (String(val).toLowerCase() !== 'yes') continue;
      drafts.push({
        formSection: 'I-485 Part 8 (Admissibility)',
        questionId: id,
        questionRef: id,
        applicantAnswer: 'yes',
        draftText: `DRAFT — review and correct before use. The applicant answered Yes to I-485 Part 8 admissibility question ${id}. Supply the date, place, and outcome in your own words for this disclosure. No facts have been added by IRU.`,
        status: 'draft-needs-review',
      });
    }
  } else if (formKey === 'n400') {
    // Part 12 good moral character: every "yes" needs an explanation.
    for (const [id, val] of Object.entries(answers)) {
      if (!/^n400_gmc_\d+$/.test(id)) continue;
      if (String(val).toLowerCase() !== 'yes') continue;
      const num = Number(id.replace('n400_gmc_', '')) + 1;
      drafts.push({
        formSection: 'N-400 Part 12 (Good Moral Character)',
        questionId: id,
        questionRef: `GMC Q${num}`,
        applicantAnswer: 'yes',
        draftText: `DRAFT — review and correct before use. The applicant answered Yes to GMC question ${num} (N-400 Part 12). Supply the date, place, and outcome in your own words for this disclosure. No facts have been added by IRU.`,
        status: 'draft-needs-review',
      });
    }
  } else if (formKey === 'i130') {
    if (get('i130_prior_denied') === 'yes') {
      drafts.push({
        formSection: 'I-130 Filing History',
        questionId: 'i130_prior_denied',
        questionRef: 'Prior petition denied or revoked',
        applicantAnswer: 'yes',
        draftText: `DRAFT — review and correct before use. The applicant disclosed a prior petition that was denied or revoked. Supply the prior petition's filing date, location, and result in your own words for review. No facts have been added by IRU.`,
        status: 'draft-needs-review',
      });
    }
    if (get('i130_ben_proceedings') === 'yes') {
      drafts.push({
        formSection: 'I-130 Beneficiary',
        questionId: 'i130_ben_proceedings',
        questionRef: 'Beneficiary in removal proceedings',
        applicantAnswer: 'yes',
        draftText: `DRAFT — review and correct before use. The applicant disclosed that the beneficiary is in removal proceedings. Supply the court, case status, and any relevant dates in your own words for review. No facts have been added by IRU.`,
        status: 'draft-needs-review',
      });
    }
  } else if (formKey === 'i90') {
    if (get('i90_name_changed') === 'yes') {
      const cardName = [get('i90_card_name_family'), get('i90_card_name_given')].filter(Boolean).join(' ');
      drafts.push({
        formSection: 'I-90 Biographical Information',
        questionId: 'i90_name_changed',
        questionRef: 'Name or biographical information changed',
        applicantAnswer: 'yes',
        draftText: `DRAFT — review and correct before use. The applicant disclosed a name or biographical change${cardName ? ` — the card shows "${cardName}"` : ''}. Confirm the current legal name and the reason for the change in your own words. No facts have been added by IRU.`,
        status: 'draft-needs-review',
      });
    }
  }
  return drafts;
}

// Aggregated report finding for the narrative drafts (so the report
// surfaces them without a new UI component). Returns null when there
// are no drafts.
function explanationDraftFinding(formKey: string, answers: Record<string, any>): Finding | null {
  const drafts = buildExplanationDrafts(formKey, answers);
  if (!drafts.length) return null;
  const refs = drafts.map(d => d.questionRef).join('; ');
  const section = formKey === 'i485' ? 'Admissibility' : formKey === 'n400' ? 'Good Moral Character' : formKey === 'i130' ? 'Filing History' : 'Filing Basis';
  return {
    t: `${drafts.length} explanation draft${drafts.length > 1 ? 's' : ''} prepared — review required`,
    d: `Premium narrative preparation drafted explanations for: ${refs}. Each draft uses ONLY the applicant's own answers — no facts were added. The applicant must review, correct, and supply the date, place, and outcome for each before use.`,
    section,
  };
}

// --- Context-aware intelligence layer ---
// Cross-answer inference and conflict detection.
// This is what makes Tier 1 "think" rather than just capture.

interface IntelligenceResult {
  inferred: Finding[];
  conflicts: Finding[];
}

function detectN400Intelligence(answers: Record<string, any>): IntelligenceResult {
  const inferred: Finding[] = [], conflicts: Finding[] = [];
  const get = (id: string) => answers[id];
  const dur = get('n400_lpr_years');
  // FIX (Premium): the question ID is n400_married_usc — the old
  // n400_married_to_usc never matched, so the 3-year-path inference
  // never fired. Accept both (stored answers may use either).
  const marriedUsc = get('n400_married_usc') === 'yes' || get('n400_married_to_usc') === 'yes';
  if (dur === '3_to_5' && marriedUsc) {
    inferred.push({ t: 'Three-year eligibility path', d: 'With 3-5 years as an LPR and marriage to a U.S. citizen, the applicant qualifies for the expedited 3-year naturalization path.', section: 'Eligibility' });
  } else if (dur && dur !== 'under_3' && !marriedUsc) {
    inferred.push({ t: 'Five-year eligibility path', d: 'Without USC marriage, the standard 5-year continuous residence path applies.', section: 'Eligibility' });
  }
  if (get('n400_long_trip') === 'yes' && dur === '3_to_5') {
    inferred.push({ t: 'Residence risk compounded', d: 'An extended trip combined with a shorter LPR duration increases continuous-residence scrutiny. Document all travel carefully.', section: 'Travel History' });
  }

  // FIX (2026-11-03): Calculate actual trip durations from dates, don't trust the yes/no
  const trips = get('n400_trips');
  if (Array.isArray(trips)) {
    for (const trip of trips) {
      const dep = trip.departure || trip.from;
      const ret = trip.return || trip.to;
      if (dep && ret) {
        const days = Math.floor((new Date(ret).getTime() - new Date(dep).getTime()) / 86400000);
        if (days > 180 && get('n400_long_trip') !== 'yes') {
          conflicts.push({ t: 'Trip duration contradiction', d: `A trip from ${dep} to ${ret} spans ~${Math.round(days / 30)} months, but "trip over 6 months" was answered No. This breaks continuous residence — correct the answer.`, section: 'Travel History' });
        } else if (days > 365) {
          inferred.push({ t: 'Automatic residence break', d: `A trip exceeding one year (${Math.round(days / 30)} months) automatically breaks continuous residence unless Form N-470 was filed.`, section: 'Travel History' });
        }
      }
      // Future return date check
      if (ret && new Date(ret) > new Date()) {
        conflicts.push({ t: 'Future trip date', d: `Trip return date ${ret} is in the future. Verify the dates are correct.`, section: 'Travel History' });
      }
    }
  }
  if (get('n400_traveled') === 'no' && trips && trips.length > 0) {
    conflicts.push({ t: 'Travel contradiction', d: 'Applicant answered "no" to travel abroad but listed trips. Clarify which is correct.', section: 'Travel History' });
  }
  if (get('n400_traveled') === 'yes' && (!trips || !trips.length)) {
    conflicts.push({ t: 'Missing trip details', d: 'Travel was indicated but no trip details were provided. These are needed for the residence calculation.', section: 'Travel History' });
  }

  // FIX (2026-11-03): Children vs child support cross-check
  const hasChildren = get('n400_has_children');
  const childSupport = get('n400_child_support');
  // FIX (Premium): the option value is 'na', not 'n/a' — the old check
  // flagged a legitimate "not applicable" as a contradiction.
  if (hasChildren === 'no' && childSupport && childSupport !== 'no' && childSupport !== 'n/a' && childSupport !== 'na') {
    conflicts.push({ t: 'Child support contradiction', d: 'Applicant has no children but indicated child support status. Clarify — this may be a data entry error.', section: 'Family' });
  }

  // FIX (2026-11-03): Email format validation
  const email = get('n400_email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    conflicts.push({ t: 'Invalid email format', d: `"${email}" is not a valid email address. Verify and correct.`, section: 'Personal Information' });
  } else if (email) {
    const local = email.split('@')[0];
    const digitRatio = (local.replace(/\D/g, '').length / local.length);
    if (digitRatio > 0.6 && /\d{3,}[\.\-]\d{3,}/.test(local)) {
      conflicts.push({ t: 'Email looks like phone number', d: `"${email}" appears to be a phone number entered in the email field. Verify.`, section: 'Personal Information' });
    }
  }

  // FIX (2026-11-03): A-Number format validation (8-9 digits)
  const aNumber = get('n400_a_number');
  if (aNumber) {
    const digits = aNumber.replace(/^A/i, '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 9) {
      conflicts.push({ t: 'A-Number format', d: `"${aNumber}" — A-Numbers are 8-9 digits. Verify this is correct.`, section: 'Personal Information' });
    }
  }

  if (get('n400_arrests') === 'yes' && get('n400_taxes') === 'no') {
    inferred.push({ t: 'Heightened character review', d: 'The combination of arrest history and missing tax filings may draw additional scrutiny on good moral character. Address both proactively.', section: 'Good Moral Character' });
  }

  // --- Premium intelligence (owner directive 2026-11-10) ---
  // Date logic: the residence path, trips, and marital history must be
  // mutually consistent. Contradictions are CONFLICT blockers.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lprDate = parseAnyDate(get('n400_lpr_date'));
  const dob = parseAnyDate(get('n400_dob'));
  const marriageDate = parseAnyDate(get('n400_marriage_date'));
  const spouseNatzDate = parseAnyDate(get('n400_spouse_natz_date'));
  const spouseDob = parseAnyDate(get('n400_spouse_dob'));

  // Future dates are impossible.
  const futureChecks: [string, Date | null, string, string][] = [
    ['n400_dob', dob, 'Date of birth', 'Personal Information'],
    ['n400_lpr_date', lprDate, 'Date became a lawful permanent resident', 'Eligibility'],
    ['n400_marriage_date', marriageDate, 'Marriage date', 'Marital History'],
    ['n400_spouse_natz_date', spouseNatzDate, "Spouse's naturalization date", 'Marital History'],
    ['n400_spouse_dob', spouseDob, "Spouse's date of birth", 'Marital History'],
  ];
  for (const [id, d, label, section] of futureChecks) {
    if (d && d > today) {
      conflicts.push({ t: `${label} is in the future`, d: `${label} (${get(id)}) is after today. A future date cannot be correct — correct it before filing.`, section });
    }
  }

  // LPR date vs. claimed years: the claimed path must match the date.
  if (lprDate && lprDate <= today) {
    const yrs = yearsBetween(lprDate, today);
    if (dur === '5_plus' && yrs < 5) {
      conflicts.push({ t: 'Residency duration contradicts LPR date', d: `Claims 5 or more years as an LPR, but the LPR date (${get('n400_lpr_date')}) is only ${yrs.toFixed(1)} years ago. The five-year path is not met — correct the duration or the date.`, section: 'Eligibility' });
    } else if (dur === '3_to_5' && yrs < 3) {
      conflicts.push({ t: 'Residency duration contradicts LPR date', d: `Claims 3–5 years as an LPR, but the LPR date (${get('n400_lpr_date')}) is only ${yrs.toFixed(1)} years ago. The three-year path is not met — correct the duration or the date.`, section: 'Eligibility' });
    } else if (dur === 'under_3' && yrs >= 3) {
      conflicts.push({ t: 'Residency duration contradicts LPR date', d: `Claims under 3 years as an LPR, but the LPR date (${get('n400_lpr_date')}) is ${yrs.toFixed(1)} years ago. Correct the duration or the date.`, section: 'Eligibility' });
    }
  }

  // Became an LPR before being born is impossible.
  if (dob && lprDate && lprDate < dob) {
    conflicts.push({ t: 'LPR date before date of birth', d: `Became a lawful permanent resident (${get('n400_lpr_date')}) before being born (${get('n400_dob')}). One of these dates is wrong.`, section: 'Eligibility' });
  }

  // Three-year path: marriage to a USC must be at least 3 years old, and
  // the spouse must have been a USC for at least 3 years.
  if (marriedUsc) {
    if (marriageDate && marriageDate <= today && yearsBetween(marriageDate, today) < 3) {
      conflicts.push({ t: 'Marriage is less than 3 years old for the 3-year path', d: `The 3-year naturalization path requires 3 years of marriage to a U.S. citizen, but the marriage date (${get('n400_marriage_date')}) is less than 3 years ago. The 5-year path may apply instead — correct the path or the date.`, section: 'Marital History' });
    }
    if (spouseNatzDate && spouseNatzDate <= today && yearsBetween(spouseNatzDate, today) < 3) {
      conflicts.push({ t: 'Spouse has been a U.S. citizen less than 3 years', d: `The 3-year path requires the spouse to have been a U.S. citizen for 3 years, but the spouse's naturalization date (${get('n400_spouse_natz_date')}) is less than 3 years ago. The 5-year path may apply instead.`, section: 'Marital History' });
    }
  }
  // Married before being born is impossible (either spouse).
  if (dob && marriageDate && marriageDate < dob) {
    conflicts.push({ t: 'Marriage date before date of birth', d: `Marriage date (${get('n400_marriage_date')}) is before the applicant's date of birth (${get('n400_dob')}). One of these dates is wrong.`, section: 'Marital History' });
  }
  if (spouseDob && marriageDate && marriageDate < spouseDob) {
    conflicts.push({ t: 'Marriage date before spouse date of birth', d: `Marriage date (${get('n400_marriage_date')}) is before the spouse's date of birth (${get('n400_spouse_dob')}). One of these dates is wrong.`, section: 'Marital History' });
  }

  // Residence history: inverted ranges are impossible; gaps are flagged.
  const residences = get('n400_residence_history');
  if (Array.isArray(residences) && residences.length) {
    const spans: { from: Date; to: Date; idx: number }[] = [];
    residences.forEach((r: any, i: number) => {
      const from = parseRangeDate(r.from, today);
      const to = parseRangeDate(r.to, today);
      if (from && to) {
        if (from > to) {
          conflicts.push({ t: 'Residence dates are inverted', d: `Residence #${i + 1} runs from ${r.from} to ${r.to} — the start is after the end. Correct the dates.`, section: 'Residence' });
        } else {
          spans.push({ from, to, idx: i + 1 });
        }
      }
      if (from && from > today) {
        conflicts.push({ t: 'Residence start date is in the future', d: `Residence #${i + 1} starts ${r.from}, which is after today. Correct the date.`, section: 'Residence' });
      }
    });
    spans.sort((a, b) => a.from.getTime() - b.from.getTime());
    for (let i = 1; i < spans.length; i++) {
      const gapDays = daysBetween(spans[i - 1].to, spans[i].from);
      if (gapDays > 180) {
        inferred.push({ t: 'Gap in residence history', d: `There is a gap of about ${Math.round(gapDays / 30)} months between residence #${spans[i - 1].idx} and residence #${spans[i].idx}. Every address in the last 5 years must be listed — add the missing address.`, section: 'Residence' });
      }
    }
    if (lprDate) {
      const beforeLpr = spans.filter(s => s.from < lprDate);
      if (beforeLpr.length) {
        inferred.push({ t: 'Residence before becoming an LPR', d: `${beforeLpr.length} residence(s) start before the LPR date (${get('n400_lpr_date')}). This is fine if the applicant lived here under another status — confirm the prior status is documented.`, section: 'Residence' });
      }
    }
  }

  // Employment history: inverted ranges are impossible; overlaps are flagged.
  const employment = get('n400_employment_history');
  if (Array.isArray(employment) && employment.length) {
    const spans: { from: Date; to: Date; idx: number }[] = [];
    employment.forEach((e: any, i: number) => {
      const from = parseRangeDate(e.from, today);
      const to = parseRangeDate(e.to, today);
      if (from && to) {
        if (from > to) {
          conflicts.push({ t: 'Employment dates are inverted', d: `Employment #${i + 1} runs from ${e.from} to ${e.to} — the start is after the end. Correct the dates.`, section: 'Employment' });
        } else {
          spans.push({ from, to, idx: i + 1 });
        }
      }
    });
    spans.sort((a, b) => a.from.getTime() - b.from.getTime());
    for (let i = 1; i < spans.length; i++) {
      // Overlap longer than 2 months (a brief handover is normal).
      const overlapDays = daysBetween(spans[i].from, spans[i - 1].to);
      if (overlapDays > 60) {
        inferred.push({ t: 'Overlapping employment periods', d: `Employment #${spans[i - 1].idx} and #${spans[i].idx} overlap by about ${Math.round(overlapDays / 30)} months. Verify — this may be concurrent part-time work, or a date error.`, section: 'Employment' });
      }
    }
  }

  // Trips: inverted or overlapping trips are impossible; trips before the
  // LPR date do not count against LPR continuous residence.
  if (Array.isArray(trips)) {
    const tripSpans: { dep: Date; ret: Date; idx: number }[] = [];
    trips.forEach((trip: any, i: number) => {
      const dep = parseAnyDate(trip.departure || trip.from);
      const ret = parseAnyDate(trip.return || trip.to);
      if (dep && ret) {
        if (ret < dep) {
          conflicts.push({ t: 'Trip return is before departure', d: `Trip #${i + 1} returns ${trip.return || trip.to} before departing ${trip.departure || trip.from}. Correct the dates.`, section: 'Travel History' });
        } else {
          tripSpans.push({ dep, ret, idx: i + 1 });
        }
      }
      if (dep && dep > today) {
        conflicts.push({ t: 'Trip departure is in the future', d: `Trip #${i + 1} departs ${trip.departure || trip.from}, which is after today. Correct the date.`, section: 'Travel History' });
      }
    });
    tripSpans.sort((a, b) => a.dep.getTime() - b.dep.getTime());
    for (let i = 1; i < tripSpans.length; i++) {
      if (tripSpans[i].dep <= tripSpans[i - 1].ret) {
        conflicts.push({ t: 'Overlapping trips', d: `Trip #${tripSpans[i - 1].idx} and trip #${tripSpans[i].idx} overlap — the applicant cannot be on two trips at once. Correct the dates.`, section: 'Travel History' });
      }
    }
    if (lprDate) {
      const beforeLpr = tripSpans.filter(t => t.ret < lprDate);
      if (beforeLpr.length) {
        inferred.push({ t: 'Trip before becoming an LPR', d: `${beforeLpr.length} trip(s) ended before the LPR date (${get('n400_lpr_date')}). These do not count against continuous residence as an LPR.`, section: 'Travel History' });
      }
    }
  }

  // Child support: has children but not paying support affects GMC.
  if (hasChildren === 'yes' && childSupport === 'no') {
    inferred.push({ t: 'Child support not current', d: 'Children are listed but child support is not current. Failure to support dependents can affect the good moral character finding — address this before filing.', section: 'Good Moral Character' });
  }

  // Narrative preparation: draft explanations for every GMC "yes".
  const gmcDraft = explanationDraftFinding('n400', answers);
  if (gmcDraft) inferred.push(gmcDraft);

  return { inferred, conflicts };
}

function detectI130Intelligence(answers: Record<string, any>): IntelligenceResult {
  const inferred: Finding[] = [], conflicts: Finding[] = [];
  const get = (id: string) => answers[id];
  const isUsc = get('i130_petitioner_status') === 'usc';
  const rel = get('i130_relationship');
  // Relationship values: the select uses child_under_21 / son_daughter_over_21;
  // a second (radio) question uses 'child'. Accept all variants.
  const isChildUnder21 = ['child_under_21', 'child', 'unmarried_child'].includes(rel);
  const isSonDaughterOver21 = rel === 'son_daughter_over_21';
  const isChild = isChildUnder21 || isSonDaughterOver21 || rel === 'married_child';
  // FIX (Premium): the old check used 'unmarried_child', which is not a
  // question value — the immediate-relative inference never fired for
  // children. Use the real option values.
  if (isUsc && (rel === 'spouse' || rel === 'parent' || isChildUnder21)) {
    inferred.push({ t: 'Immediate relative category', d: 'As a U.S. citizen petitioning for a spouse, parent, or unmarried child under 21, this is an immediate relative case - no visa number wait.', section: 'Eligibility' });
  } else if (isUsc && (isSonDaughterOver21 || rel === 'married_child' || rel === 'sibling')) {
    inferred.push({ t: 'Family preference category', d: 'This relationship falls under family preference - visa number availability and priority dates will affect timing.', section: 'Eligibility' });
  } else if (!isUsc && (rel === 'spouse' || isChildUnder21)) {
    inferred.push({ t: 'Family preference category (F2A)', d: 'As a green card holder petitioning for a spouse or unmarried child under 21, this is preference category F2A - visa number availability and priority dates will affect timing.', section: 'Eligibility' });
  } else if (!isUsc && isSonDaughterOver21) {
    inferred.push({ t: 'Family preference category (F2B)', d: 'As a green card holder petitioning for an unmarried son or daughter over 21, this is preference category F2B - visa number availability and priority dates will affect timing.', section: 'Eligibility' });
  } else if (rel) {
    inferred.push({ t: 'Family preference category', d: 'This relationship falls under family preference - visa number availability and priority dates will affect timing.', section: 'Eligibility' });
  }
  if (!isUsc && rel === 'sibling') {
    conflicts.push({ t: 'Ineligible petition', d: 'A green card holder cannot petition for a sibling. The petitioner would need to naturalize first.', section: 'Eligibility' });
  }

  // --- Premium intelligence (owner directive 2026-11-10) ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const petDob = parseAnyDate(get('i130_pet_dob'));
  const benDob = parseAnyDate(get('i130_ben_dob'));
  const petMarriage = parseAnyDate(get('i130_pet_marriage_date'));
  const benMarriage = parseAnyDate(get('i130_ben_marriage_date'));
  const priorDate = parseAnyDate(get('i130_prior_petition_date'));
  const child1Dob = parseAnyDate(get('i130_ben_child1_dob'));

  // Future dates are impossible.
  const futureChecks: [string, Date | null, string][] = [
    ['i130_pet_dob', petDob, "Petitioner's date of birth"],
    ['i130_ben_dob', benDob, "Beneficiary's date of birth"],
    ['i130_pet_marriage_date', petMarriage, "Petitioner's marriage date"],
    ['i130_ben_marriage_date', benMarriage, "Beneficiary's marriage date"],
    ['i130_prior_petition_date', priorDate, 'Prior petition date'],
    ['i130_ben_child1_dob', child1Dob, "Beneficiary child 1's date of birth"],
  ];
  for (const [id, d, label] of futureChecks) {
    if (d && d > today) {
      conflicts.push({ t: `${label} is in the future`, d: `${label} (${get(id)}) is after today. A future date cannot be correct — correct it before filing.`, section: 'Personal Information' });
    }
  }

  // Parent/child age impossibility: a parent cannot be born after their child.
  if (petDob && benDob) {
    if (rel === 'parent' && petDob < benDob) {
      conflicts.push({ t: 'Petitioner is older than the parent beneficiary', d: `Petitioning for a parent, but the petitioner's date of birth (${get('i130_pet_dob')}) is before the beneficiary's (${get('i130_ben_dob')}). A child cannot be older than their parent — correct the dates or the relationship.`, section: 'Eligibility' });
    } else if (isChild && petDob > benDob) {
      conflicts.push({ t: 'Petitioner is younger than the child beneficiary', d: `Petitioning for a child, but the petitioner's date of birth (${get('i130_pet_dob')}) is after the beneficiary's (${get('i130_ben_dob')}). A parent cannot be younger than their child — correct the dates or the relationship.`, section: 'Eligibility' });
    }
  }

  // Beneficiary age vs. claimed relationship category.
  if (benDob && benDob <= today) {
    const benAge = yearsBetween(benDob, today);
    if (isChildUnder21 && benAge >= 21) {
      conflicts.push({ t: 'Beneficiary is 21 or older, not a child under 21', d: `Relationship is "child under 21" but the beneficiary's date of birth (${get('i130_ben_dob')}) indicates age ${Math.floor(benAge)}. The category is wrong — this is a son/daughter over 21, a different preference category.`, section: 'Eligibility' });
    } else if (isSonDaughterOver21 && benAge < 21) {
      conflicts.push({ t: 'Beneficiary is under 21, not a son/daughter over 21', d: `Relationship is "son/daughter over 21" but the beneficiary's date of birth (${get('i130_ben_dob')}) indicates age ${Math.floor(benAge)}. The category is wrong — this is a child under 21.`, section: 'Eligibility' });
    }
  }

  // Petitioner under 21 cannot petition for a sibling or parent.
  if (petDob && petDob <= today && ['sibling', 'parent'].includes(rel) && yearsBetween(petDob, today) < 21) {
    conflicts.push({ t: 'Petitioner is under 21', d: `Petitioning for a ${rel} requires the petitioner to be at least 21, but the petitioner's date of birth (${get('i130_pet_dob')}) indicates age ${Math.floor(yearsBetween(petDob, today))}.`, section: 'Eligibility' });
  }

  // Marriage dates: a spouse petition's two marriage dates must match
  // (the petitioner and beneficiary are married to each other), and no
  // one can marry before being born.
  if (rel === 'spouse' && petMarriage && benMarriage) {
    const diffDays = Math.abs(daysBetween(petMarriage, benMarriage));
    if (diffDays > 30) {
      conflicts.push({ t: 'Marriage dates do not match', d: `The petitioner's marriage date (${get('i130_pet_marriage_date')}) and the beneficiary's marriage date (${get('i130_ben_marriage_date')}) differ by ${diffDays} days. For a spouse petition these are the same marriage — correct one of the dates.`, section: 'Relationship' });
    } else if (diffDays > 0) {
      inferred.push({ t: 'Marriage dates differ slightly', d: `The petitioner's marriage date (${get('i130_pet_marriage_date')}) and the beneficiary's marriage date (${get('i130_ben_marriage_date')}) differ by ${diffDays} day(s). Verify the exact date — they should match.`, section: 'Relationship' });
    }
  }
  if (petDob && petMarriage && petMarriage < petDob) {
    conflicts.push({ t: "Petitioner's marriage date is before their birth", d: `Petitioner's marriage date (${get('i130_pet_marriage_date')}) is before their date of birth (${get('i130_pet_dob')}). One of these dates is wrong.`, section: 'Relationship' });
  }
  if (benDob && benMarriage && benMarriage < benDob) {
    conflicts.push({ t: "Beneficiary's marriage date is before their birth", d: `Beneficiary's marriage date (${get('i130_ben_marriage_date')}) is before their date of birth (${get('i130_ben_dob')}). One of these dates is wrong.`, section: 'Relationship' });
  }

  // Prior petition consistency.
  if (get('i130_prior_petition') === 'yes' && !get('i130_prior_petition_date')) {
    conflicts.push({ t: 'Prior petition date is missing', d: 'A prior petition was indicated but no filing date was given. The date is needed to check the prior case. Provide it.', section: 'Filing History' });
  }
  if (get('i130_prior_denied') === 'yes' && get('i130_prior_petition') !== 'yes') {
    conflicts.push({ t: 'Prior denial without a prior petition', d: 'A prior petition denial was indicated, but "prior petition" was answered No. A denial requires a prior petition — correct one of the answers.', section: 'Filing History' });
  }
  const priorResult = get('i130_prior_petition_result');
  if (priorResult && /denied|revoked/i.test(String(priorResult)) && get('i130_prior_denied') === 'no') {
    conflicts.push({ t: 'Prior result says denied, but denial was answered No', d: `The prior petition result ("${priorResult}") indicates a denial or revocation, but "prior petition denied" was answered No. Correct one of the answers.`, section: 'Filing History' });
  }

  // Concurrent filing requires the beneficiary to be in the US.
  if (get('i130_concurrent_filing') === 'yes' && get('i130_ben_location') === 'no') {
    conflicts.push({ t: 'Concurrent filing with beneficiary outside the U.S.', d: 'Concurrent filing (I-485 with the I-130) requires the beneficiary to be in the United States, but the beneficiary is outside the U.S. Correct the filing plan or the location.', section: 'Filing Requirements' });
  }

  // Beneficiary in removal proceedings affects the filing strategy.
  if (get('i130_ben_proceedings') === 'yes') {
    inferred.push({ t: 'Beneficiary in removal proceedings', d: 'The beneficiary is in removal proceedings. This affects where and how the case proceeds — staff should confirm the court and the filing strategy before submitting.', section: 'Filing History' });
  }

  // Multiple beneficiaries need the derivative children listed.
  if (get('i130_multiple_beneficiaries') === 'yes' && !get('i130_ben_child1_dob') && !get('i130_ben_child1_family')) {
    conflicts.push({ t: 'Derivative children not listed', d: 'Multiple beneficiaries were indicated but no derivative child was listed. List each derivative child — they must be named on the petition.', section: 'Family' });
  }

  // Narrative preparation: draft explanations for the prior denial and proceedings.
  const draft = explanationDraftFinding('i130', answers);
  if (draft) inferred.push(draft);

  return { inferred, conflicts };
}

function detectI485Intelligence(answers: Record<string, any>): IntelligenceResult {
  const inferred: Finding[] = [], conflicts: Finding[] = [];
  const get = (id: string) => answers[id];
  const basisApproved = get('i485_basis_approved') === 'yes';
  const visa = get('i485_visa_available');
  if (basisApproved && visa === 'yes') {
    inferred.push({ t: 'Ready to file', d: 'With an approved underlying petition and an available visa number, the core I-485 requirements are met.', section: 'Eligibility' });
  } else if (basisApproved && visa === 'no') {
    inferred.push({ t: 'Waiting on visa number', d: 'The petition is approved but no visa is available. Monitor the Visa Bulletin - filing now would be rejected.', section: 'Eligibility' });
  }
  if (get('i485_fraud') === 'yes' && get('i485_criminal') === 'yes') {
    conflicts.push({ t: 'Multiple inadmissibility grounds', d: 'Both fraud/misrepresentation and criminal history were disclosed. This combination likely requires a waiver strategy - urgent attorney consultation needed.', section: 'Admissibility' });
  }
  if (get('i485_medical') !== 'yes' && get('i485_last_entry') !== 'yes') {
    inferred.push({ t: 'Compounded preparation needs', d: 'Both the medical exam and entry documentation need attention. Start the medical exam early - civil surgeon appointments can take weeks.', section: 'Supporting Documents' });
  }

  // --- Premium intelligence (owner directive 2026-11-10) ---
  // Immigration history, entries, status, and inadmissibility grounds
  // must be mutually consistent. Contradictions are CONFLICT blockers.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dob = parseAnyDate(get('i485_dob'));
  const arrival = parseAnyDate(get('i485_arrival_date'));
  const asylumGrant = parseAnyDate(get('i485_asylum_grant_date'));
  const refugeeAdmission = parseAnyDate(get('i485_refugee_admission_date'));
  const visaIssue = parseAnyDate(get('i485_visa_issue_date'));
  const visaDecision = parseAnyDate(get('i485_visa_decision_date'));
  const priorMarriage = parseAnyDate(get('i485_prior_marriage_date'));
  const priorityDate = parseAnyDate(get('i485_petition_priority_date'));
  const i94Expiry = parseAnyDate(get('i485_i94_expiry'));
  const statusExpiry = parseAnyDate(get('i485_current_status_expiry'));
  const passportExpiry = parseAnyDate(get('i485_passport_expiry'));

  // Future dates are impossible.
  const futureChecks: [string, Date | null, string, string][] = [
    ['i485_dob', dob, 'Date of birth', 'Personal Information'],
    ['i485_arrival_date', arrival, 'Date of last arrival', 'Immigration History'],
    ['i485_asylum_grant_date', asylumGrant, 'Asylum grant date', 'Eligibility'],
    ['i485_refugee_admission_date', refugeeAdmission, 'Refugee admission date', 'Eligibility'],
    ['i485_visa_issue_date', visaIssue, 'Visa issue date', 'Immigration History'],
    ['i485_visa_decision_date', visaDecision, 'Visa decision date', 'Immigration History'],
    ['i485_prior_marriage_date', priorMarriage, 'Prior marriage date', 'Family'],
    ['i485_petition_priority_date', priorityDate, 'Priority date', 'Eligibility'],
  ];
  for (const [id, d, label, section] of futureChecks) {
    if (d && d > today) {
      conflicts.push({ t: `${label} is in the future`, d: `${label} (${get(id)}) is after today. A future date cannot be correct — correct it before filing.`, section });
    }
  }

  // Arrived before being born is impossible; married to a prior spouse
  // before being born is impossible; a child cannot be born before the parent.
  if (dob && arrival && arrival < dob) {
    conflicts.push({ t: 'Arrival date is before date of birth', d: `Last arrival (${get('i485_arrival_date')}) is before the date of birth (${get('i485_dob')}). One of these dates is wrong.`, section: 'Immigration History' });
  }
  if (dob && priorMarriage && priorMarriage < dob) {
    conflicts.push({ t: 'Prior marriage date is before date of birth', d: `Prior marriage date (${get('i485_prior_marriage_date')}) is before the date of birth (${get('i485_dob')}). One of these dates is wrong.`, section: 'Family' });
  }
  for (const childId of ['i485_child2_dob', 'i485_child3_dob'] as const) {
    const childDob = parseAnyDate(get(childId));
    if (dob && childDob && childDob < dob) {
      conflicts.push({ t: 'Child date of birth is before parent date of birth', d: `Child date of birth (${get(childId)}) is before the applicant's date of birth (${get('i485_dob')}). A child cannot be born before their parent — correct one of the dates.`, section: 'Family' });
    }
    if (childDob && childDob > today) {
      conflicts.push({ t: 'Child date of birth is in the future', d: `Child date of birth (${get(childId)}) is after today. A future date cannot be correct — correct it before filing.`, section: 'Family' });
    }
  }

  // Inspected entry but no I-94 number: a lawful admission generates an I-94.
  if (get('i485_last_entry') === 'yes' && !get('i485_i94_number')) {
    conflicts.push({ t: 'Inspected entry but no I-94 number', d: 'The last entry was inspected and admitted, but no Form I-94 number was provided. A lawful admission generates an I-94 — provide the number or correct the manner of entry.', section: 'Immigration History' });
  }

  // Status expiry in the past while claiming status is maintained.
  if (get('i485_status_maintained') === 'yes') {
    if (i94Expiry && i94Expiry < today) {
      conflicts.push({ t: 'I-94 expired but status is claimed maintained', d: `The I-94 authorized stay expired (${get('i485_i94_expiry')}) but status is claimed as maintained. An expired I-94 means the authorized stay ended — correct the status or provide the current status document.`, section: 'Immigration History' });
    }
    if (statusExpiry && statusExpiry < today) {
      conflicts.push({ t: 'Current status expired but claimed maintained', d: `The current immigration status expired (${get('i485_current_status_expiry')}) but status is claimed as maintained. Correct the status or provide the current status document.`, section: 'Immigration History' });
    }
  }

  // Passport expired: a document issue, not a hard blocker.
  if (passportExpiry && passportExpiry < today) {
    inferred.push({ t: 'Passport has expired', d: `The passport or travel document expired (${get('i485_passport_expiry')}). A valid passport is normally needed for the application — renew it or confirm the document is still accepted.`, section: 'Supporting Documents' });
  }

  // Asylum basis: the grant must be at least 1 year ago to adjust.
  const basis = get('i485_basis');
  if (basis === 'asylum') {
    if (!asylumGrant) {
      conflicts.push({ t: 'Asylum grant date is missing', d: 'Asylum was selected as the basis but no grant date was given. Asylum-based adjustment requires at least one year since the grant — provide the date.', section: 'Eligibility' });
    } else if (asylumGrant <= today && yearsBetween(asylumGrant, today) < 1) {
      conflicts.push({ t: 'Asylum grant is less than one year ago', d: `Asylum-based adjustment requires at least one year since the grant, but the grant date (${get('i485_asylum_grant_date')}) is less than one year ago. The applicant cannot adjust yet.`, section: 'Eligibility' });
    }
  }
  // Refugee basis: admission must be at least 1 year ago to adjust.
  if (basis === 'refugee') {
    if (!refugeeAdmission) {
      conflicts.push({ t: 'Refugee admission date is missing', d: 'Refugee was selected as the basis but no admission date was given. Refugee adjustment requires at least one year since admission — provide the date.', section: 'Eligibility' });
    } else if (refugeeAdmission <= today && yearsBetween(refugeeAdmission, today) < 1) {
      conflicts.push({ t: 'Refugee admission is less than one year ago', d: `Refugee adjustment requires at least one year since admission, but the admission date (${get('i485_refugee_admission_date')}) is less than one year ago. The applicant cannot adjust yet.`, section: 'Eligibility' });
    }
  }

  // Visa available but the priority date is in the future: a future
  // priority date cannot be current.
  if (visa === 'yes' && priorityDate && priorityDate > today) {
    conflicts.push({ t: 'Visa available but priority date is in the future', d: `An immigrant visa is claimed available, but the priority date (${get('i485_petition_priority_date')}) is in the future. A future priority date cannot be current — correct the date or the visa availability.`, section: 'Eligibility' });
  }

  // Employment date ranges: an inverted range is impossible.
  for (const [fromId, toId, label] of [['i485_emp1_date_from', 'i485_emp1_date_to', 'Employment 1'], ['i485_emp2_date_from', 'i485_emp2_date_to', 'Employment 2'], ['i485_recent_date_from', 'i485_recent_date_to', 'Most recent employment'], ['i485_prior_date_from', 'i485_prior_date_to', 'Prior employment'], ['i485_org1_date_from', 'i485_org1_date_to', 'Organization 1'], ['i485_org2_date_from', 'i485_org2_date_to', 'Organization 2']] as const) {
    const from = parseAnyDate(get(fromId));
    const to = parseAnyDate(get(toId));
    if (from && to && from > to) {
      conflicts.push({ t: `${label} dates are inverted`, d: `${label} runs from ${get(fromId)} to ${get(toId)} — the start is after the end. Correct the dates.`, section: 'Employment' });
    }
  }

  // In the US but no physical-address start date: completeness, not a conflict.
  if (get('i485_in_us') === 'yes' && !get('i485_phys_date_first')) {
    inferred.push({ t: 'Physical address start date missing', d: 'The applicant is in the U.S. but no date was given for when they first resided at their current physical address. Provide it — the form asks for it.', section: 'Personal Information' });
  }

  // Narrative preparation: draft explanations for every Part 8 "yes".
  const draft = explanationDraftFinding('i485', answers);
  if (draft) inferred.push(draft);

  return { inferred, conflicts };
}

function detectI90Intelligence(answers: Record<string, any>): IntelligenceResult {
  const inferred: Finding[] = [], conflicts: Finding[] = [];
  const get = (id: string) => answers[id];
  const reason = get('i90_reason');
  if (reason === '2a') {
    inferred.push({ t: 'Police report recommended', d: 'For a lost or stolen card, filing a police report creates a paper trail that protects against identity misuse.', section: 'Filing Basis' });
  } else if (reason === '2f') {
    inferred.push({ t: 'Routine renewal', d: 'Standard 10-year card renewal. File within 6 months of expiration to avoid a lapse.', section: 'Filing Basis' });
  }
  if (reason === '2a' && get('i90_has_card') === 'yes') {
    conflicts.push({ t: 'Card status contradiction', d: 'Reason indicates lost/stolen card, but applicant says they have the physical card. Clarify the actual situation.', section: 'Filing Basis' });
  }

  // --- Premium intelligence (owner directive 2026-11-10) ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cardExpiry = parseAnyDate(get('i90_card_expiry'));
  const admission = parseAnyDate(get('i90_date_admission'));
  const dob = parseAnyDate(get('i90_dob'));

  // Future dates are impossible.
  const futureChecks: [string, Date | null, string][] = [
    ['i90_card_expiry', cardExpiry, 'Card expiration date'],
    ['i90_date_admission', admission, 'Date admitted as a permanent resident'],
    ['i90_dob', dob, 'Date of birth'],
  ];
  for (const [id, d, label] of futureChecks) {
    if (d && d > today) {
      conflicts.push({ t: `${label} is in the future`, d: `${label} (${get(id)}) is after today. A future date cannot be correct — correct it before filing.`, section: 'Personal Information' });
    }
  }

  // Admitted before being born is impossible.
  if (dob && admission && admission < dob) {
    conflicts.push({ t: 'Admission date is before date of birth', d: `Admitted as a permanent resident (${get('i90_date_admission')}) before being born (${get('i90_dob')}). One of these dates is wrong.`, section: 'Personal Information' });
  }
  // Card cannot expire before the admission that produced it.
  if (admission && cardExpiry && cardExpiry < admission) {
    conflicts.push({ t: 'Card expires before the admission date', d: `The card expires (${get('i90_card_expiry')}) before the date of admission (${get('i90_date_admission')}). The card is issued after admission — correct one of the dates.`, section: 'Filing Basis' });
  }

  // Reason 2f (expired or expires within 6 months) must match the card expiry.
  if (reason === '2f' && cardExpiry && cardExpiry <= today) {
    inferred.push({ t: 'Card already expired', d: `The card expired (${get('i90_card_expiry')}). File promptly — a lapsed card can complicate proof of status.`, section: 'Filing Basis' });
  } else if (reason === '2f' && cardExpiry) {
    const monthsToExpiry = (cardExpiry.getTime() - today.getTime()) / (30.44 * 86400000);
    if (monthsToExpiry > 6) {
      conflicts.push({ t: 'Card does not expire within 6 months', d: `Reason 2f is for a card that has expired or expires within 6 months, but this card expires in about ${Math.round(monthsToExpiry)} months (${get('i90_card_expiry')}). The reason does not match — correct the reason or the expiry date.`, section: 'Filing Basis' });
    }
  }
  // Card expiring within 6 months but a different reason was chosen.
  if (reason && reason !== '2f' && cardExpiry && cardExpiry > today) {
    const monthsToExpiry = (cardExpiry.getTime() - today.getTime()) / (30.44 * 86400000);
    if (monthsToExpiry <= 6) {
      inferred.push({ t: 'Card expires within 6 months', d: `The card expires in about ${Math.round(monthsToExpiry)} month(s) (${get('i90_card_expiry')}). If renewal is the goal, reason 2f may be the right choice — confirm the filing reason.`, section: 'Filing Basis' });
    }
  }

  // Reason 2b (issued but never received) contradicts having the card.
  if (reason === '2b' && get('i90_has_card') === 'yes') {
    conflicts.push({ t: 'Card status contradiction', d: 'Reason indicates the card was issued but never received, but the applicant says they have the physical card. Clarify the actual situation.', section: 'Filing Basis' });
  }

  // Name change: the reason and the name answers must agree, and the
  // card name must be compared against the current legal name.
  const cardFamily = get('i90_card_name_family');
  const cardGiven = get('i90_card_name_given');
  const curFamily = get('i90_name');
  const curGiven = get('i90_given');
  const nameChanged = get('i90_name_changed');
  if (reason === '2e' && nameChanged === 'no') {
    conflicts.push({ t: 'Name-change reason but no name change reported', d: 'Reason 2e is for a name or biographical change, but "name changed" was answered No. Correct the reason or the name-change answer.', section: 'Filing Basis' });
  }
  if (cardFamily && curFamily && cardGiven && curGiven) {
    const sameFamily = String(cardFamily).trim().toLowerCase() === String(curFamily).trim().toLowerCase();
    const sameGiven = String(cardGiven).trim().toLowerCase() === String(curGiven).trim().toLowerCase();
    if (nameChanged === 'yes' && sameFamily && sameGiven) {
      inferred.push({ t: 'Card already shows the current name', d: 'A name change was reported, but the name printed on the card matches the current legal name exactly. No correction may be needed — confirm the card is the one being replaced.', section: 'Filing Basis' });
    } else if (nameChanged === 'no' && (!sameFamily || !sameGiven)) {
      conflicts.push({ t: 'Card name differs but no name change reported', d: `The name on the card ("${cardFamily} ${cardGiven}") differs from the current legal name ("${curFamily} ${curGiven}"), but "name changed" was answered No. Correct the name-change answer — the reason may be 2e — or correct the name.`, section: 'Filing Basis' });
    }
  }

  // Exclusion/deportation or abandonment affects whether I-90 is the right form.
  if (get('i90_exclusion') === 'yes') {
    inferred.push({ t: 'Exclusion or deportation proceedings', d: 'The applicant disclosed exclusion, deportation, or removal proceedings. This can affect eligibility for a replacement card — attorney review is recommended before filing.', section: 'Filing Basis' });
  }
  if (get('i90_abandoned') === 'yes') {
    inferred.push({ t: 'Abandonment of status disclosed', d: 'The applicant disclosed abandonment of permanent resident status. Abandonment can mean the person is no longer an LPR — I-90 may not be the right form. Attorney review is recommended.', section: 'Filing Basis' });
  }

  // A-Number format (8-9 digits), same pattern as N-400/I-765.
  const aNum = get('i90_a_number');
  if (aNum) {
    const digits = String(aNum).replace(/^A/i, '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 9) {
      conflicts.push({ t: 'A-Number format', d: `"${aNum}" — A-Numbers are 8-9 digits. Verify this is correct.`, section: 'Personal Information' });
    }
  }

  // Lost/stolen without a police report: recommended, not required.
  if (reason === '2a' && get('i90_police_report') === 'no') {
    inferred.push({ t: 'No police report for lost/stolen card', d: 'A police report was not filed for the lost or stolen card. A report is recommended — it creates a paper trail and protects against identity misuse.', section: 'Filing Basis' });
  }

  // Narrative preparation: draft for a name change.
  const draft = explanationDraftFinding('i90', answers);
  if (draft) inferred.push(draft);

  return { inferred, conflicts };
}

function detectI589Intelligence(answers: Record<string, any>): IntelligenceResult {
  const inferred: Finding[] = [], conflicts: Finding[] = [];
  const get = (id: string) => answers[id];
  const entryDate = get('i589_entry_date');
  let daysSince = -1;
  if (entryDate) {
    daysSince = Math.floor((Date.now() - new Date(entryDate).getTime()) / (1000 * 60 * 60 * 24));
  }
  const inProceedings = get('i589_in_proceedings') === 'yes';
  if (daysSince > 300 && daysSince <= 365) {
    inferred.push({ t: 'Deadline approaching', d: `Only ${365 - daysSince} days remain in the one-year filing window. Prioritize completing this application.`, section: 'Eligibility' });
  }
  if (daysSince > 365 && inProceedings) {
    inferred.push({ t: 'Defensive filing with deadline issue', d: 'Filing defensively in court with a blown one-year deadline requires establishing an exception. This needs attorney strategy, not just form completion.', section: 'Filing History' });
  }
  const grounds = get('i589_persecution_grounds');
  const hasEvidence = get('i589_has_evidence') === 'yes';
  if (grounds && hasEvidence) {
    inferred.push({ t: 'Strong claim foundation', d: `A clear protected ground (${grounds}) combined with documentary evidence provides a solid basis for the asylum claim.`, section: 'Basis for Asylum' });
  } else if (grounds && !hasEvidence) {
    inferred.push({ t: 'Testimony-dependent claim', d: 'The claim rests on testimony without documentary evidence. Detailed, consistent personal declaration becomes critical.', section: 'Basis for Asylum' });
  }
  if (get('i589_prior_filing') === 'yes' && inProceedings) {
    conflicts.push({ t: 'Prior filing in proceedings', d: 'A previous asylum filing combined with current removal proceedings suggests a defensive re-filing. Verify the prior case status.', section: 'Filing History' });
  }
  return { inferred, conflicts };
}

// Premium gating (owner directive 2026-11-10): the intelligence layer
// (contradiction detection, narrative preparation, adaptive screening,
// document intelligence, comprehensive readiness assessment) is a
// PREMIUM PREPARATION feature. It applies ONLY when the applicant holds
// a paid preparation entitlement for the form. A Readiness-only buyer
// ($99.95) gets the basic assessment — no Premium intelligence — and a
// free/basic or institutional flow gets none unless explicitly configured
// for it. The caller (Tier1Flow) passes premium=false when the form has
// no prep token. Default is true so existing callers/tests keep the
// current behavior.
export function applyIntelligence(
  formKey: string,
  answers: Record<string, any>,
  assessment: Assessment,
  opts?: { premium?: boolean },
): Assessment {
  if (opts?.premium === false) return assessment;
  let intel: IntelligenceResult = { inferred: [], conflicts: [] };
  switch (formKey) {
    case 'n400': intel = detectN400Intelligence(answers); break;
    case 'i130': intel = detectI130Intelligence(answers); break;
    case 'i485': intel = detectI485Intelligence(answers); break;
    case 'i90': intel = detectI90Intelligence(answers); break;
    case 'i589': intel = detectI589Intelligence(answers); break;
    case 'i765': intel = detectI765Intelligence(answers); break;
  }
  return {
    blockers: [...assessment.blockers, ...intel.conflicts.map(c => ({ ...c, t: `CONFLICT: ${c.t}` }))],
    warnings: [...assessment.warnings, ...intel.inferred],
    complete: assessment.complete,
    ready: assessment.blockers.length === 0 && intel.conflicts.length === 0,
  };
}

export function assessI765(answers: Record<string, any>, lang: Tier1Lang): Assessment {
  const blockers: Finding[] = [], warnings: Finding[] = [], complete: Finding[] = [];
  const get = (id: string) => answers[id];

  // D-1: applicant selects category — IRU records, does not determine
  const category = get('i765_category');
  if (!category) blockers.push({ t: 'Eligibility category', d: 'You must select your eligibility category. IRU does not determine which category applies — consult the I-765 instructions or staff if unsure.', section: 'Eligibility' });
  else complete.push({ t: 'Category selected', d: `Category (${category}) selected by applicant.`, section: 'Eligibility' });

  const filingType = get('i765_filing_type');
  if (!filingType) blockers.push({ t: 'Filing type', d: 'Indicate whether this is an initial filing, renewal, or replacement.', section: 'Eligibility' });
  else complete.push({ t: 'Filing type', d: `${filingType} filing.`, section: 'Eligibility' });

  // Renewal without prior EAD is a conflict
  if (filingType === 'renewal' && get('i765_prior_ead') === 'no') {
    blockers.push({ t: 'CONFLICT: Renewal without prior EAD', d: 'Renewal selected but no prior EAD indicated. A renewal requires a previous EAD — this may be an initial filing instead.', section: 'Eligibility' });
  }

  for (const [id, label] of [['i765_full_name', 'Full name'], ['i765_dob', 'Date of birth'], ['i765_country_birth', 'Country of birth']] as const) {
    if (!get(id)) blockers.push({ t: label, d: `${label} is required on the application.`, section: 'Personal Information' });
    else complete.push({ t: label, d: 'Provided.', section: 'Personal Information' });
  }

  // A-Number format validation
  const aNum = get('i765_a_number');
  if (aNum) {
    const digits = String(aNum).replace(/^A/i, '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 9) {
      warnings.push({ t: 'A-Number format', d: `"${aNum}" — A-Numbers are 8-9 digits. Verify.`, section: 'Personal Information' });
    } else complete.push({ t: 'A-Number', d: 'Provided.', section: 'Personal Information' });
  }

  const lastEntry = get('i765_last_entry');
  if (!lastEntry) blockers.push({ t: 'Last entry date', d: 'Date of last U.S. entry is required.', section: 'Immigration History' });
  else complete.push({ t: 'Last entry', d: 'Provided.', section: 'Immigration History' });

  if (!get('i765_status')) warnings.push({ t: 'Status at entry', d: 'Immigration status at last entry was not provided. This helps staff assess the case.', section: 'Immigration History' });
  else complete.push({ t: 'Status at entry', d: 'Provided.', section: 'Immigration History' });

  if (!get('i765_current_status')) warnings.push({ t: 'Current status', d: 'Current immigration status was not provided.', section: 'Immigration History' });
  else complete.push({ t: 'Current status', d: 'Provided.', section: 'Immigration History' });

  return { blockers, warnings, complete, ready: blockers.length === 0 };
}

function detectI765Intelligence(answers: Record<string, any>): IntelligenceResult {
  const inferred: Finding[] = [], conflicts: Finding[] = [];
  const get = (id: string) => answers[id];
  const category = get('i765_category');
  const filingType = get('i765_filing_type');

  // Category-specific guidance
  if (category === 'c8') {
    inferred.push({ t: 'Asylum-based EAD timing', d: 'Category (c)(8) requires the asylum application to have been pending for at least 150 days before filing, and 180 days before USCIS can grant. Verify the pending clock with staff.', section: 'Eligibility' });
  } else if (category === 'c9') {
    inferred.push({ t: 'Adjustment-based EAD', d: 'Category (c)(9) requires a pending I-485. Confirm the adjustment application is on file.', section: 'Eligibility' });
  }

  // Renewal timing
  if (filingType === 'renewal') {
    inferred.push({ t: 'Renewal timing', d: 'File renewal applications up to 180 days before expiration. Do not let the current EAD lapse — check automatic extension eligibility for your category.', section: 'Eligibility' });
  }

  // --- Premium intelligence: date contradictions (adversarial) ---
  // These catch mutually contradictory dates/facts the section score
  // alone would miss. Conflicts become BLOCKERS via applyIntelligence
  // (ready=false). The 2026-11-09 I-765 report scored 88% / "Ready to
  // prepare" while missing exactly this: entered 2026-11-01, filed a
  // (c)(8) renewal 8 days later — impossible, since (c)(8) needs the
  // asylum application pending 150 days, and the applicant cannot have
  // filed asylum before entering. The old text only said "verify with
  // staff". These checks make the contradiction a blocker.
  const parseDate = (raw: any): Date | null => {
    if (!raw) return null;
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 86400000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lastEntry = parseDate(get('i765_last_entry'));
  const dob = parseDate(get('i765_dob'));

  // Future dates are impossible.
  if (lastEntry && lastEntry > today) {
    conflicts.push({ t: 'Last entry date is in the future', d: `Last entry (${get('i765_last_entry')}) is after today. A future entry date cannot be correct — correct it before filing.`, section: 'Immigration History' });
  }
  if (dob && dob > today) {
    conflicts.push({ t: 'Date of birth is in the future', d: `Date of birth (${get('i765_dob')}) is after today. A future birth date cannot be correct — correct it before filing.`, section: 'Personal Information' });
  }

  // (c)(8) requires the asylum application to have been pending >= 150
  // days. The applicant cannot have filed asylum before entering the US,
  // so an entry less than 150 days ago makes a 150-day-pending (c)(8)
  // claim impossible.
  if (category === 'c8' && lastEntry && lastEntry <= today) {
    const daysSinceEntry = daysBetween(lastEntry, today);
    if (daysSinceEntry < 150) {
      conflicts.push({ t: '(c)(8) clock cannot have reached 150 days', d: `Category (c)(8) needs the asylum application pending at least 150 days, but last entry was ${daysSinceEntry} day(s) ago (${get('i765_last_entry')}). The asylum application cannot have been pending 150 days — the filing date, entry date, or category needs review before filing.`, section: 'Eligibility' });
    }
  }

  // Renewal very soon after entry: a renewal needs a prior EAD, which
  // needs an earlier stay. Warning, not a hard conflict — a prior EAD
  // from an earlier stay is possible.
  if (filingType === 'renewal' && lastEntry && lastEntry <= today) {
    const daysSinceEntry = daysBetween(lastEntry, today);
    if (daysSinceEntry < 30) {
      inferred.push({ t: 'Renewal very soon after last entry', d: `Renewal filed ${daysSinceEntry} day(s) after last entry (${get('i765_last_entry')}). A renewal needs a prior EAD — confirm the prior EAD relates to an earlier stay, not this entry.`, section: 'Eligibility' });
    }
  }

  // Very young renewal applicant: unusual, verify (warning).
  if (filingType === 'renewal' && dob && dob <= today) {
    const ageYears = (today.getTime() - dob.getTime()) / (365.25 * 86400000);
    if (ageYears < 14) {
      inferred.push({ t: 'Young renewal applicant', d: `Date of birth (${get('i765_dob')}) indicates an applicant under 14 filing a renewal. Verify the birth date and the prior EAD — a renewal for a young child is unusual.`, section: 'Personal Information' });
    }
  }

  return { inferred, conflicts };
}

// --- Fact provenance layer (digital twin of original IRU fact mechanics) ---
// Every answer becomes a fact with source, confidence, verification status,
// correction history, and conflict flags. Scoring weighs confidence, not just completion.

export type FactSource = 'applicant-typed' | 'inferred' | 'corrected';
export type FactStatus = 'provided' | 'verified' | 'corrected' | 'conflicted';

export interface Tier1Fact {
  id: string;
  value: any;
  source: FactSource;
  confidence: number;  // 0.0 - 1.0
  status: FactStatus;
  corrections: { oldValue: any; newValue: any; timestamp: number }[];
  updatedAt: number;
}

export interface FactRecord {
  facts: Record<string, Tier1Fact>;
}

// Build a fact record from raw answers, tracking corrections.
// `answers` is keyed by question `id` (the assessment functions read
// answers by `id`). When `questions` is provided, each answer is stored
// under its `factId` (falling back to `id`) — the Python binders and
// `projectForForm` look facts up by `factId`, so keying by `id` left
// N-400 / I-130 / I-485 / I-90 fields blank on the generated PDF
// (Carbon Pass 1 finding 5, verified 2026-11-11). The `id` field of each
// fact is the factId too. Callers that omit `questions` keep the old
// behaviour (facts keyed by the answer key).
// NOTE: there is deliberately NO n400_p9_* carve-out keeping those keyed
// by `id`: no assessment function reads `n400_p9_*` keys, and the N-400
// binder maps by factId (`n400_p9_ui_mapping.json`), so the Part 9
// answers must also be translated to their factIds to fill.
export function buildFactRecord(
  answers: Record<string, any>,
  prior?: FactRecord,
  questions?: { id: string; factId?: string }[],
): FactRecord {
  const facts: Record<string, Tier1Fact> = {};
  const now = Date.now();
  const factKey = new Map<string, string>();
  if (questions) {
    for (const q of questions) factKey.set(q.id, q.factId || q.id);
  }
  for (const [id, value] of Object.entries(answers)) {
    const key = factKey.get(id) || id;
    const prev = prior?.facts[key];
    if (prev && JSON.stringify(prev.value) !== JSON.stringify(value)) {
      // Correction: applicant changed their answer
      facts[key] = {
        id: key, value,
        source: 'corrected',
        confidence: 0.9,  // Corrected answers slightly less confident
        status: 'corrected',
        corrections: [...prev.corrections, { oldValue: prev.value, newValue: value, timestamp: now }],
        updatedAt: now,
      };
    } else if (prev) {
      facts[key] = prev;  // Unchanged, preserve provenance
    } else {
      facts[key] = {
        id: key, value,
        source: 'applicant-typed',
        confidence: 1.0,
        status: 'provided',
        corrections: [],
        updatedAt: now,
      };
    }
  }
  return { facts };
}

// Mark facts as conflicted when intelligence detects contradictions
export function markConflicts(factRecord: FactRecord, conflictIds: string[]): FactRecord {
  const facts = { ...factRecord.facts };
  for (const id of conflictIds) {
    if (facts[id]) {
      facts[id] = { ...facts[id], status: 'conflicted', confidence: 0.3 };
    }
  }
  return { facts };
}

// Add inferred facts from intelligence layer
export function addInferredFacts(
  factRecord: FactRecord,
  inferred: { id: string; value: any; basis: string }[],
): FactRecord {
  const facts = { ...factRecord.facts };
  const now = Date.now();
  for (const inf of inferred) {
    facts[inf.id] = {
      id: inf.id, value: inf.value,
      source: 'inferred',
      confidence: 0.7,
      status: 'provided',
      corrections: [],
      updatedAt: now,
    };
  }
  return { facts };
}

// Confidence-weighted section scoring (evidence-aware, not just completion-counted)
export function scoreSectionWeighted(
  findings: { blockers: Finding[]; warnings: Finding[]; complete: Finding[] },
  factRecord?: FactRecord,
): number {
  const total = findings.blockers.length + findings.warnings.length + findings.complete.length;
  if (total === 0) return 1.0;

  // Base score from completion (warnings = partial credit)
  let score = (findings.complete.length + findings.warnings.length * 0.5) / total;

  // Confidence adjustment: if we have fact records, weigh by average confidence
  // of facts related to this section's findings
  if (factRecord) {
    const confidences: number[] = [];
    for (const f of [...findings.complete, ...findings.warnings]) {
      // Find related facts by matching finding titles to fact ids (heuristic)
      for (const [fid, fact] of Object.entries(factRecord.facts)) {
        if (f.t.toLowerCase().includes(fid.split('_').pop() || '')) {
          confidences.push(fact.confidence);
          if (fact.status === 'conflicted') confidences.push(0.3);
          if (fact.status === 'corrected') confidences.push(0.9);
        }
      }
    }
    if (confidences.length > 0) {
      const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      score = score * (0.7 + 0.3 * avgConfidence);  // Confidence modulates up to 30%
    }
  }

  if (findings.blockers.length > 0) score = Math.min(score, 0.35);
  else if (findings.warnings.length > 0) score = Math.min(score, 0.75);
  score = Math.max(0, score - (findings.warnings.length * 0.05));
  return Math.round(score * 100) / 100;
}
