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
 *
 * LANGUAGE CONTINUITY (directive 2026-10-22): all applicant-facing
 * prose in this module is localized per supported language
 * (EN/ES/ZH/HT/AR). Callers pass the applicant's selected language;
 * the default is English, and the English output is byte-identical
 * to the original module. Organization names, URLs, form ids, and
 * official names stay in their original form in every language.
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

export const SUPPORTED_LANGS = ['EN', 'ES', 'ZH', 'HT', 'AR'];
export function normLang(lang) {
  return SUPPORTED_LANGS.includes(lang) ? lang : 'EN';
}

/**
 * Localized next-steps content. `draftLabel` / `blankLabel` are the
 * localized document labels (kept identical to formmap.js's summary
 * labels — a regression test asserts they match).
 */
const STR = {
  EN: {
    title: NEXT_STEPS_TITLE,
    professionalHelp: PROFESSIONAL_HELP_POINTS,
    notEstablished: NOT_ESTABLISHED,
    searchPathDescriptions: RESOURCE_SEARCH_PATHS.map((p) => p.description),
    resourcesNote: 'IRU has not verified a local provider for this output. The directories below are general starting points for finding qualified help — inclusion is not a recommendation, and availability is not guaranteed.',
    draftLabel: 'IRU Pre-filled Draft — Review and Correct',
    blankLabel: 'Official Blank Form — Reference Copy',
    understandIntro: (name, edition, n) => `This package prepares a DRAFT of ${name} (Edition ${edition}) from the information you provided: ${n} field(s) were populated.`,
    understandMissing: (n, list) => `${n} required item(s) are still missing and were left blank: ${list}.`,
    understandMissingNone: 'No required item the form asks about was left unanswered from the information available.',
    understandConflicts: (n, list) => `${n} item(s) have conflicting values from different sources and were NOT filled in: ${list}. Resolve them before relying on the draft.`,
    understandNeedsConfirmation: (n, list) => `${n} value(s) came from your documents and still need your confirmation before they can be used: ${list}.`,
    reviewForm: [
      (draftLabel, blankLabel, id, edition, url) => `Compare the draft labeled "${draftLabel}" against the "${blankLabel}" (the official ${id}, Edition ${edition}, from ${url}) and against your own records.`,
      () => 'Check every populated field — your name, dates, addresses, and identifying information most of all. A pre-filled draft can contain mistakes; only you can confirm the answers are yours.',
      () => 'If anything is wrong, correct it in your information, regenerate the draft, and download the new version. Earlier downloads are stale once your information changes — use only the latest version.',
      () => 'Complete the sections listed in the completion summary that IRU does not fill (your own attestations, and your signature) yourself, only after your review.',
    ],
    checklistFirst: 'Read the completion summary and resolve anything listed as missing, conflicting, or needing confirmation.',
    checklistMissing: (n) => `Provide the ${n} missing required item(s), then regenerate the draft.`,
    checklistConflicts: 'Decide which conflicting value is correct, correct your information, and regenerate.',
    checklistCompare: 'Compare every populated field on the draft with the official blank form and your own records.',
    checklistRegenerate: 'Correct any mistakes through your information and regenerate — then download the latest version and set older downloads aside.',
    checklistComplete: 'Complete the parts of the form that are yours alone (see the completion summary), including your signature, only when you are satisfied the draft is accurate.',
    checklistConfirm: (url) => `Confirm the current form edition, instructions, fee, and filing address at ${url} before you use the form — official requirements change, and any deadline that may apply to you should be verified with an official source or a qualified professional.`,
    // Packet (readiness report) variant.
    pktUnderstandIntro: (caseType) => `This report organizes the information you provided for your ${caseType} preparation and identifies what still needs attention. It is based only on your answers and documents — nothing was independently verified.`,
    pktReadinessPct: (pct) => `Your readiness estimate is ${pct}%. It is an approximate document-completeness heuristic — not a probability, a score of your chances, or a prediction of any outcome.`,
    pktEvidenceItems: (n) => `The evidence review identified ${n} item(s) to address, listed above in priority order.`,
    pktConflicts: (n) => `${n} item(s) in your information are in conflict between sources and are listed above — resolve them before relying on any output.`,
    pktUnconfirmed: (n) => `${n} value(s) came from your documents and still need your confirmation.`,
    pktNotEstablished1: 'This report does not decide whether you are eligible for any immigration benefit, and it does not predict or guarantee any outcome.',
    pktNotEstablished2: 'Preparation assistance is not legal advice, and IRU is not a law firm. Nothing has been signed, filed, or submitted on your behalf.',
    pktReviewWithForm1: (draftLabel, id, edition) => `Your latest form output is the ${id} draft (Edition ${edition}), labeled "${draftLabel}". Earlier downloads of the same form are stale once your information changes — use only the latest version.`,
    pktReviewWithForm2: (blankLabel, id, edition, url) => `Compare the draft with the "${blankLabel}" (${id}, Edition ${edition}, ${url}) and with your own records before any use.`,
    pktReviewFormConfirm: 'Confirm the current edition, instructions, fee, and filing address on the official form page before you use the form — official requirements change.',
    pktReviewNoForm: 'No form draft was generated in this session. If you prepare a form, compare the pre-filled draft with the official blank form and your own records before any use, and confirm the current edition, instructions, fee, and filing address on the official USCIS form page.',
    pktResourcesVerified: (sectionName) => `The organizations under "${sectionName}" above were matched by IRU to the location you provided. IRU does not guarantee their availability, cost, capacity, or acceptance of your case. The directories below are additional general starting points.`,
    pktResourcesIntl: 'You are located outside IRU\u2019s U.S. resource coverage area, so no U.S. organization is presented as local to you. Use the general directories below to find qualified help that serves your situation, and confirm any deadline or filing question with an official source or a qualified professional.',
    pktResourcesNone: 'No verified local organization was matched for this report. The directories below are general starting points for finding qualified help — inclusion is not a recommendation, and availability is not guaranteed.',
    pktChecklistConflicts: (n) => `Resolve the ${n} conflicting item(s) in your information, then regenerate any affected outputs.`,
    pktChecklistUnconfirmed: (n) => `Confirm the ${n} document-provided value(s) marked as needing confirmation.`,
    pktChecklistGaps: 'Work through the evidence gaps above in priority order; for each one, use the listed primary evidence or an accepted alternative.',
    pktChecklistFormReview: (id) => `Review your ${id} draft field by field against the official blank form and your records; correct mistakes in your information and regenerate so you hold only the latest version.`,
    pktChecklistFormGeneric: 'If you prepare a form draft, review it field by field before any use.',
    pktChecklistConfirm: 'Confirm the current form editions, instructions, fees, and any deadline that may apply to you with an official source (uscis.gov) or a qualified professional.',
    pktChecklistBring: 'If you consult an attorney or accredited representative, bring this report and your latest draft version.',
    professionalQuestionsTitle: 'Questions to ask a qualified professional',
    questionDeadlines: 'Are there any deadlines, risks, or time-sensitive issues in my situation that this report does not cover?',
    questionConflicts: (list) => `My records disagree about: ${list}. Which record should control, and how do I correct the other one?`,
    questionUnconfirmed: (n) => `${n} value(s) in my information came from my documents and have not been confirmed yet. How should they be verified before anyone relies on them?`,
    questionGaps: (n) => `${n} evidence item(s) in my report are still missing. Which matter most in my situation, and what alternatives are acceptable if I cannot get the usual documents?`,
    questionForm: (id) => `Before I sign or submit anything for the ${id}, what should I double-check given my situation?`,
  },
  ES: {
    title: 'SUS PRÓXIMOS PASOS — CÓMO USAR ESTE INFORME',
    professionalHelp: [
      'Usar un profesional es su elección — no es obligatorio en todos los casos, e IRU no lo gestiona por usted.',
      'Si consulta a un abogado de inmigración o a un representante acreditado, lleve este informe y la versión más reciente de su borrador de formulario.',
      'Reúna los documentos y registros que este informe identifica antes de la reunión, para que el profesional pueda dedicar el tiempo a sus preguntas.',
      'Prepare sus preguntas con anticipación, especialmente sobre cualquier cosa marcada como inconsistente, incierta o faltante.',
      'Pregunte al profesional qué información adicional requieren sus circunstancias y qué pasos se aplican a usted.',
      'Ningún profesional u organización ha aceptado su caso a menos que se lo digan directamente — este informe no cambia eso.',
    ],
    notEstablished: [
      'Este informe no decide si usted es elegible para algún beneficio de inmigración, y no predice ni garantiza ningún resultado.',
      'Un porcentaje de preparación, cuando se muestra, es una heurística aproximada de integridad de documentos — no una puntuación de sus posibilidades.',
      'La asistencia en la preparación no es asesoría legal, e IRU no es un bufete de abogados.',
      'Nada ha sido firmado, presentado o enviado en su nombre.',
    ],
    searchPathDescriptions: [
      'Directorio de servicios legales de inmigración sin fines de lucro en todo Estados Unidos — busque por ubicación.',
      'Lista oficial de organizaciones reconocidas y representantes acreditados autorizados para representar a personas en procedimientos de inmigración.',
      'Directorio de programas de asistencia legal por estado.',
      'Formularios, instrucciones, tarifas e información de presentación oficiales — confirme siempre aquí las ediciones y requisitos actuales.',
    ],
    resourcesNote: 'IRU no ha verificado un proveedor local para este resultado. Los directorios a continuación son puntos de partida generales para encontrar ayuda calificada — su inclusión no es una recomendación y la disponibilidad no está garantizada.',
    draftLabel: 'Borrador prellenado de IRU — Revisar y corregir',
    blankLabel: 'Formulario oficial en blanco — Copia de referencia',
    understandIntro: (name, edition, n) => `Este paquete prepara un BORRADOR de ${name} (Edición ${edition}) a partir de la información que usted proporcionó: se completaron ${n} campo(s).`,
    understandMissing: (n, list) => `${n} elemento(s) requerido(s) aún faltan y se dejaron en blanco: ${list}.`,
    understandMissingNone: 'Ningún elemento requerido sobre el que pregunta el formulario quedó sin respuesta a partir de la información disponible.',
    understandConflicts: (n, list) => `${n} elemento(s) tienen valores en conflicto de diferentes fuentes y NO se completaron: ${list}. Resuélvalos antes de confiar en el borrador.`,
    understandNeedsConfirmation: (n, list) => `${n} valor(es) provinieron de sus documentos y aún necesitan su confirmación antes de poder usarse: ${list}.`,
    reviewForm: [
      (draftLabel, blankLabel, id, edition, url) => `Compare el borrador etiquetado «${draftLabel}» con el «${blankLabel}» (el ${id} oficial, Edición ${edition}, de ${url}) y con sus propios registros.`,
      () => 'Verifique cada campo completado — su nombre, fechas, direcciones e información de identificación sobre todo. Un borrador prellenado puede contener errores; solo usted puede confirmar que las respuestas son suyas.',
      () => 'Si algo está mal, corríjalo en su información, regenere el borrador y descargue la nueva versión. Las descargas anteriores quedan obsoletas una vez que su información cambia — use solo la versión más reciente.',
      () => 'Complete usted mismo las secciones enumeradas en el resumen de finalización que IRU no completa (sus propias declaraciones y su firma), solo después de su revisión.',
    ],
    checklistFirst: 'Lea el resumen de finalización y resuelva todo lo que aparezca como faltante, en conflicto o que necesite confirmación.',
    checklistMissing: (n) => `Proporcione los ${n} elemento(s) requerido(s) faltantes y luego regenere el borrador.`,
    checklistConflicts: 'Decida qué valor en conflicto es correcto, corrija su información y regenere.',
    checklistCompare: 'Compare cada campo completado en el borrador con el formulario oficial en blanco y sus propios registros.',
    checklistRegenerate: 'Corrija cualquier error a través de su información y regenere — luego descargue la versión más reciente y deje de lado las descargas anteriores.',
    checklistComplete: 'Complete las partes del formulario que son solo suyas (vea el resumen de finalización), incluida su firma, solo cuando esté satisfecho de que el borrador es exacto.',
    checklistConfirm: (url) => `Confirme la edición actual del formulario, las instrucciones, la tarifa y la dirección de presentación en ${url} antes de usar el formulario — los requisitos oficiales cambian, y cualquier fecha límite que pueda aplicarle debe verificarse con una fuente oficial o un profesional calificado.`,
    pktUnderstandIntro: (caseType) => `Este informe organiza la información que usted proporcionó para su preparación de ${caseType} e identifica lo que aún necesita atención. Se basa solo en sus respuestas y documentos — nada fue verificado de forma independiente.`,
    pktReadinessPct: (pct) => `Su estimación de preparación es ${pct}%. Es una heurística aproximada de integridad de documentos — no una probabilidad, una puntuación de sus posibilidades ni una predicción de ningún resultado.`,
    pktEvidenceItems: (n) => `La revisión de evidencia identificó ${n} elemento(s) por abordar, enumerados arriba en orden de prioridad.`,
    pktConflicts: (n) => `${n} elemento(s) de su información están en conflicto entre fuentes y se enumeran arriba — resuélvalos antes de basarse en cualquier resultado.`,
    pktUnconfirmed: (n) => `${n} valor(es) provinieron de sus documentos y aún necesitan su confirmación.`,
    pktNotEstablished1: 'Este informe no decide si usted es elegible para algún beneficio de inmigración, y no predice ni garantiza ningún resultado.',
    pktNotEstablished2: 'La asistencia en la preparación no es asesoría legal, e IRU no es un bufete de abogados. Nada ha sido firmado, presentado o enviado en su nombre.',
    pktReviewWithForm1: (draftLabel, id, edition) => `Su resultado de formulario más reciente es el borrador de ${id} (Edición ${edition}), etiquetado «${draftLabel}». Las descargas anteriores del mismo formulario quedan obsoletas una vez que su información cambia — use solo la versión más reciente.`,
    pktReviewWithForm2: (blankLabel, id, edition, url) => `Compare el borrador con el «${blankLabel}» (${id}, Edición ${edition}, ${url}) y con sus propios registros antes de cualquier uso.`,
    pktReviewFormConfirm: 'Confirme la edición actual, las instrucciones, la tarifa y la dirección de presentación en la página oficial del formulario antes de usar el formulario — los requisitos oficiales cambian.',
    pktReviewNoForm: 'No se generó ningún borrador de formulario en esta sesión. Si prepara un formulario, compare el borrador prellenado con el formulario oficial en blanco y sus propios registros antes de cualquier uso, y confirme la edición actual, las instrucciones, la tarifa y la dirección de presentación en la página oficial del formulario de USCIS.',
    pktResourcesVerified: (sectionName) => `Las organizaciones bajo «${sectionName}» arriba fueron asociadas por IRU a la ubicación que usted proporcionó. IRU no garantiza su disponibilidad, costo, capacidad o aceptación de su caso. Los directorios a continuación son puntos de partida generales adicionales.`,
    pktResourcesIntl: 'Usted se encuentra fuera del área de cobertura de recursos de IRU en EE. UU., por lo que ninguna organización estadounidense se presenta como local para usted. Use los directorios generales a continuación para encontrar ayuda calificada que atienda su situación, y confirme cualquier fecha límite o pregunta de presentación con una fuente oficial o un profesional calificado.',
    pktResourcesNone: 'No se asoció ninguna organización local verificada para este informe. Los directorios a continuación son puntos de partida generales para encontrar ayuda calificada — su inclusión no es una recomendación y la disponibilidad no está garantizada.',
    pktChecklistConflicts: (n) => `Resuelva los ${n} elemento(s) en conflicto en su información y luego regenere cualquier resultado afectado.`,
    pktChecklistUnconfirmed: (n) => `Confirme los ${n} valor(es) proporcionados por documentos marcados como que necesitan confirmación.`,
    pktChecklistGaps: 'Trabaje en las brechas de evidencia anteriores en orden de prioridad; para cada una, use la evidencia principal indicada o una alternativa aceptada.',
    pktChecklistFormReview: (id) => `Revise su borrador de ${id} campo por campo contra el formulario oficial en blanco y sus registros; corrija los errores en su información y regenere para tener solo la versión más reciente.`,
    pktChecklistFormGeneric: 'Si prepara un borrador de formulario, revíselo campo por campo antes de cualquier uso.',
    pktChecklistConfirm: 'Confirme las ediciones actuales de los formularios, las instrucciones, las tarifas y cualquier fecha límite que pueda aplicarle con una fuente oficial (uscis.gov) o un profesional calificado.',
    pktChecklistBring: 'Si consulta a un abogado o representante acreditado, lleve este informe y su versión de borrador más reciente.',
    professionalQuestionsTitle: 'Preguntas para hacer a un profesional calificado',
    questionDeadlines: '¿Existen plazos, riesgos o asuntos urgentes en mi situación que este informe no cubre?',
    questionConflicts: (list) => `Mis registros no coinciden en: ${list}. ¿Qué registro debe prevalecer y cómo corrijo el otro?`,
    questionUnconfirmed: (n) => `${n} valor(es) de mi información provienen de mis documentos y aún no han sido confirmados. ¿Cómo deben verificarse antes de que alguien confíe en ellos?`,
    questionGaps: (n) => `Aún faltan ${n} elemento(s) de evidencia en mi informe. ¿Cuáles son los más importantes en mi situación y qué alternativas se aceptan si no puedo obtener los documentos habituales?`,
    questionForm: (id) => `Antes de firmar o presentar algo para el ${id}, ¿qué debo verificar dos veces dada mi situación?`,
  },
  ZH: {
    title: '您的后续步骤 — 如何使用本报告',
    professionalHelp: [
      '是否聘请专业人士由您决定 — 并非每个案件都必须聘请，IRU 也不会为您安排。',
      '如果您咨询移民律师或认可代表，请携带本报告和最新版本的表格草稿。',
      '在会面之前，收集本报告指出的支持文件和记录，以便专业人士能把时间用在您的问题上。',
      '提前准备好您的问题，尤其是关于任何标记为不一致、不确定或缺失的内容。',
      '询问专业人士您的情况还需要哪些信息，以及哪些步骤适用于您。',
      '除非专业人士或机构直接告诉您，否则他们并未接受您的案件 — 本报告不会改变这一点。',
    ],
    notEstablished: [
      '本报告不决定您是否有资格获得任何移民福利，也不预测或保证任何结果。',
      '如显示准备百分比，它只是一个近似的文件完整度估算 — 不是对您成功机会的评分。',
      '准备协助不是法律建议，IRU 也不是律师事务所。',
      '没有任何文件以您的名义被签署、提交或递交。',
    ],
    searchPathDescriptions: [
      '覆盖全美的非营利移民法律服务目录 — 按地点搜索。',
      '官方名册，列出获准在移民程序中代表他人的认可机构和认可代表。',
      '按州划分的法律援助计划目录。',
      '官方表格、说明、费用和提交信息 — 请始终在此处确认当前版本和要求。',
    ],
    resourcesNote: 'IRU 尚未为此输出核实本地服务提供者。以下目录是寻找合格帮助的一般起点 — 列入目录并不构成推荐，也不保证可用性。',
    draftLabel: 'IRU 预填草稿 — 审核并更正',
    blankLabel: '官方空白表格 — 参考副本',
    understandIntro: (name, edition, n) => `本资料包根据您提供的信息准备了 ${name}（版本 ${edition}）的草稿：共填写了 ${n} 个字段。`,
    understandMissing: (n, list) => `仍有 ${n} 个必填项缺失，已留空：${list}。`,
    understandMissingNone: '根据现有信息，表格所询问的必填项没有未回答的。',
    understandConflicts: (n, list) => `${n} 个项目有来自不同来源的冲突值，未填写：${list}。在依赖草稿之前请先解决它们。`,
    understandNeedsConfirmation: (n, list) => `${n} 个值来自您的文件，在使用前仍需要您的确认：${list}。`,
    reviewForm: [
      (draftLabel, blankLabel, id, edition, url) => `将标有“${draftLabel}”的草稿与“${blankLabel}”（官方 ${id}，版本 ${edition}，来自 ${url}）以及您自己的记录进行比较。`,
      () => '检查每一个已填写的字段 — 尤其是您的姓名、日期、地址和身份信息。预填草稿可能包含错误；只有您能确认答案是您自己的。',
      () => '如有任何错误，请在您的信息中更正、重新生成草稿并下载新版本。您的信息更改后，之前的下载即已过时 — 仅使用最新版本。',
      () => '完成总结中列出的 IRU 不填写的部分（您自己的声明和签名）由您自己完成，且仅在您审核之后完成。',
    ],
    checklistFirst: '阅读完成总结，解决任何列为缺失、冲突或需要确认的项目。',
    checklistMissing: (n) => `提供缺失的 ${n} 个必填项，然后重新生成草稿。`,
    checklistConflicts: '确定哪个冲突值是正确的，更正您的信息并重新生成。',
    checklistCompare: '将草稿上每个已填写的字段与官方空白表格和您自己的记录进行比较。',
    checklistRegenerate: '通过您的信息更正任何错误并重新生成 — 然后下载最新版本，并将旧下载放在一旁。',
    checklistComplete: '完成只有您能完成的表格部分（见完成总结），包括您的签名，且仅在您确信草稿准确时才这样做。',
    checklistConfirm: (url) => `在使用表格之前，请在 ${url} 确认当前的表格版本、说明、费用和提交地址 — 官方要求会变化，任何可能适用于您的截止日期都应向官方来源或合格专业人士核实。`,
    pktUnderstandIntro: (caseType) => `本报告整理了您为 ${caseType} 准备所提供的信息，并指出仍需关注的事项。它仅基于您的回答和文件 — 没有任何内容经过独立核实。`,
    pktReadinessPct: (pct) => `您的准备度估计为 ${pct}%。这是一个近似的文件完整度估算 — 不是概率、不是对您成功机会的评分，也不是对任何结果的预测。`,
    pktEvidenceItems: (n) => `证据审核发现 ${n} 个需要处理的项目，已按优先级列在上方。`,
    pktConflicts: (n) => `您的信息中有 ${n} 个项目在来源之间存在冲突，已列在上方 — 在依赖任何输出之前请先解决它们。`,
    pktUnconfirmed: (n) => `${n} 个值来自您的文件，仍需要您的确认。`,
    pktNotEstablished1: '本报告不决定您是否有资格获得任何移民福利，也不预测或保证任何结果。',
    pktNotEstablished2: '准备协助不是法律建议，IRU 也不是律师事务所。没有任何文件以您的名义被签署、提交或递交。',
    pktReviewWithForm1: (draftLabel, id, edition) => `您最新的表格输出是 ${id} 草稿（版本 ${edition}），标有“${draftLabel}”。您的信息更改后，同一表格的先前下载即已过时 — 仅使用最新版本。`,
    pktReviewWithForm2: (blankLabel, id, edition, url) => `在使用前，将草稿与“${blankLabel}”（${id}，版本 ${edition}，${url}）以及您自己的记录进行比较。`,
    pktReviewFormConfirm: '在使用表格之前，请在官方表格页面确认当前版本、说明、费用和提交地址 — 官方要求会变化。',
    pktReviewNoForm: '本次会话未生成表格草稿。如果您准备表格，请在使用前将预填草稿与官方空白表格和您自己的记录进行比较，并在 USCIS 官方表格页面确认当前版本、说明、费用和提交地址。',
    pktResourcesVerified: (sectionName) => `上方“${sectionName}”下列出的机构是 IRU 根据您提供的位置为您匹配的。IRU 不保证其可用性、费用、接待能力或是否接受您的案件。以下目录是其他一般起点。`,
    pktResourcesIntl: '您位于 IRU 美国资源覆盖区域之外，因此没有美国机构被列为您的本地机构。请使用以下一般目录寻找适合您情况的合格帮助，并向官方来源或合格专业人士确认任何截止日期或提交问题。',
    pktResourcesNone: '本报告未匹配到经核实的本地机构。以下目录是寻找合格帮助的一般起点 — 列入并不构成推荐，也不保证可用性。',
    pktChecklistConflicts: (n) => `解决您信息中 ${n} 个冲突项目，然后重新生成任何受影响的输出。`,
    pktChecklistUnconfirmed: (n) => `确认标为需要确认的 ${n} 个文件提供值。`,
    pktChecklistGaps: '按优先级顺序处理上方的证据缺口；对于每一个，使用所列的主要证据或被接受的替代文件。',
    pktChecklistFormReview: (id) => `将您的 ${id} 草稿逐字段与官方空白表格和您的记录进行核对；更正信息中的错误并重新生成，以便您只持有最新版本。`,
    pktChecklistFormGeneric: '如果您准备表格草稿，请在使用前逐字段审核。',
    pktChecklistConfirm: '向官方来源（uscis.gov）或合格专业人士确认当前的表格版本、说明、费用以及任何可能适用于您的截止日期。',
    pktChecklistBring: '如果您咨询律师或认可代表，请携带本报告和您的最新草稿版本。',
    professionalQuestionsTitle: '向合格专业人士提出的问题',
    questionDeadlines: '在我的情况中，是否有本报告未涵盖的截止日期、风险或时间敏感问题？',
    questionConflicts: (list) => `我的记录在以下方面不一致：${list}。应以哪份记录为准，我应如何更正另一份？`,
    questionUnconfirmed: (n) => `我的信息中有 ${n} 个值来自我的文件，且尚未得到确认。在任何人依赖它们之前，应如何核实？`,
    questionGaps: (n) => `我的报告中仍缺少 ${n} 项证据。在我的情况下哪些最重要？如果我无法获得常规文件，可以接受哪些替代材料？`,
    questionForm: (id) => `在为 ${id} 签署或提交任何内容之前，根据我的情况，我应该仔细复查什么？`,
  },
  HT: {
    title: 'PWOSHEN ETAP OU YO — KIJAN POU ITILIZE RAPÒ SA A',
    professionalHelp: [
      'Itilize yon pwofesyonèl se chwa ou — li pa obligatwa nan tout ka, epi IRU pa ranje li pou ou.',
      'Si ou konsilte yon avoka imigrasyon oswa yon reprezantan akredite, pote rapò sa a ak dènye vèsyon bouyon fòm ou a.',
      'Rasanble dokiman ak dosye rapò sa a idantifye anvan reyinyon an, pou pwofesyonèl la ka pase tan an sou kesyon ou yo.',
      'Prepare kesyon ou yo davans, sitou sou nenpòt bagay ki make kòm enkonsistan, ensèten, oswa manke.',
      'Mande pwofesyonèl la ki enfòmasyon anplis sikonstans ou yo mande ak ki etap ki aplike pou ou.',
      'Okenn pwofesyonèl oswa òganizasyon pa aksepte ka ou a sof si yo di w li dirèkteman — rapò sa a pa chanje sa.',
    ],
    notEstablished: [
      'Rapò sa a pa deside si ou elijib pou nenpòt benefis imigrasyon, epi li pa predi oswa garanti okenn rezilta.',
      'Yon pousantaj preparasyon, lè yo montre li, se yon estime apwoksimatif sou konplè dokiman — pa yon nòt sou chans ou yo.',
      'Èd nan preparasyon se pa konsèy legal, epi IRU se pa yon kabinè avoka.',
      'Yo pa siyen, depoze, oswa soumèt anyen nan non ou.',
    ],
    searchPathDescriptions: [
      'Anyè sèvis legal imigrasyon san bi lutik nan tout Etazini — chèche pa kote.',
      'Lis ofisyèl òganizasyon rekonèt ak reprezantan akredite ki otorize reprezante moun nan pwosedi imigrasyon.',
      'Anyè pwogram èd legal pa eta.',
      'Fòm, enstriksyon, frè, ak enfòmasyon depozisyon ofisyèl — toujou konfime edisyon ak kondisyon aktyèl yo isit la.',
    ],
    resourcesNote: 'IRU pa verifye yon founisè lokal pou rezilta sa a. Anyè ki anba yo se pwen depa jeneral pou jwenn èd kalifye — prezans yo pa yon rekòmandasyon, epi disponibilite pa garanti.',
    draftLabel: 'Bouyon IRU te ranpli davans — Revize epi korije',
    blankLabel: 'Fòm ofisyèl vid — Kopi referans',
    understandIntro: (name, edition, n) => `Pake sa a prepare yon BOUYON ${name} (Edisyon ${edition}) apati enfòmasyon ou te bay yo: yo te ranpli ${n} chan.`,
    understandMissing: (n, list) => `${n} atik obligatwa toujou manke epi yo te kite vid: ${list}.`,
    understandMissingNone: 'Okenn atik obligatwa fòm nan mande pa rete san repons apati enfòmasyon ki disponib yo.',
    understandConflicts: (n, list) => `${n} atik gen valè an konfli ki soti nan diferan sous epi yo PA ranpli: ${list}. Rezoud yo anvan ou apiye sou bouyon an.`,
    understandNeedsConfirmation: (n, list) => `${n} valè soti nan dokiman ou yo epi yo toujou bezwen konfimasyon ou anvan yo ka itilize yo: ${list}.`,
    reviewForm: [
      (draftLabel, blankLabel, id, edition, url) => `Konpare bouyon ki make «${draftLabel}» a ak «${blankLabel}» a (${id} ofisyèl la, Edisyon ${edition}, soti nan ${url}) epi ak pwòp dosye ou yo.`,
      () => 'Tcheke chak chan yo ranpli — non ou, dat yo, adrès yo, ak enfòmasyon idantifikasyon ou sitou. Yon bouyon yo ranpli davans ka gen erè; sèl ou menm ki ka konfime repons yo se pa ou.',
      () => 'Si nenpòt bagay mal, korije li nan enfòmasyon ou, rejenere bouyon an, epi telechaje nouvo vèsyon an. Telechajman anvan yo vin demode depi enfòmasyon ou chanje — itilize sèlman dènye vèsyon an.',
      () => 'Ranpli seksyon yo liste nan rezime konplezyon an ke IRU pa ranpli (pwòp deklarasyon ou yo, ak siyati ou) ou menm, sèlman apre revizyon ou.',
    ],
    checklistFirst: 'Li rezime konplezyon an epi rezoud tout sa ki liste kòm manke, an konfli, oswa ki bezwen konfimasyon.',
    checklistMissing: (n) => `Bay ${n} atik obligatwa ki manke yo, apre rejenere bouyon an.`,
    checklistConflicts: 'Deside ki valè an konfli ki korèk, korije enfòmasyon ou, epi rejenere.',
    checklistCompare: 'Konpare chak chan yo ranpli sou bouyon an ak fòm ofisyèl vid la ak pwòp dosye ou yo.',
    checklistRegenerate: 'Korije nenpòt erè atravè enfòmasyon ou epi rejenere — apre telechaje dènye vèsyon an epi mete ansyen telechajman yo sou kote.',
    checklistComplete: 'Ranpli pati fòm nan ki se pa ou sèlman (gade rezime konplezyon an), siyati ou ladan tou, sèlman lè ou satisfè bouyon an egzat.',
    checklistConfirm: (url) => `Konfime edisyon fòm aktyèl la, enstriksyon yo, frè a, ak adrès depozisyon an nan ${url} anvan ou itilize fòm nan — kondisyon ofisyèl yo chanje, epi nenpòt dat limit ki ka aplike pou ou ta dwe verifye ak yon sous ofisyèl oswa yon pwofesyonèl kalifye.`,
    pktUnderstandIntro: (caseType) => `Rapò sa a òganize enfòmasyon ou te bay pou preparasyon ${caseType} ou a epi li idantifye sa ki bezwen atansyon toujou. Li baze sèlman sou repons ou yo ak dokiman ou yo — anyen pa t verifye endepandamman.`,
    pktReadinessPct: (pct) => `Estime preparasyon ou se ${pct}%. Se yon estime apwoksimatif sou konplè dokiman — pa yon pwobabilite, pa yon nòt sou chans ou, ni yon prediksyon okenn rezilta.`,
    pktEvidenceItems: (n) => `Revizyon prèv la idantifye ${n} atik pou abòde, ki liste anwo a nan lòd priyorite.`,
    pktConflicts: (n) => `${n} atik nan enfòmasyon ou an konfli ant sous yo epi yo liste anwo a — rezoud yo anvan ou apiye sou nenpòt rezilta.`,
    pktUnconfirmed: (n) => `${n} valè soti nan dokiman ou yo epi yo toujou bezwen konfimasyon ou.`,
    pktNotEstablished1: 'Rapò sa a pa deside si ou elijib pou nenpòt benefis imigrasyon, epi li pa predi oswa garanti okenn rezilta.',
    pktNotEstablished2: 'Èd nan preparasyon se pa konsèy legal, epi IRU se pa yon kabinè avoka. Yo pa siyen, depoze, oswa soumèt anyen nan non ou.',
    pktReviewWithForm1: (draftLabel, id, edition) => `Dènye rezilta fòm ou a se bouyon ${id} la (Edisyon ${edition}), ki make «${draftLabel}». Telechajman anvan yo pou menm fòm nan vin demode depi enfòmasyon ou chanje — itilize sèlman dènye vèsyon an.`,
    pktReviewWithForm2: (blankLabel, id, edition, url) => `Konpare bouyon an ak «${blankLabel}» a (${id}, Edisyon ${edition}, ${url}) epi ak pwòp dosye ou yo anvan nenpòt itilizasyon.`,
    pktReviewFormConfirm: 'Konfime edisyon aktyèl la, enstriksyon yo, frè a, ak adrès depozisyon an sou paj ofisyèl fòm nan anvan ou itilize fòm nan — kondisyon ofisyèl yo chanje.',
    pktReviewNoForm: 'Yo pa t jenere okenn bouyon fòm nan sesyon sa a. Si ou prepare yon fòm, konpare bouyon ki ranpli davans la ak fòm ofisyèl vid la ak pwòp dosye ou yo anvan nenpòt itilizasyon, epi konfime edisyon aktyèl la, enstriksyon yo, frè a, ak adrès depozisyon an sou paj ofisyèl fòm USCIS la.',
    pktResourcesVerified: (sectionName) => `Òganizasyon ki anba «${sectionName}» anwo a, IRU te asosye yo ak kote ou te bay la. IRU pa garanti disponibilite yo, pri yo, kapasite yo, oswa si yo ap aksepte ka ou a. Anyè ki anba yo se lòt pwen depa jeneral.`,
    pktResourcesIntl: 'Ou sitiye andeyò zòn kouvèti resous Etazini IRU a, kidonk yo pa prezante okenn òganizasyon Etazini kòm lokal pou ou. Itilize anyè jeneral ki anba yo pou jwenn èd kalifye ki sèvi sitiyasyon ou, epi konfime nenpòt dat limit oswa kesyon depozisyon ak yon sous ofisyèl oswa yon pwofesyonèl kalifye.',
    pktResourcesNone: 'Yo pa asosye okenn òganizasyon lokal verifye pou rapò sa a. Anyè ki anba yo se pwen depa jeneral pou jwenn èd kalifye — prezans yo pa yon rekòmandasyon, epi disponibilite pa garanti.',
    pktChecklistConflicts: (n) => `Rezoud ${n} atik ki an konfli nan enfòmasyon ou, apre rejenere nenpòt rezilta ki afekte.`,
    pktChecklistUnconfirmed: (n) => `Konfime ${n} valè dokiman te bay ki make kòm bezwen konfimasyon.`,
    pktChecklistGaps: 'Travay sou twou prèv ki anwo yo nan lòd priyorite; pou chak youn, itilize prèv prensipal ki liste a oswa yon altènatif yo aksepte.',
    pktChecklistFormReview: (id) => `Revize bouyon ${id} ou a chan pa chan kont fòm ofisyèl vid la ak dosye ou yo; korije erè nan enfòmasyon ou epi rejenere pou ou kenbe sèlman dènye vèsyon an.`,
    pktChecklistFormGeneric: 'Si ou prepare yon bouyon fòm, revize li chan pa chan anvan nenpòt itilizasyon.',
    pktChecklistConfirm: 'Konfime edisyon fòm aktyèl yo, enstriksyon yo, frè yo, ak nenpòt dat limit ki ka aplike pou ou ak yon sous ofisyèl (uscis.gov) oswa yon pwofesyonèl kalifye.',
    pktChecklistBring: 'Si ou konsilte yon avoka oswa yon reprezantan akredite, pote rapò sa a ak dènye vèsyon bouyon ou a.',
    professionalQuestionsTitle: 'Kesyon pou poze yon pwofesyonèl kalifye',
    questionDeadlines: 'Èske gen dat limit, risk, oswa kesyon ki sansib a tan nan sitiyasyon mwen ke rapò sa a pa kouvri?',
    questionConflicts: (list) => `Dosye mwen yo pa dakò sou: ${list}. Ki dosye ki ta dwe kontwole, epi kijan mwen korije lòt la?`,
    questionUnconfirmed: (n) => `${n} valè nan enfòmasyon mwen soti nan dokiman mwen epi yo poko konfime. Kijan yo ta dwe verifye anvan nenpòt moun konte sou yo?`,
    questionGaps: (n) => `${n} atik prèv toujou manke nan rapò mwen an. Kilès ki pi enpòtan nan sitiyasyon mwen, epi ki altènativ yo aksepte si mwen pa ka jwenn dokiman abityèl yo?`,
    questionForm: (id) => `Anvan mwen siyen oswa soumèt anyen pou ${id} la, kisa mwen ta dwe verifye de fwa dapre sitiyasyon mwen?`,
  },
  AR: {
    title: 'خطواتك التالية — كيفية استخدام هذا التقرير',
    professionalHelp: [
      'استخدام محترف هو خيارك — فهو ليس مطلوبًا في كل حالة، ولا تقوم IRU بترتيبه لك.',
      'إذا استشرت محامي هجرة أو ممثلًا معتمدًا، فأحضر هذا التقرير وأحدث إصدار من مسودة النموذج الخاصة بك.',
      'اجمع المستندات والسجلات الداعمة التي يحددها هذا التقرير قبل الاجتماع، حتى يتمكن المحترف من تخصيص الوقت لأسئلتك.',
      'حضّر أسئلتك مسبقًا، خاصة حول أي شيء مُعلّم بأنه غير متسق أو غير مؤكد أو مفقود.',
      'اسأل المحترف عن المعلومات الإضافية التي تتطلبها ظروفك والخطوات التي تنطبق عليك.',
      'لم يقبل أي محترف أو منظمة قضيتك ما لم يخبروك بذلك مباشرة — هذا التقرير لا يغير ذلك.',
    ],
    notEstablished: [
      'لا يقرر هذا التقرير ما إذا كنت مؤهلًا لأي منفعة هجرة، ولا يتنبأ بأي نتيجة أو يضمنها.',
      'نسبة الجاهزية، عند عرضها، هي تقدير تقريبي لاكتمال المستندات — وليست درجة لفرصك.',
      'مساعدة الإعداد ليست مشورة قانونية، وIRU ليست مكتب محاماة.',
      'لم يتم توقيع أو تقديم أو إرسال أي شيء نيابة عنك.',
    ],
    searchPathDescriptions: [
      'دليل لخدمات الهجرة القانونية غير الربحية في جميع أنحاء الولايات المتحدة — ابحث حسب الموقع.',
      'القائمة الرسمية للمنظمات المعترف بها والممثلين المعتمدين المسموح لهم بتمثيل الأشخاص في إجراءات الهجرة.',
      'دليل برامج المساعدة القانونية حسب الولاية.',
      'النماذج والتعليمات والرسوم ومعلومات التقديم الرسمية — أكّد دائمًا الإصدارات والمتطلبات الحالية هنا.',
    ],
    resourcesNote: 'لم تتحقق IRU من مقدم خدمة محلي لهذا المخرج. الأدلة أدناه هي نقاط انطلاق عامة للعثور على مساعدة مؤهلة — إدراجها ليس توصية، والتوفر غير مضمون.',
    draftLabel: 'مسودة IRU المملوءة مسبقًا — المراجعة والتصحيح',
    blankLabel: 'النموذج الرسمي الفارغ — نسخة مرجعية',
    understandIntro: (name, edition, n) => `تُعدّ هذه الحزمة مسودة من ${name} (إصدار ${edition}) من المعلومات التي قدمتها: تم ملء ${n} حقلًا.`,
    understandMissing: (n, list) => `ما زالت ${n} من العناصر المطلوبة مفقودة وتُركت فارغة: ${list}.`,
    understandMissingNone: 'لم يبقَ أي عنصر مطلوب يسأل عنه النموذج دون إجابة من المعلومات المتاحة.',
    understandConflicts: (n, list) => `${n} من العناصر لها قيم متعارضة من مصادر مختلفة ولم تُملأ: ${list}. قم بحلها قبل الاعتماد على المسودة.`,
    understandNeedsConfirmation: (n, list) => `${n} من القيم جاءت من مستنداتك وما زالت تحتاج إلى تأكيدك قبل أن يمكن استخدامها: ${list}.`,
    reviewForm: [
      (draftLabel, blankLabel, id, edition, url) => `قارن المسودة المسماة «${draftLabel}» مع «${blankLabel}» (${id} الرسمي، إصدار ${edition}، من ${url}) ومع سجلاتك الخاصة.`,
      () => 'تحقق من كل حقل مملوء — اسمك وتواريخك وعناوينك ومعلومات التعريف الخاصة بك قبل كل شيء. قد تحتوي المسودة المملوءة مسبقًا على أخطاء؛ أنت الوحيد الذي يمكنه تأكيد أن الإجابات تخصك.',
      () => 'إذا كان أي شيء غير صحيح، فصححه في معلوماتك، وأعد إنشاء المسودة، ونزّل الإصدار الجديد. تصبح التنزيلات السابقة قديمة بمجرد تغير معلوماتك — استخدم أحدث إصدار فقط.',
      () => 'أكمل بنفسك الأقسام المدرجة في ملخص الإكمال التي لا تملؤها IRU (تصريحاتك الخاصة وتوقيعك)، وبعد مراجعتك فقط.',
    ],
    checklistFirst: 'اقرأ ملخص الإكمال وقم بحل أي شيء مدرج على أنه مفقود أو متعارض أو يحتاج إلى تأكيد.',
    checklistMissing: (n) => `قدّم ${n} من العناصر المطلوبة المفقودة، ثم أعد إنشاء المسودة.`,
    checklistConflicts: 'قرر أي قيمة متعارضة هي الصحيحة، وصحح معلوماتك، وأعد الإنشاء.',
    checklistCompare: 'قارن كل حقل مملوء في المسودة مع النموذج الرسمي الفارغ وسجلاتك الخاصة.',
    checklistRegenerate: 'صحح أي أخطاء من خلال معلوماتك وأعد الإنشاء — ثم نزّل أحدث إصدار وضع التنزيلات القديمة جانبًا.',
    checklistComplete: 'أكمل أجزاء النموذج التي تخصك وحدك (انظر ملخص الإكمال)، بما في ذلك توقيعك، فقط عندما تكون راضيًا عن دقة المسودة.',
    checklistConfirm: (url) => `أكّد إصدار النموذج الحالي والتعليمات والرسوم وعنوان التقديم على ${url} قبل استخدام النموذج — تتغير المتطلبات الرسمية، ويجب التحقق من أي موعد نهائي قد ينطبق عليك مع مصدر رسمي أو محترف مؤهل.`,
    pktUnderstandIntro: (caseType) => `ينظم هذا التقرير المعلومات التي قدمتها لإعداد ${caseType} الخاص بك ويحدد ما ما زال يحتاج إلى اهتمام. وهو يستند فقط إلى إجاباتك ومستنداتك — لم يتم التحقق من أي شيء بشكل مستقل.`,
    pktReadinessPct: (pct) => `تقدير جاهزيتك هو ${pct}%. إنه تقدير تقريبي لاكتمال المستندات — وليس احتمالًا أو درجة لفرصك أو تنبؤًا بأي نتيجة.`,
    pktEvidenceItems: (n) => `حددت مراجعة الأدلة ${n} من العناصر للمعالجة، مدرجة أعلاه بترتيب الأولوية.`,
    pktConflicts: (n) => `${n} من العناصر في معلوماتك متعارضة بين المصادر ومدرجة أعلاه — قم بحلها قبل الاعتماد على أي مخرجات.`,
    pktUnconfirmed: (n) => `${n} من القيم جاءت من مستنداتك وما زالت تحتاج إلى تأكيدك.`,
    pktNotEstablished1: 'لا يقرر هذا التقرير ما إذا كنت مؤهلًا لأي منفعة هجرة، ولا يتنبأ بأي نتيجة أو يضمنها.',
    pktNotEstablished2: 'مساعدة الإعداد ليست مشورة قانونية، وIRU ليست مكتب محاماة. لم يتم توقيع أو تقديم أو إرسال أي شيء نيابة عنك.',
    pktReviewWithForm1: (draftLabel, id, edition) => `أحدث مخرجات النموذج الخاصة بك هي مسودة ${id} (إصدار ${edition})، المسماة «${draftLabel}». تصبح التنزيلات السابقة لنفس النموذج قديمة بمجرد تغير معلوماتك — استخدم أحدث إصدار فقط.`,
    pktReviewWithForm2: (blankLabel, id, edition, url) => `قارن المسودة مع «${blankLabel}» (${id}، إصدار ${edition}، ${url}) ومع سجلاتك الخاصة قبل أي استخدام.`,
    pktReviewFormConfirm: 'أكّد الإصدار الحالي والتعليمات والرسوم وعنوان التقديم على الصفحة الرسمية للنموذج قبل استخدام النموذج — تتغير المتطلبات الرسمية.',
    pktReviewNoForm: 'لم يتم إنشاء أي مسودة نموذج في هذه الجلسة. إذا أعددت نموذجًا، فقارن المسودة المملوءة مسبقًا مع النموذج الرسمي الفارغ وسجلاتك الخاصة قبل أي استخدام، وأكّد الإصدار الحالي والتعليمات والرسوم وعنوان التقديم على صفحة نموذج USCIS الرسمية.',
    pktResourcesVerified: (sectionName) => `المنظمات الواردة تحت «${sectionName}» أعلاه طابقتها IRU مع الموقع الذي قدمته. لا تضمن IRU توفرها أو تكلفتها أو قدرتها أو قبولها لقضيتك. الأدلة أدناه هي نقاط انطلاق عامة إضافية.`,
    pktResourcesIntl: 'أنت موجود خارج منطقة تغطية موارد IRU في الولايات المتحدة، لذا لا تُعرض أي منظمة أمريكية على أنها محلية بالنسبة لك. استخدم الأدلة العامة أدناه للعثور على مساعدة مؤهلة تناسب وضعك، وأكّد أي موعد نهائي أو سؤال تقديم مع مصدر رسمي أو محترف مؤهل.',
    pktResourcesNone: 'لم تتم مطابقة أي منظمة محلية موثّقة لهذا التقرير. الأدلة أدناه هي نقاط انطلاق عامة للعثور على مساعدة مؤهلة — إدراجها ليس توصية، والتوفر غير مضمون.',
    pktChecklistConflicts: (n) => `قم بحل ${n} من العناصر المتعارضة في معلوماتك، ثم أعد إنشاء أي مخرجات متأثرة.`,
    pktChecklistUnconfirmed: (n) => `أكّد ${n} من القيم المقدمة من المستندات والمُعلّمة بأنها تحتاج إلى تأكيد.`,
    pktChecklistGaps: 'اعمل على فجوات الأدلة أعلاه بترتيب الأولوية؛ لكل واحدة، استخدم الدليل الأساسي المدرج أو بديلًا مقبولًا.',
    pktChecklistFormReview: (id) => `راجع مسودة ${id} الخاصة بك حقلًا بحقل مقابل النموذج الرسمي الفارغ وسجلاتك؛ وصحح الأخطاء في معلوماتك وأعد الإنشاء حتى تحتفظ بأحدث إصدار فقط.`,
    pktChecklistFormGeneric: 'إذا أعددت مسودة نموذج، فراجعها حقلًا بحقل قبل أي استخدام.',
    pktChecklistConfirm: 'أكّد إصدارات النماذج الحالية والتعليمات والرسوم وأي موعد نهائي قد ينطبق عليك مع مصدر رسمي (uscis.gov) أو محترف مؤهل.',
    pktChecklistBring: 'إذا استشرت محاميًا أو ممثلًا معتمدًا، فأحضر هذا التقرير وأحدث إصدار من مسودتك.',
    professionalQuestionsTitle: 'أسئلة تطرحها على متخصص مؤهل',
    questionDeadlines: 'هل توجد أي مواعيد نهائية أو مخاطر أو مسائل حساسة للوقت في حالتي لا يغطيها هذا التقرير؟',
    questionConflicts: (list) => `سجلاتي غير متفقة بشأن: ${list}. أي سجل يجب أن يُعتمد، وكيف أصحح الآخر؟`,
    questionUnconfirmed: (n) => `${n} من القيم في معلوماتي جاءت من مستنداتي ولم تُؤكد بعد. كيف ينبغي التحقق منها قبل أن يعتمد عليها أي شخص؟`,
    questionGaps: (n) => `${n} من عناصر الأدلة ما زالت مفقودة في تقريري. أيها الأكثر أهمية في حالتي، وما البدائل المقبولة إذا لم أتمكن من الحصول على المستندات المعتادة؟`,
    questionForm: (id) => `قبل أن أوقّع أو أقدّم أي شيء بشأن ${id}، ما الذي يجب أن أتحقق منه مرتين بالنظر إلى حالتي؟`,
  },
};

/** Localized next-steps strings for `lang` (falls back to English). */
export function nextStepsStrings(lang) {
  return STR[normLang(lang)] || STR.EN;
}

function searchPathsFor(lang) {
  const s = nextStepsStrings(lang);
  return RESOURCE_SEARCH_PATHS.map((p, i) => ({ name: p.name, url: p.url, description: s.searchPathDescriptions[i] || p.description }));
}

/**
 * Specific questions the user can ask a qualified professional
 * (value-upgrade directive §5 item 9), DERIVED from this applicant's
 * actual unresolved issues — conflicts first (naming the items),
 * then unconfirmed document values, evidence gaps, and the prepared
 * form — plus the standing deadlines/risks question. These are
 * questions for the professional, never legal conclusions by IRU.
 */
function buildProfessionalQuestions(s, { conflictLabels = [], unconfirmed = 0, gapCount = 0, formId = null } = {}) {
  const qs = [];
  if (conflictLabels.length > 0) qs.push(s.questionConflicts(conflictLabels.slice(0, 3).join('; ')));
  if (unconfirmed > 0) qs.push(s.questionUnconfirmed(unconfirmed));
  if (gapCount > 0) qs.push(s.questionGaps(gapCount));
  if (formId) qs.push(s.questionForm(formId));
  qs.push(s.questionDeadlines);
  return qs;
}

/**
 * Next-steps content for a FORM output (used by the completion summary).
 * `entry` is the registry entry; `plan` the fill plan; the content is
 * tailored from what was actually populated, missing, or in conflict.
 * `lang` localizes all prose; official field labels inside the missing/
 * conflict lists stay in English (they name official form items).
 */
export function buildFormNextSteps(entry, plan, lang = 'EN') {
  const s = nextStepsStrings(lang);
  const missing = plan.missing || [];
  const conflicts = plan.conflicts || [];
  const needsConfirmation = plan.needsConfirmation || [];

  const understand = [
    s.understandIntro(entry.name, entry.editionDate, plan.fill.length),
    missing.length > 0
      ? s.understandMissing(missing.length, missing.map((m) => m.label).join('; '))
      : s.understandMissingNone,
    ...(conflicts.length > 0
      ? [s.understandConflicts(conflicts.length, conflicts.map((c) => c.label).join('; '))]
      : []),
    ...(needsConfirmation.length > 0
      ? [s.understandNeedsConfirmation(needsConfirmation.length, needsConfirmation.map((n) => n.label).join('; '))]
      : []),
    ...s.notEstablished,
  ];

  const reviewForm = s.reviewForm.map((f) => f(s.draftLabel, s.blankLabel, entry.id, entry.editionDate, entry.sourceUrl));

  const checklist = [
    s.checklistFirst,
    ...(missing.length > 0 ? [s.checklistMissing(missing.length)] : []),
    ...(conflicts.length > 0 ? [s.checklistConflicts] : []),
    s.checklistCompare,
    s.checklistRegenerate,
    s.checklistComplete,
    s.checklistConfirm(entry.sourceUrl),
  ];

  return {
    title: s.title,
    understand,
    reviewForm,
    professionalHelp: [...s.professionalHelp],
    professionalQuestionsTitle: s.professionalQuestionsTitle,
    professionalQuestions: buildProfessionalQuestions(s, {
      conflictLabels: conflicts.map((c) => c.label),
      unconfirmed: needsConfirmation.length,
      gapCount: missing.length,
      formId: entry.id,
    }),
    resources: {
      note: s.resourcesNote,
      searchPaths: searchPathsFor(lang),
      officialFormPage: entry.sourceUrl,
    },
    checklist,
  };
}

/**
 * Next-steps content for the READINESS PACKET (client packet + on-screen
 * panel). `ctx` carries the session's actual findings:
 * { caseType, readinessPercent|null, evidenceItemCount, conflicts,
 *   unconfirmed, form: { id, editionDate, sourceUrl } | null,
 *   resourcesKind: 'verified' | 'international' | 'none',
 *   localResourcesName }.
 * English output matches the original client-side builder exactly.
 */
export function buildPacketNextSteps(ctx, lang = 'EN') {
  const s = nextStepsStrings(lang);
  const conflicts = ctx.conflicts || 0;
  const unconfirmed = ctx.unconfirmed || 0;
  const pct = typeof ctx.readinessPercent === 'number' ? ctx.readinessPercent : null;
  const form = ctx.form || null;

  const understand = [
    s.pktUnderstandIntro(ctx.caseType || 'immigration'),
    ...(pct !== null ? [s.pktReadinessPct(pct)] : []),
    s.pktEvidenceItems(ctx.evidenceItemCount || 0),
    ...(conflicts > 0 ? [s.pktConflicts(conflicts)] : []),
    ...(unconfirmed > 0 ? [s.pktUnconfirmed(unconfirmed)] : []),
    s.pktNotEstablished1,
    s.pktNotEstablished2,
  ];

  const review = form
    ? [
        s.pktReviewWithForm1(s.draftLabel, form.id, form.editionDate),
        s.pktReviewWithForm2(s.blankLabel, form.id, form.editionDate, form.sourceUrl || ''),
        s.pktReviewFormConfirm,
      ]
    : [s.pktReviewNoForm];

  const resourcesIntro = ctx.resourcesKind === 'verified'
    ? s.pktResourcesVerified(ctx.localResourcesName || 'Local Resources')
    : ctx.resourcesKind === 'international'
      ? s.pktResourcesIntl
      : s.pktResourcesNone;

  const checklist = [
    ...(conflicts > 0 ? [s.pktChecklistConflicts(conflicts)] : []),
    ...(unconfirmed > 0 ? [s.pktChecklistUnconfirmed(unconfirmed)] : []),
    s.pktChecklistGaps,
    ...(form ? [s.pktChecklistFormReview(form.id)] : [s.pktChecklistFormGeneric]),
    s.pktChecklistConfirm,
    s.pktChecklistBring,
  ];

  return {
    title: s.title,
    understand,
    review,
    professionalHelp: [...s.professionalHelp],
    professionalQuestionsTitle: s.professionalQuestionsTitle,
    professionalQuestions: buildProfessionalQuestions(s, {
      conflictLabels: ctx.conflictLabels || [],
      unconfirmed,
      gapCount: ctx.evidenceItemCount || 0,
      formId: form ? form.id : null,
    }),
    resourcesIntro,
    searchPaths: searchPathsFor(lang),
    checklist,
  };
}
