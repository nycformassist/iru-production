/**
 * POST /api/assessment/resume (changed from GET to accept body)
 * Body: { token, clientKey }
 * - Verifies SHA-256(clientKey) matches stored client_key_hash
 * - Returns 403 if key doesn't match (even with valid token)
 * - Returns 404 if token not found, 410 if expired
 */
import pg from 'pg';
import crypto from 'crypto';
import { entitlementStore } from './_lib/entitlement.js';
import { isInstitutionalServer } from './_lib/server-mode.js';
import { withDurableStore } from './_lib/withStore.js';

const { Pool } = pg;
let pool = null;
function getPool() {
    // Test hook (same globalThis convention as __IRU_AI_CLIENT__):
    // a test may inject a pool-like { query() } instead of Postgres.
    if (globalThis.__IRU_ASSESSMENT_DB__) return globalThis.__IRU_ASSESSMENT_DB__;
    if (!pool) {
        const connStr = process.env.IRU_DB_URL || process.env.DATABASE_URL;
        if (!connStr) throw new Error('IRU_DB_URL not configured');
        pool = new Pool({ connectionString: connStr, max: 5 });
    }
    return pool;
}

async function handler(req, res, store = entitlementStore) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    // Persistence gate (owner directive 2026-11-05): when the paywall
    // is on, resuming an assessment requires a paid entitlement — any
    // paid grant (persistence belongs to a paid case). Paywall off →
    // unchanged behavior. The save-token/clientKeyHash mechanics below
    // are unchanged for entitled calls. No consumption.
    // INSTITUTIONAL MODE: the organization holds access, so the consumer
    // paid-access gate is skipped (same pattern as assessment-save.js).
    if (process.env.PAYWALL_ENABLED === 'true' && !isInstitutionalServer()) {
        const token = (req.headers && req.headers['x-entitlement-token']) || '';
        const peek = store.peekByToken(token);
        if (!peek.ok) {
            return res.status(402).json({
                error: 'A paid entitlement is required to resume an assessment.',
                reason: peek.reason,
            });
        }
    }
    try {
        const { token, clientKey } = req.body || {};
        if (!token || !clientKey) {
            return res.status(400).json({ error: 'token and clientKey required' });
        }
        const clientKeyHash = crypto.createHash('sha256').update(clientKey).digest('hex');
        const db = getPool();
        const result = await db.query(
            `SELECT id, form_id, facts, progress, status, updated_at, expires_at, client_key_hash
             FROM assessments WHERE token=$1`,
            [token]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Assessment not found' });
        }
        const row = result.rows[0];
        // Verify client key (timing-safe compare)
        const stored = Buffer.from(row.client_key_hash, 'hex');
        const provided = Buffer.from(clientKeyHash, 'hex');
        if (stored.length !== provided.length || !crypto.timingSafeEqual(stored, provided)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (new Date(row.expires_at) < new Date()) {
            return res.status(410).json({ error: 'Assessment expired' });
        }
        await db.query(`UPDATE assessments SET updated_at=NOW() WHERE id=$1`, [row.id]);
        return res.status(200).json({
            form_id: row.form_id,
            facts: row.facts,
            progress: row.progress,
            status: row.status,
            updated_at: row.updated_at,
        });
    } catch (e) {
        console.error('assessment-resume error:', e.message);
        return res.status(500).json({ error: 'Resume failed' });
    }
}

// Raw handler for unit tests (singleton default). Vercel serves the
// durable-wrapped default: load → restore → run → save (CAS).
export { handler };
export default withDurableStore(handler);
