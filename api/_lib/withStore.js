/**
 * lib/withStore.js — Durable-store request wiring (Phase 1).
 *
 * Wraps a handler so each request runs against a store restored from
 * the durable snapshot, then persists mutations with compare-and-swap:
 *
 *   load snapshot → restore store → run handler → if dirty, save (CAS)
 *
 * On a version conflict the request is retried once against a fresh
 * snapshot; a second conflict fails closed (503) so the caller retries.
 * For webhooks that means Stripe redelivery; for checkout the client
 * retries with the same idempotency key.
 *
 * The wrapped handler receives (req, res, store). Handlers keep their
 * (req, res) signature with the singleton default, so existing tests
 * are unaffected.
 *
 * COMMERCE ONLY. The snapshot never holds immigration case data.
 */

import { createEntitlementStore } from './entitlement.js';
import { createPostgresSnapshotBackend } from './store-postgres.js';
import { createMemorySnapshotBackend, assertPaidStoreAvailable } from './paymentStore.js';

/** Returns a snapshot backend instance, or null when not configured. */
export function getSnapshotBackend(env = process.env) {
  const kind = env.IRU_STORE_BACKEND;
  if (kind === 'postgres' && env.IRU_DB_URL) {
    return createPostgresSnapshotBackend(env.IRU_DB_URL);
  }
  if (kind === 'memory' && env.IRU_ALLOW_EPHEMERAL_STORE === 'true') {
    return createMemorySnapshotBackend();
  }
  return null;
}

// Process-wide backend cache: creating a Postgres pool per request
// would exhaust connections. Tests may inject their own backend.
let cachedBackend = null;
let cachedEnvKey = null;

export function _setTestBackend(backend) {
  cachedBackend = backend;
  cachedEnvKey = 'test';
}

export function _clearBackendCache() {
  cachedBackend = null;
  cachedEnvKey = null;
}

function backendFor(env = process.env) {
  const key = `${env.IRU_STORE_BACKEND || ''}|${env.IRU_DB_URL || ''}|${env.IRU_ALLOW_EPHEMERAL_STORE || ''}`;
  if (cachedBackend && cachedEnvKey === key) return cachedBackend;
  if (cachedBackend && cachedEnvKey === 'test') return cachedBackend;
  cachedBackend = getSnapshotBackend(env);
  cachedEnvKey = key;
  return cachedBackend;
}

/** Response proxy: captures status/headers/body without sending. */
function captureRes() {
  const captured = { statusCode: 200, headers: {}, body: undefined };
  const res = {
    status(code) { captured.statusCode = code; return res; },
    json(obj) { captured.body = obj; return res; },
    setHeader(k, v) { captured.headers[k] = v; },
    _captured: captured,
  };
  return res;
}

function replay(realRes, captured) {
  for (const [k, v] of Object.entries(captured.headers)) realRes.setHeader(k, v);
  realRes.status(captured.statusCode).json(captured.body);
}

export function withDurableStore(handler) {
  return async (req, res) => {
    // Fail closed exactly like the handlers' own gate.
    const gate = assertPaidStoreAvailable();
    if (!gate.ok) {
      return res.status(503).json({ error: 'Checkout is not configured.' });
    }
    const backend = backendFor();
    if (!backend) {
      return res.status(503).json({ error: 'Checkout is not configured.' });
    }

    // Single attempt, retried once on version conflict.
    for (let attempt = 0; attempt < 2; attempt++) {
      const loaded = await backend.load();
      const store = createEntitlementStore();
      if (loaded && loaded.snapshot) store.restore(loaded.snapshot);
      const before = JSON.stringify(store.snapshot());

      const proxy = captureRes();
      await handler(req, proxy, store);
      const after = JSON.stringify(store.snapshot());

      if (after === before) {
        replay(res, proxy._captured);
        return;
      }
      const saved = await backend.save(store.snapshot(), loaded ? loaded.version : null);
      if (saved.ok) {
        replay(res, proxy._captured);
        return;
      }
      // Version conflict: loop retries once with a fresh snapshot.
      if (attempt === 1) {
        console.error('[iru] durable store: version conflict after retry, failing closed');
      }
    }
    return res.status(503).json({ error: 'Temporary store conflict. Please try again.' });
  };
}
