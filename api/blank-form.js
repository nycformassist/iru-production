// api/blank-form.js — The official BLANK form, served as a reference
// copy alongside a generated draft (B2C directive §5.B).
//
// Serves the exact verified official template stored in
// forms/templates/ (see forms/PROVENANCE.md) — the same edition the
// draft generator uses — completely unfilled. Labeled everywhere as
// "Official Blank Form — Reference Copy".
//
// Authorization posture (deliberate): the blank form is a public USCIS
// document, so no payment is required to view it — and serving it
// touches NO entitlement state: it cannot grant, consume, or unlock
// preparation of any form. Generated drafts (the paid deliverable)
// remain behind the scope-enforced gate in api/generate-form.js, and
// drafts are never stored or addressable, so there is no file here
// that one user could use to reach another user's output.
// Rate-limited to bound bulk scraping of the endpoint itself.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLimiter, clientIp } from './lib/ratelimit.js';
import { getFormEntry } from './lib/forms/registry.js';

const limiter = createLimiter({ capacity: 10, windowMs: 10 * 60 * 1000 });

export const BLANK_FORM_LABEL = 'Official Blank Form — Reference Copy';

function templateDir() {
  if (process.env.IRU_TEMPLATES_DIR) return process.env.IRU_TEMPLATES_DIR;
  return path.join(process.cwd(), 'forms', 'templates');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  const formId = (req.query && req.query.form) || '';
  const entry = getFormEntry(formId);
  if (!entry) {
    return res.status(400).json({ error: 'Unknown form. Supported blank forms: I-589, I-765.' });
  }
  try {
    const bytes = await readFile(path.join(templateDir(), entry.templateFile));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${entry.id}-official-blank-form.pdf"`);
    res.setHeader('X-Iru-Document-Label', BLANK_FORM_LABEL);
    res.setHeader('X-Iru-Form-Edition', entry.editionDate);
    res.status(200);
    return res.send(bytes);
  } catch (err) {
    console.error('[iru] blank form unavailable:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'The blank form is temporarily unavailable. You can download it from the official source linked in your summary.' });
  }
}
