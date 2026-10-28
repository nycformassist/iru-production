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

export function legalReviewReason(key, lang = 'EN') {
  if (lang && lang !== 'EN' && GAP_I18N[lang] && GAP_I18N[lang].legal && GAP_I18N[lang].legal[key]) {
    return GAP_I18N[lang].legal[key];
  }
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

export const KB_I18N = {
ES: {
has_passport: { targetFact: 'Identidad y nacionalidad — quién es el solicitante y su país de ciudadanía.', primaryEvidence: 'Pasaporte válido emitido por el país de origen.', alternatives: {
proxy_passport_1: { label: 'Identificación consular (Consular ID / Matrícula)', supports: 'Identidad y nacionalidad según lo registrado por el consulado emisor.', limitations: 'No establece que exista o se haya emitido un pasaporte; la aceptación varía según el adjudicador y el tipo de beneficio.', acquisition: 'Solicítela en el consulado del país de origen que atiende su área; por lo general requiere prueba de nacionalidad y una tarifa.', safety: 'El contacto con el consulado suele ser de bajo riesgo, pero las personas con asuntos de control migratorio pendientes deben hablar primero con un abogado sobre el momento adecuado.', reviewNeeded: 'Confirme que la identificación esté vigente y que el nombre coincida con otros registros.' },
proxy_passport_2: { label: 'Certificado de nacimiento (Birth Certificate)', supports: 'Datos biográficos: nombre, fecha y lugar de nacimiento, y filiación según lo registrado al inscribirse.', limitations: 'NO establece que exista o se haya emitido un pasaporte. Un certificado de nacimiento no es un documento de viaje.', acquisition: 'Solicítelo al registro civil del lugar de nacimiento; si no está disponible, documente el intento (véase 8 CFR 103.2(b)(2)).', safety: 'Solicitar registros del país de origen puede exponer a familiares que aún están allí. Use intermediarios por correo o un abogado cuando exista riesgo.', reviewNeeded: 'Verifique si la inscripción en el registro es contemporánea o tardía; anote cuál.' },
proxy_passport_3: { label: 'Tarjeta nacional de identidad (National ID Card)', supports: 'Identidad según lo registrado por la autoridad nacional emisora.', limitations: 'No establece la emisión de un pasaporte y puede no aceptarse como prueba principal de identidad para todos los beneficios.', acquisition: 'Emitida por la autoridad civil del país de origen; los reemplazos suelen requerir una solicitud en persona o consular.', safety: 'La misma precaución sobre contacto con el país de origen que con los registros de nacimiento.', reviewNeeded: 'Verifique la fecha de vencimiento y que los datos biográficos coincidan con otros documentos.' } } },
has_i94: { targetFact: 'Admisión a los Estados Unidos — cuándo y cómo ingresó el solicitante.', primaryEvidence: 'Registro de llegada/salida I-94 (I-94 Arrival/Departure Record; puede recuperarse en i94.cbp.dhs.gov para entradas legales recientes).', alternatives: {
proxy_i94_1: { label: 'Boletos de viaje / pases de abordar', supports: 'Un itinerario de viaje coherente con la ruta declarada y el momento aproximado de entrada.', limitations: 'No establecen admisión legal, la fecha exacta de entrada ni la forma de entrada.', acquisition: 'Registros de la aerolínea o agencia de viajes, confirmaciones por correo electrónico, historial de viajero frecuente.', safety: 'Riesgo bajo; son registros propios del solicitante.', reviewNeeded: 'Verifique que nombres, fechas y rutas sean internamente coherentes.' },
proxy_i94_2: { label: 'Fotos con fecha en EE. UU.', supports: 'Presencia física en los Estados Unidos en la fecha asociada a la foto o alrededor de ella.', limitations: 'NO establecen la fecha exacta de entrada ni la forma de entrada. Las fechas de las fotos pueden ser incorrectas o faltar.', acquisition: 'Galería de la cámara del teléfono, copias en la nube, archivos de redes sociales — conserve los originales con metadatos cuando sea posible.', safety: 'Revise las fotos por otras personas que podrían no consentir ser identificadas; no las comparta públicamente.', reviewNeeded: 'Confirme la fuente de la fecha (metadatos frente a estimación) y las señales de ubicación visibles en la imagen.' },
proxy_i94_3: { label: 'Recibos de clínica u hospital', supports: 'Presencia en los Estados Unidos en la fecha del servicio.', limitations: 'No establecen la fecha de entrada ni la forma de entrada.', acquisition: 'Solicite recibos detallados o resúmenes de la visita a la oficina de registros médicos del proveedor.', safety: 'Los registros médicos son sensibles; compártalos solo con un abogado o según se requiera, con manejo conforme a HIPAA.', reviewNeeded: 'Confirme la fecha del servicio y que el registro pertenezca al solicitante.' } } },
has_lease: { targetFact: 'Residencia física en una dirección de EE. UU. (dónde vive el solicitante).', primaryEvidence: 'Contrato de arrendamiento formal por escrito de la residencia del solicitante.', alternatives: {
proxy_lease_1: { label: 'Registros escolares', supports: 'Inscripción vinculada a la residencia que relaciona al solicitante (o a su hijo) con una dirección y un período de fechas.', limitations: 'No establecen un arrendamiento formal ni la tenencia propia del solicitante.', acquisition: 'Solicite una verificación de inscripción a la secretaría de la escuela.', safety: 'Riesgo bajo; son registros propios del solicitante.', reviewNeeded: 'Verifique la dirección y las fechas de inscripción que se muestran.' },
proxy_lease_2: { label: 'Carta notariada del arrendador/compañero de vivienda', supports: 'Datos de residencia (dirección, fechas, arreglo de alquiler) atestiguados de primera mano por quien escribe.', limitations: 'NO establece un arrendamiento formal. El peso depende de la especificidad, credibilidad y conocimiento de primera mano de quien escribe.', acquisition: 'Pida al arrendador o compañero una carta fechada y firmada que indique dirección, fecha de mudanza y términos del alquiler; la notarización añade formalidad, pero no suficiencia legal.', safety: 'La situación migratoria o de vivienda de quien escribe puede hacerlo renuente; no presione a nadie.', reviewNeeded: 'Confirme la relación de quien escribe con el solicitante y que los detalles sean específicos, no genéricos.' },
proxy_lease_3: { label: 'Factura de servicios públicos (Utility Bill)', supports: 'Residencia en la dirección del servicio durante el período de facturación, a nombre del titular de la cuenta.', limitations: 'No establece un arrendamiento formal, y significa poco si la cuenta no está a nombre del solicitante.', acquisition: 'Cuenta en línea del proveedor de servicios o solicitud de registros a servicio al cliente.', safety: 'Riesgo bajo; son registros propios del solicitante.', reviewNeeded: 'Confirme el nombre en la cuenta y la dirección/fechas del servicio.' } } },
has_persecution_proof: { targetFact: 'Daño o persecución sufrido (o temido), y su conexión con un motivo protegido como religión, raza, nacionalidad, opinión política o pertenencia a un grupo social particular.', primaryEvidence: 'Evidencia directa del daño: informes policiales, registros médicos de lesiones, fotografías, amenazas escritas, registros de detención.', alternatives: {
proxy_persecution_1: { label: 'Cartas de testigos', supports: 'Corroboración de eventos que quien escribe vio o vivió personalmente.', limitations: 'Por sí solas no prueban la elegibilidad legal; el peso depende de la especificidad, el conocimiento de primera mano y la credibilidad. Apoyan el relato — no deciden el caso.', acquisition: 'Pida a testigos con conocimiento personal directo declaraciones fechadas y firmadas que describan lo que vieron, cuándo y dónde.', safety: 'Los testigos en el país de origen pueden enfrentar represalias. Nunca pida a nadie que asuma riesgos; hable de la seguridad de los testigos con un abogado antes de solicitar nada desde el extranjero.', reviewNeeded: 'Confirme conocimiento de primera mano (no rumores) y fechas/lugares específicos.' },
proxy_persecution_2: { label: 'Registros médicos', supports: 'Lesiones o tratamiento coherentes con el daño declarado, con fechas.', limitations: 'Por sí solos no establecen quién causó el daño ni por qué ocurrió.', acquisition: 'Solicite los registros de tratamiento a la oficina de registros de la clínica u hospital, en EE. UU. o en el extranjero.', safety: 'Los registros médicos son sensibles; limite su uso compartido al abogado y a las presentaciones requeridas. Obtener registros del país de origen puede exponer la ubicación o los contactos del solicitante.', reviewNeeded: 'Verifique que los diagnósticos/fechas sean coherentes con el relato; anote lo que los registros no dicen.' },
proxy_persecution_3: { label: 'Artículos de noticias / condiciones del país', supports: 'Contexto: que el tipo de daño declarado se reporta contra personas como el solicitante (p. ej., minorías religiosas) en el país.', limitations: 'NO prueban que el solicitante haya vivido personalmente el evento. La evidencia de condiciones del país aporta contexto — no es prueba individual.', acquisition: 'Reportajes de fuentes reputadas (medios importantes, organizaciones de derechos humanos, informes de país del Departamento de Estado de EE. UU.) con fecha cercana a los eventos relevantes.', safety: 'Sin riesgo personal al recopilar reportajes públicos.', reviewNeeded: 'Confirme que el reportaje se refiera realmente al grupo, la región y el período del solicitante — no solo al país en general.' } } },
has_green_card: { targetFact: 'Estatus de residente permanente legal en los Estados Unidos.', primaryEvidence: 'Tarjeta de Residente Permanente (Permanent Resident Card, Formulario I-551, "Green Card").', alternatives: {
proxy_greencard_1: { label: 'Sello I-551 en el pasaporte', supports: 'Evidencia temporal del estatus de residente permanente legal, válida por el período que cubre el sello.', limitations: 'Vence; no reemplaza la tarjeta y no se acepta indefinidamente.', acquisition: 'Cita en una oficina local de USCIS (sello InfoPass/ADIT) si la tarjeta se perdió o venció.', safety: 'Riesgo bajo; se obtiene directamente de USCIS.', reviewNeeded: 'Verifique las fechas de validez del sello.' },
proxy_greencard_2: { label: 'Aviso de aprobación de USCIS (I-797)', supports: 'Que USCIS aprobó la petición de inmigrante o la solicitud de ajuste subyacente.', limitations: 'Por sí solo no es prueba del estatus actual; muestra una aprobación, no la tarjeta.', acquisition: 'Registros propios del solicitante; reemplazos mediante solicitud a USCIS.', safety: 'Riesgo bajo; son registros propios del solicitante.', reviewNeeded: 'Confirme que el aviso se relacione con el solicitante y el beneficio correcto.' },
proxy_greencard_3: { label: 'Copia de la Green Card perdida', supports: 'Que se emitió una tarjeta (la copia del frente/reverso muestra el número y las fechas).', limitations: 'Una copia no es prueba válida del estatus. Presente el Formulario I-90 para reemplazar una tarjeta perdida.', acquisition: 'Archivos propios del solicitante; luego presente el I-90 para un reemplazo.', safety: 'Riesgo bajo.', reviewNeeded: 'Confirme que la copia sea legible y coincida con la identidad del solicitante.' } } },
has_tax_transcripts: { targetFact: 'Cumplimiento tributario y, según el beneficio, residencia continua o buen carácter moral.', primaryEvidence: 'Transcripciones de declaraciones de impuestos del IRS que cubren los años requeridos (normalmente 3–5).', alternatives: {
proxy_tax_1: { label: 'Formularios W-2 o 1099', supports: 'Ingresos reportados, empleador y año fiscal de los formularios proporcionados.', limitations: 'No establecen que las declaraciones se hayan presentado realmente ni que los impuestos se hayan pagado por completo.', acquisition: 'Departamentos de nómina del empleador o registros propios del solicitante; transcripciones de salarios e ingresos del IRS como respaldo.', safety: 'Riesgo bajo; son registros propios del solicitante.', reviewNeeded: 'Confirme los años fiscales cubiertos y que nombres/SSN coincidan.' },
proxy_tax_2: { label: 'Talones de pago (Pay Stubs)', supports: 'Empleo e ingresos durante los períodos de pago específicos mostrados.', limitations: 'Cubren solo un período limitado; no son registros tributarios y no muestran cumplimiento de presentación.', acquisition: 'Sistema de nómina del empleador o registros propios del solicitante.', safety: 'Riesgo bajo.', reviewNeeded: 'Anote el rango de fechas; unos pocos talones no cubren años.' },
proxy_tax_3: { label: 'Estados de cuenta bancarios', supports: 'Actividad financiera (depósitos, transferencias) coherente con residencia y empleo durante el período del estado de cuenta.', limitations: 'No establecen cumplimiento tributario ni presentación de declaraciones.', acquisition: 'Portal en línea del banco o solicitud de registros en una sucursal.', safety: 'Los estados bancarios revelan amplia información personal; comparta solo lo que el abogado necesite.', reviewNeeded: 'Confirme el titular de la cuenta y las fechas de los estados.' } } },
has_marriage_cert: { targetFact: 'Una relación marital legalmente reconocida.', primaryEvidence: 'Certificado civil de matrimonio emitido por la autoridad gubernamental competente.', alternatives: {
proxy_marriage_1: { label: 'Certificado de matrimonio religioso', supports: 'Que tuvo lugar una ceremonia de matrimonio religioso, con fecha y oficiante.', limitations: 'Puede no establecer un matrimonio legalmente reconocido, según la jurisdicción y si hubo registro civil posterior.', acquisition: 'La institución religiosa que realizó la ceremonia.', safety: 'Riesgo bajo; considere si revelar la afiliación religiosa crea riesgo en el contexto del solicitante y háblelo con un abogado.', reviewNeeded: 'Confirme si existe un registro civil por separado.' },
proxy_marriage_2: { label: 'Certificados de nacimiento de hijos en común', supports: 'Filiación compartida de los hijos indicados.', limitations: 'No establecen que exista un matrimonio legal.', acquisition: 'Registro civil del lugar de nacimiento.', safety: 'Los registros de los hijos son sensibles; compártalos mínimamente.', reviewNeeded: 'Confirme que ambos padres estén nombrados como se declara.' },
proxy_marriage_3: { label: 'Declaraciones juradas de familiares/amigos (Affidavits)', supports: 'Que personas con conocimiento personal observaron la relación de la pareja a lo largo del tiempo.', limitations: 'Generalmente se tratan como evidencia más débil (terciaria). Según 8 CFR 103.2(b)(2), las declaraciones juradas se aceptan solo tras demostrar que la evidencia primaria y secundaria no están disponibles — explique la indisponibilidad por escrito.', acquisition: 'Declaraciones fechadas y firmadas de personas no partes con conocimiento personal directo, que describan observaciones específicas (no conclusiones).', safety: 'Quienes firman deben entender que firman bajo pena de perjurio.', reviewNeeded: 'Confirme conocimiento de primera mano y hechos específicos, no elogios genéricos.' } } },
has_proof_of_relationship: { targetFact: 'Que la relación familiar declarada es de buena fe (genuina), no contraída con fines migratorios.', primaryEvidence: 'Prueba directa: cuentas bancarias conjuntas, fotos juntos a lo largo del tiempo, arrendamiento conjunto, registros de hijos, seguro compartido.', alternatives: {
proxy_relationship_1: { label: 'Arrendamiento conjunto o facturas de servicios', supports: 'Un hogar compartido en la misma dirección durante el período cubierto.', limitations: 'Por sí solos no prueban que la relación sea de buena fe.', acquisition: 'Registros del arrendador, administrador de la propiedad o proveedor de servicios.', safety: 'Riesgo bajo; son registros propios del solicitante.', reviewNeeded: 'Confirme que aparezcan ambos nombres y que las fechas coincidan con el período de relación declarado.' },
proxy_relationship_2: { label: 'Recibos de remesas', supports: 'Un patrón de apoyo financiero/transferencias entre las partes.', limitations: 'No establecen la naturaleza de la relación (puede existir apoyo entre no cónyuges).', acquisition: 'Historial del servicio de transferencia de dinero o registros de transferencias bancarias.', safety: 'Riesgo bajo; revela información financiera — comparta mínimamente.', reviewNeeded: 'Confirme remitente, destinatario, montos y regularidad.' },
proxy_relationship_3: { label: 'Registros de comunicación (WhatsApp, correos)', supports: 'Contacto continuo y la textura de la relación a lo largo del tiempo.', limitations: 'El contenido y el contexto importan; los registros por sí solos no prueban la buena fe, y los extractos selectivos pueden inducir a error.', acquisition: 'Exporte los historiales de chat; conserve los originales con fechas.', safety: 'El contenido de los mensajes puede ser profundamente personal; el solicitante debe revisar todo antes de compartirlo y tachar material privado no relacionado.', reviewNeeded: 'Confirme la identidad de los participantes y que los extractos sean representativos, no seleccionados a conveniencia.' } } },
has_arrests: { targetFact: 'Historial penal completo y la disposición final (resultado) de cada arresto.', primaryEvidence: 'Certificado de Disposición (Certificate of Disposition) de cada arresto, del tribunal penal donde se conoció el caso.', alternatives: {
proxy_arrests_1: { label: 'Hoja de antecedentes (Rap Sheet / Criminal History Record)', supports: 'Un registro compilado de arrestos y cargos según lo reportado por bases de datos policiales.', limitations: 'Puede ser incompleto o inexacto, y no establece la disposición final de ningún caso.', acquisition: 'Resumen de historial de identidad del FBI o solicitud al repositorio estatal (normalmente se requieren huellas dactilares).', safety: 'Solicitar el propio registro es de bajo riesgo, pero los resultados deben ir directamente a un abogado — no los publique ni comparta.', reviewNeeded: 'Compárelo con el relato del solicitante; señale discrepancias al abogado.' },
proxy_arrests_2: { label: 'Avisos de comparecencia judicial', supports: 'Que existió una fecha de audiencia para un caso y cargo dados.', limitations: 'NO establecen la disposición final. Un aviso de comparecencia no es un certificado de disposición — el resultado aún debe obtenerse del tribunal.', acquisition: 'Registros propios del solicitante o la secretaría del tribunal.', safety: 'Riesgo bajo.', reviewNeeded: 'Confirme que el número de caso coincida con el arresto en cuestión.' },
proxy_arrests_3: { label: 'Cartas del abogado defensor anterior', supports: 'El relato profesional del abogado sobre cómo terminó el caso.', limitations: 'No sustituye el registro oficial de disposición del tribunal.', acquisition: 'Contacte la oficina del abogado anterior y solicite una carta que resuma la disposición.', safety: 'El privilegio abogado-cliente puede limitar lo que un abogado anterior puede revelar; el solicitante puede necesitar renunciar al privilegio por escrito para este fin.', reviewNeeded: 'Confirme que la carta aborde el caso y el resultado específicos.' } } },
},
ZH: {
has_passport: { targetFact: '身份和国籍——申请人是谁，以及其公民身份所属国家。', primaryEvidence: '由原籍国签发的有效护照。', alternatives: {
proxy_passport_1: { label: '领事身份证（Consular ID / Matrícula）', supports: '由签发领事馆记录的身份和国籍。', limitations: '不能证明护照存在或曾经签发；是否接受因裁决者和福利类型而异。', acquisition: '向服务申请人所在地区的原籍国领事馆申请；通常需要国籍证明和费用。', safety: '联系领事馆通常风险较低，但有未决执法事项的人应先与律师讨论时间安排。', reviewNeeded: '确认证件在有效期内，且姓名与其他记录一致。' },
proxy_passport_2: { label: '出生证明（Birth Certificate）', supports: '个人基本信息：登记时记录的姓名、出生日期和地点以及父母信息。', limitations: '不能证明护照存在或曾经签发。出生证明不是旅行证件。', acquisition: '向出生地的民事登记机构申请；如无法获得，请记录尝试过程（见 8 CFR 103.2(b)(2)）。', safety: '向原籍国申请记录可能会使仍在当地的家人面临风险。存在风险时请使用邮寄中介或律师。', reviewNeeded: '检查登记是当时登记还是补登记；并注明是哪一种。' },
proxy_passport_3: { label: '国民身份证（National ID Card）', supports: '由签发国主管机关记录的身份。', limitations: '不能证明护照签发情况，且并非每种福利都接受其作为主要身份证明。', acquisition: '由原籍国民事主管机关签发；补办通常需要亲自或通过领事馆申请。', safety: '与出生记录相同的原籍国联系注意事项。', reviewNeeded: '核实到期日期，并确认个人基本信息与其他文件一致。' } } },
has_i94: { targetFact: '入境美国——申请人何时以及如何入境。', primaryEvidence: 'I-94 入境/离境记录（I-94 Arrival/Departure Record；近期合法入境可在 i94.cbp.dhs.gov 获取）。', alternatives: {
proxy_i94_1: { label: '旅行机票 / 登机牌', supports: '与所声称路线和大致入境时间一致的旅行行程。', limitations: '不能证明合法入境、确切入境日期或入境方式。', acquisition: '航空公司或旅行社记录、电子邮件确认、常旅客历史记录。', safety: '风险低；这些是申请人自己的记录。', reviewNeeded: '检查姓名、日期和路线是否内部一致。' },
proxy_i94_2: { label: '在美国拍摄的带日期照片', supports: '在照片相关日期或前后身在美国。', limitations: '不能证明确切入境日期或入境方式。照片日期可能错误或缺失。', acquisition: '手机相机相册、云端照片备份、社交媒体存档——尽可能保留带有元数据的原件。', safety: '检查照片中是否有可能不同意被识别的其他人；不要公开分享。', reviewNeeded: '确认日期来源（元数据还是猜测）以及图像中可见的地点线索。' },
proxy_i94_3: { label: '诊所或医院收据', supports: '在就诊日期身在美国。', limitations: '不能证明入境日期或入境方式。', acquisition: '向提供者的病历办公室申请明细收据或就诊摘要。', safety: '病历属于敏感信息；仅与律师分享或按要求分享，并按 HIPAA 合规方式处理。', reviewNeeded: '确认就诊日期，并确认记录属于申请人。' } } },
has_lease: { targetFact: '在美国地址的实际居住情况（申请人住在哪里）。', primaryEvidence: '申请人住所的正式书面租赁协议。', alternatives: {
proxy_lease_1: { label: '学校记录', supports: '与居住相关的入学记录，将申请人（或其子女）与某个地址和日期范围联系起来。', limitations: '不能证明正式租赁关系或申请人本人的承租关系。', acquisition: '向学校注册办公室申请入学核实。', safety: '风险低；这是申请人自己的记录。', reviewNeeded: '检查所显示的地址和入学日期。' },
proxy_lease_2: { label: '房东/室友的公证信', supports: '由写信人亲身证实的居住事实（地址、日期、租金安排）。', limitations: '不能证明正式租赁关系。其分量取决于写信人的具体程度、可信度和亲身了解程度。', acquisition: '请房东或室友提供注明日期并签名的信件，说明地址、入住日期和租金条款；公证增加了形式性，但不构成法律充分性。', safety: '写信人的移民身份或住房状况可能使其不愿写信；不要向任何人施压。', reviewNeeded: '确认写信人与申请人的关系，并确认细节具体而非笼统。' },
proxy_lease_3: { label: '水电费账单（Utility Bill）', supports: '在账单期间内居住于服务地址，账户持有人姓名如账单所示。', limitations: '不能证明正式租赁关系；如果账户不在申请人名下，其意义有限。', acquisition: '公用事业提供商的在线账户或客服记录申请。', safety: '风险低；这是申请人自己的记录。', reviewNeeded: '确认账户上的姓名以及服务地址/日期。' } } },
has_persecution_proof: { targetFact: '所遭受（或所担心的）伤害或迫害，及其与受保护理由（如宗教、种族、国籍、政治观点或特定社会群体成员身份）的联系。', primaryEvidence: '伤害的直接证据：警方报告、受伤病历、照片、书面威胁、拘留记录。', alternatives: {
proxy_persecution_1: { label: '证人信件', supports: '对写信人亲眼所见或亲身经历事件的佐证。', limitations: '其本身不能证明法律资格；其分量取决于具体程度、亲身了解程度和可信度。它们支持陈述——但不决定案件。', acquisition: '请具有直接亲身了解的人提供注明日期并签名的陈述，描述他们所见、何时、何地。', safety: '原籍国的证人可能面临报复。绝不要让任何人冒险；在从国外索取任何材料之前，请先与律师讨论证人安全。', reviewNeeded: '确认是亲身（非传闻）了解，并有具体日期/地点。' },
proxy_persecution_2: { label: '病历', supports: '与所声称伤害一致的伤情或治疗，并附有日期。', limitations: '其本身不能证明是谁造成了伤害或为何发生。', acquisition: '向诊所或医院的病历办公室申请治疗记录，可在美国或国外。', safety: '病历属于敏感信息；仅与律师及必要提交分享。从原籍国获取记录可能会暴露申请人的位置或联系人。', reviewNeeded: '检查诊断/日期是否与陈述一致；注明记录中没有说明的内容。' },
proxy_persecution_3: { label: '新闻报道 / 国家状况', supports: '背景信息：所声称的伤害类型在该国针对与申请人类似的人群（如宗教少数群体）有报道。', limitations: '不能证明申请人本人经历了该事件。国家状况证据提供背景——不是个人证明。', acquisition: '来自可靠来源的报道（主要媒体、人权组织、美国国务院国家报告），日期接近相关事件。', safety: '收集公开报道没有个人风险。', reviewNeeded: '确认报道确实涉及申请人的群体、地区和时间段——而不只是该国的一般情况。' } } },
has_green_card: { targetFact: '在美国的合法永久居民身份。', primaryEvidence: '永久居民卡（Permanent Resident Card，表格 I-551，“绿卡”）。', alternatives: {
proxy_greencard_1: { label: '护照上的 I-551 印章', supports: '合法永久居民身份的临时证据，在印章覆盖期间有效。', limitations: '会过期；不能代替卡片，也不会被无限期接受。', acquisition: '如果卡片丢失或过期，可通过 USCIS 外地办公室预约（InfoPass/ADIT 印章）获取。', safety: '风险低；直接从 USCIS 获取。', reviewNeeded: '检查印章的有效日期。' },
proxy_greencard_2: { label: 'USCIS 批准通知（I-797）', supports: 'USCIS 已批准底层的移民申请或调整身份申请。', limitations: '其本身不是当前身份的证明；它显示的是批准，而不是卡片。', acquisition: '申请人自己的记录；可通过向 USCIS 申请补发。', safety: '风险低；这是申请人自己的记录。', reviewNeeded: '确认通知与申请人及正确的福利相关。' },
proxy_greencard_3: { label: '丢失绿卡的复印件', supports: '曾签发过一张卡（正反面复印件显示号码和日期）。', limitations: '复印件不是有效的身份证明。请提交表格 I-90 以补办丢失的卡。', acquisition: '申请人自己的文件；然后提交 I-90 申请补办。', safety: '风险低。', reviewNeeded: '确认复印件清晰且与申请人身份相符。' } } },
has_tax_transcripts: { targetFact: '税务合规情况，以及（视福利而定）持续居住或良好道德品质。', primaryEvidence: '涵盖所需年份（通常为 3–5 年）的 IRS 纳税申报记录。', alternatives: {
proxy_tax_1: { label: 'W-2 或 1099 表格', supports: '所提供表格的申报收入、雇主和纳税年度。', limitations: '不能证明申报表确实已提交，也不能证明税款已全额缴纳。', acquisition: '雇主工资部门或申请人自己的记录；IRS 工资与收入记录可作为备选。', safety: '风险低；这是申请人自己的记录。', reviewNeeded: '确认涵盖的纳税年度，并确认姓名/SSN 一致。' },
proxy_tax_2: { label: '工资单（Pay Stubs）', supports: '所示具体工资期间的就业和收入情况。', limitations: '仅涵盖有限的时间段；它们不是税务记录，也不显示申报合规情况。', acquisition: '雇主工资系统或申请人自己的记录。', safety: '风险低。', reviewNeeded: '注明日期范围；几张工资单不能涵盖数年。' },
proxy_tax_3: { label: '银行对账单', supports: '与对账单期间内居住和就业一致的财务活动（存款、转账）。', limitations: '不能证明税务合规或申报情况。', acquisition: '银行在线门户或分行记录申请。', safety: '银行对账单会透露大量个人细节；仅分享律师需要的内容。', reviewNeeded: '确认账户持有人和对账单日期。' } } },
has_marriage_cert: { targetFact: '法律承认的婚姻关系。', primaryEvidence: '由有管辖权的政府机关签发的民事结婚证。', alternatives: {
proxy_marriage_1: { label: '宗教结婚证', supports: '举行过宗教结婚仪式，并附有日期和主持人。', limitations: '可能不能证明法律承认的婚姻，取决于司法管辖区以及之后是否有民事登记。', acquisition: '举行仪式的宗教机构。', safety: '风险低；请考虑在申请人的处境中披露宗教信仰是否会带来风险，并与律师讨论。', reviewNeeded: '确认是否存在单独的民事登记。' },
proxy_marriage_2: { label: '共同子女的出生证明', supports: '所列子女的共同亲子关系。', limitations: '不能证明存在合法婚姻。', acquisition: '出生地的民事登记机构。', safety: '子女记录属于敏感信息；请尽量少分享。', reviewNeeded: '确认父母双方均按所声称的列名。' },
proxy_marriage_3: { label: '亲友宣誓书（Affidavits）', supports: '具有亲身了解的人观察到这对伴侣关系随时间发展的情况。', limitations: '通常被视为较弱的（三级）证据。根据 8 CFR 103.2(b)(2)，只有在证明主要和次要证据均无法获得后才接受宣誓书——请以书面形式解释无法获得的原因。', acquisition: '由具有直接亲身了解的非当事人提供注明日期并签名的陈述，描述具体观察（而非结论）。', safety: '签署人应了解他们是在伪证处罚下签署。', reviewNeeded: '确认是亲身了解和具体事实，而非笼统的赞扬。' } } },
has_proof_of_relationship: { targetFact: '所声称的家庭关系是真实的（genuine），而非出于移民目的而缔结。', primaryEvidence: '直接证明：联名银行账户、长期合影、共同租赁、子女记录、共同保险。', alternatives: {
proxy_relationship_1: { label: '共同租赁或水电费账单', supports: '在涵盖期间内在同一地址共同居住的家庭。', limitations: '其本身不能证明关系是真实的。', acquisition: '房东、物业管理人或公用事业提供商的记录。', safety: '风险低；这是申请人自己的记录。', reviewNeeded: '确认两个人的姓名都出现，且日期与所声称的关系期间重叠。' },
proxy_relationship_2: { label: '汇款收据', supports: '双方之间财务支持/转账的模式。', limitations: '不能证明关系的性质（非配偶之间也可以存在支持）。', acquisition: '汇款服务历史记录或银行转账记录。', safety: '风险低；会透露财务细节——请尽量少分享。', reviewNeeded: '确认汇款人、收款人、金额和规律性。' },
proxy_relationship_3: { label: '通讯记录（WhatsApp、电子邮件）', supports: '随时间的持续联系和关系质地。', limitations: '内容和背景很重要；仅凭记录不能证明真实性，选择性摘录可能会误导。', acquisition: '导出聊天记录；保留带日期的原件。', safety: '消息内容可能非常私人；申请人在分享前应审查所有内容，并删除无关的私人材料。', reviewNeeded: '确认参与者的身份，并确认摘录具有代表性，而非精心挑选。' } } },
has_arrests: { targetFact: '完整的犯罪历史以及每次逮捕的最终处置（结果）。', primaryEvidence: '每次逮捕的处置证明（Certificate of Disposition），由审理案件的刑事法院出具。', alternatives: {
proxy_arrests_1: { label: '犯罪记录（Rap Sheet / Criminal History Record）', supports: '执法数据库报告的逮捕和指控汇总记录。', limitations: '可能不完整或不准确，也不能证明任何案件的最终处置。', acquisition: 'FBI 身份历史摘要或州存储库申请（通常需要指纹）。', safety: '申请自己的记录风险较低，但结果必须直接交给律师——不要发布或分享。', reviewNeeded: '与申请人的陈述进行比较；将差异标记给律师。' },
proxy_arrests_2: { label: '出庭通知', supports: '某个案件和指控曾有过出庭日期。', limitations: '不能证明最终处置。出庭通知不是处置证明——结果仍必须从法院获取。', acquisition: '申请人自己的记录或法院书记员办公室。', safety: '风险低。', reviewNeeded: '确认案件编号与所涉逮捕相符。' },
proxy_arrests_3: { label: '前辩护律师的信件', supports: '律师对案件如何结案的专业说明。', limitations: '不能代替官方的法院处置记录。', acquisition: '联系前律师的办公室，请其出具总结处置情况的信件。', safety: '律师-客户特权可能限制前律师可以披露的内容；申请人可能需要为此目的以书面形式放弃该特权。', reviewNeeded: '确认信件涉及具体案件和结果。' } } },
},
HT: {
has_passport: { targetFact: 'Idantite ak nasyonalite — ki moun aplikan an ye ak peyi sitwayènte li.', primaryEvidence: 'Paspò valab peyi orijin lan te bay.', alternatives: {
proxy_passport_1: { label: 'Kat idantite konsila (Consular ID / Matrícula)', supports: 'Idantite ak nasyonalite jan konsila ki te bay li a anrejistre yo.', limitations: 'Li pa etabli ke yon paspò egziste oswa te janm bay; akseptasyon varye selon jij la ak tip benefis la.', acquisition: 'Aplike nan konsila peyi orijin ki sèvi zòn aplikan an; anjeneral li mande prèv nasyonalite ak yon frè.', safety: 'Kontak ak konsila anjeneral gen ti risk, men moun ki gen zafè ranfòsman annatant ta dwe pale ak yon avoka anvan sou moman an.', reviewNeeded: 'Konfime kat la ajou epi non an koresponn ak lòt dosye yo.' },
proxy_passport_2: { label: 'Sètifika nesans (Birth Certificate)', supports: 'Enfòmasyon biyografik: non, dat ak kote nesans, ak paran jan yo te anrejistre yo.', limitations: 'Li PA etabli ke yon paspò egziste oswa te janm bay. Yon sètifika nesans se pa yon dokiman vwayaj.', acquisition: 'Mande li nan rejis sivil kote nesans la; si li pa disponib, dokimante tantativ la (gade 8 CFR 103.2(b)(2)).', safety: 'Mande dosye nan peyi orijin ka ekspoze manm fanmi ki toujou la. Itilize entèmedyè pa lapòs oswa yon avoka lè gen risk.', reviewNeeded: 'Tcheke si anrejistreman an te fèt nan epòk la oswa se yon anrejistreman anreta; note kiyès.' },
proxy_passport_3: { label: 'Kat idantite nasyonal (National ID Card)', supports: 'Idantite jan otorite nasyonal ki te bay li a anrejistre li.', limitations: 'Li pa etabli yo te bay yon paspò epi yo ka pa aksepte li kòm prèv prensipal idantite pou chak benefis.', acquisition: 'Otorite sivil peyi orijin bay li; ranplasman anjeneral mande yon aplikasyon an pèsòn oswa nan konsila.', safety: 'Menm prekosyon kontak ak peyi orijin tankou pou dosye nesans yo.', reviewNeeded: 'Verifye dat ekspirasyon an epi enfòmasyon biyografik yo koresponn ak lòt dokiman.' } } },
has_i94: { targetFact: 'Admisyon Ozetazini — ki lè ak kijan aplikan an te antre.', primaryEvidence: 'Dosye Arive/Depa I-94 (I-94 Arrival/Departure Record; ou ka reprann li nan i94.cbp.dhs.gov pou antre legal ki resan).', alternatives: {
proxy_i94_1: { label: 'Tikè vwayaj / kat anbakman', supports: 'Yon itinerè vwayaj ki koresponn ak wout yo deklare a ak moman antre apeprè a.', limitations: 'Yo pa etabli admisyon legal, dat antre egzak la, oswa fason antre a.', acquisition: 'Dosye konpayi avyon oswa ajans vwayaj, konfirmasyon imèl, istwa vwayajè frekan.', safety: 'Ti risk; se dosye aplikan an menm.', reviewNeeded: 'Tcheke non, dat, ak wout yo koresponn youn ak lòt.' },
proxy_i94_2: { label: 'Foto ak dat Ozetazini', supports: 'Prezans fizik Ozetazini nan dat ki asosye ak foto a oswa ozalantou li.', limitations: 'Yo PA etabli dat antre egzak la oswa fason antre a. Dat foto yo ka mal oswa manke.', acquisition: 'Woulo kamera telefòn, sovgad foto nan nyaj, achiv rezo sosyal — konsève orijinal yo ak metadone lè sa posib.', safety: 'Revize foto yo pou lòt moun ki ka pa dakò yo idantifye yo; pa pataje yo piblikman.', reviewNeeded: 'Konfime sous dat la (metadone kont estimasyon) ak siy kote ki vizib nan imaj la.' },
proxy_i94_3: { label: 'Resi klinik oswa lopital', supports: 'Prezans Ozetazini nan dat sèvis la.', limitations: 'Yo pa etabli dat antre a oswa fason antre a.', acquisition: 'Mande resi detaye oswa rezime vizit nan biwo dosye medikal founisè a.', safety: 'Dosye medikal yo sansib; pataje yo sèlman ak yon avoka oswa jan sa nesesè, ak tretman ki konfòm ak HIPAA.', reviewNeeded: 'Konfime dat sèvis la epi dosye a se pou aplikan an.' } } },
has_lease: { targetFact: 'Rezidans fizik nan yon adrès Ozetazini (kote aplikan an rete).', primaryEvidence: 'Kontra lwaye fòmèl alekri pou rezidans aplikan an.', alternatives: {
proxy_lease_1: { label: 'Dosye lekòl', supports: 'Enskripsyon ki lye ak rezidans ki konekte aplikan an (oswa pitit li) ak yon adrès ak yon peryòd dat.', limitations: 'Yo pa etabli yon kontra lwaye fòmèl oswa lokasyon aplikan an menm.', acquisition: 'Mande verifikasyon enskripsyon nan biwo rejis lekòl la.', safety: 'Ti risk; se dosye aplikan an menm.', reviewNeeded: 'Tcheke adrès ak dat enskripsyon yo montre yo.' },
proxy_lease_2: { label: 'Lèt notarye pwopriyetè/kolokatè', supports: 'Enfòmasyon rezidans (adrès, dat, aranjman lwaye) moun ki ekri a ateste an pèsòn.', limitations: 'Li PA etabli yon kontra lwaye fòmèl. Pwa li depann de presizyon, kredibilite, ak konesans an pèsòn moun ki ekri a.', acquisition: 'Mande pwopriyetè a oswa kolokatè a yon lèt ki date ak siyati ki di adrès, dat demenajman, ak kondisyon lwaye; notarye ajoute fòmalite men pa sifizans legal.', safety: 'Sitiyasyon imigrasyon oswa lojman moun ki ekri a ka fè li ezite; pa fè presyon sou pèsòn.', reviewNeeded: 'Konfime relasyon moun ki ekri a ak aplikan an epi detay yo espesifik, pa jeneral.' },
proxy_lease_3: { label: 'Fakti sèvis piblik (Utility Bill)', supports: 'Rezidans nan adrès sèvis la pandan peryòd faktirasyon an, sou non titilè kont la.', limitations: 'Li pa etabli yon kontra lwaye fòmèl, epi li vle di ti kras si kont la pa sou non aplikan an.', acquisition: 'Kont an liy founisè sèvis la oswa demann dosye nan sèvis kliyantèl.', safety: 'Ti risk; se dosye aplikan an menm.', reviewNeeded: 'Konfime non ki sou kont la ak adrès/dat sèvis la.' } } },
has_persecution_proof: { targetFact: 'Mal oswa pèsekisyon li te sibi (oswa li pè), ak koneksyon li ak yon rezon pwoteje tankou relijyon, ras, nasyonalite, opinyon politik, oswa manm nan yon gwoup sosyal patikilye.', primaryEvidence: 'Prèv dirèk mal la: rapò lapolis, dosye medikal blesi, foto, menas alekri, dosye detansyon.', alternatives: {
proxy_persecution_1: { label: 'Lèt temwen', supports: 'Koroborasyon evènman moun ki ekri a te wè oswa viv an pèsòn.', limitations: 'Yo menm sèlman yo pa pwouve elijibilite legal; pwa yo depann de presizyon, konesans an pèsòn, ak kredibilite. Yo apiye rapò a — yo pa deside ka a.', acquisition: 'Mande temwen ki gen konesans pèsonèl dirèk deklarasyon ki date ak siyati ki dekri sa yo te wè, ki lè, ak ki kote.', safety: 'Temwen nan peyi orijin ka sibi reprezay. Pa janm mande pèsòn pran risk; pale sou sekirite temwen ak yon avoka anvan ou mande anyen depi aletranje.', reviewNeeded: 'Konfime konesans an pèsòn (pa rimè) ak dat/kote espesifik.' },
proxy_persecution_2: { label: 'Dosye medikal', supports: 'Blesi oswa tretman ki koresponn ak mal yo deklare a, ak dat.', limitations: 'Yo menm sèlman yo pa etabli ki moun ki te lakoz mal la oswa poukisa li te rive.', acquisition: 'Mande dosye tretman nan biwo dosye klinik oswa lopital la, Ozetazini oswa aletranje.', safety: 'Dosye medikal yo sansib; limite pataj ak avoka ak soumisyon ki nesesè yo. Jwenn dosye nan peyi orijin ka ekspoze kote aplikan an ye oswa kontak li yo.', reviewNeeded: 'Tcheke dyagnostik/dat yo koresponn ak rapò a; note sa dosye yo pa di.' },
proxy_persecution_3: { label: 'Atik nouvèl / kondisyon peyi', supports: 'Kontèks: yo rapòte tip mal yo deklare a kont moun tankou aplikan an (pa egzanp minorite relijye) nan peyi a.', limitations: 'Yo PA pwouve aplikan an te viv evènman an an pèsòn. Prèv kondisyon peyi bay kontèks — se pa prèv endividyèl.', acquisition: 'Rapòtay ki fyab (gwo medya, òganizasyon dwa moun, rapò peyi Depatman Deta Etazini) ki date pre evènman ki enpòtan yo.', safety: 'Pa gen risk pèsonèl nan ranmase rapòtay piblik.', reviewNeeded: 'Konfime rapòtay la konsène vrèman gwoup, rejyon, ak peryòd aplikan an — pa sèlman peyi a an jeneral.' } } },
has_green_card: { targetFact: 'Estati rezidan pèmanan legal Ozetazini.', primaryEvidence: 'Kat Rezidan Pèmanan (Permanent Resident Card, Fòm I-551, "Green Card").', alternatives: {
proxy_greencard_1: { label: 'Tenb I-551 nan paspò', supports: 'Prèv tanporè estati rezidan pèmanan legal, valab pou peryòd tenb la kouvri a.', limitations: 'Li ekspire; li pa ranplase kat la epi yo pa aksepte li san limit.', acquisition: 'Randevou nan biwo lokal USCIS (tenb InfoPass/ADIT) si kat la pèdi oswa ekspire.', safety: 'Ti risk; ou jwenn li dirèkteman nan USCIS.', reviewNeeded: 'Tcheke dat validite tenb la.' },
proxy_greencard_2: { label: 'Avi apwobasyon USCIS (I-797)', supports: 'Ke USCIS te apwouve petisyon imigran oswa aplikasyon ajisteman ki kache a.', limitations: 'Li menm sèlman li pa prèv estati aktyèl; li montre yon apwobasyon, pa kat la.', acquisition: 'Dosye aplikan an menm; ranplasman pa demann bay USCIS.', safety: 'Ti risk; se dosye aplikan an menm.', reviewNeeded: 'Konfime avi a konsène aplikan an ak bon benefis la.' },
proxy_greencard_3: { label: 'Kopi Green Card ki pèdi a', supports: 'Ke yo te bay yon kat (kopi devan/dèyè montre nimewo ak dat yo).', limitations: 'Yon kopi se pa prèv valab estati. Depoze Fòm I-90 pou ranplase yon kat ki pèdi.', acquisition: 'Dosye aplikan an menm; apre depoze I-90 pou yon ranplasman.', safety: 'Ti risk.', reviewNeeded: 'Konfime kopi a lizib epi li koresponn ak idantite aplikan an.' } } },
has_tax_transcripts: { targetFact: 'Konfòmite taks epi, selon benefis la, rezidans kontinyèl oswa bon karaktè moral.', primaryEvidence: 'Transkripsyon deklarasyon taks IRS ki kouvri ane yo mande yo (anjeneral 3–5).', alternatives: {
proxy_tax_1: { label: 'Fòm W-2 oswa 1099', supports: 'Revni yo rapòte, anplwayè, ak ane taks pou fòm yo bay yo.', limitations: 'Yo pa etabli deklarasyon yo te vrèman depoze oswa taks yo te peye nèt.', acquisition: 'Depatman pevòl anplwayè oswa dosye aplikan an menm; transkripsyon salè ak revni IRS kòm backup.', safety: 'Ti risk; se dosye aplikan an menm.', reviewNeeded: 'Konfime ane taks yo kouvri epi non/SSN koresponn.' },
proxy_tax_2: { label: 'Souch peman (Pay Stubs)', supports: 'Travay ak revni pandan peryòd peman espesifik yo montre yo.', limitations: 'Yo kouvri sèlman yon ti peryòd; yo pa dosye taks epi yo pa montre konfòmite depo.', acquisition: 'Sistèm pevòl anplwayè oswa dosye aplikan an menm.', safety: 'Ti risk.', reviewNeeded: 'Note peryòd dat la; kèk souch pa kouvri ane.' },
proxy_tax_3: { label: 'Relve kont labank', supports: 'Aktivite finansye (depo, transfè) ki koresponn ak rezidans ak travay pandan peryòd relve a.', limitations: 'Yo pa etabli konfòmite taks oswa depo.', acquisition: 'Pòtal an liy labank oswa demann dosye nan branch.', safety: 'Relve labank revele anpil detay pèsonèl; pataje sèlman sa avoka a bezwen.', reviewNeeded: 'Konfime titilè kont la ak dat relve yo.' } } },
has_marriage_cert: { targetFact: 'Yon relasyon maryaj lalwa rekonèt.', primaryEvidence: 'Sètifika maryaj sivil otorite gouvènman konpetan te bay.', alternatives: {
proxy_marriage_1: { label: 'Sètifika maryaj relijye', supports: 'Ke yon seremoni maryaj relijye te fèt, ak dat ak ofisyan.', limitations: 'Li ka pa etabli yon maryaj lalwa rekonèt, selon jiridiksyon an epi si anrejistreman sivil te swiv.', acquisition: 'Enstitisyon relijye ki te fè seremoni an.', safety: 'Ti risk; konsidere si divilge afilyasyon relijye kreye risk nan kontèks aplikan an epi pale ak yon avoka.', reviewNeeded: 'Konfime si yon anrejistreman sivil egziste apa.' },
proxy_marriage_2: { label: 'Sètifika nesans timoun ansanm', supports: 'Parante pataje timoun yo liste yo.', limitations: 'Yo pa etabli yon maryaj legal egziste.', acquisition: 'Rejis sivil kote nesans la.', safety: 'Dosye timoun yo sansib; pataje yo minimòm.', reviewNeeded: 'Konfime tou de paran yo nome jan yo deklare a.' },
proxy_marriage_3: { label: 'Afidavi fanmi/zanmi (Affidavits)', supports: 'Ke moun ki gen konesans pèsonèl te obsève relasyon koup la pandan tan.', limitations: 'Anjeneral yo trete yo kòm prèv ki pi fèb (tèsyè). Dapre 8 CFR 103.2(b)(2), yo aksepte afidavi sèlman apre yo montre prèv prensipal ak segondè pa disponib — eksplike endisponibilite a alekri.', acquisition: 'Deklarasyon ki date ak siyati moun ki pa pati epi ki gen konesans pèsonèl dirèk, ki dekri obsèvasyon espesifik (pa konklizyon).', safety: 'Moun ki siyen yo dwe konprann yo siyen anba penalite fo temwayaj.', reviewNeeded: 'Konfime konesans an pèsòn ak enfòmasyon espesifik, pa lwanj jeneral.' } } },
has_proof_of_relationship: { targetFact: 'Ke relasyon fanmi yo deklare a se de bonnfwa (reyèl), li pa fèt pou rezon imigrasyon.', primaryEvidence: 'Prèv dirèk: kont labank ansanm, foto ansanm pandan tan, kontra lwaye ansanm, dosye timoun, asirans pataje.', alternatives: {
proxy_relationship_1: { label: 'Kontra lwaye ansanm oswa fakti sèvis', supports: 'Yon kay pataje nan menm adrès pandan peryòd ki kouvri a.', limitations: 'Yo menm sèlman yo pa pwouve relasyon an de bonnfwa.', acquisition: 'Dosye pwopriyetè, manadjè pwopriyete, oswa founisè sèvis.', safety: 'Ti risk; se dosye aplikan an menm.', reviewNeeded: 'Konfime tou de non yo parèt epi dat yo koresponn ak peryòd relasyon yo deklare a.' },
proxy_relationship_2: { label: 'Resi transfè lajan', supports: 'Yon modèl sipò finansye/transfè ant pati yo.', limitations: 'Yo pa etabli nati relasyon an (sipò ka egziste ant moun ki pa marye).', acquisition: 'Istwa sèvis transfè lajan oswa dosye transfè labank.', safety: 'Ti risk; li revele detay finansye — pataje minimòm.', reviewNeeded: 'Konfime moun ki voye, moun ki resevwa, montan, ak regilarite.' },
proxy_relationship_3: { label: 'Jounal kominikasyon (WhatsApp, imèl)', supports: 'Kontak kontinyèl ak teksti relasyon an pandan tan.', limitations: 'Kontni ak kontèks enpòtan; jounal yo sèlman pa pwouve bonnfwa, epi ekstrè seleksyone ka twonpe.', acquisition: 'Ekspòte istwa chat yo; konsève orijinal yo ak dat.', safety: 'Kontni mesaj ka trè pèsonèl; aplikan an ta dwe revize tout bagay anvan li pataje epi retire materyèl prive ki pa gen rapò.', reviewNeeded: 'Konfime idantite patisipan yo epi ekstrè yo reprezantan, pa chwazi pou avantaje.' } } },
has_arrests: { targetFact: 'Istwa kriminèl konplè ak dispozisyon final (rezilta) chak arestasyon.', primaryEvidence: 'Sètifika Dispozisyon (Certificate of Disposition) pou chak arestasyon, nan tribinal kriminèl kote yo te tande ka a.', alternatives: {
proxy_arrests_1: { label: 'Rapò antesedan (Rap Sheet / Criminal History Record)', supports: 'Yon dosye konpile arestasyon ak akizasyon jan baz done lapolis rapòte yo.', limitations: 'Li ka enkonplè oswa pa egzak, epi li pa etabli dispozisyon final okenn ka.', acquisition: 'Rezime istwa idantite FBI oswa demann depo eta (anjeneral yo mande anprent).', safety: 'Mande pwòp dosye ou gen ti risk, men rezilta yo dwe ale dirèkteman bay yon avoka — pa poste oswa pataje yo.', reviewNeeded: 'Konpare ak rapò aplikan an; siyalize diferans bay avoka a.' },
proxy_arrests_2: { label: 'Avi konparisyon tribinal', supports: 'Ke yon dat tribinal te egziste pou yon ka ak akizasyon bay.', limitations: 'Yo PA etabli dispozisyon final la. Yon avi konparisyon se pa yon sètifika dispozisyon — yo dwe toujou jwenn rezilta a nan tribinal la.', acquisition: 'Dosye aplikan an menm oswa biwo grefye tribinal la.', safety: 'Ti risk.', reviewNeeded: 'Konfime nimewo ka a koresponn ak arestasyon an kesyon an.' },
proxy_arrests_3: { label: 'Lèt ansyen avoka defans', supports: 'Rapò pwofesyonèl avoka a sou kijan ka a te fini.', limitations: 'Li pa ranplase dosye dispozisyon ofisyèl tribinal la.', acquisition: 'Kontakte biwo ansyen avoka a epi mande yon lèt ki rezime dispozisyon an.', safety: 'Privilèj avoka-kliyan ka limite sa yon ansyen avoka ka divilge; aplikan an ka bezwen renonse privilèj la alekri pou rezon sa a.', reviewNeeded: 'Konfime lèt la konsène ka espesifik la ak rezilta a.' } } },
},
AR: {
has_passport: { targetFact: 'الهوية والجنسية — من هو مقدم الطلب وبلد جنسيته.', primaryEvidence: 'جواز سفر سارٍ صادر عن بلد الأصل.', alternatives: {
proxy_passport_1: { label: 'بطاقة الهوية القنصلية (Consular ID / Matrícula)', supports: 'الهوية والجنسية كما سجلتها القنصلية المصدرة.', limitations: 'لا تثبت وجود جواز سفر أو أنه صدر في أي وقت؛ يختلف القبول حسب القاضي ونوع الاستحقاق.', acquisition: 'قدّم الطلب في قنصلية بلد الأصل التي تخدم منطقة مقدم الطلب؛ يتطلب عادةً إثبات الجنسية ورسمًا.', safety: 'الاتصال بالقنصلية منخفض المخاطر عمومًا، لكن من لديهم مسائل إنفاذ معلقة يجب أن يناقشوا التوقيت مع محامٍ أولًا.', reviewNeeded: 'تأكد من أن البطاقة سارية وأن الاسم يطابق السجلات الأخرى.' },
proxy_passport_2: { label: 'شهادة الميلاد (Birth Certificate)', supports: 'حقائق السيرة: الاسم وتاريخ ومكان الميلاد والنسب كما سُجلت عند التسجيل.', limitations: 'لا تثبت وجود جواز سفر أو أنه صدر في أي وقت. شهادة الميلاد ليست وثيقة سفر.', acquisition: 'اطلبها من السجل المدني لمكان الميلاد؛ إذا لم تكن متاحة، وثّق المحاولة (انظر 8 CFR 103.2(b)(2)).', safety: 'طلب السجلات من بلد الأصل قد يعرّض أفراد الأسرة الذين ما زالوا هناك للخطر. استخدم وسطاء بالبريد أو محاميًا عند وجود خطر.', reviewNeeded: 'تحقق مما إذا كان قيد السجل معاصرًا أم تسجيلًا متأخرًا؛ ولاحظ أيهما.' },
proxy_passport_3: { label: 'بطاقة الهوية الوطنية (National ID Card)', supports: 'الهوية كما سجلتها السلطة الوطنية المصدرة.', limitations: 'لا تثبت إصدار جواز سفر وقد لا تُقبل كإثبات هوية أساسي لكل استحقاق.', acquisition: 'تصدرها السلطة المدنية في بلد الأصل؛ تتطلب البدائل عادةً طلبًا شخصيًا أو قنصليًا.', safety: 'نفس تحذير الاتصال ببلد الأصل كما في سجلات الميلاد.', reviewNeeded: 'تحقق من تاريخ الانتهاء وأن تفاصيل السيرة تطابق المستندات الأخرى.' } } },
has_i94: { targetFact: 'الدخول إلى الولايات المتحدة — متى وكيف دخل مقدم الطلب.', primaryEvidence: 'سجل الوصول/المغادرة I-94 (I-94 Arrival/Departure Record؛ يمكن استرجاعه على i94.cbp.dhs.gov للدخول القانوني الحديث).', alternatives: {
proxy_i94_1: { label: 'تذاكر السفر / بطاقات الصعود', supports: 'خط سير سفر متسق مع المسار المزعوم وتوقيت الدخول التقريبي.', limitations: 'لا تثبت الدخول القانوني أو تاريخ الدخول الدقيق أو طريقة الدخول.', acquisition: 'سجلات شركة الطيران أو وكيل السفر، تأكيدات البريد الإلكتروني، سجل المسافر الدائم.', safety: 'مخاطر منخفضة؛ هذه سجلات مقدم الطلب الخاصة.', reviewNeeded: 'تحقق من أن الأسماء والتواريخ والمسارات متسقة داخليًا.' },
proxy_i94_2: { label: 'صور مؤرخة في الولايات المتحدة', supports: 'الوجود الفعلي في الولايات المتحدة في التاريخ المرتبط بالصورة أو حوله.', limitations: 'لا تثبت تاريخ الدخول الدقيق أو طريقة الدخول. قد تكون تواريخ الصور خاطئة أو مفقودة.', acquisition: 'ألبوم كاميرا الهاتف، النسخ الاحتياطية السحابية للصور، أرشيف وسائل التواصل — احتفظ بالأصول مع البيانات الوصفية حيثما أمكن.', safety: 'راجع الصور بحثًا عن أشخاص آخرين قد لا يوافقون على تحديد هويتهم؛ لا تشاركها علنًا.', reviewNeeded: 'تأكد من مصدر التاريخ (البيانات الوصفية مقابل التخمين) وإشارات الموقع الظاهرة في الصورة.' },
proxy_i94_3: { label: 'إيصالات العيادة أو المستشفى', supports: 'الوجود في الولايات المتحدة في تاريخ الخدمة.', limitations: 'لا تثبت تاريخ الدخول أو طريقة الدخول.', acquisition: 'اطلب إيصالات مفصلة أو ملخصات الزيارة من مكتب السجلات الطبية للمقدم.', safety: 'السجلات الطبية حساسة؛ شاركها فقط مع محامٍ أو حسب الحاجة، مع معالجة متوافقة مع HIPAA.', reviewNeeded: 'تأكد من تاريخ الخدمة وأن السجل يخص مقدم الطلب.' } } },
has_lease: { targetFact: 'الإقامة الفعلية في عنوان أمريكي (حيث يعيش مقدم الطلب).', primaryEvidence: 'عقد إيجار رسمي مكتوب لمسكن مقدم الطلب.', alternatives: {
proxy_lease_1: { label: 'سجلات المدرسة', supports: 'تسجيل مرتبط بالإقامة يربط مقدم الطلب (أو طفله) بعنوان ونطاق تواريخ.', limitations: 'لا تثبت عقد إيجار رسمي أو إشغال مقدم الطلب نفسه.', acquisition: 'اطلب التحقق من التسجيل من مسجل المدرسة.', safety: 'مخاطر منخفضة؛ سجلات مقدم الطلب الخاصة.', reviewNeeded: 'تحقق من العنوان وتواريخ التسجيل المعروضة.' },
proxy_lease_2: { label: 'خطاب موثق من المالك/زميل السكن', supports: 'حقائق الإقامة (العنوان والتواريخ وترتيب الإيجار) كما شهد بها الكاتب بنفسه.', limitations: 'لا يثبت عقد إيجار رسمي. يعتمد وزنه على خصوصية الكاتب ومصداقيته ومعرفته المباشرة.', acquisition: 'اطلب من المالك أو زميل السكن خطابًا مؤرخًا وموقعًا يذكر العنوان وتاريخ الانتقال وشروط الإيجار؛ يضيف التوثيق رسمية لكنه لا يضيف كفاية قانونية.', safety: 'قد تجعل حالة الهجرة أو السكن للكاتب مترددًا؛ لا تضغط على أي شخص.', reviewNeeded: 'تأكد من علاقة الكاتب بمقدم الطلب وأن التفاصيل محددة وليست عامة.' },
proxy_lease_3: { label: 'فاتورة المرافق (Utility Bill)', supports: 'الإقامة في عنوان الخدمة خلال فترة الفوترة، باسم صاحب الحساب.', limitations: 'لا تثبت عقد إيجار رسمي، وتعني القليل إذا لم يكن الحساب باسم مقدم الطلب.', acquisition: 'حساب مقدم المرافق عبر الإنترنت أو طلب سجلات خدمة العملاء.', safety: 'مخاطر منخفضة؛ سجلات مقدم الطلب الخاصة.', reviewNeeded: 'تأكد من الاسم على الحساب وعنوان/تواريخ الخدمة.' } } },
has_persecution_proof: { targetFact: 'الأذى أو الاضطهاد الذي تعرض له (أو يخشاه)، وصلته بسبب محمي مثل الدين أو العرق أو الجنسية أو الرأي السياسي أو العضوية في مجموعة اجتماعية معينة.', primaryEvidence: 'أدلة مباشرة على الأذى: تقارير الشرطة، السجلات الطبية للإصابات، الصور، التهديدات المكتوبة، سجلات الاحتجاز.', alternatives: {
proxy_persecution_1: { label: 'خطابات الشهود', supports: 'تأييد للأحداث التي رآها الكاتب أو عاشها شخصيًا.', limitations: 'لا تثبت بحد ذاتها الأهلية القانونية؛ يعتمد وزنها على الخصوصية والمعرفة المباشرة والمصداقية. إنها تدعم الرواية — ولا تحسم القضية.', acquisition: 'اطلب من شهود ذوي معرفة شخصية مباشرة بيانات مؤرخة وموقعة تصف ما رأوه ومتى وأين.', safety: 'قد يواجه الشهود في بلد الأصل انتقامًا. لا تطلب أبدًا من أي شخص أن يخاطر؛ ناقش سلامة الشهود مع محامٍ قبل طلب أي شيء من الخارج.', reviewNeeded: 'تأكد من المعرفة المباشرة (وليس السماع) وتواريخ/أماكن محددة.' },
proxy_persecution_2: { label: 'السجلات الطبية', supports: 'إصابات أو علاج متسق مع الأذى المزعوم، مع التواريخ.', limitations: 'لا تثبت بحد ذاتها من تسبب في الأذى أو سبب حدوثه.', acquisition: 'اطلب سجلات العلاج من مكتب سجلات العيادة أو المستشفى، في الولايات المتحدة أو الخارج.', safety: 'السجلات الطبية حساسة؛ قصر المشاركة على المحامي والتقديمات المطلوبة. الحصول على سجلات من بلد الأصل قد يكشف موقع مقدم الطلب أو جهات اتصاله.', reviewNeeded: 'تحقق من أن التشخيصات/التواريخ متسقة مع الرواية؛ لاحظ ما لا تقوله السجلات.' },
proxy_persecution_3: { label: 'مقالات إخبارية / ظروف البلد', supports: 'سياق: أن نوع الأذى المزعوم يُبلغ عنه ضد أشخاص مثل مقدم الطلب (مثل الأقليات الدينية) في البلد.', limitations: 'لا تثبت أن مقدم الطلب عاش الحدث شخصيًا. أدلة ظروف البلد توفر سياقًا — وليست إثباتًا فرديًا.', acquisition: 'تقارير موثوقة (وسائل إعلام رئيسية، منظمات حقوق الإنسان، تقارير وزارة الخارجية الأمريكية عن البلدان) مؤرخة قرب الأحداث ذات الصلة.', safety: 'لا مخاطر شخصية في جمع التقارير العامة.', reviewNeeded: 'تأكد من أن التقارير تخص فعلًا مجموعة مقدم الطلب ومنطقته وفترته الزمنية — وليس البلد عمومًا فقط.' } } },
has_green_card: { targetFact: 'وضع المقيم الدائم القانوني في الولايات المتحدة.', primaryEvidence: 'بطاقة المقيم الدائم (Permanent Resident Card، النموذج I-551، "Green Card").', alternatives: {
proxy_greencard_1: { label: 'ختم I-551 في جواز السفر', supports: 'دليل مؤقت على وضع المقيم الدائم القانوني، سارٍ للفترة التي يغطيها الختم.', limitations: 'ينتهي؛ لا يحل محل البطاقة ولا يُقبل إلى أجل غير مسمى.', acquisition: 'موعد في مكتب USCIS الميداني (ختم InfoPass/ADIT) إذا فُقدت البطاقة أو انتهت.', safety: 'مخاطر منخفضة؛ يُحصل عليه مباشرة من USCIS.', reviewNeeded: 'تحقق من تواريخ صلاحية الختم.' },
proxy_greencard_2: { label: 'إشعار موافقة USCIS (I-797)', supports: 'أن USCIS وافقت على التماس الهجرة الأساسي أو طلب تعديل الوضع.', limitations: 'ليس إثباتًا للوضع الحالي بحد ذاته؛ يُظهر موافقة وليس البطاقة.', acquisition: 'سجلات مقدم الطلب الخاصة؛ بدائل عبر طلب إلى USCIS.', safety: 'مخاطر منخفضة؛ سجلات مقدم الطلب الخاصة.', reviewNeeded: 'تأكد من أن الإشعار يتعلق بمقدم الطلب والاستحقاق الصحيح.' },
proxy_greencard_3: { label: 'نسخة من Green Card المفقودة', supports: 'أنه صدرت بطاقة (تُظهر النسخة الأمامية/الخلفية الرقم والتواريخ).', limitations: 'النسخة ليست إثباتًا صالحًا للوضع. قدّم النموذج I-90 لاستبدال بطاقة مفقودة.', acquisition: 'ملفات مقدم الطلب الخاصة؛ ثم قدّم I-90 للحصول على بديل.', safety: 'مخاطر منخفضة.', reviewNeeded: 'تأكد من أن النسخة مقروءة وتطابق هوية مقدم الطلب.' } } },
has_tax_transcripts: { targetFact: 'الامتثال الضريبي، وحسب الاستحقاق، الإقامة المستمرة أو حسن الخلق الأخلاقي.', primaryEvidence: 'نسخ إقرارات ضريبية من IRS تغطي السنوات المطلوبة (عادةً 3–5).', alternatives: {
proxy_tax_1: { label: 'نماذج W-2 أو 1099', supports: 'الأرباح المبلغ عنها وصاحب العمل والسنة الضريبية للنماذج المقدمة.', limitations: 'لا تثبت أن الإقرارات قُدمت فعليًا أو أن الضرائب دُفعت بالكامل.', acquisition: 'أقسام رواتب صاحب العمل أو سجلات مقدم الطلب الخاصة؛ نسخ أجور ودخل IRS كاحتياط.', safety: 'مخاطر منخفضة؛ سجلات مقدم الطلب الخاصة.', reviewNeeded: 'تأكد من السنوات الضريبية المغطاة وأن الأسماء/SSN متطابقة.' },
proxy_tax_2: { label: 'كعوب الرواتب (Pay Stubs)', supports: 'التوظيف والأرباح خلال فترات الدفع المحددة المعروضة.', limitations: 'تغطي نافذة محدودة فقط؛ ليست سجلات ضريبية ولا تُظهر امتثال التقديم.', acquisition: 'نظام رواتب صاحب العمل أو سجلات مقدم الطلب الخاصة.', safety: 'مخاطر منخفضة.', reviewNeeded: 'لاحظ نطاق التواريخ؛ بضعة كعوب لا تغطي سنوات.' },
proxy_tax_3: { label: 'كشوف الحسابات المصرفية', supports: 'نشاط مالي (إيداعات وتحويلات) متسق مع الإقامة والتوظيف خلال فترة الكشف.', limitations: 'لا تثبت الامتثال الضريبي أو التقديم.', acquisition: 'بوابة البنك عبر الإنترنت أو طلب سجلات الفرع.', safety: 'تكشف كشوف الحسابات المصرفية تفاصيل شخصية واسعة؛ شارك فقط ما يحتاجه المحامي.', reviewNeeded: 'تأكد من صاحب الحساب وتواريخ الكشوف.' } } },
has_marriage_cert: { targetFact: 'علاقة زوجية معترف بها قانونًا.', primaryEvidence: 'شهادة زواج مدنية صادرة عن السلطة الحكومية المختصة.', alternatives: {
proxy_marriage_1: { label: 'شهادة زواج ديني', supports: 'أن حفل زواج ديني قد أُقيم، مع التاريخ والمُجري.', limitations: 'قد لا تثبت زواجًا معترفًا به قانونًا، حسب الولاية القضائية وما إذا تبعها تسجيل مدني.', acquisition: 'المؤسسة الدينية التي أجرت الحفل.', safety: 'مخاطر منخفضة؛ ضع في اعتبارك ما إذا كان الكشف عن الانتماء الديني يخلق خطرًا في سياق مقدم الطلب وناقشه مع محامٍ.', reviewNeeded: 'تأكد مما إذا كان يوجد تسجيل مدني منفصل.' },
proxy_marriage_2: { label: 'شهادات ميلاد الأطفال معًا', supports: 'النسب المشترك للأطفال المدرجين.', limitations: 'لا تثبت وجود زواج قانوني.', acquisition: 'السجل المدني لمكان الميلاد.', safety: 'سجلات الأطفال حساسة؛ شاركها بأقل قدر.', reviewNeeded: 'تأكد من تسمية كلا الوالدين كما هو مزعوم.' },
proxy_marriage_3: { label: 'إفادات من الأسرة/الأصدقاء (Affidavits)', supports: 'أن أشخاصًا ذوي معرفة شخصية لاحظوا علاقة الزوجين عبر الزمن.', limitations: 'تُعامل عمومًا كأدلة أضعف (من الدرجة الثالثة). بموجب 8 CFR 103.2(b)(2)، تُقبل الإفادات فقط بعد إظهار أن الأدلة الأساسية والثانوية غير متاحة — اشرح عدم التوفر كتابةً.', acquisition: 'بيانات مؤرخة وموقعة من غير أطراف ذوي معرفة شخصية مباشرة، تصف ملاحظات محددة (وليس استنتاجات).', safety: 'يجب أن يفهم الموقعون أنهم يوقعون تحت عقوبة الحنث باليمين.', reviewNeeded: 'تأكد من المعرفة المباشرة والحقائق المحددة، وليس الثناء العام.' } } },
has_proof_of_relationship: { targetFact: 'أن العلاقة الأسرية المزعومة حقيقية (genuine)، وليست لأغراض الهجرة.', primaryEvidence: 'إثبات مباشر: حسابات مصرفية مشتركة، صور معًا عبر الزمن، عقد إيجار مشترك، سجلات الأطفال، تأمين مشترك.', alternatives: {
proxy_relationship_1: { label: 'عقد إيجار مشترك أو فواتير مرافق', supports: 'أسرة مشتركة في نفس العنوان خلال الفترة المغطاة.', limitations: 'لا تثبت بحد ذاتها أن العلاقة حقيقية.', acquisition: 'سجلات المالك أو مدير العقار أو مقدم المرافق.', safety: 'مخاطر منخفضة؛ سجلات مقدم الطلب الخاصة.', reviewNeeded: 'تأكد من ظهور كلا الاسمين وتداخل التواريخ مع فترة العلاقة المزعومة.' },
proxy_relationship_2: { label: 'إيصالات التحويلات المالية', supports: 'نمط من الدعم المالي/التحويلات بين الطرفين.', limitations: 'لا تثبت طبيعة العلاقة (يمكن أن يوجد دعم بين غير الأزواج).', acquisition: 'سجل خدمة تحويل الأموال أو سجلات التحويل المصرفي.', safety: 'مخاطر منخفضة؛ تكشف تفاصيل مالية — شارك بأقل قدر.', reviewNeeded: 'تأكد من المرسل والمستلم والمبالغ والانتظام.' },
proxy_relationship_3: { label: 'سجلات الاتصالات (WhatsApp، رسائل البريد)', supports: 'اتصال مستمر وطبيعة العلاقة عبر الزمن.', limitations: 'المحتوى والسياق مهمان؛ السجلات وحدها لا تثبت حسن النية، والمقتطفات الانتقائية قد تضلل.', acquisition: 'صدّر سجلات المحادثات؛ احتفظ بالأصول مع التواريخ.', safety: 'قد يكون محتوى الرسائل شخصيًا للغاية؛ يجب على مقدم الطلب مراجعة كل شيء قبل المشاركة وحذف المواد الخاصة غير ذات الصلة.', reviewNeeded: 'تأكد من هويات المشاركين وأن المقتطفات تمثيلية وليست منتقاة.' } } },
has_arrests: { targetFact: 'السجل الجنائي الكامل والتصرف النهائي (نتيجة) كل اعتقال.', primaryEvidence: 'شهادة التصرف (Certificate of Disposition) لكل اعتقال، من المحكمة الجنائية التي نظرت القضية.', alternatives: {
proxy_arrests_1: { label: 'سجل السوابق (Rap Sheet / Criminal History Record)', supports: 'سجل مجمع للاعتقالات والتهم كما أبلغت عنها قواعد بيانات إنفاذ القانون.', limitations: 'قد يكون غير مكتمل أو غير دقيق، ولا يثبت التصرف النهائي في أي قضية.', acquisition: 'ملخص تاريخ هوية FBI أو طلب من مستودع الولاية (تُطلب البصمات عادةً).', safety: 'طلب سجلك الخاص منخفض المخاطر، لكن النتائج يجب أن تذهب مباشرة إلى محامٍ — لا تنشرها أو تشاركها.', reviewNeeded: 'قارن برواية مقدم الطلب؛ ضع علامة على التناقضات للمحامي.' },
proxy_arrests_2: { label: 'إشعارات المثول أمام المحكمة', supports: 'أنه كان هناك تاريخ محكمة لقضية وتهمة معينة.', limitations: 'لا تثبت التصرف النهائي. إشعار المثول ليس شهادة تصرف — يجب الحصول على النتيجة من المحكمة.', acquisition: 'سجلات مقدم الطلب الخاصة أو مكتب كاتب المحكمة.', safety: 'مخاطر منخفضة.', reviewNeeded: 'تأكد من أن رقم القضية يطابق الاعتقال المعني.' },
proxy_arrests_3: { label: 'خطابات من محامي الدفاع السابق', supports: 'رواية المحامي المهنية عن كيفية انتهاء القضية.', limitations: 'ليست بديلًا عن سجل تصرف المحكمة الرسمي.', acquisition: 'اتصل بمكتب المحامي السابق واطلب خطابًا يلخص التصرف.', safety: 'قد تحد امتيازات المحامي-العميل مما يمكن للمحامي السابق الكشف عنه؛ قد يحتاج مقدم الطلب إلى التنازل عن الامتياز كتابةً لهذا الغرض.', reviewNeeded: 'تأكد من أن الخطاب يتناول القضية والنتيجة المحددة.' } } },
},
};

/** Localized gap-record framing (current state, next-action steps, legal-review reasons). EN lives in the original literals; these tables only override for non-EN. */
export const GAP_I18N = {
  ES: {
    currentNo: 'El solicitante informó que no tiene este documento.',
    currentUnknown: 'El solicitante no sabe si tiene este documento, o no aplica tal como se preguntó.',
    legal: {
      has_persecution_proof: 'La evidencia de daño/persecución y la conexión entre un motivo protegido (p. ej., religión) y el presunto perseguidor requieren evaluación legal calificada.',
      has_arrests: 'El historial penal y la disposición final de cada arresto pueden afectar la elegibilidad. Siempre revele los arrestos a un abogado calificado; no interprete disposiciones sin asesoría.',
    },
    nextAttorney: 'Hable de este elemento con un abogado de inmigración calificado antes de reunir o presentar cualquier cosa.',
    nextDetermine: 'Determine si este documento existe (revise sus archivos personales y luego la autoridad emisora).',
    nextAlternatives: 'Trabaje las alternativas listadas en orden; reúna lo que se pueda obtener y anote lo que no.',
  },
  ZH: {
    currentNo: '申请人表示没有此文件。',
    currentUnknown: '申请人不知道是否有此文件，或者该问题不适用。',
    legal: {
      has_persecution_proof: '伤害/迫害证据以及受保护理由（如宗教）与所指称迫害者之间的联系需要合格的法律评估。',
      has_arrests: '犯罪历史和每次逮捕的最终处置可能会影响资格。请始终向合格律师披露逮捕情况；不要在没有律师的情况下解释处置结果。',
    },
    nextAttorney: '在收集或提交任何材料之前，请先与合格的移民律师讨论此项目。',
    nextDetermine: '确定此文件是否存在（先检查个人文件，然后联系签发机构）。',
    nextAlternatives: '按顺序处理所列的替代方案；收集可以获得的材料，并记录无法获得的材料。',
  },
  HT: {
    currentNo: 'Aplikan an rapòte li pa gen dokiman sa a.',
    currentUnknown: 'Aplikan an pa konnen si li gen dokiman sa a, oswa li pa aplike jan yo te mande a.',
    legal: {
      has_persecution_proof: 'Prèv mal/pèsekisyon ak koneksyon ant yon rezon pwoteje (pa egzanp relijyon) ak swadizan pèsekite a mande evalyasyon legal kalifye.',
      has_arrests: 'Istwa kriminèl ak dispozisyon final chak arestasyon ka afekte elijibilite. Toujou divilge arestasyon bay yon avoka kalifye; pa entèprete dispozisyon san konsèy.',
    },
    nextAttorney: 'Pale sou atik sa a ak yon avoka imigrasyon kalifye anvan ou ranmase oswa soumèt anyen.',
    nextDetermine: 'Detèmine si dokiman sa a egziste (tcheke dosye pèsonèl ou, apre otorite ki bay li a).',
    nextAlternatives: 'Travay altènatif yo liste yo nan lòd; ranmase sa ou ka jwenn epi note sa ou pa ka jwenn.',
  },
  AR: {
    currentNo: 'أفاد مقدم الطلب بأنه ليس لديه هذا المستند.',
    currentUnknown: 'لا يعرف مقدم الطلب ما إذا كان لديه هذا المستند، أو أنه لا ينطبق كما طُرح.',
    legal: {
      has_persecution_proof: 'تتطلب أدلة الأذى/الاضطهاد والعلاقة بين سبب محمي (مثل الدين) والاضطهاد المزعوم تقييمًا قانونيًا مؤهلًا.',
      has_arrests: 'يمكن أن يؤثر السجل الجنائي والتصرف النهائي في كل اعتقال على الأهلية. اكشف دائمًا عن الاعتقالات لمحامٍ مؤهل؛ لا تفسّر التصرفات دون مشورة.',
    },
    nextAttorney: 'ناقش هذا العنصر مع محامي هجرة مؤهل قبل جمع أو تقديم أي شيء.',
    nextDetermine: 'حدد ما إذا كان هذا المستند موجودًا (تحقق من الملفات الشخصية، ثم من السلطة المصدرة).',
    nextAlternatives: 'اعمل على البدائل المدرجة بالترتيب؛ اجمع ما يمكن الحصول عليه ولاحظ ما لا يمكن.',
  },
};

export function localizedKb(key, lang = 'EN') {
  const en = EVIDENCE_KB[key];
  if (!en) return null;
  if (!lang || lang === 'EN') {
    return { targetFact: en.targetFact, primaryEvidence: en.primaryEvidence, alternatives: en.alternatives.map((a) => ({ ...a })) };
  }
  const tr = (KB_I18N[lang] || {})[key];
  if (!tr) return { targetFact: en.targetFact, primaryEvidence: en.primaryEvidence, alternatives: en.alternatives.map((a) => ({ ...a })) };
  return {
    targetFact: tr.targetFact || en.targetFact,
    primaryEvidence: tr.primaryEvidence || en.primaryEvidence,
    alternatives: en.alternatives.map((a) => {
      const t = (tr.alternatives || {})[a.id];
      if (!t) return { ...a };
      return {
        id: a.id, availability: a.availability,
        label: t.label || a.label, supports: t.supports || a.supports, limitations: t.limitations || a.limitations,
        acquisition: t.acquisition || a.acquisition, safety: t.safety || a.safety, reviewNeeded: t.reviewNeeded || a.reviewNeeded,
      };
    }),
  };
}

export function localizedAlternative(key, alt, lang = 'EN') {
  if (!alt) return alt;
  if (!lang || lang === 'EN') return { ...alt };
  const kbKey = typeof key === 'string' ? key : Object.keys(EVIDENCE_KB).find((k) => EVIDENCE_KB[k].alternatives.some((a) => a.id === alt.id));
  const tr = kbKey ? ((KB_I18N[lang] || {})[kbKey]?.alternatives || {})[alt.id] : null;
  if (!tr) return { ...alt };
  return { ...alt, label: tr.label || alt.label, supports: tr.supports || alt.supports, limitations: tr.limitations || alt.limitations, acquisition: tr.acquisition || alt.acquisition, safety: tr.safety || alt.safety, reviewNeeded: tr.reviewNeeded || alt.reviewNeeded };
}

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
/**
 * Not-applicable rules (owner directive 2026-10-27, fix #9): an evidence
 * item that cannot apply to this applicant is never a gap and never a
 * demand. Provided ('yes') answers always win over N/A downstream.
 * - Marriage certificate: single marital status (no marriage to certify).
 * - Green card / tax transcripts: entered in the current calendar year
 *   (entryRecency '<1y'), i.e. a recent entrant.
 * Returns [{ key, reason }] in EN; the client mirrors these rules.
 */
export function getNotApplicableReasons(min) {
  if (!min) return [];
  const out = [];
  if (min.maritalStatus === 'single') {
    out.push({ key: 'has_marriage_cert', reason: 'No marriage to certify (single status reported).' });
    out.push({ key: 'has_proof_of_relationship', reason: 'No relationship to document (single status reported).' });
  }
  if (min.entryRecency === '<1y') {
    out.push({ key: 'has_green_card', reason: 'Recent entrant — a green card is not expected at this stage.' });
    out.push({ key: 'has_tax_transcripts', reason: 'Recent entrant — no prior-year US tax filings expected.' });
  }
  return out;
}

export function buildGapRecords(min, imageReviews = [], lang = 'EN') {
  const evidence = (min && min.evidence) || {};
  const reviews = Array.isArray(imageReviews) ? imageReviews : [];
  const records = [];
  const naKeys = new Set(getNotApplicableReasons(min).map(r => r.key));
  for (const key of EVIDENCE_KEYS) {
    const answer = evidence[key];
    // Disposition gaps are suppressed only by an explicit 'no' to prior
    // arrests: a certificates-'no' never implies no arrests, and legacy
    // payloads without the arrest-history answer keep the prior behavior
    // (owner directive 2026-10-27, fix #3).
    if (key === 'has_arrests' && min && min.priorArrests === 'no') continue;
    if (naKeys.has(key)) continue;
    if (answer !== 'no' && answer !== 'unknown') continue;
    const kb = localizedKb(key, lang);
    if (!kb) continue;
    const gapTr = (lang && lang !== 'EN' && GAP_I18N[lang]) || null;
    const currentState =
      answer === 'no'
        ? (gapTr ? gapTr.currentNo : 'Applicant reported they do not have this document.')
        : (gapTr ? gapTr.currentUnknown : 'Applicant does not know whether they have this document, or it does not apply as asked.');
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
      legalReviewReason: legalReviewReason(key, lang),
      imageObservations,
      imageReviewed: imageObservations.length > 0,
      nextAction: nextActionFor(key, answer, lang),
    });
  }
  return records;
}

export function nextActionFor(key, answer, lang = 'EN') {
  const base = { status: 'not-started' };
  const tr = (lang && lang !== 'EN' && GAP_I18N[lang]) || null;
  if (key === 'has_persecution_proof' || key === 'has_arrests') {
    return {
      ...base,
      step: tr ? tr.nextAttorney : 'Discuss this item with a qualified immigration attorney before gathering or submitting anything.',
      responsible: 'attorney',
      priority: 'high',
    };
  }
  if (key === 'has_passport' || key === 'has_i94') {
    return {
      ...base,
      step: answer === 'unknown'
        ? (tr ? tr.nextDetermine : 'Determine whether this document exists (check personal files, then the issuing authority).')
        : (tr ? tr.nextAlternatives : 'Work through the listed alternatives in order; gather what is obtainable and note what is not.'),
      responsible: 'applicant',
      priority: 'high',
    };
  }
  return {
    ...base,
    step: answer === 'unknown'
      ? (tr ? tr.nextDetermine : 'Determine whether this document exists (check personal files, then the issuing authority).')
      : (tr ? tr.nextAlternatives : 'Work through the listed alternatives in order; gather what is obtainable and note what is not.'),
    responsible: 'applicant',
    priority: 'medium',
  };
}

/**
 * The absence of corroborating material does not disprove an applicant's
 * account. This principle is encoded here (not just in prose) so prompts,
 * tests, and gap records all share one statement of it.
 */
/**
 * C5 — naming-collision guard. `has_prior_arrests` records whether arrests
 * occurred; `has_arrests` records ONLY whether disposition certificates are
 * held. The second reads as "has arrests" to any reader, including the model
 * (which once manufactured an "ambiguity" between them). The key is NOT
 * renamed: a rename would orphan stored recovery payloads and silently drop
 * the answer from analysis during a client/server version skew (the server
 * allowlist drops unknown keys). Instead, the meaning lives in ONE place and
 * api/c5-key-semantics.test.js fails if any prompt line or question text
 * stops carrying it.
 */
export const EVIDENCE_KEY_SEMANTICS = Object.freeze({
  has_arrests: Object.freeze({
    meaning: 'disposition certificates held, NOT arrest history',
    promptLabel: 'has_arrests (disposition certificates held, NOT arrest history)',
    gatedBy: 'has_prior_arrests',
  }),
});

export const NO_ADVERSE_INFERENCE_PRINCIPLE =
  'The absence of corroborating evidence does not, by itself, disprove the ' +
  'applicant\u2019s account. Missing documents are gaps to address — through ' +
  'primary evidence, secondary evidence, or a documented explanation of ' +
  'unavailability — not findings against the applicant.';
