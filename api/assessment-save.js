/**
 * POST /api/assessment/save
 * Body: { token?, clientKeyHash, form_id, facts, progress }
 * - clientKeyHash: SHA-256 hex of client-generated clientKey (required)
 * - If token provided: updates existing (verifies clientKeyHash matches)
 * - If no token: creates new, stores clientKeyHash
 */
import crypto from 'crypto';
import { entitlementStore } from './_lib/entitlement.js';
import { getPool, storageErrorResponse } from './_lib/assessment-store.js';

export default async function handler(req, res, store = entitlementStore) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    // Persistence gate (owner directive 2026-11-05): when the paywall
    // is on, saving an assessment requires a paid entitlement — any
    // paid grant (persistence belongs to a paid case). Paywall off →
    // unchanged behavior. The save-token/clientKeyHash mechanics below
    // are unchanged for entitled calls. No consumption.
    if (process.env.PAYWALL_ENABLED === 'true') {
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
        // 'i589' is accepted: the DTC app offers the I-589 questionnaire
        // and its Save Progress posts form_id 'i589' (fix 2026-11-12 —
        // the allowlist predates the I-589 form, so I-589 saves 400d).
        if (!form_id || !['n400','i485','i130','i90','i765','i589'].includes(form_id)) {
            return res.status(400).json({ error: 'Invalid form_id' });
        }
        const db = await getPool();
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
        return storageErrorResponse(res, e, 'Save failed');
    }
}
