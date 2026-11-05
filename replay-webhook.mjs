// replay-webhook.mjs — LOCAL webhook proof (documented deviation from the
// `stripe listen` plan: the CLI cannot auth with the surrogate key format,
// and no tunnel is reachable from this sandbox).
//
// Takes the REAL session object fetched live from Stripe's API, builds the
// checkout.session.completed event Stripe would emit after payment
// (payment_status 'paid'), signs it with the LOCAL whsec secret using
// Stripe's exact HMAC-SHA256 scheme (t=timestamp,v1=hmac), and POSTs it to
// the real local /api/webhook handler. This is equivalent to `stripe listen`
// forwarding: the CLI also signs locally with its own generated secret;
// Stripe never signs listen-forwarded events. It proves handler code,
// signature verification, entitlement creation on checkout.session.completed,
// and idempotency. It does NOT prove Stripe-to-URL transport (that is the
// owner's remaining preview step).
//
// Secrets are read from .env.local and never printed.
// Usage: node replay-webhook.mjs [event-id-suffix]
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const ROOT = new URL('.', import.meta.url).pathname;
const env = {};
for (const line of readFileSync(ROOT + '.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
}
const secret = env.STRIPE_WEBHOOK_SECRET;
if (!secret || !secret.startsWith('whsec_')) { console.error('no whsec secret in .env.local'); process.exit(1); }

const sess = JSON.parse(readFileSync('/tmp/replay-session.json', 'utf8'));
const obj = JSON.parse(readFileSync('/tmp/replay-session-object.json', 'utf8'));
obj.payment_status = 'paid'; // as Stripe sets it after a successful payment
const suffix = process.argv[2] || Date.now();
const event = {
  id: 'evt_replay_' + suffix,
  object: 'event',
  api_version: '2024-06-20',
  created: Math.floor(Date.now() / 1000),
  type: 'checkout.session.completed',
  livemode: false,
  data: { object: obj },
};
const payload = JSON.stringify(event);
const ts = Math.floor(Date.now() / 1000);
const sig = createHmac('sha256', secret).update(`${ts}.${payload}`, 'utf8').digest('hex');
const header = `t=${ts},v1=${sig}`;

async function post(label) {
  const r = await fetch('http://localhost:3002/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    body: payload,
  });
  const body = await r.json().catch(() => ({}));
  console.log(label, '-> HTTP', r.status, JSON.stringify(body));
  return body;
}

await post('first delivery');
await post('replay (same event id)');

// Entitlement check via the token captured at checkout.
const st = await fetch('http://localhost:3001/api/entitlement-status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: sess.entitlementToken }),
});
const sd = await st.json().catch(() => ({}));
console.log('entitlement-status -> HTTP', st.status, JSON.stringify(sd).slice(0, 300));
