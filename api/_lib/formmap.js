/**
 * lib/formmap.js — Map canonical facts to official-form fields (§7.3).
 *
 * Principles:
 * - Map existing facts FIRST; ask only for what is missing.
 * - Only consumer-reported facts (stated, confirmed, or corrected by the
 *   consumer) are written into a form. Document-extracted values that the
 *   consumer has NOT confirmed are never silently written — they are
 *   listed as needing confirmation.
 * - Conflicting facts are never written; both candidates are surfaced.
 * - Missing values stay blank. IRU never invents a form answer.
 * - Signature fields are never filled (registry denylist + pattern guard).
 */

import { isNarrativeApproved } from './narrative.js';
import { buildFormNextSteps, normLang } from './nextsteps.js';
import { localizedFieldQuestion } from './forms/registry.js';

/**
 * Pre-download review instructions (B2C directive §5.A). Shown with
 * every generated draft. A generated form is a DRAFT to be checked by
 * the applicant — never presented as automatically correct, legally
 * sufficient, or guaranteed to be accepted.
 */
export const FORM_REVIEW_INSTRUCTIONS = [
  'This is a DRAFT. It has not been signed, submitted, or filed, and it must be checked by you before any use.',
  'Verify your name, dates, addresses, identifying information, and every other populated field against your own records and supporting documents.',
  'Review anything listed as unanswered, inconsistent, uncertain, or needing confirmation in the completion summary.',
  'Confirm that every applicable question has been answered accurately — questions left blank were left blank because the information was not provided, not because they do not apply.',
  'Correct mistakes in your information and regenerate the draft before signing, submitting, or otherwise using the form.',
  'A form prepared with software assistance is not automatically correct or legally sufficient, and no outcome is guaranteed.',
];

/** Explicit final-review checklist (B2C directive §5.D) — a review aid, not a legal certification. */
export const FINAL_REVIEW_CHECKLIST = [
  'I checked every populated field on the draft against my own records and documents.',
  'I reviewed the supporting material and the items listed as missing, inconsistent, or unconfirmed.',
  'I addressed the known inconsistencies, or I understand they remain unresolved.',
  'I understand this draft is not signed, filed, or submitted, and that signing and filing are my responsibility.',
];

/**
 * Localized summary prose (language-continuity directive 2026-10-22).
 * English is the default and is byte-identical to the original strings.
 * Official form FIELD labels (registry `label`s) are NOT translated —
 * they name official USCIS form items; the guidance around them is.
 * The draft/blank document labels here MUST match nextsteps.js's
 * draftLabel/blankLabel (a regression test asserts they agree, because
 * the next-steps text quotes them).
 */
export const FORM_SUMMARY_I18N = {
  EN: {
    reviewInstructions: FORM_REVIEW_INSTRUCTIONS,
    finalReviewChecklist: FINAL_REVIEW_CHECKLIST,
    draftLabel: 'DRAFT — for consumer review only. Not signed, not submitted, not legal advice.',
    draftDocumentLabel: 'IRU Pre-filled Draft — Review and Correct',
    blankFormLabel: 'Official Blank Form — Reference Copy',
    blankFormNote: 'The blank official form is a reference for checking the draft\u2019s answers and noting corrections. Downloading it does not grant preparation of any form.',
    staleVersionNote: 'If you correct any information after downloading this draft, the download is stale. Regenerate the draft and use only the latest version.',
    downloadedDraftNote: 'A draft you already downloaded cannot be recalled or updated by IRU. If your information changes, discard older downloads and use only the latest generated draft.',
    signatureStatus: 'No signature was added. No form was submitted. Signing and filing are the consumer\u2019s responsibility, after review.',
    pleaseProvide: (label) => `Please provide: ${label}`,
    formatIssueDate: (label) => `The value on record for ${label} is not in a date format IRU can place on the form (use MM/DD/YYYY), so it was left blank. Correct the date and regenerate the draft.`,
    formatIssueANumber: (label) => `The value on record for ${label} contains no digits IRU can place in the A-Number field, so it was left blank. Correct it and regenerate the draft.`,
    conditionalNoteSpouse: 'Because you reported that you are married, Part A.II (information about your spouse and children) applies to you. IRU does not fill that part \u2014 complete it yourself from your own records.',
    conditionalNotePriorFilings: 'Because this is a renewal or replacement request, the items about prior I-765 filings and earlier employment authorization (Part 2, Items 11\u201316 and related items) apply to you. IRU does not fill them \u2014 complete them yourself from your own records.',
  },
  ES: {
    reviewInstructions: [
      'Esto es un BORRADOR. No ha sido firmado, presentado ni enviado, y usted debe revisarlo antes de cualquier uso.',
      'Verifique su nombre, fechas, direcciones, información de identificación y todos los demás campos completados contra sus propios registros y documentos de respaldo.',
      'Revise todo lo enumerado como sin respuesta, inconsistente, incierto o que necesite confirmación en el resumen de finalización.',
      'Confirme que cada pregunta aplicable haya sido respondida con exactitud — las preguntas que quedaron en blanco se dejaron en blanco porque la información no fue proporcionada, no porque no apliquen.',
      'Corrija los errores en su información y regenere el borrador antes de firmar, presentar o usar el formulario de otro modo.',
      'Un formulario preparado con asistencia de software no es automáticamente correcto ni legalmente suficiente, y ningún resultado está garantizado.',
    ],
    finalReviewChecklist: [
      'Revisé cada campo completado en el borrador contra mis propios registros y documentos.',
      'Revisé el material de respaldo y los elementos enumerados como faltantes, inconsistentes o sin confirmar.',
      'Abordé las inconsistencias conocidas, o entiendo que permanecen sin resolver.',
      'Entiendo que este borrador no está firmado, presentado ni enviado, y que firmar y presentar es mi responsabilidad.',
    ],
    draftLabel: 'BORRADOR — solo para revisión del consumidor. No firmado, no presentado, no es asesoría legal.',
    draftDocumentLabel: 'Borrador prellenado de IRU — Revisar y corregir',
    blankFormLabel: 'Formulario oficial en blanco — Copia de referencia',
    blankFormNote: 'El formulario oficial en blanco es una referencia para verificar las respuestas del borrador y anotar correcciones. Descargarlo no otorga la preparación de ningún formulario.',
    staleVersionNote: 'Si corrige alguna información después de descargar este borrador, la descarga queda obsoleta. Regenere el borrador y use solo la versión más reciente.',
    downloadedDraftNote: 'Un borrador que ya descargó no puede ser retirado ni actualizado por IRU. Si su información cambia, deseche las descargas anteriores y use solo el borrador generado más recientemente.',
    signatureStatus: 'No se agregó ninguna firma. No se presentó ningún formulario. Firmar y presentar es responsabilidad del consumidor, después de su revisión.',
    pleaseProvide: (label) => `Proporcione: ${label}`,
    formatIssueDate: (label) => `El valor registrado para ${label} no está en un formato de fecha que IRU pueda colocar en el formulario (use MM/DD/AAAA), por lo que se dejó en blanco. Corrija la fecha y regenere el borrador.`,
    formatIssueANumber: (label) => `El valor registrado para ${label} no contiene dígitos que IRU pueda colocar en el campo de Número A, por lo que se dejó en blanco. Corríjalo y regenere el borrador.`,
    conditionalNoteSpouse: 'Como usted indicó que está casado/a, la Parte A.II (información sobre su cónyuge e hijos) le aplica. IRU no completa esa parte \u2014 complétela usted mismo/a a partir de sus propios registros.',
    conditionalNotePriorFilings: 'Como esta es una solicitud de renovación o reemplazo, los elementos sobre solicitudes I-765 anteriores y autorizaciones de empleo previas (Parte 2, elementos 11\u201316 y relacionados) le aplican. IRU no los completa \u2014 complételos usted mismo/a a partir de sus propios registros.',
  },
  ZH: {
    reviewInstructions: [
      '这是一份草稿。它尚未被签署、提交或递交，在任何使用之前必须由您检查。',
      '将您的姓名、日期、地址、身份信息以及其他每个已填写字段与您自己的记录和支持文件核对。',
      '审核完成总结中列为未回答、不一致、不确定或需要确认的任何内容。',
      '确认每个适用的问题都已准确回答 — 留空的问题之所以留空，是因为没有提供相关信息，而不是因为它们不适用。',
      '在签署、提交或以其他方式使用表格之前，更正您信息中的错误并重新生成草稿。',
      '在软件协助下准备的表格并不自动正确或具有法律充分性，也不保证任何结果。',
    ],
    finalReviewChecklist: [
      '我已将草稿上每个已填写的字段与我自己的记录和文件核对。',
      '我已审核支持材料以及列为缺失、不一致或未确认的项目。',
      '我已处理已知的不一致之处，或者我理解它们仍未解决。',
      '我理解此草稿未被签署、提交或递交，签署和提交是我的责任。',
    ],
    draftLabel: '草稿 — 仅供消费者审核。未签署、未提交、非法律建议。',
    draftDocumentLabel: 'IRU 预填草稿 — 审核并更正',
    blankFormLabel: '官方空白表格 — 参考副本',
    blankFormNote: '官方空白表格是用于核对草稿答案和记录更正的参考。下载它并不授予准备任何表格的服务。',
    staleVersionNote: '如果您在下载此草稿后更正了任何信息，该下载即已过时。请重新生成草稿并仅使用最新版本。',
    downloadedDraftNote: '您已经下载的草稿无法被 IRU 撤回或更新。如果您的信息发生变化，请丢弃先前的下载文件，只使用最新生成的草稿。',
    signatureStatus: '未添加任何签名。未提交任何表格。签署和提交是消费者的责任，请在审核后进行。',
    pleaseProvide: (label) => `请提供：${label}`,
    formatIssueDate: (label) => `记录中${label}的值不是 IRU 可以填入表格的日期格式（请使用 MM/DD/YYYY），因此已留空。请更正日期并重新生成草稿。`,
    formatIssueANumber: (label) => `记录中${label}的值不包含 IRU 可以填入 A 号字段的任何数字，因此已留空。请更正并重新生成草稿。`,
    conditionalNoteSpouse: '由于您报告的婚姻状况为已婚，A 部分 II（配偶和子女信息）适用于您。IRU 不填写该部分 \u2014 请根据您自己的记录自行填写。',
    conditionalNotePriorFilings: '由于这是续期或补发申请，关于先前 I-765 申请和先前就业授权的项目（第 2 部分第 11\u201316 项及相关项目）适用于您。IRU 不填写这些项目 \u2014 请根据您自己的记录自行填写。',
  },
  HT: {
    reviewInstructions: [
      'Sa a se yon BOUYON. Yo pa siyen li, soumèt li, oswa depoze li, epi ou dwe tcheke li anvan nenpòt itilizasyon.',
      'Verifye non ou, dat ou yo, adrès ou yo, enfòmasyon idantifikasyon ou, ak chak lòt chan yo ranpli kont pwòp dosye ou yo ak dokiman sipò ou yo.',
      'Revize tout sa ki liste kòm san repons, enkonsistan, ensèten, oswa ki bezwen konfimasyon nan rezime konplezyon an.',
      'Konfime chak kesyon ki aplikab te reponn egzat — kesyon ki rete vid yo rete vid paske enfòmasyon an pa t bay, pa paske yo pa aplike.',
      'Korije erè nan enfòmasyon ou epi rejenere bouyon an anvan ou siyen, soumèt, oswa itilize fòm nan otreman.',
      'Yon fòm ki prepare ak èd lojisyèl pa otomatikman korèk oswa legalman sifi, epi okenn rezilta pa garanti.',
    ],
    finalReviewChecklist: [
      'Mwen te tcheke chak chan yo ranpli sou bouyon an kont pwòp dosye ak dokiman mwen yo.',
      'Mwen te revize materyèl sipò a ak atik yo liste kòm manke, enkonsistan, oswa san konfimasyon.',
      'Mwen te abòde enkonsistans yo konnen yo, oswa mwen konprann yo rete san rezoud.',
      'Mwen konprann bouyon sa a pa siyen, depoze, oswa soumèt, epi siyen ak depoze se responsablite mwen.',
    ],
    draftLabel: 'BOUYON — pou revizyon konsomatè sèlman. Pa siyen, pa soumèt, pa konsèy legal.',
    draftDocumentLabel: 'Bouyon IRU te ranpli davans — Revize epi korije',
    blankFormLabel: 'Fòm ofisyèl vid — Kopi referans',
    blankFormNote: 'Fòm ofisyèl vid la se yon referans pou tcheke repons bouyon an epi note koreksyon yo. Telechaje li pa bay preparasyon okenn fòm.',
    staleVersionNote: 'Si ou korije nenpòt enfòmasyon apre ou telechaje bouyon sa a, telechajman an demode. Rejenere bouyon an epi itilize sèlman dènye vèsyon an.',
    downloadedDraftNote: 'IRU pa ka reprann oswa mete ajou yon bouyon ou te deja telechaje. Si enfòmasyon ou chanje, jete ansyen telechajman yo epi itilize sèlman dènye bouyon ki te pwodwi a.',
    signatureStatus: 'Yo pa ajoute okenn siyati. Yo pa soumèt okenn fòm. Siyen ak depoze se responsablite konsomatè a, apre revizyon.',
    pleaseProvide: (label) => `Tanpri bay: ${label}`,
    formatIssueDate: (label) => `Valè ki anrejistre pou ${label} pa nan yon fòma dat IRU ka mete sou fòm nan (itilize MM/JJ/AAAA), kidonk li rete vid. Korije dat la epi rejenere bouyon an.`,
    formatIssueANumber: (label) => `Valè ki anrejistre pou ${label} pa gen okenn chif IRU ka mete nan chan Nimewo A a, kidonk li rete vid. Korije li epi rejenere bouyon an.`,
    conditionalNoteSpouse: 'Paske ou rapòte ou marye, Pati A.II (enfòmasyon sou madanm/mari ou ak pitit ou yo) aplike pou ou. IRU pa ranpli pati sa a \u2014 ranpli li ou menm dapre pwòp dosye ou.',
    conditionalNotePriorFilings: 'Paske sa a se yon demann renouvèlman oswa ranplasman, atik ki konsènen ansyen aplikasyon I-765 ak otorizasyon travay anvan yo (Pati 2, atik 11\u201316 ak atik ki gen rapò) aplike pou ou. IRU pa ranpli yo \u2014 ranpli yo ou menm dapre pwòp dosye ou.',
  },
  AR: {
    reviewInstructions: [
      'هذه مسودة. لم يتم توقيعها أو تقديمها أو إرسالها، ويجب عليك التحقق منها قبل أي استخدام.',
      'تحقق من اسمك وتواريخك وعناوينك ومعلومات التعريف الخاصة بك وكل حقل مملوء آخر مقابل سجلاتك ومستنداتك الداعمة.',
      'راجع أي شيء مدرج على أنه دون إجابة أو غير متسق أو غير مؤكد أو يحتاج إلى تأكيد في ملخص الإكمال.',
      'أكّد أن كل سؤال منطبق قد تمت الإجابة عليه بدقة — الأسئلة التي تُركت فارغة تُركت فارغة لأن المعلومات لم تُقدم، وليس لأنها لا تنطبق.',
      'صحح الأخطاء في معلوماتك وأعد إنشاء المسودة قبل التوقيع أو التقديم أو استخدام النموذج بأي طريقة أخرى.',
      'النموذج المعدّ بمساعدة برنامج ليس صحيحًا أو كافيًا قانونيًا تلقائيًا، ولا توجد نتيجة مضمونة.',
    ],
    finalReviewChecklist: [
      'لقد تحققت من كل حقل مملوء في المسودة مقابل سجلاتي ومستنداتي الخاصة.',
      'لقد راجعت المواد الداعمة والعناصر المدرجة على أنها مفقودة أو غير متسقة أو غير مؤكدة.',
      'لقد عالجت حالات عدم الاتساق المعروفة، أو أفهم أنها ما زالت دون حل.',
      'أفهم أن هذه المسودة غير موقعة وغير مقدمة وغير مرسلة، وأن التوقيع والتقديم مسؤوليتي.',
    ],
    draftLabel: 'مسودة — لمراجعة المستهلك فقط. غير موقعة وغير مقدمة وليست مشورة قانونية.',
    draftDocumentLabel: 'مسودة IRU المملوءة مسبقًا — المراجعة والتصحيح',
    blankFormLabel: 'النموذج الرسمي الفارغ — نسخة مرجعية',
    blankFormNote: 'النموذج الرسمي الفارغ هو مرجع للتحقق من إجابات المسودة وتدوين التصحيحات. تنزيله لا يمنح إعداد أي نموذج.',
    staleVersionNote: 'إذا صححت أي معلومات بعد تنزيل هذه المسودة، يصبح التنزيل قديمًا. أعد إنشاء المسودة واستخدم أحدث إصدار فقط.',
    downloadedDraftNote: 'لا يمكن لـ IRU استرجاع مسودة سبق أن نزّلتها أو تحديثها. إذا تغيّرت معلوماتك، تخلّص من التنزيلات السابقة واستخدم فقط أحدث مسودة تم إنشاؤها.',
    signatureStatus: 'لم تتم إضافة أي توقيع. لم يتم تقديم أي نموذج. التوقيع والتقديم مسؤولية المستهلك، بعد المراجعة.',
    pleaseProvide: (label) => `يرجى تقديم: ${label}`,
    formatIssueDate: (label) => `القيمة المسجلة لـ ${label} ليست بصيغة تاريخ يمكن لـ IRU وضعها في النموذج (استخدم MM/DD/YYYY)، لذا تُركت فارغة. صحح التاريخ وأعد إنشاء المسودة.`,
    formatIssueANumber: (label) => `القيمة المسجلة لـ ${label} لا تحتوي على أي أرقام يمكن لـ IRU وضعها في حقل رقم A، لذا تُركت فارغة. صححها وأعد إنشاء المسودة.`,
    conditionalNoteSpouse: 'نظرًا لأنك أفدت بأنك متزوج، فإن الجزء A.II (معلومات عن زوجك وأطفالك) ينطبق عليك. لا تملأ IRU هذا الجزء \u2014 أكمله بنفسك من سجلاتك الخاصة.',
    conditionalNotePriorFilings: 'نظرًا لأن هذا طلب تجديد أو استبدال، فإن البنود المتعلقة بطلبات I-765 السابقة وتصاريح العمل السابقة (الجزء 2، البنود 11\u201316 والبنود ذات الصلة) تنطبق عليك. لا تملأ IRU هذه البنود \u2014 أكملها بنفسك من سجلاتك الخاصة.',
  },
};

export function formSummaryStrings(lang) {
  return FORM_SUMMARY_I18N[normLang(lang)] || FORM_SUMMARY_I18N.EN;
}

export const TRANSFORMS = {
  /** A-Number: official fields hold digits only (max 9). Strip a leading "A". */
  aNumber(value) {
    return String(value || '').trim().replace(/^[Aa][- ]?/, '').replace(/[^0-9]/g, '').slice(0, 9);
  },
  /** 'YYYY-MM-DD' → 'MM/DD/YYYY'; passes through values already in MDY form. */
  dateMDY(value) {
    const v = String(value || '').trim();
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
    return v;
  },
  /** US phone → 3-digit area code. */
  phoneAreaCode(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    return local.length >= 3 ? local.slice(0, 3) : '';
  },
  /** US phone → XXX-XXXX remainder. */
  phoneNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (local.length === 10) return `${local.slice(3, 6)}-${local.slice(6)}`;
    return local.slice(3);
  },
  /** I-589 Item 13 is one field: "City and Country of Birth". */
  cityCountryOfBirth(value, record) {
    const country = String(record?.facts?.country_of_birth?.value || '').trim();
    const city = String(value || '').trim();
    if (city && country) {
      // The city value often already carries the country — applicants
      // answer the combined question ("Port-au-Prince, Haiti") and
      // document extraction produces the same shape. Never print the
      // country twice ("Port-au-Prince, Haiti, Haiti"). The applicant's
      // own casing is preserved. (The I-765 needs no such guard: it maps
      // city and country to separate fields, 18.a and 18.c.)
      const cityTail = city.replace(/[\s.,;]+$/, '').toLowerCase();
      if (cityTail.endsWith(country.toLowerCase())) return city;
      return `${city}, ${country}`;
    }
    return city || country;
  },
};

export function applyTransform(field, value, record) {
  if (!field.transform) return String(value);
  const fn = TRANSFORMS[field.transform];
  return fn ? fn(value, record) : String(value);
}

/**
 * Best-effort split of a free-text full name into form name parts.
 * The result is a PROPOSAL the consumer reviews — never silently trusted:
 * callers mark derived parts so the UI can ask for correction.
 */
export function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { family_name: parts[0] };
  if (parts.length === 2) return { given_name: parts[0], family_name: parts[1] };
  return {
    given_name: parts[0],
    middle_name: parts.slice(1, -1).join(' '),
    family_name: parts[parts.length - 1],
  };
}

const norm = (v) => String(v || '').trim().toLowerCase();

/**
 * A date value IRU can honestly place on a form: ISO (YYYY-MM-DD) or
 * M/D/YYYY with a real calendar day. Anything else ("spring 1990",
 * "unknown", a typo'd month 13) is NOT a date the form can carry —
 * passing it through the transform would print the raw text into an
 * official date field, so the fill plan flags it instead (below).
 */
export function isRecognizedDateValue(value) {
  const v = String(value || '').trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return isRealCalendarDate(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return isRealCalendarDate(+m[3], +m[1], +m[2]);
  return false;
}

function isRealCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Build the fill plan for one form from the canonical record.
 * Returns everything the generator and the completion summary need.
 */
export function buildFillPlan(record, entry, lang = 'EN') {
  const s = formSummaryStrings(lang);
  const fill = [];
  const needsConfirmation = [];
  const missing = [];
  const conflicts = [];
  const notFilled = [];
  const formatIssues = [];
  const seenMissingFacts = new Set();
  const seenConfirmFacts = new Set();
  const seenFormatFacts = new Set();

  for (const field of entry.fields) {
    const fact = record?.facts?.[field.factId];
    const hasValue = fact && fact.value !== null && fact.value !== undefined && String(fact.value).trim() !== '';

    if (!hasValue) {
      if (field.required && !seenMissingFacts.has(field.factId)) {
        seenMissingFacts.add(field.factId);
        missing.push({
          factId: field.factId,
          label: field.label,
          question: localizedFieldQuestion(entry, field, lang) || s.pleaseProvide(field.label),
        });
      } else if (!field.required) {
        notFilled.push({ pdfField: field.pdfField, label: field.label, reason: 'no-value-optional' });
      }
      continue;
    }

    if (fact.status === 'conflicting') {
      conflicts.push({
        factId: field.factId,
        label: field.label,
        values: [fact.value, ...(fact.alternatives || []).map((a) => a.value)],
      });
      continue;
    }

    if (fact.status === 'extracted-unconfirmed') {
      if (!seenConfirmFacts.has(field.factId)) {
        seenConfirmFacts.add(field.factId);
        needsConfirmation.push({
          factId: field.factId,
          label: field.label,
          value: fact.value,
          sourceRef: fact.sourceRef || null,
        });
      }
      continue;
    }

    // Narrative gate (successive directive §4): a fact whose source is
    // the applicant's narrative may be used in form preparation ONLY
    // after the applicant has reviewed and approved the narrative.
    // Until then it is surfaced as needing that approval — never
    // silently written, never re-asked as if unknown.
    if (fact.source === 'narrative' && record?.narrative && !isNarrativeApproved(record.narrative)) {
      if (!seenConfirmFacts.has(field.factId)) {
        seenConfirmFacts.add(field.factId);
        needsConfirmation.push({
          factId: field.factId,
          label: field.label,
          value: fact.value,
          sourceRef: null,
          reason: 'narrative-not-approved',
        });
      }
      continue;
    }

    // Consumer-reported value (answer / narrative / correction / confirmed).
    if (field.kind === 'checkbox') {
      if (norm(fact.value) === norm(field.matchValue)) {
        fill.push({ pdfField: field.pdfField, kind: 'checkbox', label: field.label, factId: field.factId });
      }
      // A different option of the same group: this box correctly stays
      // unchecked — not an error, not missing.
      continue;
    }

    // Format validation (value-upgrade directive §4): a value that
    // cannot be represented in the official field's format must be
    // flagged for correction — never printed raw into the form and
    // never silently dropped. Dates must be recognizable calendar
    // dates; an A-Number must contain at least one digit for the
    // digits-only transform to place.
    if (field.transform === 'dateMDY' && !isRecognizedDateValue(fact.value)) {
      if (!seenFormatFacts.has(field.factId)) {
        seenFormatFacts.add(field.factId);
        formatIssues.push({ factId: field.factId, label: field.label, reason: 'unrecognized-date-format' });
      }
      continue;
    }
    if (field.transform === 'aNumber' && !/[0-9]/.test(String(fact.value))) {
      if (!seenFormatFacts.has(field.factId)) {
        seenFormatFacts.add(field.factId);
        formatIssues.push({ factId: field.factId, label: field.label, reason: 'anumber-no-digits' });
      }
      continue;
    }

    const value = applyTransform(field, fact.value, record);
    if (value === '') {
      notFilled.push({ pdfField: field.pdfField, label: field.label, reason: 'transform-produced-empty' });
      continue;
    }
    fill.push({ pdfField: field.pdfField, kind: 'text', value, label: field.label, factId: field.factId });
  }

  return { formId: entry.id, fill, needsConfirmation, missing, conflicts, notFilled, formatIssues };
}

/** The consumer-facing completion summary (§7.5) for a fill plan. */
export function buildCompletionSummary(entry, plan, record, lang = 'EN') {
  const s = formSummaryStrings(lang);
  return {
    formId: entry.id,
    formName: entry.name,
    editionDate: entry.editionDate,
    registryCheckedDate: entry.checkedDate,
    draftLabel: s.draftLabel,
    // The two documents in a form package, labeled exactly (B2C §5.B).
    draftDocumentLabel: s.draftDocumentLabel,
    blankForm: {
      label: s.blankFormLabel,
      formId: entry.id,
      editionDate: entry.editionDate,
      // The blank served alongside the draft is the same verified
      // official template the draft was generated from — unfilled.
      downloadPath: `/api/blank-form?form=${encodeURIComponent(entry.id)}`,
      sourceUrl: entry.sourceUrl,
      instructionsUrl: entry.instructionsUrl,
      note: s.blankFormNote,
    },
    reviewInstructions: [...s.reviewInstructions],
    finalReviewChecklist: [...s.finalReviewChecklist],
    nextSteps: buildFormNextSteps(entry, plan, lang),
    staleVersionNote: s.staleVersionNote,
    downloadedDraftNote: s.downloadedDraftNote,
    populated: plan.fill.map((f) => ({ label: f.label, pdfField: f.pdfField, value: f.kind === 'text' ? f.value : '✓ checked' })),
    fillErrors: (plan.fillErrors || []).map((e) => ({ label: e.label, reason: e.reason })),
    needsConfirmation: plan.needsConfirmation,
    missingRequired: plan.missing,
    conflicts: plan.conflicts,
    // Values present but not placeable in the official field format —
    // each carries a localized explanation and correction instruction.
    formatIssues: (plan.formatIssues || []).map((i) => ({
      factId: i.factId,
      label: i.label,
      reason: i.reason,
      message: i.reason === 'anumber-no-digits' ? s.formatIssueANumber(i.label) : s.formatIssueDate(i.label),
    })),
    // Consumer-completed sections whose TRIGGERING condition is known
    // to apply to this applicant (value-upgrade directive §4:
    // conditional questions evaluated when their trigger is known).
    // Sections with unknown triggers stay in consumerCompletedSections.
    conditionalNotes: buildConditionalNotes(entry, record, s),
    optionalLeftBlank: plan.notFilled.filter((n) => n.reason === 'no-value-optional').map((n) => n.label),
    consumerCompletedSections: entry.consumerCompletedSections || [],
    documentsUsedAsSources: collectDocumentSources(record),
    signatureStatus: s.signatureStatus,
  };
}

/**
 * Conditional applicability for sections IRU does not fill: when a
 * section's triggering fact is KNOWN, say explicitly that the section
 * applies to this applicant and why. When the trigger is unknown, the
 * section stays in the plain consumerCompletedSections list and no
 * applicability is asserted. Section strings match the registry's
 * consumerCompletedSections entries verbatim so the UI can pair them.
 */
function buildConditionalNotes(entry, record, s) {
  const notes = [];
  if (entry.id === 'I-589' && norm(record?.facts?.marital_status?.value) === 'married') {
    notes.push({ section: 'Part A.II (spouse and children information)', note: s.conditionalNoteSpouse });
  }
  if (entry.id === 'I-765') {
    const reason = norm(record?.facts?.application_reason?.value);
    if (reason === 'renewal' || reason === 'replacement') {
      notes.push({
        section: 'Part 2, Items 11\u201316 (prior I-765 filings and Social Security card consent questions \u2014 your own answers)',
        note: s.conditionalNotePriorFilings,
      });
    }
  }
  return notes;
}

function collectDocumentSources(record) {
  const seen = new Map();
  for (const fact of Object.values(record?.facts || {})) {
    if (fact?.source === 'document' && fact.sourceRef?.documentType) {
      seen.set(fact.sourceRef.documentType, true);
    }
    for (const alt of fact?.alternatives || []) {
      if (alt?.sourceRef?.documentType) seen.set(alt.sourceRef.documentType, true);
    }
  }
  return [...seen.keys()];
}
