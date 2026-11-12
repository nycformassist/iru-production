/**
 * api/_lib/assessment-store.js — shared Postgres pool + schema provisioning
 * for the assessment save/resume handlers (api/assessment-save.js,
 * api/assessment-resume.js).
 *
 * Defect (live walk 2026-11-12, ported from institutional commit
 * ac857d1): "Save Progress" failed with a generic 500 'Save failed'
 * because the `assessments` table never existed in the provisioned
 * database. The DDL was defined in api/_lib/assessment-schema.sql
 * but nothing ever applied it, so the first live save's INSERT threw
 * "relation assessments does not exist". The handlers now ensure the
 * table exists (CREATE TABLE IF NOT EXISTS + indexes, once per pool)
 * before the first query, and a missing/failing store is an honest
 * 503 instead of a generic 500.
 */
import pg from 'pg';

const { Pool } = pg;

// Assessment table DDL — canonical copy lives in
// api/_lib/assessment-schema.sql. The save/resume handlers ensure it
// exists before the first query (see ensureAssessmentSchema): the DDL
// was defined but never applied to the provisioned database, so the
// first live save failed with "relation \"assessments\" does not
// exist" (500 'Save failed'). CREATE TABLE IF NOT EXISTS is
// idempotent — a provisioned table is untouched.
const ASSESSMENT_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    client_key_hash TEXT NOT NULL,
    form_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    facts JSONB NOT NULL DEFAULT '{}',
    progress JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);
CREATE INDEX IF NOT EXISTS idx_assessments_token ON assessments(token);
CREATE INDEX IF NOT EXISTS idx_assessments_form ON assessments(form_id);
`;

// Pools already ensured (module-level: a warm serverless instance runs
// the DDL once; a cold start runs it once per pool). Keyed by pool
// object so injected test DBs are ensured once each, too. A failed
// ensure is NOT recorded, so a retry re-attempts it.
const ensuredPools = new WeakSet();

async function ensureAssessmentSchema(db) {
  if (ensuredPools.has(db)) return;
  try {
    await db.query(ASSESSMENT_SCHEMA_DDL);
  } catch (e) {
    const err = new Error(`assessment schema ensure failed: ${e.message}`);
    err.code = 'ASSESSMENT_STORE_UNAVAILABLE';
    throw err;
  }
  ensuredPools.add(db);
}

let pool = null;

export async function getPool() {
  // Test hook (same globalThis convention as __IRU_AI_CLIENT__):
  // a test may inject a pool-like { query() } instead of Postgres.
  if (globalThis.__IRU_ASSESSMENT_DB__) {
    const db = globalThis.__IRU_ASSESSMENT_DB__;
    await ensureAssessmentSchema(db);
    return db;
  }
  if (!pool) {
    const connStr = process.env.IRU_DB_URL || process.env.DATABASE_URL;
    if (!connStr) {
      const err = new Error('IRU_DB_URL not configured');
      err.code = 'ASSESSMENT_STORE_NOT_CONFIGURED';
      throw err;
    }
    pool = new Pool({ connectionString: connStr, max: 5 });
  }
  await ensureAssessmentSchema(pool);
  return pool;
}

// Map a storage failure to the honest status: a missing database URL
// or an unreachable/failing database is a 503 (storage unavailable —
// the caller can retry later), never a generic 500 'Save failed'
// that hides the cause. Unexpected errors keep the 500.
export function storageErrorResponse(res, e, fallbackError) {
  if (e && e.code === 'ASSESSMENT_STORE_NOT_CONFIGURED') {
    return res.status(503).json({ error: 'Assessment storage is not configured' });
  }
  if (e && (e.code === 'ASSESSMENT_STORE_UNAVAILABLE' || typeof e.code === 'string')) {
    // Postgres / system error code from the pool or a query
    // (connection refused, missing relation, auth): the store is
    // unavailable. The exact error is logged server-side above.
    return res.status(503).json({ error: 'Assessment storage is not available' });
  }
  return res.status(500).json({ error: fallbackError });
}
