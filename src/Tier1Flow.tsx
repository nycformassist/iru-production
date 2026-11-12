// Tier 1 workflow component — guided questionnaire → readiness → staff report
// Supports EN/ES/ZH/HT/AR via the labels map on each question.
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { scoreAssessment, applyIntelligence, buildFactRecord, type ScoredAssessment, type FactRecord } from './tier1-assess';
import PathwayGuidance from './components/PathwayGuidance';
import PathwayStaffPanel from './components/PathwayStaffPanel';
import PathwayCheckoutSummary from './components/PathwayCheckoutSummary';
import { INSTITUTIONAL_MODE, getStaffDestination, markCaseReportSent } from './institutional';
import { buildStaffReportHtml } from './reportEmail';
import { FORMS, getActiveCatalog } from '../api/_lib/catalog.js';
import { pricePurchase } from '../api/_lib/checkout-pricing.js';
// Entitlement tokens live in localStorage (paywall.tsx). Do not read
// sessionStorage for tokens: checkout writes localStorage, and the
// sessionStorage reads below used to find nothing (Gap 7, 2026-11-05).
import { getFormTokens, getReadinessTokens, getStoredToken } from './paywall';

export type Tier1Lang = 'EN' | 'ES' | 'ZH' | 'HT' | 'AR';

export interface Tier1Option {
  value: string;
  labels: Record<string, string>;
}
export interface Tier1Question {
  id: string;
  step: string;
  type: 'text' | 'date' | 'radio' | 'select' | 'repeating_group';
  factId?: string;
  groupId?: string;
  labels: Record<string, string>;
  helpText?: Record<string, string>;
  shortLabel?: string;
  shortLabels?: Record<string, string>;
  options?: Tier1Option[];
  required?: boolean;
  conditionalOn?: { factId: string; operator: 'equals' | 'not_equals'; value: string };
  optionsSource?: string;
}
export interface Tier1Step {
  id: string;
  title: Record<string, string>;
}
export interface Tier1FormInfo {
  formNumber: string;
  title: string;
  titles?: Record<string, string>;
  edition?: string;
  pdfUrl: string;
  instructionsUrl: string;
}

// Repeating group field schemas (labels translated via RG_FIELD_LABELS)
const RG_SCHEMAS: Record<string, { id: string; type: string }[]> = {
  residences: [
    { id: 'street', type: 'text' }, { id: 'city', type: 'text' }, { id: 'state', type: 'text' },
    { id: 'from', type: 'text' }, { id: 'to', type: 'text' },
  ],
  children: [
    { id: 'name', type: 'text' }, { id: 'dob', type: 'date' }, { id: 'country', type: 'text' },
  ],
  employment: [
    { id: 'employer', type: 'text' }, { id: 'title', type: 'text' },
    { id: 'from', type: 'text' }, { id: 'to', type: 'text' },
  ],
  education: [
    { id: 'school', type: 'text' }, { id: 'from', type: 'text' }, { id: 'to', type: 'text' },
  ],
  trips: [
    { id: 'destination', type: 'text' }, { id: 'departure', type: 'date' }, { id: 'return', type: 'date' },
  ],
};

const RG_FIELD_LABELS: Record<string, Record<Tier1Lang, string>> = {
  street: { EN: 'Street address', ES: 'Dirección', ZH: '街道地址', HT: 'Adrès lari', AR: 'عنوان الشارع' },
  city: { EN: 'City', ES: 'Ciudad', ZH: '城市', HT: 'Vil', AR: 'المدينة' },
  state: { EN: 'State', ES: 'Estado', ZH: '州', HT: 'Eta', AR: 'الولاية' },
  from: { EN: 'From (MM/YYYY)', ES: 'Desde (MM/AAAA)', ZH: '开始 (月/年)', HT: 'Depi (MM/AAAA)', AR: 'من (شهر/سنة)' },
  to: { EN: 'To (MM/YYYY or "present")', ES: 'Hasta (MM/AAAA o "actual")', ZH: '至 (月/年或"至今")', HT: 'Jouk (MM/AAAA oswa "kounye a")', AR: 'إلى (شهر/سنة أو "الحاضر")' },
  name: { EN: 'Full name', ES: 'Nombre completo', ZH: '全名', HT: 'Non konplè', AR: 'الاسم الكامل' },
  dob: { EN: 'Date of birth', ES: 'Fecha de nacimiento', ZH: '出生日期', HT: 'Dat nesans', AR: 'تاريخ الميلاد' },
  country: { EN: 'Country of birth', ES: 'País de nacimiento', ZH: '出生国家', HT: 'Peyi nesans', AR: 'بلد الميلاد' },
  employer: { EN: 'Employer name', ES: 'Nombre del empleador', ZH: '雇主名称', HT: 'Non anplwayè', AR: 'اسم صاحب العمل' },
  title: { EN: 'Job title', ES: 'Puesto', ZH: '职位', HT: 'Tit travay', AR: 'المسمى الوظيفي' },
  school: { EN: 'School name', ES: 'Nombre de la escuela', ZH: '学校名称', HT: 'Non lekòl', AR: 'اسم المدرسة' },
  destination: { EN: 'Destination country', ES: 'País de destino', ZH: '目的地国家', HT: 'Peyi destinasyon', AR: 'بلد الوجهة' },
  departure: { EN: 'Departure date', ES: 'Fecha de salida', ZH: '出发日期', HT: 'Dat depa', AR: 'تاريخ المغادرة' },
  return: { EN: 'Return date', ES: 'Fecha de regreso', ZH: '返回日期', HT: 'Dat retou', AR: 'تاريخ العودة' },
};

const UI: Record<string, Record<Tier1Lang, string>> = {
  back: { EN: '← Back', ES: '← Atrás', ZH: '← 返回', HT: '← Tounen', AR: '← رجوع' },
  next: { EN: 'Next →', ES: 'Siguiente →', ZH: '下一步 →', HT: 'Pwochen →', AR: 'التالي →' },
  seeReport: { EN: 'See Report →', ES: 'Ver informe →', ZH: '查看报告 →', HT: 'Wè rapò →', AR: 'عرض التقرير →' },
  required: { EN: 'This question is required.', ES: 'Esta pregunta es obligatoria.', ZH: '此问题为必填项。', HT: 'Kesyon sa a obligatwa.', AR: 'هذا السؤال مطلوب.' },
  addEntry: { EN: 'Add entry', ES: 'Agregar', ZH: '添加', HT: 'Ajoute', AR: 'إضافة' },
  edit: { EN: 'Edit', ES: 'Editar', ZH: '编辑', HT: 'Modifye', AR: 'تعديل' },
  delete: { EN: 'Delete', ES: 'Eliminar', ZH: '删除', HT: 'Efase', AR: 'حذف' },
  save: { EN: 'Save', ES: 'Guardar', ZH: '保存', HT: 'Sove', AR: 'حفظ' },
  cancel: { EN: 'Cancel', ES: 'Cancelar', ZH: '取消', HT: 'Anile', AR: 'إلغاء' },
  atLeastOne: { EN: 'Please add at least one entry.', ES: 'Agregue al menos una entrada.', ZH: '请至少添加一条。', HT: 'Tanpri ajoute omwen yon antre.', AR: 'يرجى إضافة إدخال واحد على الأقل.' },
  fillOneField: { EN: 'Please fill in at least one field.', ES: 'Complete al menos un campo.', ZH: '请至少填写一个字段。', HT: 'Tanpri ranpli omwen yon chan.', AR: 'يرجى ملء حقل واحد على الأقل.' },
  optional: { EN: '(optional)', ES: '(opcional)', ZH: '(可选)', HT: '(opsyonèl)', AR: '(اختياري)' },
  startOver: { EN: '← Start Over', ES: '← Empezar de nuevo', ZH: '← 重新开始', HT: '← Rekòmanse', AR: '← البدء من جديد' },
  downloadPdf: { EN: 'Download PDF', ES: 'Descargar PDF', ZH: '下载 PDF', HT: 'Telechaje PDF', AR: 'تحميل PDF' },
  officialInstructions: { EN: 'Official instructions', ES: 'Instrucciones oficiales', ZH: '官方说明', HT: 'Enstriksyon ofisyèl', AR: 'التعليمات الرسمية' },
  notLegalAdvice: { EN: 'This report is a preparation aid, not legal advice. It does not determine eligibility.', ES: 'Este informe es una ayuda de preparación, no asesoramiento legal. No determina elegibilidad.', ZH: '本报告为准备辅助工具，并非法律建议，不决定资格。', HT: 'Rapò sa a se yon èd preparasyon, pa konsèy legal. Li pa detèmine elijiblite.', AR: 'هذا التقرير أداة مساعدة للتحضير وليس استشارة قانونية. لا يحدد الأهلية.' },
  applicantSummary: { EN: 'Applicant Summary', ES: 'Resumen del solicitante', ZH: '申请人摘要', HT: 'Rezime aplikan', AR: 'ملخص مقدم الطلب' },
  needsAttention: { EN: 'What needs attention', ES: 'Qué necesita atención', ZH: '需要注意的事项', HT: 'Sa ki bezwen atansyon', AR: 'ما يحتاج إلى اهتمام' },
  worthReviewing: { EN: 'Worth reviewing', ES: 'Vale la pena revisar', ZH: '值得复查', HT: 'Vo lapenn revize', AR: 'يستحق المراجعة' },
  looksGood: { EN: 'What looks good', ES: 'Lo que está bien', ZH: '良好的方面', HT: 'Sa ki bon', AR: 'ما يبدو جيدًا' },
  infoProvided: { EN: 'Information provided', ES: 'Información proporcionada', ZH: '已提供的信息', HT: 'Enfòmasyon yo bay', AR: 'المعلومات المقدمة' },
  infoProvidedSub: { EN: 'Everything below was collected during the questionnaire, organized by form section. Staff can use this directly to complete the official form — no need to re-ask.', ES: 'Todo lo siguiente se recopiló durante el cuestionario, organizado por sección del formulario. El personal puede usarlo directamente para completar el formulario oficial, sin necesidad de preguntar de nuevo.', ZH: '以下所有信息均在问卷期间收集，按表格部分整理。工作人员可直接使用这些信息填写正式表格，无需重新询问。', HT: 'Tout sa ki anba a te rasanble pandan kesyonè a, òganize pa seksyon fòm. Anplwaye yo ka itilize li dirèkteman pou ranpli fòm ofisyèl la — pa bezwen mande ankò.', AR: 'تم جمع كل ما يلي أثناء الاستبيان، منظمًا حسب قسم النموذج. يمكن للموظفين استخدام هذا مباشرة لإكمال النموذج الرسمي — لا حاجة لإعادة السؤال.' },
  staffNextSteps: { EN: 'Staff next steps', ES: 'Próximos pasos del personal', ZH: '工作人员后续步骤', HT: 'Pwochen etap anplwaye yo', AR: 'الخطوات التالية للموظفين' },
};

function t(map: Record<string, string> | undefined, lang: Tier1Lang): string {
  if (!map) return '';
  return map[lang] || map['EN'] || '';
}

interface Props {
  formKey: string;
  questions: Tier1Question[];
  steps: Tier1Step[];
  info: Tier1FormInfo;
  lang: Tier1Lang;
  assess: (answers: Record<string, any>, lang: Tier1Lang) => { blockers: { t: string; d: string }[]; warnings: { t: string; d: string }[]; complete: { t: string; d: string }[]; ready: boolean };
  onExit: () => void;
  /** Pathway Add at completion: App performs the formprep checkout POST
   *  + Stripe redirect for these forms. Optional — without it the Add
   *  button is inert. Never passed in institutional mode (no consumer
   *  purchase; the report shows the staff panel instead). */
  onFormprepCheckout?: (forms: string[]) => void;
  /** Staff case context (institutional mode): the participant this
   *  questionnaire belongs to, so the report and staff delivery name
   *  them. Optional — consumer mode has no staff case. */
  participantName?: string;
  staffCaseId?: string;
}

export default function Tier1Flow({ formKey, questions, steps, info, lang, assess, onExit, onFormprepCheckout, participantName, staffCaseId }: Props) {
  // Autosave key: scoped to the staff case when present, so starting a
  // new case for another participant never pre-populates the previous
  // participant's answers (Carbon Pass 1 finding 6). Consumer mode has
  // no staff case, so it keeps the per-form key.
  const storageKey = staffCaseId ? `iru_tier1_${staffCaseId}` : `iru_tier1_${formKey}`;
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>(() => {
    // Restore from localStorage on mount (returning session)
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Only restore if saved within 30 days
        if (Date.now() - parsed.savedAt < 30 * 24 * 60 * 60 * 1000) {
          return parsed.answers || {};
        }
      }
    } catch (e) { /* ignore */ }
    return {};
  });

  // Persist answers on change
  const persistAnswers = (newAnswers: Record<string, any>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        answers: newAnswers,
        savedAt: Date.now(),
        formKey,
      }));
    } catch (e) { /* storage full or unavailable */ }
  };

  // Auto-persist whenever answers change (survives refresh + returning session)
  useEffect(() => {
    persistAnswers(answers);
  }, [answers]);
  const [rgData, setRgData] = useState<Record<string, any[]>>({});
  const [rgEditing, setRgEditing] = useState<number | null>(null);
  const [textVal, setTextVal] = useState('');
  const [radioVal, setRadioVal] = useState('');
  const [saveToken, setSaveToken] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Save to persistence API
  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      let clientKey = localStorage.getItem('iru_client_key');
      if (!clientKey) {
        clientKey = crypto.randomUUID();
        localStorage.setItem('iru_client_key', clientKey);
      }
      const encoder = new TextEncoder();
      const data = encoder.encode(clientKey);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const clientKeyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      const factRecord = buildFactRecord(answers, undefined, questions);
      // Persistence is gated server-side (any paid entitlement).
      const saveHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const saveTokenHeader = tier1TokenFor(formKey);
      if (saveTokenHeader) saveHeaders['x-entitlement-token'] = saveTokenHeader;
      const res = await fetch('/api/assessment-save', {
        method: 'POST',
        headers: saveHeaders,
        body: JSON.stringify({
          clientKeyHash,
          form_id: formKey,
          facts: factRecord.facts,
          progress: { qi, answers: Object.keys(answers).length },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Save failed');
      setSaveToken(result.token);
    } catch (e: any) {
      setSaveError(e.message || 'Could not save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const visible = questions.filter(q => {
    if (!q.conditionalOn) return true;
    const aq = questions.find(x => (x.factId || x.id) === q.conditionalOn!.factId);
    const av = aq ? answers[aq.id] : null;
    return q.conditionalOn.operator === 'equals' ? av === q.conditionalOn.value : av !== q.conditionalOn.value;
  });

  // Finding 16: keep the per-question input state in sync with the
  // restored answers whenever the current question changes. textVal /
  // radioVal used to start as '' on mount even when answers were
  // restored from localStorage, so a cleared input snapped back to the
  // saved value and Next on Q0 deleted the restored answer. This runs
  // on mount too (qi = 0), so the first question is synced as well.
  const currentQId = visible[qi]?.id;
  useEffect(() => {
    const cur = visible[qi];
    if (!cur) return;
    setTextVal(answers[cur.id] ?? '');
    setRadioVal(answers[cur.id] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQId]);

  if (qi >= visible.length) {
    const factRecord: FactRecord = buildFactRecord(answers, undefined, questions);
    const basic = assess(answers, lang);
    // Premium gating (owner directive 2026-11-10): the intelligence layer
    // is a Premium preparation feature. It applies ONLY when this browser
    // holds a paid preparation token for the form (getFormTokens — the
    // same prep-token store the prepared-PDF gate uses; a readiness-only
    // token is refused 402 by the fill endpoint). A Readiness-only buyer
    // gets the basic assessment — no contradiction intelligence, no
    // narrative drafts, no adaptive screening.
    const withIntel = applyIntelligence(formKey, answers, basic, { premium: hasPrepEntitlement(formKey) });
    const r: ScoredAssessment = scoreAssessment(withIntel, info.formNumber, [], factRecord);
    return <Tier1Report info={info} lang={lang} result={r} questions={questions} steps={steps} answers={answers} factRecord={factRecord} onExit={onExit} onFormprepCheckout={onFormprepCheckout} participantName={participantName} staffCaseId={staffCaseId} />;
  }

  const q = visible[qi];
  const step = steps.find(s => s.id === q.step);
  const pct = Math.round((qi / visible.length) * 100);

  const saveAnswer = (): boolean => {
    if (q.type === 'repeating_group') {
      const entries = rgData[q.groupId!] || [];
      if (q.required && entries.length === 0) { alert(UI.atLeastOne[lang]); return false; }
      if (entries.length) setAnswers(a => ({ ...a, [q.id]: entries }));
      return true;
    }
    const val = q.type === 'radio' || q.type === 'select' ? radioVal : textVal.trim();
    if (q.required && !val) { alert(UI.required[lang]); return false; }
    setAnswers(a => {
      const n = { ...a };
      if (val) n[q.id] = val; else delete n[q.id];
      return n;
    });
    return true;
  };

  const loadQ = (idx: number) => {
    const nq = visible[idx];
    if (!nq) return;
    setTextVal(answers[nq.id] || '');
    setRadioVal(answers[nq.id] || '');
    setRgEditing(null);
  };

  const goNext = () => { if (saveAnswer()) { loadQ(qi + 1); setQi(qi + 1); } };
  const goBack = () => { if (saveAnswer()) { loadQ(qi - 1); setQi(qi - 1); } };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <div style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
        {info.formNumber} · {t(step?.title, lang)}
      </div>
      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, marginBottom: '1.25rem', overflow: 'hidden' }}>
        <div style={{ height: '100%', background: '#1a56db', borderRadius: 3, width: pct + '%', transition: 'width 0.3s' }} />
      </div>
      <div style={{ background: '#fff', padding: '1.5rem', borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>
          {t(q.labels, lang)} {q.required ? '' : <span style={{ color: '#64748b', fontWeight: 'normal' }}>{UI.optional[lang]}</span>}
        </h3>
        {q.helpText && <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0.5rem 0 1rem' }}>{t(q.helpText, lang)}</p>}
        {(q.type === 'text' || q.type === 'date') && (
          <input data-testid={`question-input-${q.id}`} type={q.type} value={textVal} onChange={e => setTextVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') goNext(); }}
            style={{ width: '100%', padding: '0.7rem', fontSize: '1rem', border: '1px solid #e2e8f0', borderRadius: 8, boxSizing: 'border-box' }} />
        )}
        {(q.type === 'radio' || q.type === 'select') && (
          <div>{(q.options || []).map(o => (
            <label key={o.value} style={{ display: 'block', padding: '0.7rem 0.9rem', margin: '0.35rem 0', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer' }}>
              <input type="radio" name={'q_' + q.id} value={o.value} checked={radioVal === o.value}
                onChange={e => setRadioVal(e.target.value)} style={{ marginRight: '0.6rem' }} />
              {t(o.labels, lang)}
            </label>
          ))}</div>
        )}
        {q.type === 'repeating_group' && (
          <RepeatingGroupEditor q={q} lang={lang} rgData={rgData} setRgData={setRgData} rgEditing={rgEditing} setRgEditing={setRgEditing} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '1.25rem 0', gap: '1rem' }}>
        <button data-testid="btn-back" onClick={goBack} disabled={qi === 0} style={btnStyle}>{UI.back[lang]}</button>
        <button data-testid="btn-save" onClick={handleSave} disabled={isSaving} style={{ ...btnStyle, background: '#0e9f6e', color: '#fff', borderColor: '#0e9f6e' }}>
          {isSaving ? 'Saving...' : 'Save Progress'}
        </button>
        <button data-testid={qi === visible.length - 1 ? "btn-see-report" : "btn-next"} onClick={goNext} style={{ ...btnStyle, background: '#1a56db', color: '#fff', borderColor: '#1a56db' }}>
          {qi === visible.length - 1 ? UI.seeReport[lang] : UI.next[lang]}
        </button>
      </div>
      {saveToken && (
        <div data-testid="save-token-display" style={{ background: '#ecfdf5', border: '1px solid #0e9f6e', borderRadius: 8, padding: '1rem', margin: '1rem 0' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Progress Saved!</div>
          <div style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Save this token to resume your application on another device:</div>
          <code style={{ display: 'block', background: '#fff', padding: '0.5rem', borderRadius: 4, wordBreak: 'break-all', userSelect: 'all' }}>{saveToken}</code>
        </div>
      )}
      {saveError && (
        <div data-testid="save-error" style={{ background: '#fef2f2', border: '1px solid #ef4444', borderRadius: 8, padding: '1rem', margin: '1rem 0', color: '#dc2626' }}>
          {saveError}
        </div>
      )}
      <button onClick={onExit} style={linkStyle}>{UI.startOver[lang]}</button>
    </div>
  );
}

const btnStyle: CSSProperties = { padding: '0.8rem 1.6rem', fontSize: '1rem', cursor: 'pointer', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff' };
const linkStyle: CSSProperties = { background: 'none', border: 'none', color: '#1a56db', cursor: 'pointer', fontSize: '0.95rem', padding: '0.5rem 0' };

function RepeatingGroupEditor({ q, lang, rgData, setRgData, rgEditing, setRgEditing }: any) {
  const gid = q.groupId;
  const schema = RG_SCHEMAS[gid] || [{ id: 'detail', type: 'text' }];
  const entries: any[] = rgData[gid] || [];
  const [draft, setDraft] = useState<Record<string, string>>({});



  const startAdd = () => { setDraft({}); setRgEditing(entries.length); };
  const startEdit = (i: number) => { setDraft({ ...entries[i] }); setRgEditing(i); };
  const saveDraft = () => {
    const has = Object.values(draft).some((v: unknown) => v && (v as string).trim());
    if (!has) { alert(UI.fillOneField[lang]); return; }
    const clean: Record<string, string> = {};
    Object.entries(draft).forEach(([k, v]) => { if (v && (v as string).trim()) clean[k] = (v as string).trim(); });
    setRgData((d: any) => {
      const arr = [...(d[gid] || [])];
      if (rgEditing! < arr.length) arr[rgEditing!] = clean; else arr.push(clean);
      return { ...d, [gid]: arr };
    });
    setRgEditing(null);
  };

  return (
    <div>
      {entries.map((e: any, i: number) => (
        <div key={i} data-testid={`entry-card-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.6rem 0.9rem', margin: '0.4rem 0' }}>
          <span>{schema.map(s => e[s.id]).filter(Boolean).join(' · ') || 'Entry ' + (i + 1)}</span>
          <span>
            <button onClick={() => startEdit(i)} style={{ ...btnStyle, padding: '0.3rem 0.7rem', fontSize: '0.85rem', marginRight: '0.4rem' }}>{UI.edit[lang]}</button>
            <button onClick={() => setRgData((d: any) => ({ ...d, [gid]: (d[gid] || []).filter((_: any, j: number) => j !== i) }))} style={{ ...btnStyle, padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}>{UI.delete[lang]}</button>
          </span>
        </div>
      ))}
      {rgEditing !== null ? (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', margin: '0.75rem 0' }}>
          {schema.map(s => (
            <label key={s.id} style={{ fontSize: '0.85rem', color: '#64748b', display: 'block', margin: '0.4rem 0' }}>
              {RG_FIELD_LABELS[s.id]?.[lang] || s.id}
              <input type={s.type} value={draft[s.id] || ''} onChange={e => setDraft({ ...draft, [s.id]: e.target.value })}
                data-testid={`entry-input-${s.id}`}
                style={{ width: '100%', padding: '0.6rem', fontSize: '1rem', border: '1px solid #e2e8f0', borderRadius: 8, boxSizing: 'border-box', marginTop: '0.25rem' }} />
            </label>
          ))}
          <div style={{ marginTop: '0.75rem' }}>
            <button data-testid="btn-save-entry" onClick={saveDraft} style={{ ...btnStyle, background: '#1a56db', color: '#fff', borderColor: '#1a56db', marginRight: '0.5rem' }}>{UI.save[lang]}</button>
            <button onClick={() => setRgEditing(null)} style={btnStyle}>{UI.cancel[lang]}</button>
          </div>
        </div>
      ) : (
        <button data-testid="btn-add-entry" onClick={startAdd} style={btnStyle}>+ {UI.addEntry[lang]}</button>
      )}
      {q.required && entries.length === 0 && rgEditing === null && (
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>{UI.atLeastOne[lang]}</p>
      )}
    </div>
  );
}

function Tier1Report({ info, lang, result, questions, steps, answers, factRecord, onExit, onFormprepCheckout, participantName, staffCaseId }: any) {
  const r = result as ScoredAssessment;
  const institutional = INSTITUTIONAL_MODE();
  // ── Staff delivery (institutional only) ──────────────────────────────
  // CONFIRMED SEND FLOW (owner, 2026-11-11): review → confirm →
  // automatic Resend routing to the org's pre-configured staff email →
  // on-screen "sent" confirmation. The review + confirm step STAYS;
  // "automatic" is the ROUTING, not the send. The consumer never enters
  // a staff email and never opens a mail app — the destination is the
  // org's pre-configured receiving address (device org config set by
  // staff, or the server org registry). TESTING: the destination is the
  // owner's healthcarebyvalentine@gmail.com until an org account is
  // created at sale/install time. The sent confirmation below is
  // prominent and stays on screen; it is never auto-dismissed.
  const staffDestination = institutional ? getStaffDestination() : null;
  const orgSlug = staffDestination ? staffDestination.orgSlug : null;
  const staffEmail = staffDestination ? staffDestination.staffEmail : '';
  const orgDisplayName = staffDestination ? staffDestination.orgName : 'your organization';
  const [sendConfirming, setSendConfirming] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string; sentAt?: string } | null>(null);
  // Pathway staff panel (institutional only): staff suggestions are
  // recorded on screen; dismissing hides the panel for this report.
  const [showStaffPanel, setShowStaffPanel] = useState(true);
  const [suggestedForms, setSuggestedForms] = useState<string[]>([]);

  // Structured report input: ONE object feeds both delivery paths —
  // the print window (rendered client-side by buildStaffReportHtml)
  // and staff email (rendered SERVER-side from this same data by
  // /api/send-report — the client never sends raw HTML or a recipient
  // address; Carbon Pass 1, finding 1).
  const reportInput = () => ({
    formNumber: info.formNumber,
    formTitle: info.title || info.formNumber,
    participantName,
    overallScore: r.overallScore || 0,
    overallBand: r.overallBand || 'Incomplete',
    executiveSummary: r.executiveSummary || '',
    sections: r.sections,
    blockers: r.blockers,
    warnings: r.warnings,
    complete: r.complete,
    steps,
    questions,
    answers,
    factRecord,
    lang,
  });

  const reportHtmlForDelivery = () => buildStaffReportHtml(reportInput());

  const openPrintWindow = () => {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Please allow pop-ups to print this report.');
      return;
    }
    w.document.write(reportHtmlForDelivery());
    w.document.close();
    // Print once the popup has loaded (fonts/logo included) instead of
    // racing them with a blind 500ms timer (Carbon Pass 1 finding 22).
    // Fallback timer covers browsers where the load event is missed.
    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      w.print();
    };
    if (w.document.readyState === 'complete') doPrint();
    else {
      w.addEventListener('load', doPrint);
      setTimeout(doPrint, 1500);
    }
  };

  const sendReportToStaff = async () => {
    // Fires ONLY after the applicant reviewed the report on screen and
    // hit confirm. The server resolves the recipient from its org
    // registry and renders the email HTML from the structured report
    // data — the applicant never typed an address, sent raw HTML, or
    // opened a mail app.
    if (!staffEmail) {
      setSendResult({ ok: false, message: 'Staff delivery is not set up for this organization yet. Staff can configure the receiving email in the Staff Dashboard, or you can print this report.' });
      return;
    }
    setSendBusy(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org: orgSlug || undefined,
          participantName: participantName || '',
          formNumber: info.formNumber,
          report: reportInput(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSendResult({ ok: false, message: (data && data.error) || 'Could not send the report. Please try again.' });
        return;
      }
      if (staffCaseId) markCaseReportSent(staffCaseId, staffEmail);
      setSendResult({
        ok: true,
        message: `Report sent to ${orgDisplayName} staff (${staffEmail}).`,
        sentAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      });
      setSendConfirming(false);
    } catch {
      setSendResult({ ok: false, message: 'Could not reach the email service. Please try again.' });
    } finally {
      setSendBusy(false);
    }
  };
  // ── end staff delivery state ──
  // Pathway Add at completion: shows the checkout summary inline
  // (lines, discount/bundle, total) instead of the guidance panel.
  // onFormprepCheckout (from App) performs the formprep checkout POST
  // + Stripe redirect for these forms.
  const [pathwayCheckout, setPathwayCheckout] = useState<{
    selectedForm: string;
    addedForm: string;
    pricing: { lines: { form: string; regularCents: number; discountCents: number; finalCents: number; kind: string }[]; totalCents: number; bundleApplied: boolean; bundleSavingCents: number };
  } | null>(null);
  const [pathwayCheckoutError, setPathwayCheckoutError] = useState<string | null>(null);
  // FIX (2026-11-03): banner reflects weakest section, not just blocker count.
  // A report with no blockers but an Incomplete section should not say "ready."
  const weakest = r.sections?.length ? r.sections.reduce((a, b) => a.score < b.score ? a : b) : null;
  const bannerState = !r.ready ? 'blocked'
    : weakest && (weakest.band === 'Incomplete' || weakest.band === 'Developing') ? 'caution'
    : 'ready';
  const banner = bannerState === 'ready'
    ? { bg: '#dcfce7', bd: '#86efac', icon: '✅' }
    : bannerState === 'caution'
    ? { bg: '#fef3c7', bd: '#fcd34d', icon: '⚠️' }
    : { bg: '#fee2e2', bd: '#fca5a5', icon: '⚠️' };
  const bannerText = bannerState === 'ready'
    ? t({ EN: 'Ready to prepare.' }, lang)
    : bannerState === 'caution'
    ? t({ EN: `${weakest!.section} needs attention (${weakest!.band}) — review below before filing.` }, lang)
    : t({ EN: `${r.blockers.length} item(s) need attention before filing.` }, lang);
  const shortLabel = (q: Tier1Question) => q.shortLabels?.[lang] || q.shortLabel || t(q.labels, lang);

  const bandColor: Record<string, string> = {
    Strong: '#15803d', Moderate: '#b45309', Developing: '#c2410c', Incomplete: '#dc2626',
  };
  const bandBg: Record<string, string> = {
    Strong: '#dcfce7', Moderate: '#fef3c7', Developing: '#ffedd5', Incomplete: '#fee2e2',
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <h1>{info.formNumber} — {UI.applicantSummary[lang]}</h1>
      {participantName && (
        <p data-testid="report-participant" style={{ color: '#475569', margin: '0.25rem 0 0' }}>
          {t({ EN: `Participant: ${participantName}` }, lang)}
        </p>
      )}

      {/* Executive summary + overall score */}
      <div style={{ padding: '1.25rem 1.5rem', borderRadius: 12, margin: '1rem 0', background: bandBg[r.overallBand] || '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.75rem', fontWeight: 700 }}>{Math.round((r.overallScore || 0) * 100)}%</span>
          <span style={{ padding: '0.25rem 0.75rem', borderRadius: 999, fontWeight: 600, fontSize: '0.9rem', background: bandColor[r.overallBand] || '#64748b', color: '#fff' }}>
            {r.overallBand || 'Incomplete'}
          </span>
        </div>
        <p style={{ ...narrStyle, margin: 0 }}>{r.executiveSummary}</p>
      </div>

      {/* Section scores */}
      {r.sections && r.sections.length > 0 && (
        <div style={secStyle}>
          <h2>Readiness by Section</h2>
          {r.sections.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: i < r.sections.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{s.section}</span>
              <span style={{ fontSize: '0.9rem', color: '#64748b' }}>{Math.round(s.score * 100)}%</span>
              <span style={{ padding: '0.15rem 0.6rem', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600, background: bandBg[s.band], color: bandColor[s.band] }}>
                {s.band}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '1.25rem 1.5rem', borderRadius: 12, margin: '1rem 0', fontSize: '1.1rem', background: banner.bg, border: '1px solid ' + banner.bd }}>
        {banner.icon} <strong>{bannerText}</strong>
      </div>
      {r.blockers.length > 0 && (
        <div style={secStyle}><h2>{UI.needsAttention[lang]}</h2>
          {r.blockers.map((b: any, i: number) => <div key={i}><p><strong style={{ color: '#dc2626' }}>❌ {b.t}</strong></p><p style={narrStyle}>{b.d}</p></div>)}
        </div>
      )}
      {r.warnings.length > 0 && (
        <div style={secStyle}><h2>{UI.worthReviewing[lang]}</h2>
          {r.warnings.map((w: any, i: number) => <div key={i}><p><strong style={{ color: '#b45309' }}>⚠️ {w.t}</strong></p><p style={narrStyle}>{w.d}</p></div>)}
        </div>
      )}
      {r.complete.length > 0 && (
        <div style={secStyle}><h2>{UI.looksGood[lang]}</h2>
          {r.complete.map((c: any, i: number) => <p key={i}><strong style={{ color: '#15803d' }}>✅ {c.t}</strong> <span style={{ color: '#64748b' }}>{c.d}</span></p>)}
        </div>
      )}
      <div style={secStyle}>
        <h2>{UI.infoProvided[lang]}</h2>
        <p style={{ ...narrStyle, color: '#64748b' }}>{UI.infoProvidedSub[lang]}</p>
        {steps.map((step: Tier1Step) => {
          const sqs = questions.filter((q: Tier1Question) => q.step === step.id && answers[q.id] !== undefined);
          if (!sqs.length) return null;
          return (
            <div key={step.id}>
              <h3 style={{ margin: '1.25rem 0 0.5rem', fontSize: '1.05rem' }}>{t(step.title, lang)}</h3>
              {sqs.map((q: Tier1Question) => {
                const ans = answers[q.id];
                const fact = factRecord?.facts[q.factId || q.id];
                let display: any = ans;
                if (q.type === 'repeating_group' && Array.isArray(ans)) {
                  const schema = RG_SCHEMAS[q.groupId!] || [{ id: 'detail' }];
                  display = <ol style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>{ans.map((e: any, i: number) =>
                    <li key={i}>{schema.map(s => e[s.id]).filter(Boolean).join(' · ')}</li>)}</ol>;
                } else if (q.type === 'radio' || q.type === 'select') {
                  const opt = (q.options || []).find(o => o.value === ans);
                  display = t(opt?.labels, lang) || ans;
                }
                // Provenance badge: corrected or conflicted facts get flagged
                const badge = fact?.status === 'corrected'
                  ? <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#b45309', padding: '0.1rem 0.4rem', borderRadius: 999, marginLeft: '0.5rem' }}>Corrected ({fact.corrections.length}x)</span>
                  : fact?.status === 'conflicted'
                  ? <span style={{ fontSize: '0.75rem', background: '#fee2e2', color: '#dc2626', padding: '0.1rem 0.4rem', borderRadius: 999, marginLeft: '0.5rem' }}>Conflicted</span>
                  : null;
                return <div key={q.id} style={{ margin: '0.4rem 0' }}><div style={{ fontWeight: 600 }}>{shortLabel(q)}{badge}</div><div>{display}</div></div>;
              })}
            </div>
          );
        })}
      </div>
      <div style={secStyle}>
        <h2>{UI.staffNextSteps[lang]}</h2>
        <ol style={narrStyle}>
          <li>{t({ EN: 'Print this summary or keep it open as a reference.' }, lang)}</li>
          <li>{t({ EN: `Download the official ${info.formNumber} PDF using the button below.` }, lang)}</li>
          <li>{t({ EN: 'Complete the form using the information provided above — organized by form section.' }, lang)}</li>
        </ol>
      </div>
      {/* Pathway Assistant — related-form guidance at completion (before Generate).
          Institutional mode: the staff panel (no paywall, no pricing, no
          purchase language) — staff sees the suggestion and decides whether
          to suggest it to the participant. Consumer mode: the guidance
          panel + checkout summary, unchanged. */}
      {institutional ? (
        showStaffPanel ? (
          <>
            <PathwayStaffPanel
              currentForm={info.formNumber}
              ownedForms={[info.formNumber]}
              activeCatalog={getActiveCatalog()}
              participantName={participantName}
              onSuggest={(form) => setSuggestedForms((prev) => (prev.includes(form) ? prev : [...prev, form]))}
              onDismiss={() => setShowStaffPanel(false)}
            />
            {suggestedForms.length > 0 && (
              <p data-testid="pathway-suggested-note" style={{ color: '#047857', fontSize: '0.9rem' }}>
                Suggested to participant: {suggestedForms.join(', ')}.
              </p>
            )}
          </>
        ) : null
      ) : pathwayCheckout ? (
        <PathwayCheckoutSummary
          pricing={pathwayCheckout.pricing}
          selectedForm={pathwayCheckout.selectedForm}
          addedForm={pathwayCheckout.addedForm}
          error={pathwayCheckoutError}
          onConfirm={() => {
            if (onFormprepCheckout) {
              onFormprepCheckout([pathwayCheckout.selectedForm, pathwayCheckout.addedForm]);
            }
          }}
          onBack={() => { setPathwayCheckout(null); setPathwayCheckoutError(null); }}
        />
      ) : (
        <PathwayGuidance
          currentForm={info.formNumber}
          // Owned prep forms = forms this browser holds a PAID entitlement
          // token for (set only after a successful checkout). Completing
          // the questionnaire is NOT a purchase: the server re-derives
          // ownership from the entitlement token and is authoritative on
          // price, so the display must never treat the just-completed
          // form as owned. (Bug found 2026-11-05 by the error crawl:
          // the panel + summary showed $200 for I-589 at I-765 completion
          // while the server charges the $349 bundle.)
          ownedForms={Object.keys(getFormTokens())}
          activeCatalog={getActiveCatalog()}
          formsCatalog={FORMS}
          placement="completion"
          onAddForm={(form) => {
            if (!onFormprepCheckout) return;
            setPathwayCheckoutError(null);
            // Owned prep forms: ONLY forms with a paid entitlement token
            // in this browser — see the note above. The server is
            // authoritative on price and charges the bundle when the
            // current form is not actually owned.
            let owned: string[] = [];
            try {
              const tokens = getFormTokens();
              owned = [...new Set(Object.keys(tokens))];
            } catch { /* ignore */ }
            const priced = pricePurchase({
              ownedForms: owned,
              selectedForm: info.formNumber,
              addedForm: form,
            });
            if (!priced.ok) {
              setPathwayCheckoutError(priced.error || 'This purchase cannot be completed.');
              return;
            }
            setPathwayCheckout({
              selectedForm: info.formNumber,
              addedForm: form,
              pricing: {
                lines: priced.lines,
                totalCents: priced.totalCents,
                bundleApplied: priced.bundleApplied,
                bundleSavingCents: priced.bundleSavingCents,
              },
            });
          }}
        />
      )}
      <div style={{ display: 'flex', gap: '1rem', margin: '1.25rem 0' }}>
        <button onClick={onExit} style={btnStyle}>{UI.startOver[lang]}</button>
        <a href={info.pdfUrl} target="_blank" rel="noopener"><button style={{ ...btnStyle, background: '#1a56db', color: '#fff', borderColor: '#1a56db' }}>{UI.downloadPdf[lang]} {info.formNumber}</button></a>
        {info.formNumber === 'I-130' && (
          <button
            data-testid="btn-generate"
            onClick={() => generateCompletedForm('i130', factRecord?.facts || {})}
            style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}
          >
            {lang === 'EN' ? 'Generate completed I-130' : lang === 'ES' ? 'Generar I-130 completado' : lang === 'ZH' ? '生成已完成的 I-130' : lang === 'HT' ? 'Jenere I-130 ki konplè' : 'إنشاء نموذج I-130 مكتمل'}
          </button>
        )}
        {info.formNumber === 'I-90' && (
          <button
            data-testid="btn-generate"
            onClick={() => generateCompletedForm('i90', factRecord?.facts || {})}
            style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}
          >
            {lang === 'EN' ? 'Generate completed I-90' : lang === 'ES' ? 'Generar I-90 completado' : lang === 'ZH' ? '生成已完成的 I-90' : lang === 'HT' ? 'Jenere I-90 ki konplè' : 'إنشاء نموذج I-90 مكتمل'}
          </button>
        )}
        {info.formNumber === 'N-400' && (
          <button
            data-testid="btn-generate"
            onClick={() => generateCompletedForm('n400', factRecord?.facts || {})}
            style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}
          >
            {lang === 'EN' ? 'Generate completed N-400' : lang === 'ES' ? 'Generar N-400 completado' : lang === 'ZH' ? '生成已完成的 N-400' : lang === 'HT' ? 'Jenere N-400 ki konplè' : 'إنشاء نموذج N-400 مكتمل'}
          </button>
        )}
        {info.formNumber === 'I-765' && (
          <button
            data-testid="btn-generate"
            onClick={() => generateCompletedForm('i765', factRecord?.facts || {})}
            style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}
          >
            {lang === 'EN' ? 'Generate completed I-765' : lang === 'ES' ? 'Generar I-765 completado' : lang === 'ZH' ? '生成已完成的 I-765' : lang === 'HT' ? 'Jenere I-765 ki konplè' : 'إنشاء نموذج I-765 مكتمل'}
          </button>
        )}
        {info.formNumber === 'I-485' && (
          <button
            data-testid="btn-generate"
            onClick={() => generateCompletedForm('i485', factRecord?.facts || {})}
            style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}
          >
            {lang === 'EN' ? 'Generate completed I-485' : lang === 'ES' ? 'Generar I-485 completado' : lang === 'ZH' ? '生成已完成的 I-485' : lang === 'HT' ? 'Jenere I-485 ki konplè' : 'إنشاء نموذج I-485 مكتمل'}
          </button>
        )}
        {info.formNumber === 'I-589' && (
          <button
            data-testid="btn-generate"
            onClick={() => generateCompletedForm('i589', factRecord?.facts || {})}
            style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}
          >
            {lang === 'EN' ? 'Generate completed I-589' : lang === 'ES' ? 'Generar I-589 completado' : lang === 'ZH' ? '生成已完成的 I-589' : lang === 'HT' ? 'Jenere I-589 ki konplè' : 'إنشاء نموذج I-589 مكتمل'}
          </button>
        )}
      </div>
      {/* Delivery — confirmed send flow (institutional) + print (both modes).
          Institutional: the report is already reviewed on screen; the
          applicant confirms, then Resend routes it to the org's
          pre-configured staff email, and a prominent SENT confirmation
          appears here and stays on screen. The consumer never enters a
          staff email and never opens a mail app. Print / Save as PDF is
          the same report HTML opened in a clean print window. */}
      <div style={{ ...secStyle, borderColor: '#1a56db' }}>
        <h2>{t({ EN: 'Send or save this report' }, lang)}</h2>
        {institutional && (
          <>
            <p style={{ lineHeight: 1.5 }}>
              {staffDestination && staffDestination.isTestDefault
                ? `Send this report to staff — test address ${staffEmail}. (Testing only: the organization's own staff email is set up when the organization is installed.)`
                : `Send this report to ${orgDisplayName} staff — ${staffEmail}.`}
            </p>
            {sendResult && sendResult.ok ? (
              <div data-testid="report-sent-confirmation" style={{ background: '#dcfce7', border: '2px solid #16a34a', borderRadius: 10, padding: '1rem 1.1rem', margin: '0.75rem 0' }}>
                <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#166534' }}>✓ Report sent to staff</div>
                <div style={{ color: '#166534', lineHeight: 1.5 }}>
                  {sendResult.message}{sendResult.sentAt ? ` Sent at ${sendResult.sentAt}.` : ''}
                </div>
              </div>
            ) : sendConfirming ? (
              <div style={{ margin: '0.75rem 0' }}>
                <p style={{ lineHeight: 1.5, fontWeight: 600 }}>
                  {`Send this report to ${orgDisplayName} staff (${staffEmail})?`}
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button data-testid="report-send-confirm" onClick={sendReportToStaff} disabled={sendBusy} style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}>
                    {sendBusy ? 'Sending…' : 'Yes, send this report to staff'}
                  </button>
                  <button data-testid="report-send-cancel" onClick={() => setSendConfirming(false)} style={btnStyle}>Cancel</button>
                </div>
              </div>
            ) : (
              <button data-testid="report-send-to-staff" onClick={() => { setSendResult(null); setSendConfirming(true); }} style={{ ...btnStyle, background: '#059669', color: '#fff', borderColor: '#059669' }}>
                Send this report to staff
              </button>
            )}
            {sendResult && !sendResult.ok && (
              <div data-testid="report-send-error" style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, padding: '0.75rem 1rem', margin: '0.75rem 0', color: '#991b1b' }}>
                {sendResult.message}
              </div>
            )}
          </>
        )}
        <div style={{ marginTop: institutional ? '0.75rem' : 0 }}>
          <button data-testid="report-print" onClick={openPrintWindow} style={btnStyle}>Print / Save as PDF</button>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            {t({ EN: 'Printing opens a clean copy of this report — choose Print or Save as PDF in the print dialog.' }, lang)}
          </p>
        </div>
      </div>
      <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
        <a href={info.instructionsUrl} target="_blank" rel="noopener" style={{ color: '#1a56db' }}>{UI.officialInstructions[lang]}</a> · {UI.notLegalAdvice[lang]}
      </p>
    </div>
  );
}


// Best entitlement token for this form's server calls (fill + save):
// the preparation token for the form, else readiness, else generic.
// The server decides what each token unlocks; this only presents it.
function tier1TokenFor(formKey: string): string | null {
  const codeMap: Record<string, string> = { i130: 'I-130', i90: 'I-90', n400: 'N-400', i765: 'I-765', i485: 'I-485', i589: 'I-589' };
  const code = codeMap[formKey];
  try {
    if (code) {
      const prep = getFormTokens();
      if (prep[code]) return prep[code];
      const read = getReadinessTokens();
      if (read[code]) return read[code];
    }
    return getStoredToken();
  } catch { return null; }
}

// Paid preparation entitlement for this form (Premium gate, owner
// directive 2026-11-10). Reads the prep-token store — the same store
// tier1TokenFor prefers and the fill endpoint enforces server-side.
// A readiness-only buyer has a token in getReadinessTokens(), not here,
// so the Premium intelligence does not apply to them. Stale prep tokens
// are removed by verifyStoredEntitlements (App.tsx), so this store is
// maintained; the fill endpoint's server-side 402 remains the
// authoritative enforcement for the prepared PDF.
function hasPrepEntitlement(formKey: string): boolean {
  // Institutional mode: the organization holds access, so the
  // intelligence layer applies — there is no per-form consumer purchase.
  if (INSTITUTIONAL_MODE()) return true;
  const codeMap: Record<string, string> = { i130: 'I-130', i90: 'I-90', n400: 'N-400', i765: 'I-765', i485: 'I-485', i589: 'I-589' };
  const code = codeMap[formKey];
  if (!code) return false;
  try {
    return Boolean(getFormTokens()[code]);
  } catch { return false; }
}

// Generate completed form via Python endpoint
async function generateCompletedForm(formKey: string, facts: Record<string, any>): Promise<void> {
  const endpoint = formKey === 'i130' ? '/api/fill-i130' : formKey === 'i90' ? '/api/fill-i90' : formKey === 'n400' ? '/api/fill-n400' : formKey === 'i765' ? '/api/fill-i765' : formKey === 'i485' ? '/api/fill-i485' : formKey === 'i589' ? '/api/fill-i589' : null;
  if (!endpoint) {
    alert('Form generation not yet available for ' + formKey);
    return;
  }
  try {
    // Preparation is gated server-side: present this form's token.
    // A readiness-only token is refused 402 — readiness does not
    // include the prepared form draft.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = tier1TokenFor(formKey);
    if (token) headers['x-entitlement-token'] = token;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ facts, addresses: [], biographic: {} }),
    });
    if (res.status === 402) {
      // Institutional mode: there is no consumer purchase, so the
      // consumer "paid Form Preparation purchase" message is wrong.
      // A 402 here means the organization access was not recognized.
      alert(INSTITUTIONAL_MODE()
        ? 'This form could not be generated right now. Please try again, or ask staff to check the organization access.'
        : 'A paid Form Preparation purchase for this form is required to generate its draft.');
      return;
    }
    if (!res.ok) throw new Error('Generation failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${formKey}-draft.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Could not generate the form. Please try again.');
  }
}

const secStyle: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1.25rem 1.5rem', margin: '1rem 0' };
const narrStyle: CSSProperties = { lineHeight: 1.6, fontSize: '1.02rem' };
