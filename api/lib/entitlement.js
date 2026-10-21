/**
 * lib/entitlement.js — Pay-per-use entitlement core for IRU.
 *
 * Adapted from the audited ~/workspace/paygate core design (RESERVED →
 * CONSUMED / EXPIRED / VOID state machine, webhook-authoritative payment,
 * idempotent event processing, hashed claim tokens). Implemented here
 * with node:crypto HMAC token hashing and an in-memory store.
 *
 * LIMITS (honest): the store is per-process in-memory — suitable for
 * local and test-mode verification only. A durable store is required
 * before any production payment use (owner decision). NOTHING in this
 * module talks to Stripe or moves money.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ENTITLEMENT_STATES = ['RESERVED', 'CONSUMED', 'EXPIRED', 'VOID'];
export const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes to complete checkout
export const DEFAULT_CLAIM_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days to use a paid entitlement

const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

export function createEntitlementStore(now = () => Date.now()) {
  const byId = new Map();
  const byTokenHash = new Map();
  const bySessionId = new Map();
  const processedEvents = new Set();

  function expireIfNeeded(ent) {
    if (!ent) return null;
    if (ent.state === 'RESERVED') {
      const deadline = ent.paidAt
        ? ent.paidAt + (ent.claimWindowMs ?? DEFAULT_CLAIM_WINDOW_MS)
        : ent.createdAt + (ent.ttlMs ?? DEFAULT_TTL_MS);
      if (now() > deadline) {
        ent.state = 'EXPIRED';
        ent.expiredAt = now();
      }
    }
    return ent;
  }

  return {
    /**
     * Create a RESERVED entitlement. Returns the record + one-time raw token.
     *
     * B2C scope (lib/pricing.js): `scope` describes what the purchase
     * grants — { kind: 'evaluation' } or { kind: 'forms', forms: [...] }.
     * A null scope is the pre-B2C legacy grant (any one form draft, whole-
     * token consumption). `parentId` links an upgrade/add-on entitlement
     * to the entitlement it builds on; `creditedCents`/`totalCents` record
     * the server-computed price chain (credit applied / buyer's total).
     */
    create({ sku, amountCents, currency = 'usd', sessionId = null, ttlMs = DEFAULT_TTL_MS, claimWindowMs = DEFAULT_CLAIM_WINDOW_MS, scope = null, parentId = null, creditedCents = 0, totalCents = null }) {
      const id = `ent_${randomBytes(9).toString('hex')}`;
      const token = randomBytes(24).toString('base64url');
      const ent = {
        id, sku, amountCents, currency, sessionId,
        tokenHash: hashToken(token),
        state: 'RESERVED',
        createdAt: now(), paidAt: null, consumedAt: null, expiredAt: null, voidedAt: null,
        ttlMs, claimWindowMs, lastEventId: null,
        scope: scope ? JSON.parse(JSON.stringify(scope)) : null,
        parentId: parentId || null,
        creditedCents: creditedCents || 0,
        totalCents: totalCents === null || totalCents === undefined ? amountCents : totalCents,
        consumedForms: [],
      };
      byId.set(id, ent);
      byTokenHash.set(ent.tokenHash, id);
      if (sessionId) bySessionId.set(sessionId, id);
      return { entitlement: { ...ent }, token };
    },

    attachSession(id, sessionId) {
      const ent = byId.get(id);
      if (!ent) return null;
      ent.sessionId = sessionId;
      bySessionId.set(sessionId, id);
      return ent;
    },

    getById(id) {
      return expireIfNeeded(byId.get(id) || null);
    },

    getBySessionId(sessionId) {
      const id = bySessionId.get(sessionId);
      return id ? expireIfNeeded(byId.get(id) || null) : null;
    },

    /** Constant-time token lookup. Returns the entitlement or null. */
    getByToken(token) {
      if (!token || typeof token !== 'string') return null;
      const h = hashToken(token);
      const id = byTokenHash.get(h);
      if (!id) return null;
      const ent = byId.get(id);
      // Defense in depth: constant-time compare of the stored hash.
      const a = Buffer.from(h);
      const b = Buffer.from(ent.tokenHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      return expireIfNeeded(ent);
    },

    /**
     * Webhook-authoritative payment marking. Idempotent per event id:
     * returns { applied: false, duplicate: true } for replays.
     */
    markPaidBySession(sessionId, eventId) {
      if (eventId && processedEvents.has(eventId)) return { applied: false, duplicate: true };
      const ent = this.getBySessionId(sessionId);
      // The event id is burned ONLY once the event has been applied (or
      // is a genuine duplicate of an applied one). An event that arrives
      // before its session is attached — or for an unknown session —
      // must remain deliverable: Stripe redelivery can still fulfill.
      if (!ent) return { applied: false, duplicate: false, reason: 'unknown-session' };
      if (ent.state !== 'RESERVED') return { applied: false, duplicate: false, reason: `state-${ent.state}` };
      if (ent.paidAt) {
        if (eventId) processedEvents.add(eventId);
        return { applied: false, duplicate: true };
      }
      if (eventId) processedEvents.add(eventId);
      ent.paidAt = now();
      ent.lastEventId = eventId || null;
      return { applied: true, duplicate: false, entitlement: ent };
    },

    hasProcessedEvent(eventId) {
      return processedEvents.has(eventId);
    },

    /** Consume a PAID entitlement for delivery. Atomic within the process. */
    consumeByToken(token) {
      const ent = this.getByToken(token);
      if (!ent) return { ok: false, reason: 'unknown-token' };
      if (!ent.paidAt) return { ok: false, reason: 'not-paid' };
      if (ent.state === 'CONSUMED') return { ok: false, reason: 'already-consumed' };
      if (ent.state !== 'RESERVED') return { ok: false, reason: `state-${ent.state}` };
      ent.state = 'CONSUMED';
      ent.consumedAt = now();
      return { ok: true, entitlement: ent };
    },

    /** Check (without consuming) that a token is paid and usable. */
    peekByToken(token) {
      const ent = this.getByToken(token);
      if (!ent) return { ok: false, reason: 'unknown-token' };
      if (!ent.paidAt) return { ok: false, reason: 'not-paid' };
      if (ent.state !== 'RESERVED') return { ok: false, reason: `state-${ent.state}` };
      return { ok: true, entitlement: ent };
    },

    /** Entitlements created as upgrades/add-ons of a parent entitlement. */
    childrenOf(parentId) {
      if (!parentId) return [];
      const out = [];
      for (const ent of byId.values()) {
        if (ent.parentId === parentId) out.push(expireIfNeeded(ent));
      }
      return out;
    },

    /**
     * Scope-aware check for FORM generation: the token must be paid, its
     * scope must cover this specific form, and that form must not already
     * have been delivered under this entitlement. A legacy (null-scope)
     * entitlement covers any one form, as before.
     */
    peekForForm(token, formId) {
      const ent = this.getByToken(token);
      if (!ent) return { ok: false, reason: 'unknown-token' };
      if (!ent.paidAt) return { ok: false, reason: 'not-paid' };
      if (ent.state !== 'RESERVED') return { ok: false, reason: `state-${ent.state}` };
      if (!ent.scope) return { ok: true, entitlement: ent };
      if (ent.scope.kind !== 'forms') return { ok: false, reason: 'scope-mismatch' };
      if (!Array.isArray(ent.scope.forms) || !ent.scope.forms.includes(formId)) {
        return { ok: false, reason: 'form-not-covered' };
      }
      if ((ent.consumedForms || []).includes(formId)) return { ok: false, reason: 'form-already-delivered' };
      return { ok: true, entitlement: ent };
    },

    /**
     * Scope-aware consumption for one form delivery. Per-form for scoped
     * entitlements (a two-form bundle is exhausted only when BOTH forms
     * have been delivered); whole-token for legacy entitlements.
     */
    consumeForForm(token, formId) {
      const peek = this.peekForForm(token, formId);
      if (!peek.ok) return peek;
      const ent = peek.entitlement;
      if (!ent.scope) return this.consumeByToken(token);
      ent.consumedForms = [...(ent.consumedForms || []), formId];
      const covered = ent.scope.forms || [];
      if (covered.length > 0 && covered.every((f) => ent.consumedForms.includes(f))) {
        ent.state = 'CONSUMED';
        ent.consumedAt = now();
      }
      return { ok: true, entitlement: ent };
    },

    /**
     * Scope-aware check for the LIMITED EVALUATION: only an entitlement
     * whose scope is the evaluation itself qualifies. A form entitlement
     * (or a legacy token) never unlocks it, and vice versa.
     */
    peekForEvaluation(token) {
      const ent = this.getByToken(token);
      if (!ent) return { ok: false, reason: 'unknown-token' };
      if (!ent.paidAt) return { ok: false, reason: 'not-paid' };
      if (ent.state !== 'RESERVED') return { ok: false, reason: `state-${ent.state}` };
      if (!ent.scope || ent.scope.kind !== 'evaluation') return { ok: false, reason: 'scope-mismatch' };
      return { ok: true, entitlement: ent };
    },

    void(id, reason) {
      const ent = byId.get(id);
      if (!ent) return null;
      if (ent.state === 'RESERVED') {
        ent.state = 'VOID';
        ent.voidedAt = now();
        ent.voidReason = reason || 'voided';
      }
      return ent;
    },

    /** Public view: never exposes the token hash or the session id. */
    publicView(ent) {
      if (!ent) return null;
      return {
        id: ent.id, sku: ent.sku, amountCents: ent.amountCents, currency: ent.currency,
        state: ent.state, paid: !!ent.paidAt,
        createdAt: ent.createdAt, paidAt: ent.paidAt, consumedAt: ent.consumedAt,
        scope: ent.scope
          ? { kind: ent.scope.kind, forms: Array.isArray(ent.scope.forms) ? [...ent.scope.forms] : [] }
          : null,
        creditedCents: ent.creditedCents || 0,
        totalCents: ent.totalCents === undefined ? ent.amountCents : ent.totalCents,
        consumedForms: [...(ent.consumedForms || [])],
      };
    },
  };
}

/** Process-wide store (per-instance; see module limits). */
export const entitlementStore = createEntitlementStore();
