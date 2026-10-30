/**
 * src/paywall.tsx — Build A buyer journey UI (Phase 2).
 *
 * Stages: ENTRY → GUIDE → PACKAGES → CHECKOUT → (Stripe) → EVAL_INTAKE → EVAL_REPORT
 *         ENTRY → RECOVER (email → reissued token)
 *
 * Active only when VITE_PAYWALL_ENABLED=true. The production build
 * (flag off) never renders these components.
 *
 * D4 boundaries (non-negotiable): form suggestions are "commonly
 * associated with," never "required" or "you qualify." Every guidance
 * screen carries the not-legal-advice disclaimer. Same framing in all
 * 5 languages.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Labels (5 languages). Muse self-verified via back-translation;
// owner does not read non-English strings (directive 2026-10-27).
// ---------------------------------------------------------------------------

type Lang = 'EN' | 'ES' | 'ZH' | 'HT' | 'AR';

export const PAYWALL_LABELS: Record<string, Record<Lang, string>> = {
  // Entry
  entryTitle: {
    EN: 'Prepare your immigration forms',
    ES: 'Prepare sus formularios de inmigración',
    ZH: '准备您的移民表格',
    HT: 'Prepare fòmilè imigrasyon ou yo',
    AR: 'جهّز نماذج الهجرة الخاصة بك',
  },
  entrySubtitle: {
    EN: 'IRU helps you organize your information and prepare review-ready drafts. It is not a law firm and provides no legal advice.',
    ES: 'IRU le ayuda a organizar su información y preparar borradores listos para revisión. No es un bufete de abogados y no brinda asesoramiento legal.',
    ZH: 'IRU 帮助您整理信息并准备可供审核的草稿。它不是律师事务所，不提供法律建议。',
    HT: 'IRU ede ou òganize enfòmasyon ou epi prepare bouyon ki pare pou revizyon. Li pa yon kabinè avoka epi li pa bay konsèy legal.',
    AR: 'يساعدك IRU في تنظيم معلوماتك وإعداد مسودات جاهزة للمراجعة. وهو ليس مكتب محاماة ولا يقدم استشارات قانونية.',
  },
  entryFindForms: {
    EN: 'Find which forms fit me',
    ES: 'Descubrir qué formularios me corresponden',
    ZH: '查找适合我的表格',
    HT: 'Chèche ki fòm ki bon pou mwen',
    AR: 'اكتشف النماذج المناسبة لي',
  },
  entryFindFormsDesc: {
    EN: 'Answer 3 quick questions — we’ll suggest commonly relevant forms.',
    ES: 'Responda 3 preguntas rápidas — le sugeriremos formularios comúnmente relevantes.',
    ZH: '回答3个快速问题——我们将推荐通常相关的表格。',
    HT: 'Reponn 3 kesyon rapid — n ap sijere fòm ki souvan enpòtan.',
    AR: 'أجب عن 3 أسئلة سريعة — وسنقترح النماذج الشائعة الصلة.',
  },
  entryKnowNeeded: {
    EN: 'I know what I need',
    ES: 'Sé lo que necesito',
    ZH: '我知道我需要什么',
    HT: 'M konnen sa m bezwen',
    AR: 'أعرف ما أحتاج إليه',
  },
  entryKnowNeededDesc: {
    EN: 'Go straight to package selection.',
    ES: 'Vaya directamente a la selección del paquete.',
    ZH: '直接进入套餐选择。',
    HT: 'Ale dwat nan chwa pake a.',
    AR: 'انتقل مباشرة إلى اختيار الباقة.',
  },
  entryRecover: {
    EN: 'I already purchased — recover access',
    ES: 'Ya compré — recuperar acceso',
    ZH: '我已购买——恢复访问',
    HT: 'M te deja achte — reprann aksè',
    AR: 'لقد اشتريت بالفعل — استعادة الوصول',
  },
  entryRecoverDesc: {
    EN: 'Lost your access token? Get a new one by email.',
    ES: '¿Perdió su token de acceso? Obtenga uno nuevo por correo electrónico.',
    ZH: '丢失了访问令牌？通过电子邮件获取新的令牌。',
    HT: 'Ou pèdi token aksè ou? Jwenn yon nouvo pa imèl.',
    AR: 'فقدت رمز الوصول؟ احصل على رمز جديد عبر البريد الإلكتروني.',
  },

  // Guidance
  guideTitle: {
    EN: 'Which forms might fit your situation',
    ES: 'Qué formularios podrían corresponder a su situación',
    ZH: '哪些表格可能适合您的情况',
    HT: 'Ki fòm ki ta ka bon pou sitiyasyon ou',
    AR: 'النماذج التي قد تناسب حالتك',
  },
  guideDisclaimer: {
    EN: 'General information only — not legal advice. IRU does not determine eligibility or make legal decisions.',
    ES: 'Solo información general — no es asesoramiento legal. IRU no determina elegibilidad ni toma decisiones legales.',
    ZH: '仅为一般信息——不是法律建议。IRU 不确定资格，也不做法律决定。',
    HT: 'Enfòmasyon jeneral sèlman — pa konsèy legal. IRU pa detèmine elijiblite ni pran desizyon legal.',
    AR: 'معلومات عامة فقط — ليست استشارة قانونية. لا يحدد IRU الأهلية ولا يتخذ قرارات قانونية.',
  },
  guideQ1: {
    EN: 'What brings you here today?',
    ES: '¿Qué le trae hoy?',
    ZH: '您今天来是为了什么？',
    HT: 'Kisa ki mennen ou isit la jodi a?',
    AR: 'ما الذي جاء بك اليوم؟',
  },
  guideQ1Protection: {
    EN: 'Seeking protection in the U.S.',
    ES: 'Busco protección en EE. UU.',
    ZH: '在美国寻求保护',
    HT: 'Chèche pwoteksyon nan Etazini',
    AR: 'طلب الحماية في الولايات المتحدة',
  },
  guideQ1Work: {
    EN: 'Work authorization',
    ES: 'Autorización de trabajo',
    ZH: '工作许可',
    HT: 'Otorizasyon travay',
    AR: 'تصريح العمل',
  },
  guideQ1Both: {
    EN: 'Both protection and work authorization',
    ES: 'Protección y autorización de trabajo',
    ZH: '保护和工作许可',
    HT: 'Pwoteksyon ak otorizasyon travay',
    AR: 'الحماية وتصريح العمل معًا',
  },
  guideQ1Unsure: {
    EN: 'Not sure yet',
    ES: 'Aún no estoy seguro',
    ZH: '还不确定',
    HT: 'M pa sèten toujou',
    AR: 'لست متأكدًا بعد',
  },
  guideQ2: {
    EN: 'Have you filed any immigration forms before?',
    ES: '¿Ha presentado formularios de inmigración antes?',
    ZH: '您以前提交过移民表格吗？',
    HT: 'Èske ou te deja ranpli fòm imigrasyon anvan?',
    AR: 'هل قدمت نماذج هجرة من قبل؟',
  },
  guideQ2No: { EN: 'No, this is my first time', ES: 'No, es mi primera vez', ZH: '没有，这是第一次', HT: 'Non, se premye fwa m', AR: 'لا، هذه أول مرة' },
  guideQ2Yes: { EN: 'Yes, I have filed before', ES: 'Sí, he presentado antes', ZH: '是的，以前提交过', HT: 'Wi, m te ranpli anvan', AR: 'نعم، قدمت من قبل' },
  guideQ2Unsure: { EN: 'Not sure', ES: 'No estoy seguro', ZH: '不确定', HT: 'M pa sèten', AR: 'لست متأكدًا' },
  guideQ3: {
    EN: 'Do you currently have work authorization?',
    ES: '¿Tiene actualmente autorización de trabajo?',
    ZH: '您目前有工作许可吗？',
    HT: 'Èske ou gen otorizasyon travay kounye a?',
    AR: 'هل لديك تصريح عمل حاليًا؟',
  },
  guideYes: { EN: 'Yes', ES: 'Sí', ZH: '是', HT: 'Wi', AR: 'نعم' },
  guideNo: { EN: 'No', ES: 'No', ZH: '否', HT: 'Non', AR: 'لا' },
  guideUnsure: { EN: 'Not sure', ES: 'No estoy seguro', ZH: '不确定', HT: 'M pa sèten', AR: 'لست متأكدًا' },

  guideResultTitle: {
    EN: 'Forms commonly associated with your situation',
    ES: 'Formularios comúnmente asociados con su situación',
    ZH: '与您的情况通常相关的表格',
    HT: 'Fòm ki souvan asosye ak sitiyasyon ou',
    AR: 'النماذج الشائعة الارتباط بحالتك',
  },
  guideResultNote: {
    EN: 'These are commonly relevant — not a determination that you qualify or must file. A qualified attorney or accredited representative can advise your specific case.',
    ES: 'Estos son comúnmente relevantes — no es una determinación de que usted califica o debe presentar. Un abogado calificado o representante acreditado puede asesorar su caso específico.',
    ZH: '这些通常相关——并不确定您符合资格或必须提交。合格的律师或认可代表可以为您的具体案件提供建议。',
    HT: 'Sa yo souvan enpòtan — se pa yon detèminasyon ke ou kalifye oswa dwe ranpli. Yon avoka kalifye oswa reprezantan akredite ka konseye ka espesifik ou.',
    AR: 'هذه النماذج شائعة الصلة — وليست قرارًا بأنك مؤهل أو يجب عليك التقديم. يمكن لمحامٍ مؤهل أو ممثل معتمد تقديم المشورة لحالتك الخاصة.',
  },
  form589Name: { EN: 'I-589', ES: 'I-589', ZH: 'I-589', HT: 'I-589', AR: 'I-589' },
  form589Desc: {
    EN: 'Application for Asylum and for Withholding of Removal — for people seeking protection in the U.S.',
    ES: 'Solicitud de asilo y de suspensión de expulsión — para personas que buscan protección en EE. UU.',
    ZH: '庇护和暂缓递解申请——适用于在美国寻求保护的人。',
    HT: 'Demann Azil ak pou Kanpe Depòtasyon — pou moun k ap chèche pwoteksyon nan Etazini.',
    AR: 'طلب اللجوء ووقف الترحيل — للأشخاص الذين يطلبون الحماية في الولايات المتحدة.',
  },
  form765Name: { EN: 'I-765', ES: 'I-765', ZH: 'I-765', HT: 'I-765', AR: 'I-765' },
  form765Desc: {
    EN: 'Application for Employment Authorization — to request permission to work legally in the U.S.',
    ES: 'Solicitud de autorización de empleo — para solicitar permiso para trabajar legalmente en EE. UU.',
    ZH: '就业许可申请——申请在美国合法工作的许可。',
    HT: 'Demann Otorizasyon Travay — pou mande pèmisyon travay legalman nan Etazini.',
    AR: 'طلب تصريح العمل — لطلب إذن للعمل بشكل قانوني في الولايات المتحدة.',
  },
  guideContinue: {
    EN: 'Continue to packages',
    ES: 'Continuar a los paquetes',
    ZH: '继续查看套餐',
    HT: 'Kontinye nan pake yo',
    AR: 'المتابعة إلى الباقات',
  },
  guideBack: {
    EN: 'Back',
    ES: 'Atrás',
    ZH: '返回',
    HT: 'Tounen',
    AR: 'رجوع',
  },
};

export function pt(key: string, lang: Lang): string {
  const entry = PAYWALL_LABELS[key];
  if (!entry) return key;
  return entry[lang] || entry.EN;
}

// ---------------------------------------------------------------------------
// Token storage (localStorage per D2; server remains authoritative)
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'iru_entitlement_token';
const EVAL_TOKEN_KEY = 'iru_evaluation_token';
const FORM_TOKENS_KEY = 'iru_form_tokens';

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function getStoredToken(): string | null { return safeGet(TOKEN_KEY); }
export function setStoredToken(token: string): void { safeSet(TOKEN_KEY, token); }
export function getEvalToken(): string | null { return safeGet(EVAL_TOKEN_KEY); }
export function setEvalToken(token: string): void { safeSet(EVAL_TOKEN_KEY, token); }
export function getFormTokens(): Record<string, string> {
  try { return JSON.parse(safeGet(FORM_TOKENS_KEY) || '{}'); } catch { return {}; }
}
export function setFormToken(formId: string, token: string): void {
  const map = getFormTokens();
  map[formId] = token;
  safeSet(FORM_TOKENS_KEY, JSON.stringify(map));
  safeSet(TOKEN_KEY, token);
}
export function clearTokens(): void {
  safeRemove(TOKEN_KEY); safeRemove(EVAL_TOKEN_KEY); safeRemove(FORM_TOKENS_KEY);
}

// ---------------------------------------------------------------------------
// Guidance logic (pure — testable without React)
// ---------------------------------------------------------------------------

export type GuideAnswers = { q1: string; q2: string; q3: string };

export function suggestForms(a: GuideAnswers): string[] {
  const forms: string[] = [];
  if (a.q1 === 'protection' || a.q1 === 'both' || a.q1 === 'unsure') forms.push('I-589');
  if (a.q1 === 'work' || a.q1 === 'both' || a.q1 === 'unsure') forms.push('I-765');
  return forms;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

type Props = { lang: Lang; onNavigate: (stage: string, data?: any) => void };

function Disclaimer({ lang }: { lang: Lang }) {
  return (
    <p className="text-xs text-slate-500 italic mt-4 max-w-xl mx-auto text-center">
      {pt('guideDisclaimer', lang)}
    </p>
  );
}

export function EntryScreen({ lang, onNavigate }: Props) {
  const card = 'w-full text-left border-2 border-slate-200 rounded-2xl p-5 hover:border-indigo-400 hover:bg-indigo-50 transition-colors';
  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-serif font-bold text-slate-900 text-center mb-2">{pt('entryTitle', lang)}</h1>
      <p className="text-sm text-slate-600 text-center mb-8 max-w-lg mx-auto">{pt('entrySubtitle', lang)}</p>
      <div className="space-y-4">
        <button className={card} onClick={() => onNavigate('GUIDE')}>
          <div className="font-semibold text-indigo-700 text-base">{pt('entryFindForms', lang)}</div>
          <div className="text-sm text-slate-600 mt-1">{pt('entryFindFormsDesc', lang)}</div>
        </button>
        <button className={card} onClick={() => onNavigate('PACKAGES', { forms: ['I-589', 'I-765'] })}>
          <div className="font-semibold text-indigo-700 text-base">{pt('entryKnowNeeded', lang)}</div>
          <div className="text-sm text-slate-600 mt-1">{pt('entryKnowNeededDesc', lang)}</div>
        </button>
        <button className={card} onClick={() => onNavigate('RECOVER')}>
          <div className="font-semibold text-indigo-700 text-base">{pt('entryRecover', lang)}</div>
          <div className="text-sm text-slate-600 mt-1">{pt('entryRecoverDesc', lang)}</div>
        </button>
      </div>
      <Disclaimer lang={lang} />
    </div>
  );
}

export function GuideFlow({ lang, onNavigate }: Props) {
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState<GuideAnswers>({ q1: '', q2: '', q3: '' });

  const questions = [
    { key: 'q1', label: pt('guideQ1', lang), options: [
      { v: 'protection', l: pt('guideQ1Protection', lang) },
      { v: 'work', l: pt('guideQ1Work', lang) },
      { v: 'both', l: pt('guideQ1Both', lang) },
      { v: 'unsure', l: pt('guideQ1Unsure', lang) },
    ]},
    { key: 'q2', label: pt('guideQ2', lang), options: [
      { v: 'no', l: pt('guideQ2No', lang) },
      { v: 'yes', l: pt('guideQ2Yes', lang) },
      { v: 'unsure', l: pt('guideQ2Unsure', lang) },
    ]},
    { key: 'q3', label: pt('guideQ3', lang), options: [
      { v: 'yes', l: pt('guideYes', lang) },
      { v: 'no', l: pt('guideNo', lang) },
      { v: 'unsure', l: pt('guideUnsure', lang) },
    ]},
  ];

  if (step >= questions.length) {
    const forms = suggestForms(answers);
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <h2 className="text-xl font-serif font-bold text-slate-900 text-center mb-4">{pt('guideResultTitle', lang)}</h2>
        <div className="space-y-3 mb-4">
          {forms.map((f) => (
            <div key={f} className="border-2 border-indigo-200 bg-indigo-50 rounded-2xl p-4">
              <div className="font-bold text-indigo-800">{pt(f === 'I-589' ? 'form589Name' : 'form765Name', lang)}</div>
              <div className="text-sm text-slate-700 mt-1">{pt(f === 'I-589' ? 'form589Desc' : 'form765Desc', lang)}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-600 mb-6 text-center max-w-lg mx-auto">{pt('guideResultNote', lang)}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => setStep(0)} className="px-5 py-2.5 border-2 border-slate-300 text-slate-700 text-sm font-semibold rounded-xl">
            {pt('guideBack', lang)}
          </button>
          <button onClick={() => onNavigate('PACKAGES', { forms })} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">
            {pt('guideContinue', lang)}
          </button>
        </div>
        <Disclaimer lang={lang} />
      </div>
    );
  }

  const q = questions[step];
  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h2 className="text-xl font-serif font-bold text-slate-900 text-center mb-2">{pt('guideTitle', lang)}</h2>
      <p className="text-xs text-slate-500 text-center mb-6">{step + 1} / {questions.length}</p>
      <p className="text-base font-semibold text-slate-800 text-center mb-5">{q.label}</p>
      <div className="space-y-3">
        {q.options.map((o) => (
          <button
            key={o.v}
            className="w-full text-left border-2 border-slate-200 rounded-2xl p-4 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-slate-800"
            onClick={() => { setAnswers({ ...answers, [q.key]: o.v }); setStep(step + 1); }}
          >
            {o.l}
          </button>
        ))}
      </div>
      {step > 0 && (
        <div className="text-center mt-6">
          <button onClick={() => setStep(step - 1)} className="text-sm text-slate-500 underline">{pt('guideBack', lang)}</button>
        </div>
      )}
      <Disclaimer lang={lang} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Additional labels for packages, eval, recovery
// ---------------------------------------------------------------------------

Object.assign(PAYWALL_LABELS, {
  pkgTitle: {
    EN: 'Choose your preparation package',
    ES: 'Elija su paquete de preparación',
    ZH: '选择您的准备套餐',
    HT: 'Chwazi pake preparasyon ou',
    AR: 'اختر باقة التحضير',
  },
  pkgSubtitle: {
    EN: 'One-time charges in USD. No subscription. Your $1.00 evaluation is credited in full toward complete preparation.',
    ES: 'Cargos únicos en USD. Sin suscripción. Su $1.00 de evaluación se acredita en su totalidad para la preparación completa.',
    ZH: '一次性 USD 收费。无订阅。您的 $1.00 评估费将全额抵扣完整准备费用。',
    HT: 'Peman yon sèl fwa an USD. Pa gen abònman. $1.00 evalyasyon ou an kredite nèt pou preparasyon konplè.',
    AR: 'رسوم لمرة واحدة بالدولار الأمريكي. بدون اشتراك. يتم خصم مبلغ التقييم البالغ 1.00 دولار بالكامل من التحضير الكامل.',
  },
  pkgEvalName: { EN: 'Limited Evaluation', ES: 'Evaluación limitada', ZH: '有限评估', HT: 'Evalyasyon limite', AR: 'تقييم محدود' },
  pkgEvalDesc: {
    EN: 'A Readiness Snapshot: which forms are commonly relevant, 6 readiness areas rated, and a document checklist to start gathering.',
    ES: 'Un panorama de preparación: qué formularios son comúnmente relevantes, 6 áreas de preparación calificadas y una lista de documentos.',
    ZH: '准备情况快照：通常相关的表格、6 个准备领域的评级，以及开始收集的文件清单。',
    HT: 'Yon Apèsi Preparasyon: ki fòm ki souvan enpòtan, 6 domèn preparasyon note, ak yon lis dokiman pou kòmanse rasanble.',
    AR: 'لمحة عن الاستعداد: النماذج الشائعة الصلة، وتقييم 6 مجالات استعداد، وقائمة مستندات للبدء في جمعها.',
  },
  pkgOneFormName: { EN: 'Complete — One Form', ES: 'Completa — Un formulario', ZH: '完整——一份表格', HT: 'Konplè — Yon Fòm', AR: 'كاملة — نموذج واحد' },
  pkgOneFormDesc: {
    EN: 'Full preparation for one form: detailed analysis, evidence review, and a review-ready draft.',
    ES: 'Preparación completa para un formulario: análisis detallado, revisión de evidencia y un borrador listo para revisión.',
    ZH: '一份表格的完整准备：详细分析、证据审查和可供审核的草稿。',
    HT: 'Preparasyon konplè pou yon fòm: analiz detaye, revizyon prèv, ak yon bouyon ki pare pou revizyon.',
    AR: 'تحضير كامل لنموذج واحد: تحليل مفصل ومراجعة الأدلة ومسودة جاهزة للمراجعة.',
  },
  pkgBundleName: { EN: 'Complete — Both Forms', ES: 'Completa — Ambos formularios', ZH: '完整——两份表格', HT: 'Konplè — Toude Fòm', AR: 'كاملة — النموذجان' },
  pkgBundleDesc: {
    EN: 'Full preparation for both forms, with detailed analysis and review-ready drafts for each.',
    ES: 'Preparación completa para ambos formularios, con análisis detallado y borradores listos para revisión.',
    ZH: '两份表格的完整准备，每份都有详细分析和可供审核的草稿。',
    HT: 'Preparasyon konplè pou toude fòm yo, ak analiz detaye ak bouyon ki pare pou revizyon.',
    AR: 'تحضير كامل للنموذجين، مع تحليل مفصل ومسودات جاهزة للمراجعة لكل منهما.',
  },
  pkgBundleSave: {
    EN: 'Save $49.95 vs two one-form purchases',
    ES: 'Ahorre $49.95 vs dos compras individuales',
    ZH: '比单独购买两份节省 $49.95',
    HT: 'Ekonomize $49.95 konpare ak de acha separe',
    AR: 'وفّر 49.95 دولارًا مقارنة بشراء نموذجين منفصلين',
  },
  pkgChoose: {
    EN: 'Choose', ES: 'Elegir', ZH: '选择', HT: 'Chwazi', AR: 'اختر',
  },
  pkgTotal: {
    EN: 'total', ES: 'total', ZH: '总计', HT: 'total', AR: 'الإجمالي',
  },
  pkgCreditNote: {
    EN: 'Your $1.00 evaluation credit applies — you pay the difference.',
    ES: 'Su crédito de $1.00 aplica — usted paga la diferencia.',
    ZH: '您的 $1.00 评估抵扣适用——您只需支付差额。',
    HT: 'Kredi $1.00 evalyasyon ou an aplike — ou peye diferans lan.',
    AR: 'يُطبق رصيد التقييم البالغ 1.00 دولار — تدفع الفرق فقط.',
  },
  pkgBack: {
    EN: 'Back', ES: 'Atrás', ZH: '返回', HT: 'Tounen', AR: 'رجوع',
  },

  // Eval intake
  evalIntakeTitle: {
    EN: 'Your Readiness Snapshot — 6 quick questions',
    ES: 'Su panorama de preparación — 6 preguntas rápidas',
    ZH: '您的准备情况快照——6 个快速问题',
    HT: 'Apèsi Preparasyon ou — 6 kesyon rapid',
    AR: 'لمحة الاستعداد — 6 أسئلة سريعة',
  },
  evalIntakeIntro: {
    EN: 'Answer each question honestly. Your snapshot rates 6 broad areas — it’s a starting point, not a final judgment.',
    ES: 'Responda cada pregunta con honestidad. Su panorama califica 6 áreas amplias — es un punto de partida, no un juicio final.',
    ZH: '请如实回答每个问题。您的快照将评估 6 个广泛领域——这是一个起点，而非最终判断。',
    HT: 'Reponn chak kesyon onètman. Apèsi ou a note 6 gwo domèn — se yon pwen depa, pa yon jijman final.',
    AR: 'أجب عن كل سؤال بصدق. تقيّم لمحتك 6 مجالات واسعة — إنها نقطة بداية وليست حكمًا نهائيًا.',
  },
  evalYes: { EN: 'Yes', ES: 'Sí', ZH: '是', HT: 'Wi', AR: 'نعم' },
  evalPartial: { EN: 'Partially', ES: 'Parcialmente', ZH: '部分', HT: 'An pati', AR: 'جزئيًا' },
  evalNo: { EN: 'No', ES: 'No', ZH: '否', HT: 'Non', AR: 'لا' },
  evalSeeReport: {
    EN: 'See my snapshot', ES: 'Ver mi panorama', ZH: '查看我的快照', HT: 'Wè apèsi mwen', AR: 'عرض لمحتي',
  },

  // Eval report
  evalReportTitle: {
    EN: 'Your Readiness Snapshot',
    ES: 'Su panorama de preparación',
    ZH: '您的准备情况快照',
    HT: 'Apèsi Preparasyon ou',
    AR: 'لمحة الاستعداد الخاصة بك',
  },
  evalReportForms: {
    EN: 'Forms commonly relevant to you',
    ES: 'Formularios comúnmente relevantes para usted',
    ZH: '与您通常相关的表格',
    HT: 'Fòm ki souvan enpòtan pou ou',
    AR: 'النماذج الشائعة الصلة بك',
  },
  evalReportAreas: {
    EN: 'Your 6 readiness areas',
    ES: 'Sus 6 áreas de preparación',
    ZH: '您的 6 个准备领域',
    HT: '6 domèn preparasyon ou yo',
    AR: 'مجالات الاستعداد الستة',
  },
  evalStatusReady: { EN: 'Ready', ES: 'Listo', ZH: '就绪', HT: 'Pare', AR: 'جاهز' },
  evalStatusWork: { EN: 'Needs work', ES: 'Necesita trabajo', ZH: '需要改进', HT: 'Bezwen travay', AR: 'يحتاج إلى عمل' },
  evalStatusStart: { EN: 'Not started', ES: 'Sin empezar', ZH: '未开始', HT: 'Poko kòmanse', AR: 'لم يبدأ' },
  evalChecklistTitle: {
    EN: 'Document checklist — start gathering these',
    ES: 'Lista de documentos — comience a reunirlos',
    ZH: '文件清单——开始收集这些',
    HT: 'Lis dokiman — kòmanse rasanble yo',
    AR: 'قائمة المستندات — ابدأ في جمعها',
  },
  evalNotIncluded: {
    EN: 'What’s not in this snapshot',
    ES: 'Lo que no incluye este panorama',
    ZH: '此快照不包括的内容',
    HT: 'Sa apèsi sa a pa gen ladan',
    AR: 'ما لا تشمله هذه اللمحة',
  },
  evalNotIncludedList: {
    EN: 'Detailed findings · Evidence scoring · Completed form drafts · Claim-by-claim analysis',
    ES: 'Hallazgos detallados · Puntuación de evidencia · Borradores completos · Análisis detallado',
    ZH: '详细发现 · 证据评分 · 完整的表格草稿 · 逐项分析',
    HT: 'Konklizyon detaye · Nòt prèv · Bouyon fòm konplè · Analiz detaye',
    AR: 'نتائج مفصلة · تقييم الأدلة · مسودات نماذج مكتملة · تحليل مفصّل',
  },
  evalUpgradeTitle: {
    EN: 'Want the complete picture?',
    ES: '¿Quiere el panorama completo?',
    ZH: '想要完整的情况？',
    HT: 'Ou vle tout pòtre a?',
    AR: 'هل تريد الصورة الكاملة؟',
  },
  evalUpgradeDesc: {
    EN: 'Complete preparation adds detailed analysis, evidence review, and review-ready drafts for your forms.',
    ES: 'La preparación completa agrega análisis detallado, revisión de evidencia y borradores listos para revisión.',
    ZH: '完整准备包括详细分析、证据审查和可供审核的表格草稿。',
    HT: 'Preparasyon konplè ajoute analiz detaye, revizyon prèv, ak bouyon ki pare pou revizyon.',
    AR: 'يضيف التحضير الكامل تحليلًا مفصلًا ومراجعة للأدلة ومسودات جاهزة للمراجعة.',
  },
  evalUpgradeCta: {
    EN: 'See complete preparation options',
    ES: 'Ver opciones de preparación completa',
    ZH: '查看完整准备选项',
    HT: 'Wè opsyon preparasyon konplè',
    AR: 'عرض خيارات التحضير الكامل',
  },
  evalDone: {
    EN: 'Done — my snapshot is saved in this browser',
    ES: 'Listo — mi panorama está guardado en este navegador',
    ZH: '完成——我的快照已保存在此浏览器中',
    HT: 'Fini — apèsi mwen an sove nan navigatè sa a',
    AR: 'تم — تم حفظ لمحتي في هذا المتصفح',
  },

  // Recovery
  recoverTitle: {
    EN: 'Recover your access',
    ES: 'Recupere su acceso',
    ZH: '恢复您的访问',
    HT: 'Reprann aksè ou',
    AR: 'استعادة الوصول',
  },
  recoverDesc: {
    EN: 'Enter the email you used at purchase. We’ll issue a new access token — your old one stops working.',
    ES: 'Ingrese el correo que usó al comprar. Emitiremos un nuevo token — el anterior dejará de funcionar.',
    ZH: '输入您购买时使用的电子邮件。我们将发放新的访问令牌——旧令牌将失效。',
    HT: 'Antre imèl ou te itilize lè ou te achte a. N ap bay yon nouvo token — ansyen an ap sispann mache.',
    AR: 'أدخل البريد الإلكتروني الذي استخدمته عند الشراء. سنصدر رمز وصول جديد — وسيتوقف القديم عن العمل.',
  },
  recoverEmailLabel: {
    EN: 'Email address', ES: 'Correo electrónico', ZH: '电子邮件地址', HT: 'Adrès imèl', AR: 'عنوان البريد الإلكتروني',
  },
  recoverSubmit: {
    EN: 'Send me a new token', ES: 'Enviarme un nuevo token', ZH: '向我发送新令牌', HT: 'Voye yon nouvo token ban mwen', AR: 'أرسل لي رمزًا جديدًا',
  },
  recoverBack: {
    EN: 'Back to start', ES: 'Volver al inicio', ZH: '返回开始', HT: 'Tounen nan kòmansman', AR: 'العودة إلى البداية',
  },
  recoverSending: {
    EN: 'Sending…', ES: 'Enviando…', ZH: '发送中…', HT: 'Ap voye…', AR: 'جارٍ الإرسال…',
  },
  recoverOk: {
    EN: 'A new token was issued. Check your email — your old token no longer works.',
    ES: 'Se emitió un nuevo token. Revise su correo — el anterior ya no funciona.',
    ZH: '已发放新令牌。请查收电子邮件——旧令牌已失效。',
    HT: 'Yo bay yon nouvo token. Tcheke imèl ou — ansyen an pa mache ankò.',
    AR: 'تم إصدار رمز جديد. تحقق من بريدك الإلكتروني — الرمز القديم لم يعد يعمل.',
  },
  recoverFail: {
    EN: 'We couldn’t find a purchase for that email. Check the spelling and try again.',
    ES: 'No encontramos una compra para ese correo. Revise la ortografía e intente de nuevo.',
    ZH: '找不到该电子邮件的购买记录。请检查拼写并重试。',
    HT: 'Nou pa jwenn acha pou imèl sa a. Tcheke òtograf la epi eseye ankò.',
    AR: 'تعذر العثور على عملية شراء لهذا البريد. تحقق من الإملاء وحاول مرة أخرى.',
  },
  recoverNote: {
    EN: 'Email delivery is being connected — if the email doesn’t arrive, your token is safe and you can try again.',
    ES: 'La entrega por correo se está conectando — si el correo no llega, su token está seguro y puede intentarlo de nuevo.',
    ZH: '电子邮件发送正在接通中——如果未收到邮件，您的令牌是安全的，可以重试。',
    HT: 'Livrezon imèl la ap konekte — si imèl la pa rive, token ou an an sekirite epi ou ka eseye ankò.',
    AR: 'جارٍ توصيل البريد الإلكتروني — إذا لم تصل الرسالة، فالرمز الخاص بك آمن ويمكنك المحاولة مرة أخرى.',
  },
});

// Eval readiness areas (6) — questions per area
export const EVAL_AREAS = [
  { id: 'identity', qKey: 'evalQIdentity', whyKey: 'evalWhyIdentity' },
  { id: 'entry', qKey: 'evalQEntry', whyKey: 'evalWhyEntry' },
  { id: 'evidence', qKey: 'evalQEvidence', whyKey: 'evalWhyEvidence' },
  { id: 'statement', qKey: 'evalQStatement', whyKey: 'evalWhyStatement' },
  { id: 'filing', qKey: 'evalQFilin', whyKey: 'evalWhyFiling' },
  { id: 'legal', qKey: 'evalQLegal', whyKey: 'evalWhyLegal' },
];

Object.assign(PAYWALL_LABELS, {
  evalQIdentity: {
    EN: 'Do you have a valid passport, national ID, or birth certificate?',
    ES: '¿Tiene pasaporte válido, identificación nacional o acta de nacimiento?',
    ZH: '您有有效的护照、国民身份证或出生证明吗？',
    HT: 'Èske ou gen yon paspò valab, kat idantite nasyonal, oswa batistè?',
    AR: 'هل لديك جواز سفر ساري أو هوية وطنية أو شهادة ميلاد؟',
  },
  evalWhyIdentity: {
    EN: 'Identity documents are the foundation of every immigration filing.',
    ES: 'Los documentos de identidad son la base de toda solicitud de inmigración.',
    ZH: '身份文件是每份移民申请的基础。',
    HT: 'Dokiman idantite se fondasyon tout demann imigrasyon.',
    AR: 'وثائق الهوية هي أساس كل معاملة هجرة.',
  },
  evalQEntry: {
    EN: 'Do you know your date and manner of entry to the United States?',
    ES: '¿Conoce su fecha y forma de entrada a los Estados Unidos?',
    ZH: '您知道进入美国的日期和方式吗？',
    HT: 'Èske ou konnen dat ak fason ou te antre nan Etazini?',
    AR: 'هل تعرف تاريخ وطريقة دخولك إلى الولايات المتحدة؟',
  },
  evalWhyEntry: {
    EN: 'Entry history affects which forms apply and what evidence you’ll need.',
    ES: 'El historial de entrada afecta qué formularios aplican y qué evidencia necesitará.',
    ZH: '入境历史影响适用哪些表格以及需要哪些证据。',
    HT: 'Istwa antre afekte ki fòm ki aplike ak ki prèv w ap bezwen.',
    AR: 'يؤثر سجل الدخول على النماذج المنطبقة والأدلة التي ستحتاجها.',
  },
  evalQEvidence: {
    EN: 'Do you have documents, photos, or records supporting your case?',
    ES: '¿Tiene documentos, fotos o registros que respalden su caso?',
    ZH: '您有支持您案件的文件、照片或记录吗？',
    HT: 'Èske ou gen dokiman, foto, oswa dosye ki sipòte ka ou?',
    AR: 'هل لديك مستندات أو صور أو سجلات تدعم قضيتك؟',
  },
  evalWhyEvidence: {
    EN: 'Supporting evidence strengthens every type of immigration case.',
    ES: 'La evidencia de apoyo fortalece todo tipo de caso de inmigración.',
    ZH: '支持性证据能加强各类移民案件。',
    HT: 'Prèv sipò ranfòse tout kalite ka imigrasyon.',
    AR: 'الأدلة الداعمة تقوي كل أنواع قضايا الهجرة.',
  },
  evalQStatement: {
    EN: 'Have you written your story in your own words?',
    ES: '¿Ha escrito su historia con sus propias palabras?',
    ZH: '您用自己的话写下过您的经历吗？',
    HT: 'Èske ou te ekri istwa ou ak pwòp mo ou?',
    AR: 'هل كتبت قصتك بكلماتك الخاصة؟',
  },
  evalWhyStatement: {
    EN: 'A clear personal account is central to most applications.',
    ES: 'Un relato personal claro es central en la mayoría de las solicitudes.',
    ZH: '清晰的个人陈述是大多数申请的核心。',
    HT: 'Yon istwa pèsonèl klè santral nan pifò demann.',
    AR: 'السرد الشخصي الواضح أساسي في معظم الطلبات.',
  },
  evalQFilin: {
    EN: 'Do you know the filing fees and where to file?',
    ES: '¿Conoce las tarifas de presentación y dónde presentar?',
    ZH: '您知道申请费用和提交地点吗？',
    HT: 'Èske ou konnen frè depo ak ki kote pou depoze?',
    AR: 'هل تعرف رسوم التقديم وأين تقدم؟',
  },
  evalWhyFiling: {
    EN: 'Filing logistics prevent costly delays and rejections.',
    ES: 'La logística de presentación evita retrasos y rechazos costosos.',
    ZH: '了解提交流程可避免代价高昂的延误和拒绝。',
    HT: 'Lojistik depo anpeche reta ak rejè ki koute chè.',
    AR: 'معرفة إجراءات التقديم تمنع التأخير والرفض المكلف.',
  },
  evalQLegal: {
    EN: 'Do you have an attorney or accredited representative?',
    ES: '¿Tiene abogado o representante acreditado?',
    ZH: '您有律师或认可代表吗？',
    HT: 'Èske ou gen yon avoka oswa reprezantan akredite?',
    AR: 'هل لديك محامٍ أو ممثل معتمد؟',
  },
  evalWhyLegal: {
    EN: 'Professional guidance is strongly recommended for immigration matters.',
    ES: 'Se recomienda fuertemente la orientación profesional en asuntos de inmigración.',
    ZH: '强烈建议在移民事务中寻求专业指导。',
    HT: 'Yo rekòmande anpil konsèy pwofesyonèl pou zafè imigrasyon.',
    AR: 'يُنصح بشدة بالاستعانة بتوجيه مهني في مسائل الهجرة.',
  },
});

export type EvalAnswers = Record<string, 'yes' | 'partial' | 'no'>;

export function areaStatus(v: 'yes' | 'partial' | 'no'): 'ready' | 'work' | 'start' {
  return v === 'yes' ? 'ready' : v === 'partial' ? 'work' : 'start';
}

// ---------------------------------------------------------------------------
// PackageSelect — 4 cards, server prices (passed in as props from App)
// ---------------------------------------------------------------------------

export type PkgOffer = {
  sku: string; name: string; desc: string; totalCents: number;
  chargeCents: number; savingsNote?: string; forms?: string[];
};

export function PackageSelect({ lang, onNavigate, offers, hasEvalCredit, onCheckout, checkoutBusy }: Props & {
  offers: PkgOffer[]; hasEvalCredit: boolean; onCheckout: (sku: string) => void; checkoutBusy: boolean;
}) {
  const fmt = (c: number) => '$' + (c / 100).toFixed(2);
  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h2 className="text-xl font-serif font-bold text-slate-900 text-center mb-2">{pt('pkgTitle', lang)}</h2>
      <p className="text-xs text-slate-600 text-center mb-6 max-w-lg mx-auto">{pt('pkgSubtitle', lang)}</p>
      {hasEvalCredit && (
        <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-4 text-center">
          {pt('pkgCreditNote', lang)}
        </p>
      )}
      <div className="space-y-4">
        {offers.map((o) => (
          <div key={o.sku} className="border-2 border-slate-200 rounded-2xl p-5">
            <div className="flex justify-between items-start mb-1">
              <div className="font-bold text-slate-900">{o.name}</div>
              <div className="font-bold text-indigo-700">{fmt(o.totalCents)} <span className="text-xs font-normal text-slate-500">{pt('pkgTotal', lang)}</span></div>
            </div>
            <p className="text-sm text-slate-600 mb-2">{o.desc}</p>
            {o.savingsNote && <p className="text-xs text-green-700 font-semibold mb-2">{o.savingsNote}</p>}
            {hasEvalCredit && o.chargeCents < o.totalCents && (
              <p className="text-xs text-slate-500 mb-2">You pay {fmt(o.chargeCents)} — $1.00 credited.</p>
            )}
            <button
              onClick={() => onCheckout(o.sku)}
              disabled={checkoutBusy}
              className="mt-1 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50"
            >
              {pt('pkgChoose', lang)} — {fmt(hasEvalCredit ? o.chargeCents : o.totalCents)}
            </button>
          </div>
        ))}
      </div>
      <div className="text-center mt-6">
        <button onClick={() => onNavigate('ENTRY')} className="text-sm text-slate-500 underline">{pt('pkgBack', lang)}</button>
      </div>
      <Disclaimer lang={lang} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvalIntake — 6 questions → EVAL_REPORT
// ---------------------------------------------------------------------------

export function EvalIntake({ lang, onNavigate }: Props) {
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState<EvalAnswers>({});

  if (step >= EVAL_AREAS.length) {
    onNavigate('EVAL_REPORT', { answers });
    return null;
  }

  const area = EVAL_AREAS[step];
  const opts = [
    { v: 'yes' as const, l: pt('evalYes', lang) },
    { v: 'partial' as const, l: pt('evalPartial', lang) },
    { v: 'no' as const, l: pt('evalNo', lang) },
  ];

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h2 className="text-xl font-serif font-bold text-slate-900 text-center mb-2">{pt('evalIntakeTitle', lang)}</h2>
      <p className="text-xs text-slate-600 text-center mb-6 max-w-lg mx-auto">{pt('evalIntakeIntro', lang)}</p>
      <p className="text-xs text-slate-500 text-center mb-4">{step + 1} / {EVAL_AREAS.length}</p>
      <p className="text-base font-semibold text-slate-800 text-center mb-5">{pt(area.qKey, lang)}</p>
      <div className="space-y-3">
        {opts.map((o) => (
          <button
            key={o.v}
            className="w-full text-left border-2 border-slate-200 rounded-2xl p-4 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-slate-800"
            onClick={() => { setAnswers({ ...answers, [area.id]: o.v }); setStep(step + 1); }}
          >
            {o.l}
          </button>
        ))}
      </div>
      {step > 0 && (
        <div className="text-center mt-6">
          <button onClick={() => setStep(step - 1)} className="text-sm text-slate-500 underline">{pt('guideBack', lang)}</button>
        </div>
      )}
      <Disclaimer lang={lang} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvalReport — the $1 Readiness Snapshot deliverable
// ---------------------------------------------------------------------------

export function EvalReport({ lang, onNavigate, forms, answers }: Props & { forms: string[]; answers: EvalAnswers }) {
  const statusIcon = (s: 'ready' | 'work' | 'start') =>
    s === 'ready' ? '✅' : s === 'work' ? '⚠️' : '❌';
  const statusLabel = (s: 'ready' | 'work' | 'start') =>
    s === 'ready' ? pt('evalStatusReady', lang) : s === 'work' ? pt('evalStatusWork', lang) : pt('evalStatusStart', lang);

  const checklist: Record<string, string[]> = {
    'I-589': ['Passport or national ID', 'Birth certificate', 'Evidence of entry to the U.S.', 'Country-condition evidence', 'Personal declaration (your story)', 'Any police/medical records, if applicable'],
    'I-765': ['Passport-style photo', 'Copy of last EAD (if renewing)', 'I-94 arrival record', 'Government-issued ID'],
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h2 className="text-2xl font-serif font-bold text-slate-900 text-center mb-6">{pt('evalReportTitle', lang)}</h2>

      <h3 className="text-base font-bold text-slate-800 mb-2">{pt('evalReportForms', lang)}</h3>
      <div className="space-y-2 mb-6">
        {forms.map((f) => (
          <div key={f} className="border border-indigo-200 bg-indigo-50 rounded-xl p-3">
            <div className="font-bold text-indigo-800 text-sm">{f}</div>
            <div className="text-xs text-slate-600">{pt(f === 'I-589' ? 'form589Desc' : 'form765Desc', lang)}</div>
          </div>
        ))}
      </div>

      <h3 className="text-base font-bold text-slate-800 mb-2">{pt('evalReportAreas', lang)}</h3>
      <div className="space-y-2 mb-6">
        {EVAL_AREAS.map((a) => {
          const st = areaStatus(answers[a.id] || 'no');
          return (
            <div key={a.id} className="border border-slate-200 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <span>{statusIcon(st)}</span>
                <span className="text-sm font-semibold text-slate-800">{pt(a.qKey, lang)}</span>
              </div>
              <div className="text-xs text-slate-600 ml-7">
                <span className="font-semibold">{statusLabel(st)}</span> — {pt(a.whyKey, lang)}
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="text-base font-bold text-slate-800 mb-2">{pt('evalChecklistTitle', lang)}</h3>
      <ul className="text-sm text-slate-700 list-disc pl-5 mb-6 space-y-1">
        {forms.flatMap((f) => checklist[f] || []).map((item, i) => <li key={i}>{item}</li>)}
      </ul>

      <div className="border border-slate-200 rounded-xl p-3 mb-6 bg-slate-50">
        <div className="text-xs font-bold text-slate-700 mb-1">{pt('evalNotIncluded', lang)}</div>
        <div className="text-xs text-slate-600">{pt('evalNotIncludedList', lang)}</div>
      </div>

      <div className="border-2 border-indigo-200 rounded-2xl p-5 mb-6 text-center">
        <div className="font-bold text-slate-900 mb-1">{pt('evalUpgradeTitle', lang)}</div>
        <p className="text-sm text-slate-600 mb-3">{pt('evalUpgradeDesc', lang)}</p>
        <button
          onClick={() => onNavigate('PACKAGES', { forms, fromEval: true })}
          className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700"
        >
          {pt('evalUpgradeCta', lang)}
        </button>
      </div>

      <p className="text-xs text-slate-500 text-center">{pt('evalDone', lang)}</p>
      <Disclaimer lang={lang} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecoverFlow — email → reissued token
// ---------------------------------------------------------------------------

export function RecoverFlow({ lang, onNavigate }: Props) {
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState('');

  const submit = async () => {
    if (!email.includes('@')) { setError(pt('recoverFail', lang)); return; }
    setBusy(true); setError('');
    try {
      const resp = await fetch('/api/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || !data.token) throw new Error('not-found');
      setStoredToken(data.token);
      setDone(true);
    } catch {
      setError(pt('recoverFail', lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h2 className="text-xl font-serif font-bold text-slate-900 text-center mb-2">{pt('recoverTitle', lang)}</h2>
      <p className="text-sm text-slate-600 text-center mb-6 max-w-lg mx-auto">{pt('recoverDesc', lang)}</p>
      {done ? (
        <div className="border-2 border-green-200 bg-green-50 rounded-2xl p-5 text-center">
          <p className="text-sm text-green-800 font-semibold mb-2">{pt('recoverOk', lang)}</p>
          <p className="text-xs text-slate-500 mb-4">{pt('recoverNote', lang)}</p>
          <button
            onClick={() => onNavigate('ENTRY')}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700"
          >
            {pt('recoverBack', lang)}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">{pt('recoverEmailLabel', lang)}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl p-3 text-slate-800"
              placeholder="you@example.com"
            />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            onClick={submit}
            disabled={busy || !email}
            className="w-full px-5 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? pt('recoverSending', lang) : pt('recoverSubmit', lang)}
          </button>
          <p className="text-xs text-slate-500 text-center">{pt('recoverNote', lang)}</p>
          <div className="text-center">
            <button onClick={() => onNavigate('ENTRY')} className="text-sm text-slate-500 underline">{pt('recoverBack', lang)}</button>
          </div>
        </div>
      )}
      <Disclaimer lang={lang} />
    </div>
  );
}
