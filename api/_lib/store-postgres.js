/**
 * lib/store-postgres.js — Postgres snapshot backend for the entitlement
 * store (Phase 1). Implements the durable contract from lib/paymentStore.js:
 * load() / save(snapshot, expectedVersion) with compare-and-swap on the
 * row version, so two instances cannot both commit a grant.
 *
 * COMMERCE ONLY. The snapshot holds entitlement/credit/event/intent/
 * recovery records. It never holds immigration case data.
 */

import pg from 'pg';

const { Pool } = pg;

const SNAPSHOT_ID = 'entitlements';

export function createPostgresSnapshotBackend(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') {
    throw new Error('createPostgresSnapshotBackend: connection string required');
  }
  const pool = new Pool({ connectionString, max: 5 });

  return {
    kind: 'postgres-snapshot',
    durable: true,

    async init() {
      // Verifies connectivity. Schema is managed by sql/schema.sql.
      await pool.query('SELECT 1');
    },

    async close() {
      await pool.end();
    },

    /** Returns { version, snapshot } or null when no snapshot exists yet. */
    async load() {
      const { rows } = await pool.query(
        'SELECT version, data FROM store_snapshots WHERE id = $1',
        [SNAPSHOT_ID]
      );
      if (rows.length === 0) return null;
      return { version: rows[0].version, snapshot: rows[0].data };
    },

    /**
     * Compare-and-swap save. Returns { ok: true, version } on success,
     * { ok: false, reason: 'version-conflict', version } when another
     * writer committed first — the caller must reload and retry.
     * expectedVersion is null when no snapshot exists yet.
     */
    async save(snapshot, expectedVersion) {
      const data = JSON.stringify(snapshot);
      if (expectedVersion == null) {
        // First write ever: insert only if the row is still absent.
        const { rows } = await pool.query(
          `INSERT INTO store_snapshots (id, version, data, updated_at)
           VALUES ($1, 1, $2::jsonb, now())
           ON CONFLICT (id) DO NOTHING
           RETURNING version`,
          [SNAPSHOT_ID, data]
        );
        if (rows.length === 1) return { ok: true, version: 1 };
        // Lost the race: fall through to the CAS update below.
        const cur = await this.load();
        expectedVersion = cur ? cur.version : null;
        if (expectedVersion == null) {
          return { ok: false, reason: 'version-conflict', version: null };
        }
      }
      const { rows } = await pool.query(
        `UPDATE store_snapshots
           SET version = version + 1, data = $2::jsonb, updated_at = now()
         WHERE id = $1 AND version = $3
         RETURNING version`,
        [SNAPSHOT_ID, data, expectedVersion]
      );
      if (rows.length === 0) {
        const cur = await this.load();
        return { ok: false, reason: 'version-conflict', version: cur ? cur.version : null };
      }
      return { ok: true, version: rows[0].version };
    },
  };
}
