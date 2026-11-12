/**
 * /api/assessment — Assessment dispatcher (save + resume).
 *
 * CONSOLIDATION (Vercel Hobby 12-function limit, 2026-11-12): this
 * single function serves both assessment endpoints, dispatching on
 * ?route= (vercel.json rewrites the original URLs here):
 *   POST /api/assessment-save   → /api/assessment?route=save
 *   POST /api/assessment-resume → /api/assessment?route=resume
 * The two handlers below are moved verbatim from
 * api/assessment-save.js and api/assessment-resume.js (both deleted);
 * every URL, method, request shape, and response shape is preserved.
 * The two originals shared one Postgres pool (same DB, same
 * __IRU_ASSESSMENT_DB__ test hook), so this file keeps a single
 * getPool() for both routes.
 *
 * POST /api/assessment/save
 * Body: { token?, clientKeyHash, form_id, facts, progress }
 * - clientKeyHash: SHA-256 hex of client-generated clientKey (required)
 * - If token provided: updates existing (verifies clientKeyHash matches)
 * - If no token: creates new, stores clientKeyHash
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

async function saveHandler(req, res, store = entitlementStore) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    // Persistence gate (owner directive 2026-11-05): when the paywall
    // is on, saving an assessment requires a paid entitlement — any
    // paid grant (persistence belongs to a paid case). Paywall off →
    // unchanged behavior. The save-token/clientKeyHash mechanics below
    // are unchanged for entitled calls. No consumption.
    // INSTITUTIONAL MODE: the organization holds access, so the consumer
    // paid-access gate is skipped (isInstitutionalServer reads the
    // build-time mode; fail-closed to the consumer gate).
    if (process.env.PAYWALL_ENABLED === 'true' && !isInstitutionalServer()) {
        const token = (req.headers && req.headers['x-entitlement-token']) || '';
        const peek = store.peekByToken(token);
        if (!peek.ok) {
            return res.status(402).json({
                error: 'A paid entitlement is required to save an assessment.',
                reason: peek.reason,
            });
        }
    }
    try {
        const { token, clientKeyHash, form_id, facts, progress } = req.body || {};
        if (!clientKeyHash || !/^[a-f0-9]{64}$/.test(clientKeyHash)) {
            return res.status(400).json({ error: 'clientKeyHash required (SHA-256 hex)' });
        }
        if (!form_id || !['n400','i485','i130','i90','i765','i589'].includes(form_id)) {
            return res.status(400).json({ error: 'Invalid form_id' });
        }
        const db = getPool();
        if (token) {
            const result = await db.query(
                `UPDATE assessments SET facts=$1, progress=$2, updated_at=NOW(), status='in_progress'
                 WHERE token=$3 AND client_key_hash=$4 AND expires_at > NOW()
                 RETURNING id, token, updated_at`,
                [JSON.stringify(facts||{}), JSON.stringify(progress||{}), token, clientKeyHash]
            );
            if (result.rows.length === 0) {
                // Distinguish: wrong token vs wrong key (both 403 to avoid oracle)
                return res.status(403).json({ error: 'Access denied' });
            }
            return res.status(200).json({
                token: result.rows[0].token,
                assessment_id: result.rows[0].id,
                updated_at: result.rows[0].updated_at,
            });
        } else {
            const newToken = crypto.randomBytes(32).toString('hex');
            const result = await db.query(
                `INSERT INTO assessments (token, client_key_hash, form_id, facts, progress)
                 VALUES ($1,$2,$3,$4,$5) RETURNING id, token, created_at`,
                [newToken, clientKeyHash, form_id, JSON.stringify(facts||{}), JSON.stringify(progress||{})]
            );
            return res.status(201).json({
                token: result.rows[0].token,
                assessment_id: result.rows[0].id,
                created_at: result.rows[0].created_at,
            });
        }
    } catch (e) {
        console.error('assessment-save error:', e.message);
        return res.status(500).json({ error: 'Save failed' });
    }
}

/**
 * POST /api/assessment/resume (changed from GET to accept body)
 * Body: { token, clientKey }
 * - Verifies SHA-256(clientKey) matches stored client_key_hash
 * - Returns 403 if key doesn't match (even with valid token)
 * - Returns 404 if token not found, 410 if expired
 * Moved verbatim from api/assessment-resume.js.
 */
async function resumeHandler(req, res, store = entitlementStore) {
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

// Wrapped single-route handlers, in the exact shape of the two
// originals' defaults (Vercel serves the durable-wrapped default:
// load → restore → run → save (CAS)). Tests import these and call
// them with an injected store, as they did the originals.
// Read-only peek gate (Carbon Pass 2, finding H-5): these handlers
// only peek at entitlements, never mutate the store, so the durable
// snapshot is loaded and the handler runs directly against the real
// response without captureRes() buffering.
const wrappedSaveHandler = withDurableStore(saveHandler, { readOnly: true });
const wrappedResumeHandler = withDurableStore(resumeHandler, { readOnly: true });
export { wrappedSaveHandler as saveHandler, wrappedResumeHandler as resumeHandler };

// ── Dispatcher (Vercel serves this file as one function) ──────────────
// vercel.json rewrites /api/assessment-save and /api/assessment-resume
// here with ?route= set. The dispatcher is itself durable-wrapped
// (readOnly) exactly as the two originals were, and it passes the
// store through to the inner handler. An unknown or missing route is
// a 404 (the route does not exist), never a fallback to a handler.
async function dispatcher(req, res, store) {
    const route = req.query && typeof req.query.route === 'string' ? req.query.route : '';
    if (route === 'save') return saveHandler(req, res, store);
    if (route === 'resume') return resumeHandler(req, res, store);
    return res.status(404).json({ error: 'Not found.' });
}
export default withDurableStore(dispatcher, { readOnly: true });
