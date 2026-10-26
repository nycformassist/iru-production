/**
 * lib/pricing.js — B2C pricing & entitlement structure (owner-set,
 * 2026-10-21 directive). Pure data + pure functions; imported by BOTH
 * the server (checkout enforcement) and the client (offer display) so
 * the amounts a consumer sees are the amounts the server charges.
 *
 * TEST MODE ONLY. These amounts describe the intended commercial
 * structure the owner directed us to implement and test. Nothing here
 * activates a live charge, and no Stripe product/price is created or
 * modified by this module — checkout amounts are enforced server-side
 * at session creation from this table, never taken from the client.
 *
 * Structure:
 * - Limited evaluation: $1.00 one-time. Grants ONLY the limited
 *   evaluation. Credited toward either complete purchase.
 * - One-form Complete Preparation: $99.95 TOTAL (incl. the $1) for ONE
 *   selected form (I-589 XOR I-765). Upgrade charge after evaluation:
 *   $98.95.
 * - Two-form bundle: $129.95 TOTAL (incl. the $1) for BOTH forms.
 *   Upgrade charge after evaluation: $128.95. Savings vs two separate
 *   one-form purchases (2 × $99.95 = $199.90): $69.95.
 * - Second-form add-on: after a completed one-form purchase, the other
 *   form for $30.00 more (total paid becomes $129.95).
 * No recurring billing, no hidden charges, no automatic upgrades.
 */

export const FORM_IDS = ['I-589', 'I-765'];

export const SKUS = {
  EVALUATION: 'iru-evaluation',
  ONE_FORM: 'iru-complete-one-form',
  BUNDLE: 'iru-complete-bundle',
  SECOND_FORM: 'iru-second-form-addon',
  /** Pre-B2C single-product SKU (env-priced). Kept for compatibility
   *  with the original test-mode path; not part of the B2C offer. */
  LEGACY: 'iru-assessment-form-draft',
};

export const PRICING = {
  evaluation: {
    sku: SKUS.EVALUATION,
    chargeCents: 100,
    totalCents: 100,
    creditedCents: 0,
    name: 'IRU Limited Evaluation',
    scope: 'A limited initial evaluation: the broad categories of preparation gaps and missing information in your case, what complete preparation would add, and your next step. It does not include the full readiness workflow or any prepared form.',
  },
  oneForm: {
    sku: SKUS.ONE_FORM,
    // Charged at upgrade time, after the $1 evaluation credit.
    chargeCents: 9895,
    totalCents: 9995,
    creditedCents: 100,
    name: 'IRU Complete Preparation — One Form',
    scope: 'Complete preparation of ONE form you select — Form I-589 or Form I-765 — as a reviewable DRAFT PDF, with corrections and regeneration and a completion summary. Includes your $1.00 evaluation payment as a credit.',
  },
  bundle: {
    sku: SKUS.BUNDLE,
    chargeCents: 12895,
    totalCents: 12995,
    creditedCents: 100,
    name: 'IRU Complete Preparation — Both Forms (Bundle)',
    scope: 'Complete preparation of BOTH Form I-589 and Form I-765, each as a reviewable DRAFT PDF, with corrections and regeneration and completion summaries. Includes your $1.00 evaluation payment as a credit.',
    separateTotalCents: 19990, // 2 × $99.95
    savingsCents: 6995, // 19990 − 12995
  },
  secondForm: {
    sku: SKUS.SECOND_FORM,
    chargeCents: 3000,
    totalCents: 12995, // $99.95 already paid + $30.00
    creditedCents: 0,
    name: 'IRU Second Form Add-On',
    scope: 'Adds preparation of the second form (the one not covered by your one-form purchase) on the same terms: reviewable DRAFT PDF, corrections and regeneration, completion summary. After this purchase your total paid is $129.95 — the same as the two-form bundle.',
  },
};

/** Format integer cents as a USD string, e.g. 9995 → "$99.95". */
export function formatCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return `$${(n / 100).toFixed(2)}`;
}

/**
 * Localized offer copy (language-continuity directive 2026-10-22).
 * Prices, SKUs, and amounts are language-independent and never change;
 * only the explanatory names/scopes/disclosures are localized. English
 * output is identical to the original literals (PRICING.name/scope for
 * EN; the strings below for the offer-level text).
 */
const OFFER_I18N = {
  EN: {
    creditedToward: 'either complete purchase',
    formsIncludedOne: 'exactly one form — Form I-589 OR Form I-765, your choice',
    formsIncludedBundle: 'both forms — Form I-589 AND Form I-765',
    savingsNote: (separate, one, bundle, savings) => `Buying both forms separately would cost ${separate} (2 × ${one}). The bundle costs ${bundle} — a saving of ${savings}.`,
    disclosures: [
      'All prices are one-time payments in USD. There is no subscription, no recurring billing, and no automatic upgrade.',
      'The $1.00 evaluation payment is credited toward either complete purchase, so the totals above are the most you would pay.',
      'IRU prepares DRAFT forms for your review. IRU does not sign, submit, or file anything, and preparation help is not legal advice.',
    ],
  },
  ES: {
    names: {
      evaluation: 'Evaluación limitada de IRU',
      oneForm: 'Preparación completa de IRU — Un formulario',
      bundle: 'Preparación completa de IRU — Ambos formularios (Paquete)',
      secondForm: 'Complemento de segundo formulario de IRU',
    },
    scopes: {
      evaluation: 'Una evaluación inicial limitada: las categorías amplias de brechas de preparación e información faltante en su caso, lo que agregaría la preparación completa y su próximo paso. No incluye el flujo completo de preparación ni ningún formulario preparado.',
      oneForm: 'Preparación completa de UN formulario que usted seleccione — Formulario I-589 o Formulario I-765 — como un PDF BORRADOR revisable, con correcciones y regeneración y un resumen de finalización. Incluye su pago de evaluación de $1.00 como crédito.',
      bundle: 'Preparación completa de AMBOS formularios, I-589 e I-765, cada uno como un PDF BORRADOR revisable, con correcciones y regeneración y resúmenes de finalización. Incluye su pago de evaluación de $1.00 como crédito.',
      secondForm: 'Agrega la preparación del segundo formulario (el que no cubre su compra de un formulario) en los mismos términos: PDF BORRADOR revisable, correcciones y regeneración, resumen de finalización. Después de esta compra, su total pagado es $129.95 — lo mismo que el paquete de dos formularios.',
    },
    creditedToward: 'cualquiera de las compras completas',
    formsIncludedOne: 'exactamente un formulario — Formulario I-589 O Formulario I-765, a su elección',
    formsIncludedBundle: 'ambos formularios — Formulario I-589 Y Formulario I-765',
    savingsNote: (separate, one, bundle, savings) => `Comprar ambos formularios por separado costaría ${separate} (2 × ${one}). El paquete cuesta ${bundle} — un ahorro de ${savings}.`,
    disclosures: [
      'Todos los precios son pagos únicos en USD. No hay suscripción, facturación recurrente ni actualización automática.',
      'El pago de evaluación de $1.00 se acredita a cualquiera de las compras completas, por lo que los totales anteriores son lo máximo que pagaría.',
      'IRU prepara formularios BORRADOR para su revisión. IRU no firma, presenta ni envía nada, y la ayuda en la preparación no es asesoría legal.',
    ],
  },
  ZH: {
    names: {
      evaluation: 'IRU 有限评估',
      oneForm: 'IRU 完整准备 — 一个表格',
      bundle: 'IRU 完整准备 — 两个表格（套餐）',
      secondForm: 'IRU 第二个表格附加服务',
    },
    scopes: {
      evaluation: '有限的初步评估：您案件中准备缺口和缺失信息的广泛类别、完整准备将增加的内容，以及您的下一步。它不包括完整的准备流程或任何已准备的表格。',
      oneForm: '完整准备您选择的一个表格 — I-589 表格或 I-765 表格 — 制成可审核的草稿 PDF，附更正、重新生成和完成总结。包含您的 1.00 美元评估付款作为抵扣。',
      bundle: '完整准备 I-589 和 I-765 两个表格，每个都制成可审核的草稿 PDF，附更正、重新生成和完成总结。包含您的 1.00 美元评估付款作为抵扣。',
      secondForm: '以相同条款添加第二个表格（您的单表格购买未涵盖的那个）的准备：可审核的草稿 PDF、更正和重新生成、完成总结。此次购买后，您的总付款为 129.95 美元 — 与双表格套餐相同。',
    },
    creditedToward: '任一完整购买',
    formsIncludedOne: '恰好一个表格 — I-589 表格或 I-765 表格，由您选择',
    formsIncludedBundle: '两个表格 — I-589 表格和 I-765 表格',
    savingsNote: (separate, one, bundle, savings) => `分别购买两个表格需花费 ${separate}（2 × ${one}）。套餐价格为 ${bundle} — 节省 ${savings}。`,
    disclosures: [
      '所有价格均为美元一次性付款。无订阅、无定期计费、无自动升级。',
      '1.00 美元评估付款可抵扣任一完整购买，因此上述总额是您最多需要支付的金额。',
      'IRU 准备供您审核的草稿表格。IRU 不签署、提交或递交任何文件，准备帮助不是法律建议。',
    ],
  },
  HT: {
    names: {
      evaluation: 'Evalyasyon Limite IRU',
      oneForm: 'Preparasyon Konplè IRU — Yon Fòm',
      bundle: 'Preparasyon Konplè IRU — Tou De Fòm (Pakè)',
      secondForm: 'Sipleman Dezyèm Fòm IRU',
    },
    scopes: {
      evaluation: 'Yon evalyasyon inisyal limite: kategori laj twou preparasyon ak enfòmasyon ki manke nan ka ou, sa preparasyon konplè ta ajoute, ak pwochen etap ou. Li pa gen pwosesis preparasyon konplè a oswa okenn fòm prepare.',
      oneForm: 'Preparasyon konplè YON fòm ou chwazi — Fòm I-589 oswa Fòm I-765 — kòm yon PDF BOUYON ou ka revize, ak koreksyon ak rejenerasyon ak yon rezime konplezyon. Li gen ladan pemman evalyasyon $1.00 ou a kòm yon kredi.',
      bundle: 'Preparasyon konplè TOU DE fòm yo, I-589 ak I-765, chak kòm yon PDF BOUYON ou ka revize, ak koreksyon ak rejenerasyon ak rezime konplezyon. Li gen ladan pemman evalyasyon $1.00 ou a kòm yon kredi.',
      secondForm: 'Ajoute preparasyon dezyèm fòm nan (sa acha yon sèl fòm ou a pa kouvri) sou menm kondisyon yo: PDF BOUYON ou ka revize, koreksyon ak rejenerasyon, rezime konplezyon. Apre acha sa a, total ou peye a se $129.95 — menm jan ak pakè de fòm nan.',
    },
    creditedToward: 'nenpòt acha konplè',
    formsIncludedOne: 'egzakteman yon fòm — Fòm I-589 OSWA Fòm I-765, chwa ou',
    formsIncludedBundle: 'tou de fòm yo — Fòm I-589 AK Fòm I-765',
    savingsNote: (separate, one, bundle, savings) => `Achte tou de fòm yo separeman ta koute ${separate} (2 × ${one}). Pakè a koute ${bundle} — yon ekonomi ${savings}.`,
    disclosures: [
      'Tout pri yo se pemman yon sèl fwa an USD. Pa gen abònman, pa gen faktirasyon rekiran, epi pa gen ogmantasyon otomatik.',
      'Pemman evalyasyon $1.00 la kredite nan nenpòt acha konplè, kidonk total ki anwo yo se maksimòm ou ta peye.',
      'IRU prepare fòm BOUYON pou revizyon ou. IRU pa siyen, soumèt, oswa depoze anyen, epi èd nan preparasyon se pa konsèy legal.',
    ],
  },
  AR: {
    names: {
      evaluation: 'التقييم المحدود من IRU',
      oneForm: 'الإعداد الكامل من IRU — نموذج واحد',
      bundle: 'الإعداد الكامل من IRU — كلا النموذجين (حزمة)',
      secondForm: 'إضافة النموذج الثاني من IRU',
    },
    scopes: {
      evaluation: 'تقييم أولي محدود: الفئات الواسعة لفجوات الإعداد والمعلومات المفقودة في قضيتك، وما سيضيفه الإعداد الكامل، وخطوتك التالية. لا يتضمن سير عمل الجاهزية الكامل أو أي نموذج معدّ.',
      oneForm: 'الإعداد الكامل لنموذج واحد تختاره — نموذج I-589 أو نموذج I-765 — كملف PDF مسودة قابل للمراجعة، مع التصحيحات وإعادة الإنشاء وملخص الإكمال. يتضمن دفعة التقييم بقيمة 1.00 دولار كرصيد.',
      bundle: 'الإعداد الكامل لكلا النموذجين I-589 وI-765، كل منهما كملف PDF مسودة قابل للمراجعة، مع التصحيحات وإعادة الإنشاء وملخصات الإكمال. يتضمن دفعة التقييم بقيمة 1.00 دولار كرصيد.',
      secondForm: 'يضيف إعداد النموذج الثاني (غير المشمول بشراء النموذج الواحد) بنفس الشروط: ملف PDF مسودة قابل للمراجعة، تصحيحات وإعادة إنشاء، ملخص إكمال. بعد هذا الشراء يصبح مجموع ما دفعته 129.95 دولار — وهو نفس سعر حزمة النموذجين.',
    },
    creditedToward: 'أي شراء كامل',
    formsIncludedOne: 'نموذج واحد بالضبط — نموذج I-589 أو نموذج I-765، باختيارك',
    formsIncludedBundle: 'كلا النموذجين — نموذج I-589 ونموذج I-765',
    savingsNote: (separate, one, bundle, savings) => `شراء كلا النموذجين بشكل منفصل سيكلف ${separate} (2 × ${one}). تكلفة الحزمة هي ${bundle} — توفير قدره ${savings}.`,
    disclosures: [
      'جميع الأسعار مدفوعات لمرة واحدة بالدولار الأمريكي. لا يوجد اشتراك ولا فوترة متكررة ولا ترقية تلقائية.',
      'تُحتسب دفعة التقييم بقيمة 1.00 دولار نحو أي شراء كامل، لذا فإن الإجماليات أعلاه هي الحد الأقصى الذي ستدفعه.',
      'تُعدّ IRU نماذج مسودة لمراجعتك. لا تقوم IRU بتوقيع أو تقديم أو إرسال أي شيء، ومساعدة الإعداد ليست مشورة قانونية.',
    ],
  },
};

function offerStrings(lang) {
  return OFFER_I18N[lang] || OFFER_I18N.EN;
}

/**
 * The offer exactly as it must be shown BEFORE the initial payment:
 * both complete-purchase options, their scope, and their TOTAL prices,
 * alongside the $1 evaluation entry. Pure function of PRICING.
 */
export function buildOffer(lang = 'EN') {
  const s = offerStrings(lang);
  const names = s.names || {};
  const scopes = s.scopes || {};
  return {
    currency: 'usd',
    evaluation: {
      sku: PRICING.evaluation.sku,
      price: formatCents(PRICING.evaluation.chargeCents),
      chargeCents: PRICING.evaluation.chargeCents,
      creditedToward: s.creditedToward,
      name: names.evaluation || PRICING.evaluation.name,
      scope: scopes.evaluation || PRICING.evaluation.scope,
    },
    options: [
      {
        sku: PRICING.oneForm.sku,
        kind: 'one-form',
        totalPrice: formatCents(PRICING.oneForm.totalCents),
        totalCents: PRICING.oneForm.totalCents,
        afterEvaluationCharge: formatCents(PRICING.oneForm.chargeCents),
        afterEvaluationChargeCents: PRICING.oneForm.chargeCents,
        name: names.oneForm || PRICING.oneForm.name,
        scope: scopes.oneForm || PRICING.oneForm.scope,
        formsIncluded: s.formsIncludedOne,
      },
      {
        sku: PRICING.bundle.sku,
        kind: 'bundle',
        totalPrice: formatCents(PRICING.bundle.totalCents),
        totalCents: PRICING.bundle.totalCents,
        afterEvaluationCharge: formatCents(PRICING.bundle.chargeCents),
        afterEvaluationChargeCents: PRICING.bundle.chargeCents,
        name: names.bundle || PRICING.bundle.name,
        scope: scopes.bundle || PRICING.bundle.scope,
        formsIncluded: s.formsIncludedBundle,
        savingsNote: s.savingsNote(formatCents(PRICING.bundle.separateTotalCents), formatCents(PRICING.oneForm.totalCents), formatCents(PRICING.bundle.totalCents), formatCents(PRICING.bundle.savingsCents)),
      },
    ],
    secondFormAddon: {
      sku: PRICING.secondForm.sku,
      price: formatCents(PRICING.secondForm.chargeCents),
      chargeCents: PRICING.secondForm.chargeCents,
      resultingTotal: formatCents(PRICING.secondForm.totalCents),
      name: names.secondForm || PRICING.secondForm.name,
      scope: scopes.secondForm || PRICING.secondForm.scope,
    },
    disclosures: [...s.disclosures],
  };
}

/** Resolve a purchasable SKU to its pricing row. Null for unknown SKUs. */
export function pricingForSku(sku) {
  for (const row of Object.values(PRICING)) {
    if (row.sku === sku) return row;
  }
  return null;
}
