// api/entitlement-status.js — Buyer recovery / status lookup (§11).
//
// A buyer whose delivery was interrupted can return with their
// entitlement token and learn whether it is paid and still usable.
// The token travels in a POST body (never a URL) to keep it out of logs.

import { entitlementStore } from './lib/entitlement.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const token = body && typeof body.token === 'string' ? body.token : '';
  if (!token) return res.status(400).json({ error: 'Invalid submission.' });
  const ent = entitlementStore.getByToken(token);
  if (!ent) return res.status(404).json({ error: 'Entitlement not found.' });
  const view = entitlementStore.publicView(ent);
  return res.status(200).json({
    ok: true,
    entitlement: view,
    usable: !!ent.paidAt && ent.state === 'RESERVED',
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
