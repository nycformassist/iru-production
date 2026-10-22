/**
 * lib/nextsteps.js — "YOUR NEXT STEPS — HOW TO USE THIS REPORT"
 * (B2C directive §6). Pure content builders — no I/O, no secrets;
 * imported by the server (completion summary) and the client (packet).
 *
 * Every readiness report and form-preparation output carries this
 * section. It is tailored to the selected form and the actual
 * findings; it never depends on a ZIP code; it never fabricates
 * organizations, details, or availability; it makes no eligibility
 * determination and no guarantee. Verified resources (matched by the
 * resource layer) are distinguished from general search paths.
 */

export const NEXT_STEPS_TITLE = 'YOUR NEXT STEPS — HOW TO USE THIS REPORT';

export const PROFESSIONAL_HELP_POINTS = [
  'Using a professional is your choice — it is not required in every case, and IRU does not arrange it for you.',
  'If you consult an immigration attorney or an accredited representative, bring this report and the latest version of your draft form.',
  'Gather the supporting documents and records this report identifies before the meeting, so the professional can use the time on your questions.',
  'Prepare your questions in advance, especially about anything marked inconsistent, uncertain, or missing.',
  'Ask the professional what additional information your circumstances require and what steps apply to you.',
  'No professional or organization has accepted your case unless they tell you so directly — this report does not change that.',
];

/**
 * General, honest paths for finding help. These are well-known official
 * or directory starting points — NOT verified local providers, and the
 * text always says so.
 */
export const RESOURCE_SEARCH_PATHS = [
  { name: 'ImmigrationLawHelp.org', url: 'https://www.immigrationlawhelp.org/', description: 'Directory of nonprofit immigration legal services across the United States — search by location.' },
  { name: 'U.S. Department of Justice — EOIR Recognition & Accreditation', url: 'https://www.justice.gov/eoir/recognition-accreditation-roster-by-state', description: 'Official roster of recognized organizations and accredited representatives allowed to represent people in immigration proceedings.' },
  { name: 'LawHelp.org', url: 'https://www.lawhelp.org/', description: 'Directory of legal aid programs by state.' },
  { name: 'USCIS', url: 'https://www.uscis.gov/', description: 'Official forms, instructions, fees, and filing information — always confirm current editions and requirements here.' },
];

const NOT_ESTABLISHED = [
  'This report does not decide whether you are eligible for any immigration benefit, and it does not predict or guarantee any outcome.',
  'A readiness percentage, where shown, is an approximate document-completeness heuristic — not a score of your chances.',
  'Preparation assistance is not legal advice, and IRU is not a law firm.',
  'Nothing has been signed, filed, or submitted on your behalf.',
];

/**
 * Next-steps content for a FORM output (used by the completion summary).
 * `entry` is the registry entry; `plan` the fill plan; the content is
 * tailored from what was actually populated, missing, or in conflict.
 */
export function buildFormNextSteps(entry, plan) {
  const missing = plan.missing || [];
  const conflicts = plan.conflicts || [];
  const needsConfirmation = plan.needsConfirmation || [];
  const consumerSections = entry.consumerCompletedSections || [];

  const understand = [
    `This package prepares a DRAFT of ${entry.name} (Edition ${entry.editionDate}) from the information you provided: ${plan.fill.length} field(s) were populated.`,
    missing.length > 0
      ? `${missing.length} required item(s) are still missing and were left blank: ${missing.map((m) => m.label).join('; ')}.`
      : 'No required item the form asks about was left unanswered from the information available.',
    ...(conflicts.length > 0
      ? [`${conflicts.length} item(s) have conflicting values from different sources and were NOT filled in: ${conflicts.map((c) => c.label).join('; ')}. Resolve them before relying on the draft.`]
      : []),
    ...(needsConfirmation.length > 0
      ? [`${needsConfirmation.length} value(s) came from your documents and still need your confirmation before they can be used: ${needsConfirmation.map((n) => n.label).join('; ')}.`]
      : []),
    ...NOT_ESTABLISHED,
  ];

  const reviewForm = [
    `Compare the draft labeled "IRU Pre-filled Draft — Review and Correct" against the "Official Blank Form — Reference Copy" (the official ${entry.id}, Edition ${entry.editionDate}, from ${entry.sourceUrl}) and against your own records.`,
    'Check every populated field — your name, dates, addresses, and identifying information most of all. A pre-filled draft can contain mistakes; only you can confirm the answers are yours.',
    'If anything is wrong, correct it in your information, regenerate the draft, and download the new version. Earlier downloads are stale once your information changes — use only the latest version.',
    'Complete the sections listed in the completion summary that IRU does not fill (your own attestations, and your signature) yourself, only after your review.',
  ];

  const checklist = [
    'Read the completion summary and resolve anything listed as missing, conflicting, or needing confirmation.',
    ...(missing.length > 0 ? [`Provide the ${missing.length} missing required item(s), then regenerate the draft.`] : []),
    ...(conflicts.length > 0 ? ['Decide which conflicting value is correct, correct your information, and regenerate.'] : []),
    'Compare every populated field on the draft with the official blank form and your own records.',
    'Correct any mistakes through your information and regenerate — then download the latest version and set older downloads aside.',
    'Complete the parts of the form that are yours alone (see the completion summary), including your signature, only when you are satisfied the draft is accurate.',
    `Confirm the current form edition, instructions, fee, and filing address at ${entry.sourceUrl} before you use the form — official requirements change, and any deadline that may apply to you should be verified with an official source or a qualified professional.`,
  ];

  return {
    title: NEXT_STEPS_TITLE,
    understand,
    reviewForm,
    professionalHelp: [...PROFESSIONAL_HELP_POINTS],
    resources: {
      note: 'IRU has not verified a local provider for this output. The directories below are general starting points for finding qualified help — inclusion is not a recommendation, and availability is not guaranteed.',
      searchPaths: RESOURCE_SEARCH_PATHS.map((p) => ({ ...p })),
      officialFormPage: entry.sourceUrl,
    },
    checklist,
  };
}
