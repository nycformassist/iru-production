/**
 * lib/paymentStore.js — Durable-store provider interface + fail-closed gate.
 *
 * HONEST STATUS (payment-hardening directive 2026-10-24; Phase 1 2026-10-30):
 * the Postgres snapshot backend is implemented (api/_lib/store-postgres.js,
 * sql/schema.sql) but no database is provisioned yet — set IRU_DATABASE_URL
 * to activate it. Until then this module does NOT make the in-memory store
 * durable. It does three things:
 *
 * 1. Backend selection is explicit (IRU_STORE_BACKEND). The only backend
 *    available in this tree is the in-memory test adapter, and it is
 *    usable for paid paths ONLY with the explicit opt-in
 *    IRU_ALLOW_EPHEMERAL_STORE=true. Anything else — unset, unknown,
 *    or the unprovisioned 'postgres' name — makes paid paths refuse
 *    with 503 instead of creating ambiguous purchase states.
 * 2. Snapshot interface: the entitlement store can serialize its full
 *    state (snapshot()) and rebuild from it (restore()). A provisioned
 *    durable backend MUST implement load()/save(snapshot, expectedVersion)
 *    with compare-and-swap versioning, and handlers MUST load at request
 *    start and save after mutation in a single atomic step together with
 *    event burning. The memory snapshot backend below proves the
 *    interface (including CAS version conflicts) and backs the
 *    restart/persistence tests. It is labeled test-only everywhere.
 * 3. The gate (assertPaidStoreAvailable) is what handlers consult before
 *    creating a checkout, applying a webhook event, or answering a
 *    status lookup. A webhook refused by the gate does NOT burn its
 *    event, so Stripe redelivery still fulfills after provisioning.
 *
 * Provisioning requirement (exact): a Postgres service (or equivalent
 * durable store) + IRU_DATABASE_URL + the `pg` driver dependency + a
 * migration creating one versioned snapshot row (or one row per
 * entitlement/event/exception/intent with unique constraints) + the
 * handler load/save wiring described above + a test-mode delivery run.
 * Until then, paid production behavior is refused by design.
 */

export function resolvePaymentBackend(env = process.env) {
  const kind = env.IRU_STORE_BACKEND;
  if (kind === 'memory') {
    if (env.IRU_ALLOW_EPHEMERAL_STORE === 'true') {
      return {
        available: true, kind: 'memory', durable: false, ephemeral: true,
        reason: 'Explicit ephemeral test adapter (IRU_ALLOW_EPHEMERAL_STORE=true). NOT production durability: state is lost on restart/redeploy and is not shared across instances.',
      };
    }
    return {
      available: false, kind: 'memory', durable: false,
      reason: 'Memory backend requires IRU_ALLOW_EPHEMERAL_STORE=true (explicit test opt-in). Refusing paid paths.',
    };
  }
  if (kind === 'postgres') {
    if (env.IRU_DATABASE_URL) {
      return {
        available: true, kind: 'postgres', durable: true,
        reason: 'Postgres snapshot backend (IRU_DATABASE_URL). Commerce snapshot with compare-and-swap versioning.',
      };
    }
    return {
      available: false, kind: 'postgres', durable: false,
      reason: 'Postgres backend selected but IRU_DATABASE_URL is not set. Refusing paid paths.',
    };
  }
  if (kind) {
    return { available: false, kind, durable: false, reason: `Unknown store backend '${kind}'. Refusing paid paths.` };
  }
  return {
    available: false, kind: null, durable: false,
    reason: 'No store backend configured (set IRU_STORE_BACKEND). Refusing paid paths.',
  };
}

/** Returns { ok: true, backend } or { ok: false, backend }. */
export function assertPaidStoreAvailable(env = process.env) {
  const backend = resolvePaymentBackend(env);
  return backend.available ? { ok: true, backend } : { ok: false, backend };
}

/**
 * Versioned snapshot backend (test adapter; durable: false).
 * save() is compare-and-swap on the version: a stale writer loses and
 * must reload, which is the contract the provisioned backend must also
 * satisfy so two instances cannot both commit a grant.
 */
export function createMemorySnapshotBackend() {
  let snapshot = null;
  let version = 0;
  return {
    kind: 'memory-snapshot',
    durable: false,
    async load() {
      // Shape matches the Postgres backend: { version, snapshot }.
      // Returns null when no snapshot exists yet.
      return snapshot ? { version, snapshot: JSON.parse(JSON.stringify(snapshot)) } : null;
    },
    async loadVersion() {
      return version;
    },
    async save(next, expectedVersion) {
      const expected = expectedVersion == null ? 0 : expectedVersion;
      if (expected !== version) {
        return { ok: false, reason: 'version-conflict', version };
      }
      version += 1;
      snapshot = JSON.parse(JSON.stringify(next));
      return { ok: true, version };
    },
  };
}
