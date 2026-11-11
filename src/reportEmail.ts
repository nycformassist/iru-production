/**
 * src/reportEmail.ts — Staff report HTML builder (pure, no I/O).
 *
 * Renders a completed Tier 1 report as a standalone HTML document.
 * ONE builder serves TWO delivery paths (institutional staff delivery):
 *   1. Email to staff via Resend (POST /api/send-report) — the HTML is
 *      the email body.
 *   2. Print / Save as PDF — the same HTML is opened in a print window
 *      (window.open + print()), so the printed page matches the email.
 *
 * All applicant-provided values are HTML-escaped. Nothing here is legal
 * advice and nothing determines eligibility — the disclaimer is part of
 * the document. The report is a preparation aid built from the
 * applicant's own answers and the intelligence findings.
 */

export interface StaffReportInput {
  formNumber: string;
  formTitle: string;
  participantName?: string;
  overallScore: number;
  overallBand: string;
  executiveSummary: string;
  sections?: { section: string; score: number; band: string }[];
  blockers?: { t: string; d: string }[];
  warnings?: { t: string; d: string }[];
  complete?: { t: string; d: string }[];
  steps?: { id: string; title: Record<string, string> | string }[];
  questions?: {
    id: string;
    step: string;
    type: string;
    groupId?: string;
    labels: Record<string, string> | string;
    shortLabel?: string;
    shortLabels?: Record<string, string>;
    options?: { value: string; labels: Record<string, string> | string }[];
  }[];
  answers?: Record<string, any>;
  factRecord?: { facts?: Record<string, { status?: string; corrections?: unknown[] }> };
  lang?: string;
  generatedAt?: Date;
}

const RG_SCHEMA_FIELDS: Record<string, string[]> = {
  residences: ['street', 'city', 'state', 'from', 'to'],
  children: ['name', 'dob', 'country'],
  employment: ['employer', 'title', 'from', 'to'],
  education: ['school', 'from', 'to'],
  trips: ['destination', 'departure', 'return'],
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelText(map: Record<string, string> | string | undefined, lang: string): string {
  if (typeof map === 'string') return map;
  if (!map) return '';
  return map[lang] || map.EN || '';
}

function displayAnswer(q: NonNullable<StaffReportInput['questions']>[number], ans: any, lang: string): string {
  if (q.type === 'repeating_group' && Array.isArray(ans)) {
    const fields = RG_SCHEMA_FIELDS[q.groupId || ''] || ['detail'];
    const items = ans
      .map((e: any) => fields.map((f) => e?.[f]).filter(Boolean).join(' · '))
      .filter(Boolean);
    if (!items.length) return '';
    return `<ol style="margin:0.25rem 0;padding-left:1.25rem;">${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
  }
  if ((q.type === 'radio' || q.type === 'select') && q.options) {
    const opt = q.options.find((o) => o.value === ans);
    return escapeHtml(opt ? labelText(opt.labels, lang) : ans);
  }
  return escapeHtml(ans);
}

function itemList(items: { t: string; d: string }[] | undefined, color: string, icon: string): string {
  if (!items || !items.length) return '';
  return items
    .map(
      (it) =>
        `<div style="margin:0.5rem 0;"><strong style="color:${color};">${icon} ${escapeHtml(it.t)}</strong>` +
        (it.d ? `<div style="line-height:1.6;">${escapeHtml(it.d)}</div>` : '') +
        `</div>`,
    )
    .join('');
}

export function buildStaffReportHtml(input: StaffReportInput): string {
  const lang = input.lang || 'EN';
  const pct = Math.round((input.overallScore || 0) * 100);
  const dateStr = (input.generatedAt || new Date()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const participant = (input.participantName || '').trim();

  // Information provided, organized by form section.
  let infoHtml = '';
  const steps = input.steps || [];
  const questions = input.questions || [];
  const answers = input.answers || {};
  for (const step of steps) {
    const stepTitle = labelText(step.title as any, lang);
    const sqs = questions.filter((q) => q.step === step.id && answers[q.id] !== undefined);
    if (!sqs.length) continue;
    const rows = sqs
      .map((q) => {
        const display = displayAnswer(q, answers[q.id], lang);
        if (!display) return '';
        const short = q.shortLabels?.[lang] || q.shortLabel || labelText(q.labels as any, lang);
        const fact = input.factRecord?.facts?.[q.id];
        const badge =
          fact?.status === 'corrected'
            ? ` <span style="font-size:0.75rem;background:#fef3c7;color:#b45309;padding:0.1rem 0.4rem;border-radius:999;">Corrected (${(fact.corrections || []).length}x)</span>`
            : fact?.status === 'conflicted'
              ? ` <span style="font-size:0.75rem;background:#fee2e2;color:#dc2626;padding:0.1rem 0.4rem;border-radius:999;">Conflicted</span>`
              : '';
        return `<div style="margin:0.4rem 0;"><div style="font-weight:600;">${escapeHtml(short)}${badge}</div><div>${display}</div></div>`;
      })
      .filter(Boolean)
      .join('');
    if (!rows) continue;
    infoHtml += `<h3 style="margin:1.25rem 0 0.5rem;font-size:1.05rem;">${escapeHtml(stepTitle)}</h3>${rows}`;
  }

  const sectionsHtml = (input.sections || []).length
    ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Readiness by section</h2>` +
      (input.sections || [])
        .map(
          (s) =>
            `<div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #f1f5f9;">` +
            `<span>${escapeHtml(s.section)}</span><span>${Math.round(s.score * 100)}% — ${escapeHtml(s.band)}</span></div>`,
        )
        .join('')
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>IRU ${escapeHtml(input.formNumber)} — Readiness Report</title></head>` +
    `<body style="font-family:Georgia,serif;color:#1a1a1a;max-width:680px;margin:0 auto;padding:1.5rem;line-height:1.6;">` +
    `<div style="border-bottom:2px solid #1a56db;padding-bottom:0.75rem;margin-bottom:1rem;">` +
    `<div style="font-size:1.4rem;font-weight:700;">IRU — Immigration Readiness Utility</div>` +
    `<div style="color:#64748b;">${escapeHtml(input.formNumber)} — ${escapeHtml(input.formTitle)}</div>` +
    (participant ? `<div>Participant: <strong>${escapeHtml(participant)}</strong></div>` : '') +
    `<div style="color:#64748b;font-size:0.9rem;">${escapeHtml(dateStr)}</div></div>` +
    `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:1.25rem 1.5rem;margin:1rem 0;">` +
    `<div style="font-size:1.75rem;font-weight:700;">${pct}% — ${escapeHtml(input.overallBand || 'Incomplete')}</div>` +
    `<p style="margin:0.5rem 0 0;">${escapeHtml(input.executiveSummary || '')}</p></div>` +
    sectionsHtml +
    (input.blockers?.length ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">What needs attention</h2>${itemList(input.blockers, '#dc2626', '❌')}` : '') +
    (input.warnings?.length ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Worth reviewing</h2>${itemList(input.warnings, '#b45309', '⚠️')}` : '') +
    (input.complete?.length ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">What looks good</h2>${itemList(input.complete, '#15803d', '✅')}` : '') +
    (infoHtml ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Information provided</h2><p style="color:#64748b;">Everything below was collected during the questionnaire, organized by form section. Staff can use this directly to complete the official form — no need to re-ask.</p>${infoHtml}` : '') +
    `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Staff next steps</h2><ol style="line-height:1.6;">` +
    `<li>Print this summary or keep it open as a reference.</li>` +
    `<li>Download the official ${escapeHtml(input.formNumber)} PDF and complete the form using the information above — organized by form section.</li></ol>` +
    `<p style="color:#64748b;font-size:0.9rem;border-top:1px solid #e2e8f0;padding-top:0.75rem;margin-top:1.5rem;">` +
    `This report is a preparation aid, not legal advice. It does not determine eligibility. Prepared with IRU — Immigration Readiness Utility.</p>` +
    `</body></html>`;
}
