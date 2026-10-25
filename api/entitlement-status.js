// api/entitlement-status.js — Buyer recovery / status lookup (§11).
//
// A buyer whose delivery was interrupted can return with their
// entitlement token and learn whether it is paid and still usable.
// The token travels in a POST body (never a URL) to keep it out of logs.
// Rate-limited: the token is a bearer credential, so guessing is
// throttled per source (the tokens themselves are 192-bit random and
// stored only as SHA-256 hashes).

import { entitlementStore } from './_lib/entitlement.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { assertPaidStoreAvailable } from './_lib/paymentStore.js';

const limiter = createLimiter({ capacity: 10, windowMs: 10 * 60 * 1000 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  // Fail closed: with no durable backend configured, a lookup against
  // an empty in-process store would falsely report a paid purchase as
  // "not found". Refuse instead of lying (see lib/paymentStore.js).
  const storeGate = assertPaidStoreAvailable();
  if (!storeGate.ok) {
    return res.status(503).json({ error: 'Entitlement lookup is not configured.' });
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const token = body && typeof body.token === 'string' ? body.token : '';
  if (!token) return res.status(400).json({ error: 'Invalid submission.' });
  const ent = entitlementStore.getByToken(token);
  if (!ent) return res.status(404).json({ error: 'Entitlement not found.' });
  const view = entitlementStore.publicView(ent);
  // Usable = paid, still RESERVED, and (for scoped form grants) at
  // least one covered form has not been delivered yet. Legacy grants
  // keep their original whole-token semantics.
  let usable = ent.paidAt != null && ent.state === 'RESERVED';
  if (usable && ent.scope && ent.scope.kind === 'forms') {
    const forms = Array.isArray(ent.scope.forms) ? ent.scope.forms : [];
    usable = forms.some((f) => !(ent.consumedForms || []).includes(f));
  }
  return res.status(200).json({
    ok: true,
    entitlement: view,
    usable,
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
