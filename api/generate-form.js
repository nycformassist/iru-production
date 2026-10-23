// api/generate-form.js — Official-form DRAFT generation (directive §7.5).
//
// Populates the official USCIS PDF (forms/templates/, see
// forms/PROVENANCE.md) from the consumer's canonical fact record and
// returns it as a clearly-labeled DRAFT plus a completion summary.
//
// Hard rules:
// - Only consumer-reported facts are written (see lib/formmap.js).
//   Unconfirmed document extractions and conflicts are listed, never filled.
// - Signature fields are NEVER populated (registry guard + pattern check).
// - Nothing is signed, certified, submitted, or stored. The PDF exists
//   only in this request/response.
// - Every page is stamped "DRAFT — FOR REVIEW ONLY".

import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { entitlementStore } from './_lib/entitlement.js';
import { sanitizeFactRecord } from './_lib/facts.js';
import { getFormEntry, SIGNATURE_FIELD_PATTERN } from './_lib/forms/registry.js';
import { buildFillPlan, buildCompletionSummary } from './_lib/formmap.js';
import { isNarrativeApproved } from './_lib/narrative.js';

const limiter = createLimiter({ capacity: 5, windowMs: 10 * 60 * 1000 });
const MAX_BODY_BYTES = 256 * 1024;

const DRAFT_STAMP = 'DRAFT — FOR REVIEW ONLY — NOT SIGNED — NOT SUBMITTED';

function templateDir() {
  if (process.env.IRU_TEMPLATES_DIR) return process.env.IRU_TEMPLATES_DIR;
  return path.join(process.cwd(), 'forms', 'templates');
}

/**
 * Core generator (exported for tests).
 * @returns {Promise<{ pdfBytes: Uint8Array, summary: object }>}
 */
export async function generateFormDraft({ formId, factRecord }) {
  const entry = getFormEntry(formId);
  if (!entry) throw Object.assign(new Error(`unknown form: ${formId}`), { status: 400 });
  const record = sanitizeFactRecord(factRecord);
  if (!record) throw Object.assign(new Error('invalid fact record'), { status: 400 });

  // Narrative approval gate (successive directive §4), enforced at
  // generation — not only per-fact inside the fill plan. When the
  // applicant has a narrative on record, it must be reviewed and
  // approved before ANY draft is prepared from the record: the per-fact
  // hold in buildFillPlan keeps narrative-sourced values out of the
  // draft, but generation itself must also refuse, so an unapproved
  // story can never ride along inside a "successful" draft. A record
  // with NO narrative is unaffected (the narrative is optional).
  if (record.narrative && !isNarrativeApproved(record.narrative)) {
    throw Object.assign(new Error('narrative-not-approved'), {
      status: 422,
      code: 'narrative-not-approved',
      applicantMessage: 'Your story (personal narrative) has not been approved yet. Review and approve it in the "Your Story" section first — IRU prepares form drafts only from information you have reviewed and approved.',
    });
  }

  const plan = buildFillPlan(record, entry);
  const templatePath = path.join(templateDir(), entry.templateFile);
  const templateBytes = await readFile(templatePath);
  const doc = await PDFDocument.load(templateBytes, { updateMetadata: false });
  const form = doc.getForm();

  // Type-aware, fault-tolerant filling: official forms mix text fields,
  // dropdowns (e.g. state picklists) and checkboxes. A field that cannot
  // accept the value is reported in the summary — never silently dropped,
  // never allowed to fail the whole draft.
  plan.fillErrors = [];
  const actuallyFilled = [];
  for (const item of plan.fill) {
    if (SIGNATURE_FIELD_PATTERN.test(item.pdfField)) {
      throw new Error(`refusing to fill signature field: ${item.pdfField}`);
    }
    try {
      const field = form.getField(item.pdfField);
      const typeName = field.constructor.name;
      if (item.kind === 'checkbox' || typeName === 'PDFCheckBox') {
        field.check();
      } else if (typeName === 'PDFDropdown') {
        const options = field.getOptions();
        if (!options.includes(item.value)) {
          throw new Error(`value is not one of the field's options`);
        }
        field.select(item.value);
      } else if (typeName === 'PDFRadioGroup') {
        field.select(item.value);
      } else {
        field.setText(item.value);
      }
      actuallyFilled.push(item);
    } catch (err) {
      plan.fillErrors.push({ pdfField: item.pdfField, label: item.label, reason: String(err && err.message || err).slice(0, 160) });
    }
  }
  plan.fill = actuallyFilled;

  // Make AcroForm values authoritative for viewers: drop the XFA packet
  // (which carries no values) so the filled AcroForm appearances render.
  try {
    const acroForm = doc.catalog.get(PDFName.of('AcroForm'));
    if (acroForm && typeof acroForm.delete === 'function') {
      acroForm.delete(PDFName.of('XFA'));
    }
  } catch { /* non-fatal: AcroForm values are still stored */ }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  try { form.updateFieldAppearances(font); } catch { /* appearances regenerate in most viewers */ }

  // Stamp every page as a draft.
  for (const page of doc.getPages()) {
    const { height } = page.getSize();
    page.drawText(DRAFT_STAMP, {
      x: 36, y: height - 14, size: 7.5, font, color: rgb(0.72, 0.1, 0.1),
    });
  }
  doc.setTitle(`${entry.id} — DRAFT for review (IRU)`);
  doc.setSubject('Draft generated by IRU for consumer review. Not signed. Not submitted.');

  const pdfBytes = await doc.save();
  const summary = buildCompletionSummary(entry, plan, record);
  return { pdfBytes, summary, plan };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  const rawBody = req.body;
  const bodySize = typeof rawBody === 'string' ? Buffer.byteLength(rawBody) : JSON.stringify(rawBody || {}).length;
  if (bodySize > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large.' });
  }
  const body = typeof rawBody === 'string' ? safeParse(rawBody) : (rawBody || {});
  if (!body) return res.status(400).json({ error: 'Invalid submission.' });

  // Entitlement gate (directive §11; B2C §3/§4 scope enforcement):
  // active ONLY when PAYWALL_ENABLED=true. Default off — the readiness
  // flow is unchanged. When on, authorization is checked HERE, on the
  // server, independently of any client state: the token must be paid,
  // its scope must cover THIS form (an evaluation token never qualifies;
  // a one-form token never covers the other form), and that form must
  // not already have been delivered under it. Consumption is per-form
  // and happens exactly once, only after a successful generation (a
  // failed generation leaves the entitlement intact for recovery/retry).
  const paywallOn = process.env.PAYWALL_ENABLED === 'true';
  let entitlementToken = '';
  if (paywallOn) {
    entitlementToken = (req.headers && req.headers['x-entitlement-token']) || body.entitlementToken || '';
    const peek = entitlementStore.peekForForm(entitlementToken, body.formId);
    if (!peek.ok) {
      return res.status(402).json({
        error: 'A paid entitlement covering this form is required to generate its draft, or that form has already been delivered.',
        reason: peek.reason,
      });
    }
  }

  try {
    const { pdfBytes, summary } = await generateFormDraft({
      formId: body.formId,
      factRecord: body.factRecord,
    });
    if (paywallOn) {
      const consumed = entitlementStore.consumeForForm(entitlementToken, body.formId);
      if (!consumed.ok) {
        console.error(`[iru] entitlement consume failed after generation: ${consumed.reason}`);
        return res.status(409).json({ error: 'This entitlement could not be completed. Please contact support with your entitlement reference.' });
      }
    }
    // Audit log: form id + counts only. Never fact values.
    console.log(`[iru] form draft generated: form=${summary.formId} populated=${summary.populated.length} missing=${summary.missingRequired.length} conflicts=${summary.conflicts.length}`);
    return res.status(200).json({
      ok: true,
      // Version identification: every generation is a distinct draft.
      // Only the most recent draft for a form is current; drafts made
      // before a correction are stale and must not be used.
      draftId: `draft_${randomBytes(6).toString('hex')}`,
      generatedAt: new Date().toISOString(),
      documentLabel: 'IRU Pre-filled Draft — Review and Correct',
      pdfBase64: Buffer.from(pdfBytes).toString('base64'),
      summary,
    });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    console.error('[iru] form generation error:', err && err.message ? err.message : err);
    // Applicant-facing refusals (e.g. the narrative approval gate) carry
    // their own clear message; everything else stays generic so internal
    // detail never leaks.
    const message = err && err.applicantMessage
      ? err.applicantMessage
      : status === 400 ? 'Invalid submission.' : 'Form generation unavailable. Please try again later.';
    return res.status(status).json({
      error: message,
      ...(err && err.code ? { reason: err.code } : {}),
    });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
