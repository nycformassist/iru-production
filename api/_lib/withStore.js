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
 * (req, res, store = entitlementStore) signature, so existing tests
 * are unaffected: a caller may inject a fresh store as the 3rd arg
 * (the test contract — the injected store is used as-is and the caller
 * owns it, so no backend load/save applies), and a 2-arg call uses
 * the handler's default singleton store.
 *
 * When no durable backend is provisioned, the wrapper fails closed
 * (503) ONLY when the store is actually needed — paywall on in
 * consumer mode. When the paywall is off, or the build is
 * institutional (the handler never consults entitlements), the
 * request runs against the default store instead of 503ing; otherwise
 * every paywall-off and institutional request would fail in any
 * environment without a provisioned store.
 *
 * COMMERCE ONLY. The snapshot never holds immigration case data.
 */

import { createEntitlementStore } from './entitlement.js';
import { createPostgresSnapshotBackend } from './store-postgres.js';
import { createMemorySnapshotBackend, assertPaidStoreAvailable } from './paymentStore.js';
import { isInstitutionalServer } from './server-mode.js';

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

/** Response proxy: captures status/headers/body without sending.
 * Streaming support: handlers that stream (e.g. /api/analyze SSE via
 * res.write()/res.end()) have their chunks buffered and replayed in
 * order after the handler returns, so the wrapper can still persist
 * store mutations before anything reaches the client. Trade-off: a
 * streamed response is delivered only once the handler completes —
 * no incremental delivery while wrapped. */
function captureRes() {
  const captured = { statusCode: 200, headers: {}, body: undefined, chunks: [], ended: false };
  const res = {
    status(code) { captured.statusCode = code; return res; },
    json(obj) { captured.body = obj; return res; },
    setHeader(k, v) { captured.headers[k] = v; },
    write(chunk) {
      captured.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        captured.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk));
      }
      captured.ended = true;
      return res;
    },
    _captured: captured,
  };
  return res;
}

function replay(realRes, captured) {
  for (const [k, v] of Object.entries(captured.headers)) realRes.setHeader(k, v);
  if (captured.chunks.length > 0) {
    realRes.status(captured.statusCode);
    for (const chunk of captured.chunks) realRes.write(chunk);
    realRes.end();
    return;
  }
  realRes.status(captured.statusCode).json(captured.body);
}

// NOTE (Carbon Pass 2, finding H-5): the old mergeEntitlements step
// that merged the warm-instance in-memory singleton into every
// request's store was REMOVED — it re-introduced stale state across
// serverless instances, resurrected reset/migrated entitlements back
// into Postgres, and merged entitlements without recoveryIdentities,
// ledger, or intents. The durable snapshot is now the only source: a
// request store is restored from it, or starts empty when no snapshot
// exists. Tests that seed entitlements must pass the seeded store as
// the injectedStore arg or use _setTestBackend — never the singleton.

export function withDurableStore(handler, options = {}) {
  return async (req, res, injectedStore) => {
    // Test/embedding contract (Carbon Pass 1, finding 10 follow-up):
    // a caller-provided store is used as-is. The caller owns it
    // (seeds entitlements, observes mutations); no backend load/save
    // applies, and the handler writes directly to res so incremental
    // SSE delivery is preserved.
    if (injectedStore) {
      await handler(req, res, injectedStore);
      return;
    }
    // Fail closed exactly like the handlers' own gate — but only when
    // the store is actually needed. When the paywall is off, or the
    // build is institutional, the handler never consults entitlements,
    // so a missing backend must not 503 the request: run it against
    // the default (singleton) store instead. When the paywall IS on
    // in consumer mode, fail closed (503) so a paid user is not
    // wrongly denied with a 402 from an empty store.
    const gate = assertPaidStoreAvailable();
    if (!gate.ok) {
      if (process.env.PAYWALL_ENABLED === 'true' && !isInstitutionalServer()) {
        return res.status(503).json({ error: 'Checkout is not configured.' });
      }
      await handler(req, res);
      return;
    }
    const backend = backendFor();
    if (!backend) {
      return res.status(503).json({ error: 'Checkout is not configured.' });
    }

    // Read-only peek path (Carbon Pass 2, finding H-5): handlers that
    // only PEEK at entitlements never mutate the store, so there is
    // nothing to persist — load the durable snapshot, run the handler
    // directly against the real response, and stream without the
    // captureRes() buffering that defeated SSE delivery in
    // /api/analyze. `options.readOnly` is `true` for always-read-only
    // handlers, or a (req) => boolean predicate for handlers with
    // both a read-only path and a mutating path (analyze.js: the
    // limited-evaluation path CONSUMES, so it keeps the durable
    // capture-save-replay path below).
    const readOnlyOption = options.readOnly;
    const readOnly = typeof readOnlyOption === 'function' ? readOnlyOption(req) : !!readOnlyOption;
    if (readOnly) {
      const loaded = await backend.load();
      const store = createEntitlementStore();
      if (loaded && loaded.snapshot) store.restore(loaded.snapshot);
      await handler(req, res, store);
      return;
    }

    // Single attempt, retried once on version conflict.
    for (let attempt = 0; attempt < 2; attempt++) {
      const loaded = await backend.load();
      // The request store is a fresh store restored from the durable
      // snapshot ONLY — the warm-instance singleton is never merged
      // in (finding H-5). When no snapshot exists the store starts
      // empty.
      const store = createEntitlementStore();
      if (loaded && loaded.snapshot) {
        store.restore(loaded.snapshot);
      }
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
