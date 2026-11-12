// api/org-info.js — Server-configured staff receiving setup (read-only).
//
// GET /api/org-info returns the organizations whose completed-case
// reports the server will deliver, as [{ slug, orgName, configured }].
// NO email addresses are ever returned: the destination is
// server-configured at sale/install time (api/_lib/org-staff.js) and
// staff cannot change it from the device (Carbon Pass 2, finding C-2
// — the Staff Dashboard's editable client-side email input misled
// staff about where PII was sent, because the server allowlist is
// authoritative and a client-set slug/email can never route).
//
// The dashboard fetches this to display the receiving setup; the
// response carries no PII and no credentials, so it is not gated to
// institutional builds.

import { ORG_STAFF } from './_lib/org-staff.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }
  const orgs = Object.entries(ORG_STAFF).map(([slug, entry]) => ({
    slug,
    orgName: entry && typeof entry.name === 'string' ? entry.name : slug,
    configured: !!(entry && typeof entry.staffEmail === 'string' && entry.staffEmail.includes('@')),
  }));
  return res.status(200).json(orgs);
}
