/**
 * lib/evaluation.js — The LIMITED evaluation (B2C directive §4).
 *
 * What the $1 entry payment buys: a genuinely useful but CONCISE
 * result — the BROAD CATEGORIES of preparation gaps and missing
 * information, what looks accounted for, what complete preparation
 * adds, and the next step with the upgrade options.
 *
 * What it deliberately NEVER contains (these are the paid deliverables
 * of the full workflow):
 * - the personalized readiness narrative / full assessment text;
 * - per-item evidence alternatives, target facts, or next actions
 *   (the full evidence-gap detail);
 * - document-review findings or any generated form / PDF;
 * - any eligibility determination.
 *
 * It is computed deterministically from the applicant's own evidence
 * answers — no model call, so no prompt, model output, or internal
 * decision logic is ever exposed through this endpoint.
 */

import { buildOffer } from './pricing.js';

/**
 * Broad categories only — never the underlying per-item detail.
 * `label` is the English label; `labelI18n` carries the same category
 * in the other supported languages (language-continuity directive
 * 2026-10-22). Category ids and statuses are language-independent
 * codes and never change.
 */
export const GAP_CATEGORIES = [
  { id: 'identity-documents', label: 'Identity documents', keys: ['has_passport'], labelI18n: { ES: 'Documentos de identidad', ZH: '身份证件', HT: 'Dokiman idantite', AR: 'مستندات الهوية' } },
  { id: 'entry-records', label: 'U.S. entry records', keys: ['has_i94'], labelI18n: { ES: 'Registros de entrada a EE. UU.', ZH: '美国入境记录', HT: 'Dosye antre Etazini', AR: 'سجلات الدخول إلى الولايات المتحدة' } },
  { id: 'residence-evidence', label: 'Evidence of where you live', keys: ['has_lease'], labelI18n: { ES: 'Evidencia de dónde vive', ZH: '居住地证据', HT: 'Prèv kote w ap viv', AR: 'إثبات مكان إقامتك' } },
  { id: 'case-evidence', label: 'Evidence supporting your case', keys: ['has_persecution_proof'], labelI18n: { ES: 'Evidencia que respalda su caso', ZH: '支持您案件的证据', HT: 'Prèv ki sipòte ka ou', AR: 'الأدلة الداعمة لقضيتك' } },
  { id: 'status-documents', label: 'Immigration status documents', keys: ['has_green_card'], labelI18n: { ES: 'Documentos de estado migratorio', ZH: '移民身份文件', HT: 'Dokiman estati imigrasyon', AR: 'مستندات وضع الهجرة' } },
  { id: 'financial-records', label: 'Financial and tax records', keys: ['has_tax_transcripts'], labelI18n: { ES: 'Registros financieros y de impuestos', ZH: '财务和税务记录', HT: 'Dosye finansye ak taks', AR: 'السجلات المالية والضريبية' } },
  { id: 'family-records', label: 'Family and relationship records', keys: ['has_marriage_cert', 'has_proof_of_relationship'], labelI18n: { ES: 'Registros familiares y de relación', ZH: '家庭和关系记录', HT: 'Dosye fanmi ak relasyon', AR: 'سجلات العائلة والعلاقة' } },
  { id: 'court-records', label: 'Court records', keys: ['has_arrests'], labelI18n: { ES: 'Registros judiciales', ZH: '法院记录', HT: 'Dosye tribinal', AR: 'سجلات المحكمة' } },
];

const EVAL_I18N = {
  EN: {
    headlineNeeding: (n, t) => `${n} of ${t} preparation areas need attention before your case is fully prepared.`,
    headlineNone: 'Based on the areas you answered, no broad preparation gaps stand out — the complete preparation would confirm the details.',
    adds: [
      'A full readiness review of your circumstances, with each missing item explained — why it matters, what could support it, and what to do next, in priority order.',
      'Review of your documents and information together, with conflicts and uncertainties flagged for you to resolve.',
      'Preparation of your selected form as a reviewable DRAFT PDF you can check, correct, and regenerate — with the matching official blank form for comparison.',
      'A "Your Next Steps" section in every output, tailored to your form and findings.',
    ],
    nextStepNeeding: 'Start with the areas marked "needs attention" above. Complete preparation turns each one into specific, prioritized actions and prepares your form draft.',
    nextStepNone: 'Complete preparation verifies the details behind these areas and prepares your form draft.',
    limits: [
      'This limited evaluation names broad categories only. It is not the complete readiness report and does not include any prepared form.',
      'It does not determine whether you are eligible for any immigration benefit, and it is not legal advice.',
      'Nothing here has been independently verified — it reflects only the answers you provided.',
    ],
  },
  ES: {
    headlineNeeding: (n, t) => `${n} de ${t} áreas de preparación necesitan atención antes de que su caso esté completamente preparado.`,
    headlineNone: 'Según las áreas que respondió, no destacan brechas amplias de preparación — la preparación completa confirmaría los detalles.',
    adds: [
      'Una revisión completa de preparación de sus circunstancias, con cada elemento faltante explicado — por qué importa, qué podría respaldarlo y qué hacer a continuación, en orden de prioridad.',
      'Revisión de sus documentos e información en conjunto, con conflictos e incertidumbres señalados para que usted los resuelva.',
      'Preparación de su formulario seleccionado como un PDF BORRADOR revisable que puede verificar, corregir y regenerar — con el formulario oficial en blanco correspondiente para comparación.',
      'Una sección «Sus próximos pasos» en cada resultado, adaptada a su formulario y conclusiones.',
    ],
    nextStepNeeding: 'Comience con las áreas marcadas como «necesitan atención» arriba. La preparación completa convierte cada una en acciones específicas y priorizadas y prepara su borrador de formulario.',
    nextStepNone: 'La preparación completa verifica los detalles detrás de estas áreas y prepara su borrador de formulario.',
    limits: [
      'Esta evaluación limitada nombra solo categorías amplias. No es el informe completo de preparación y no incluye ningún formulario preparado.',
      'No determina si usted es elegible para algún beneficio de inmigración, y no es asesoría legal.',
      'Nada aquí ha sido verificado de forma independiente — refleja solo las respuestas que usted proporcionó.',
    ],
  },
  ZH: {
    headlineNeeding: (n, t) => `在您的案件完全准备好之前，${t} 个准备领域中有 ${n} 个需要关注。`,
    headlineNone: '根据您回答的领域，没有突出的广泛准备缺口 — 完整准备将确认细节。',
    adds: [
      '对您的情况进行完整的准备审核，解释每个缺失项目 — 为何重要、什么可以支持它、下一步该做什么，按优先级排序。',
      '将您的文件和信息一起审核，标出冲突和不确定之处供您解决。',
      '将您选择的表格准备成可审核的草稿 PDF，您可以检查、更正和重新生成 — 并附上相应的官方空白表格供比较。',
      '每个输出中都有一个“您的后续步骤”部分，根据您的表格和审核结果量身定制。',
    ],
    nextStepNeeding: '从上方标记为“需要关注”的领域开始。完整准备将每个领域转化为具体的、按优先级排序的行动，并准备您的表格草稿。',
    nextStepNone: '完整准备将核实这些领域背后的细节并准备您的表格草稿。',
    limits: [
      '此有限评估仅列出广泛类别。它不是完整的准备报告，也不包含任何已准备的表格。',
      '它不决定您是否有资格获得任何移民福利，也不是法律建议。',
      '此处没有任何内容经过独立核实 — 它仅反映您提供的答案。',
    ],
  },
  HT: {
    headlineNeeding: (n, t) => `${n} sou ${t} domèn preparasyon bezwen atansyon anvan ka ou a fin prepare nèt.`,
    headlineNone: 'Dapre domèn ou te reponn yo, okenn gwo twou preparasyon pa parèt — preparasyon konplè a ta konfime detay yo.',
    adds: [
      'Yon revizyon preparasyon konplè sou sikonstans ou yo, ak chak atik ki manke eksplike — poukisa li enpòtan, sa ki ka sipòte li, ak sa pou fè apre, nan lòd priyorite.',
      'Revizyon dokiman ou yo ak enfòmasyon ou ansanm, ak konfli ak ensètitid yo make pou ou rezoud.',
      'Preparasyon fòm ou chwazi a kòm yon PDF BOUYON ou ka revize, tcheke, korije, epi rejenere — ak fòm ofisyèl vid ki koresponn lan pou konparezon.',
      'Yon seksyon «Pwochen etap ou yo» nan chak rezilta, ki adapte ak fòm ou ak konklizyon yo.',
    ],
    nextStepNeeding: 'Kòmanse ak domèn ki make «bezwen atansyon» anwo yo. Preparasyon konplè transfòme chak youn an aksyon espesifik, priyorize epi prepare bouyon fòm ou a.',
    nextStepNone: 'Preparasyon konplè verifye detay ki dèyè domèn sa yo epi prepare bouyon fòm ou a.',
    limits: [
      'Evalyasyon limite sa a site sèlman kategori laj. Li pa rapò preparasyon konplè a epi li pa gen okenn fòm prepare ladan li.',
      'Li pa detèmine si ou elijib pou nenpòt benefis imigrasyon, epi li pa konsèy legal.',
      'Anyen isit la pa verifye endepandamman — li reflete sèlman repons ou te bay yo.',
    ],
  },
  AR: {
    headlineNeeding: (n, t) => `${n} من ${t} مجالات إعداد تحتاج إلى اهتمام قبل أن تكون قضيتك مهيأة بالكامل.`,
    headlineNone: 'بناءً على المجالات التي أجبت عنها، لا تبرز أي فجوات إعداد واسعة — سيؤكد الإعداد الكامل التفاصيل.',
    adds: [
      'مراجعة جاهزية كاملة لظروفك، مع شرح كل عنصر مفقود — لماذا يهم، وما الذي يمكن أن يدعمه، وما يجب فعله بعد ذلك، بترتيب الأولوية.',
      'مراجعة مستنداتك ومعلوماتك معًا، مع تعليم التعارضات وأوجه عدم اليقين لك لحلها.',
      'إعداد النموذج الذي اخترته كملف PDF مسودة قابل للمراجعة يمكنك التحقق منه وتصحيحه وإعادة إنشائه — مع النموذج الرسمي الفارغ المطابق للمقارنة.',
      'قسم «خطواتك التالية» في كل مخرجات، مصمم خصيصًا لنموذجك ونتائجك.',
    ],
    nextStepNeeding: 'ابدأ بالمجالات المُعلّمة بـ«تحتاج إلى اهتمام» أعلاه. يحوّل الإعداد الكامل كل مجال إلى إجراءات محددة ومرتبة حسب الأولوية ويعدّ مسودة النموذج الخاصة بك.',
    nextStepNone: 'يتحقق الإعداد الكامل من التفاصيل وراء هذه المجالات ويعدّ مسودة النموذج الخاصة بك.',
    limits: [
      'يسمي هذا التقييم المحدود فئات واسعة فقط. وهو ليس تقرير الجاهزية الكامل ولا يتضمن أي نموذج معدّ.',
      'لا يحدد ما إذا كنت مؤهلًا لأي منفعة هجرة، وهو ليس مشورة قانونية.',
      'لم يتم التحقق من أي شيء هنا بشكل مستقل — فهو يعكس فقط الإجابات التي قدمتها.',
    ],
  },
};

export function buildLimitedEvaluation(min, lang = 'EN') {
  const s = EVAL_I18N[lang] || EVAL_I18N.EN;
  const evidence = (min && min.evidence) || {};
  const categories = GAP_CATEGORIES.map((cat) => {
    let answered = 0;
    let missing = 0;
    for (const key of cat.keys) {
      const v = evidence[key];
      if (v === undefined || v === null || v === '') continue;
      answered += 1;
      if (v === 'no' || v === 'unknown') missing += 1;
    }
    const status = answered === 0 ? 'not-addressed' : missing > 0 ? 'needs-attention' : 'accounted-for';
    return { id: cat.id, label: (lang && cat.labelI18n && cat.labelI18n[lang]) || cat.label, status, itemsNeedingAttention: missing };
  });
  const needing = categories.filter((c) => c.status === 'needs-attention');
  const accounted = categories.filter((c) => c.status === 'accounted-for');

  return {
    kind: 'limited-evaluation',
    headline: needing.length > 0
      ? s.headlineNeeding(needing.length, categories.length)
      : s.headlineNone,
    caseType: (min && min.caseType) || null,
    gapCategories: categories,
    areasAccountedFor: accounted.map((c) => c.label),
    whatCompletePreparationAdds: [...s.adds],
    nextStep: needing.length > 0 ? s.nextStepNeeding : s.nextStepNone,
    upgradeOptions: buildOffer(lang),
    limits: [...s.limits],
  };
}
