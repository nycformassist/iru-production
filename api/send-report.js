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
 * PER-ORG ROUTING (owner correction 2026-11-11): the recipient is the
 * org's pre-configured staff email, resolved in this order:
 *   1. api/_lib/org-staff.js registry (authoritative — a listed org's
 *      staff email wins and the client cannot choose the recipient).
 *   2. The client-provided staffEmail (the device-side org config staff
 *      set in the Staff Dashboard, or the test default).
 * TESTING: the staff email is the owner's healthcarebyvalentine@gmail.com.
 * At sale/install the owner creates the org's account with its real
 * staff email; no real org staff address is configured during testing.
 *
 * ABUSE GUARDS: per-IP rate limit (5 sends / 10 min, shared limiter
 * instance for this endpoint only), strict email validation, HTML size
 * cap (200KB), single recipient only. The key and the HTML body are
 * never logged.
 */
import { createLimiter } from './_lib/ratelimit.js';
import { resolveOrgStaffEmail } from './_lib/org-staff.js';

const sendLimiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });

const KNOWN_FORMS = new Set(['N-400', 'I-130', 'I-485', 'I-90', 'I-589', 'I-765']);
const MAX_HTML_BYTES = 200 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Browser UA header (see module doc): clears Cloudflare 1010 blocks
// that hit default (non-browser) HTTP clients on Resend's API.
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export default async function handler(req, res) {
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
  // Per-org routing: the server registry wins when the org is listed
  // (the client cannot choose the recipient); otherwise the
  // client-provided address is the device-side org config / test default.
  const registryEmail = resolveOrgStaffEmail(org);
  const providedEmail = typeof body.staffEmail === 'string' ? body.staffEmail.trim() : '';
  const staffEmail = registryEmail || providedEmail;
  const html = typeof body.html === 'string' ? body.html : '';
  const formNumber = typeof body.formNumber === 'string' ? body.formNumber.trim() : '';
  const participantName = typeof body.participantName === 'string' ? body.participantName.trim().slice(0, 200) : '';

  if (!EMAIL_RE.test(staffEmail)) {
    return res.status(400).json({ error: 'No staff delivery is configured for this organization. Staff can configure the receiving email in the Staff Dashboard.' });
  }
  if (!html || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return res.status(400).json({ error: 'Report content is missing or too large.' });
  }
  if (formNumber && !KNOWN_FORMS.has(formNumber)) {
    return res.status(400).json({ error: 'Unknown form number.' });
  }

  const subject = participantName
    ? `IRU ${formNumber || 'readiness'} report — ${participantName}`
    : `IRU ${formNumber || 'readiness'} report`;

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
    const message =
      (data && (data.message || data.error)) || `Email service returned ${upstream.status}.`;
    // Surface the provider's own rejection (e.g. test-mode recipient
    // restriction) instead of rewriting it into a false success.
    console.error('[iru] send-report: Resend rejected', upstream.status, message);
    return res.status(upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status).json({
      error: message,
      reason: 'provider-rejected',
      status: upstream.status,
    });
  }

  return res.status(200).json({ ok: true, id: data && data.id ? data.id : null });
}
