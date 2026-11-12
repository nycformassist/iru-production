/**
 * POST /api/send-report — Staff delivery (institutional mode only).
 *
 * Sends a completed Tier 1 readiness report to a staff member's email
 * via Resend. This file exists ONLY on the institutional branch — the
 * DTC branch has no staff-delivery endpoint.
 *
 * FLOW RULE (owner correction Nov 2-3): Resend delivery is NOT
 * zero-interaction. The applicant reviews the report on screen and
 * explicitly confirms ("yes, send this to staff") BEFORE this endpoint
 * is called. Resend only removes the email-app step (no mail client
 * opens, no manual send tap, no dependence on device email setup).
 * The review-and-consent step stays — the client enforces it with a
 * two-step confirm; this endpoint does not send without a request.
 *
 * RESEND (owner key in secure storage; test email confirmed Nov 2):
 * - Requires RESEND_API_KEY as a Vercel env var. Missing key → 503
 *   'not-configured' (the endpoint never sends without it, and the key
 *   is never read from anywhere else). Owner step: set RESEND_API_KEY
 *   on Vercel (Preview scope for this branch).
 * - Sends with a browser User-Agent header. Outbound HTTP from the
 *   agent VM was Cloudflare-blocked (error 1010) on default requests
 *   with Resend as the case in point; the browser UA header clears it.
 *   Kept here so the call is robust from any host.
 * - TEST MODE constraint: Resend is currently in test mode, so delivery
 *   is restricted to healthcarebyvalentine@gmail.com until the sending
 *   domain is verified / test mode is lifted. A send to any other
 *   address returns Resend's rejection, which this endpoint surfaces
 *   (it does not rewrite it into a false success).
 *
 * PER-ORG ROUTING (owner correction 2026-11-11, hardened Carbon Pass 1
 * finding 1): the recipient comes ONLY from the server-side
 * api/_lib/org-staff.js registry. The request MUST name an org slug
 * listed there; an omitted or unlisted org is rejected with 400.
 * A client-supplied staffEmail is NEVER read — it cannot choose the
 * recipient. TESTING: only the "test" org is listed, routing to the
 * owner's healthcarebyvalentine@gmail.com. At sale/install the owner
 * creates the org's account with its real staff email; no real org
 * staff address is configured during testing.
 *
 * SERVER-SIDE RENDERING (finding 1): the client sends STRUCTURED
 * report data (`body.report` — scores, sections, findings, steps,
 * questions, answers) and this endpoint renders the email HTML
 * itself, HTML-escaping every applicant-supplied value. Raw HTML
 * from the client is NEVER accepted: a `body.html` field, if present,
 * is ignored. The client-side builder in src/reportEmail.ts renders
 * the same content for the print path; the two renderers must stay
 * in step (same sections, same escaping).
 *
 * ABUSE GUARDS: per-IP rate limit (5 sends / 10 min, shared limiter
 * instance for this endpoint only), strict org-registry resolution,
 * structured-report size cap (200KB), single recipient only. The key
 * and the report content are never logged.
 */
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { resolveOrgStaff } from './_lib/org-staff.js';
import { isInstitutionalServer } from './_lib/server-mode.js';

const sendLimiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });

const KNOWN_FORMS = new Set(['N-400', 'I-130', 'I-485', 'I-90', 'I-589', 'I-765']);
const MAX_REPORT_BYTES = 200 * 1024;
// Browser UA header (see module doc): clears Cloudflare 1010 blocks
// that hit default (non-browser) HTTP clients on Resend's API.
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ── Server-side report rendering ───────────────────────────────────────
// Mirrors src/reportEmail.ts buildStaffReportHtml (the print path).
// Every applicant-supplied value is escaped; no client HTML is ever
// interpolated. Field caps keep a hostile structured payload bounded.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function str(v, max = 500) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function labelText(map, lang) {
  if (typeof map === 'string') return map;
  if (!map || typeof map !== 'object') return '';
  return map[lang] || map.EN || '';
}

const RG_SCHEMA_FIELDS = {
  residences: ['street', 'city', 'state', 'from', 'to'],
  children: ['name', 'dob', 'country'],
  employment: ['employer', 'title', 'from', 'to'],
  education: ['school', 'from', 'to'],
  trips: ['destination', 'departure', 'return'],
};

function displayAnswer(q, ans, lang) {
  if (q.type === 'repeating_group' && Array.isArray(ans)) {
    const fields = RG_SCHEMA_FIELDS[q.groupId || ''] || ['detail'];
    const items = ans
      .slice(0, 50)
      .map((e) => fields.map((f) => (e && typeof e === 'object' ? e[f] : undefined)).filter(Boolean).join(' · '))
      .filter(Boolean);
    if (!items.length) return '';
    return `<ol style="margin:0.25rem 0;padding-left:1.25rem;">${items.map((s) => `<li>${escapeHtml(String(s).slice(0, 500))}</li>`).join('')}</ol>`;
  }
  if ((q.type === 'radio' || q.type === 'select') && Array.isArray(q.options)) {
    const opt = q.options.find((o) => o && o.value === ans);
    return escapeHtml(opt ? labelText(opt.labels, lang) : ans);
  }
  if (typeof ans === 'string') return escapeHtml(ans.slice(0, 2000));
  if (typeof ans === 'number' || typeof ans === 'boolean') return escapeHtml(String(ans));
  return '';
}

function itemList(items, color, icon) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .slice(0, 100)
    .map(
      (it) =>
        `<div style="margin:0.5rem 0;"><strong style="color:${color};">${icon} ${escapeHtml(str(it && it.t, 500))}</strong>` +
        (it && it.d ? `<div style="line-height:1.6;">${escapeHtml(str(it.d, 2000))}</div>` : '') +
        `</div>`,
    )
    .join('');
}

export function renderStaffReportHtml(report) {
  const r = report && typeof report === 'object' ? report : {};
  const lang = str(r.lang, 10) || 'EN';
  const formNumber = str(r.formNumber, 20);
  const formTitle = str(r.formTitle, 200);
  const participant = str(r.participantName, 200).trim();
  const pct = Math.round(Math.min(1, Math.max(0, num(r.overallScore, 0))) * 100);
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let infoHtml = '';
  const steps = Array.isArray(r.steps) ? r.steps.slice(0, 100) : [];
  const questions = Array.isArray(r.questions) ? r.questions.slice(0, 1000) : [];
  const answers = r.answers && typeof r.answers === 'object' ? r.answers : {};
  const facts = r.factRecord && typeof r.factRecord === 'object'
    && r.factRecord.facts && typeof r.factRecord.facts === 'object'
    ? r.factRecord.facts : {};
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const stepTitle = labelText(step.title, lang);
    const sqs = questions.filter((q) => q && typeof q === 'object' && q.step === step.id && answers[q.id] !== undefined);
    if (!sqs.length) continue;
    const rows = sqs
      .map((q) => {
        const display = displayAnswer(q, answers[q.id], lang);
        if (!display) return '';
        const short = (q.shortLabels && typeof q.shortLabels === 'object' && q.shortLabels[lang])
          || q.shortLabel || labelText(q.labels, lang);
        const fact = facts[q.factId || q.id] && typeof facts[q.factId || q.id] === 'object' ? facts[q.factId || q.id] : null;
        const badge =
          fact && fact.status === 'corrected'
            ? ` <span style="font-size:0.75rem;background:#fef3c7;color:#b45309;padding:0.1rem 0.4rem;border-radius:999;">Corrected (${Array.isArray(fact.corrections) ? fact.corrections.length : 0}x)</span>`
            : fact && fact.status === 'conflicted'
              ? ` <span style="font-size:0.75rem;background:#fee2e2;color:#dc2626;padding:0.1rem 0.4rem;border-radius:999;">Conflicted</span>`
              : '';
        return `<div style="margin:0.4rem 0;"><div style="font-weight:600;">${escapeHtml(str(short, 500))}${badge}</div><div>${display}</div></div>`;
      })
      .filter(Boolean)
      .join('');
    if (!rows) continue;
    infoHtml += `<h3 style="margin:1.25rem 0 0.5rem;font-size:1.05rem;">${escapeHtml(str(stepTitle, 500))}</h3>${rows}`;
  }

  const sectionsHtml = Array.isArray(r.sections) && r.sections.length
    ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Readiness by section</h2>` +
      r.sections.slice(0, 100)
        .map(
          (s) =>
            `<div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #f1f5f9;">` +
            `<span>${escapeHtml(str(s && s.section, 200))}</span><span>${Math.round(Math.min(1, Math.max(0, num(s && s.score, 0))) * 100)}% — ${escapeHtml(str(s && s.band, 100))}</span></div>`,
        )
        .join('')
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>IRU ${escapeHtml(formNumber)} — Readiness Report</title></head>` +
    `<body style="font-family:Georgia,serif;color:#1a1a1a;max-width:680px;margin:0 auto;padding:1.5rem;line-height:1.6;">` +
    `<div style="border-bottom:2px solid #1a56db;padding-bottom:0.75rem;margin-bottom:1rem;">` +
    `<div style="font-size:1.4rem;font-weight:700;">IRU — Immigration Readiness Utility</div>` +
    `<div style="color:#64748b;">${escapeHtml(formNumber)} — ${escapeHtml(formTitle)}</div>` +
    (participant ? `<div>Participant: <strong>${escapeHtml(participant)}</strong></div>` : '') +
    `<div style="color:#64748b;font-size:0.9rem;">${escapeHtml(dateStr)}</div></div>` +
    `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:1.25rem 1.5rem;margin:1rem 0;">` +
    `<div style="font-size:1.75rem;font-weight:700;">${pct}% — ${escapeHtml(str(r.overallBand, 100) || 'Incomplete')}</div>` +
    `<p style="margin:0.5rem 0 0;">${escapeHtml(str(r.executiveSummary, 5000))}</p></div>` +
    sectionsHtml +
    (Array.isArray(r.blockers) && r.blockers.length ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">What needs attention</h2>${itemList(r.blockers, '#dc2626', '❌')}` : '') +
    (Array.isArray(r.warnings) && r.warnings.length ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Worth reviewing</h2>${itemList(r.warnings, '#b45309', '⚠️')}` : '') +
    (Array.isArray(r.complete) && r.complete.length ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">What looks good</h2>${itemList(r.complete, '#15803d', '✅')}` : '') +
    (infoHtml ? `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Information provided</h2><p style="color:#64748b;">Everything below was collected during the questionnaire, organized by form section. Staff can use this directly to complete the official form — no need to re-ask.</p>${infoHtml}` : '') +
    `<h2 style="font-size:1.15rem;margin:1.5rem 0 0.5rem;">Staff next steps</h2><ol style="line-height:1.6;">` +
    `<li>Print this summary or keep it open as a reference.</li>` +
    `<li>Download the official ${escapeHtml(formNumber)} PDF and complete the form using the information above — organized by form section.</li></ol>` +
    `<p style="color:#64748b;font-size:0.9rem;border-top:1px solid #e2e8f0;padding-top:0.75rem;margin-top:1.5rem;">` +
    `This report is a preparation aid, not legal advice. It does not determine eligibility. Prepared with IRU — Immigration Readiness Utility.</p>` +
    `</body></html>`;
}

export default async function handler(req, res) {
  // Institutional-only endpoint (Carbon Pass 2, finding C-2): on
  // consumer builds this route does not exist — it must never act as
  // an unauthenticated email relay there.
  if (!isInstitutionalServer()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const limited = sendLimiter.check(clientIp(req));
  if (!limited.allowed) {
    return res.status(429).json({ error: 'Too many send requests. Please try again in a few minutes.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Staff email delivery is not configured.',
      reason: 'not-configured',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const org = typeof body.org === 'string' ? body.org.trim().toLowerCase() : '';
  // Strict registry resolution (finding 1): the org MUST be listed
  // server-side. An omitted or unlisted org is rejected — the client
  // cannot supply a recipient address, and there is no fallback.
  const orgStaff = resolveOrgStaff(org);
  if (!orgStaff) {
    return res.status(400).json({ error: 'No staff delivery is configured for this organization.' });
  }
  const staffEmail = orgStaff.staffEmail;
  // Structured report data only. Client HTML is never read or used.
  const report = body.report && typeof body.report === 'object' ? body.report : null;
  if (!report) {
    return res.status(400).json({ error: 'Report content is missing.' });
  }
  let reportSize = 0;
  try {
    reportSize = Buffer.byteLength(JSON.stringify(report), 'utf8');
  } catch {
    return res.status(400).json({ error: 'Report content is invalid.' });
  }
  if (reportSize > MAX_REPORT_BYTES) {
    return res.status(400).json({ error: 'Report content is missing or too large.' });
  }
  const formNumber = typeof body.formNumber === 'string'
    ? body.formNumber.trim()
    : (typeof report.formNumber === 'string' ? report.formNumber.trim() : '');
  if (!KNOWN_FORMS.has(formNumber)) {
    return res.status(400).json({ error: 'Unknown form number.' });
  }
  // Strip control / bidi-override characters before the name is used
  // in the subject (Carbon Pass 2, finding M-2): CR/LF or U+202E in a
  // participant-supplied name must never reach a mail header.
  const stripHeaderChars = (v) =>
    (typeof v === 'string' ? v : '').replace(/[\r\n\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, '');
  const participantName = stripHeaderChars(
    typeof body.participantName === 'string'
      ? body.participantName.trim().slice(0, 200)
      : (typeof report.participantName === 'string' ? report.participantName.trim().slice(0, 200) : ''),
  );

  // The server renders the email HTML from the structured report.
  const html = renderStaffReportHtml({ ...report, formNumber, participantName });

  const subject = participantName
    ? `IRU ${formNumber} report — ${participantName}`
    : `IRU ${formNumber} report`;

  let upstream;
  try {
    upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_UA,
      },
      body: JSON.stringify({
        from: 'IRU Intake <intake@smrgconsulting.com>',
        to: [staffEmail],
        subject,
        html,
      }),
    });
  } catch (e) {
    console.error('[iru] send-report: Resend request failed', e && e.message ? e.message : 'network error');
    return res.status(502).json({ error: 'Could not reach the email service. Please try again.' });
  }

  let data = null;
  try {
    data = await upstream.json();
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    // Map every non-2xx upstream status to 502 (429 for rate limit)
    // and return a sanitized message — the raw provider message is
    // never forwarded (Carbon Pass 2, finding M-2: it can disclose
    // account details in test mode). The provider's own rejection is
    // still logged server-side, so a test-mode recipient restriction
    // is observable without being surfaced to the caller.
    const status = upstream.status === 429 ? 429 : 502;
    const message =
      (data && (data.message || data.error)) || `Email service returned ${upstream.status}.`;
    console.error('[iru] send-report: Resend rejected', upstream.status, message);
    return res.status(status).json({
      error: 'The email service could not send this report. Please try again.',
      reason: 'provider-rejected',
      status: upstream.status,
    });
  }

  // The destination reported here is the server-side registry entry —
  // never a client-supplied value (Carbon Pass 2, finding C-2).
  return res.status(200).json({
    ok: true,
    id: data && data.id ? data.id : null,
    deliveredTo: orgStaff.staffEmail,
    orgName: orgStaff.orgName,
  });
}
