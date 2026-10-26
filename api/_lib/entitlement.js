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
 * before any production payment use (owner decision); see
 * lib/paymentStore.js for the provider interface, the fail-closed gate,
 * and the exact provisioning requirement. NOTHING in this module talks
 * to Stripe or moves money.
 *
 * PAYMENT-HARDENING INVARIANTS (directive 2026-10-24):
 * - Upgrade family rule: within one upgrade family (all descendants of
 *   an evaluation root, transitively), the only valid paid sets are
 *   {one-form}, {one-form, second-form}, or {bundle} alone. A bundle
 *   never coexists with a paid one-form/add-on, and no upgrade SKU is
 *   ever paid twice in a family. Enforced at payment time, not only at
 *   checkout creation, so concurrent checkouts cannot both grant.
 * - Late payment: a confirmed payment for an expired/voided unpaid
 *   record is NEVER silently dropped. If the record, session identity
 *   and family all check out it is fulfilled late (fresh claim window
 *   from payment); otherwise it becomes a durable, observable
 *   exception for the documented manual-refund procedure. No refund is
 *   ever issued automatically and no unearned entitlement is granted.
 * - Events are burned only once adjudicated (applied, duplicate, or
 *   exception). Unknown-session and not-yet-applicable events stay
 *   deliverable so Stripe redelivery can still fulfill.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SKUS } from './pricing.js';

export const ENTITLEMENT_STATES = ['RESERVED', 'CONSUMED', 'EXPIRED', 'VOID'];
export const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes to complete checkout
export const DEFAULT_CLAIM_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days to use a paid entitlement

const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

const UPGRADE_SKUS = new Set([SKUS.ONE_FORM, SKUS.BUNDLE, SKUS.SECOND_FORM]);

export function createEntitlementStore(now = () => Date.now()) {
  const byId = new Map();
  const byTokenHash = new Map();
  const bySessionId = new Map();
  const processedEvents = new Set();
  // Durable, observable payment exceptions (paid-but-unfulfillable):
  // recorded, never auto-refunded, resolved only by the documented
  // manual procedure. See docs/PAYMENT_EXCEPTIONS_PROCEDURE.md.
  const exceptions = [];
  // Checkout idempotency intents: purchaseIntentKey -> original
  // checkout. The raw entitlement token is NEVER stored here (the
  // server keeps only its SHA-256 hash); a retry returns the original
  // session URL + entitlement id, not the token.
  const intents = new Map();

  /** Raw record read: no lazy-expiry flip (callers decide the semantics). */
  function rawBySessionId(sessionId) {
    const id = bySessionId.get(sessionId);
    return id ? (byId.get(id) || null) : null;
  }

  /** Walk parentId links to the family root (the evaluation entitlement). */
  function rootIdOf(ent) {
    let cur = ent;
    const seen = new Set();
    while (cur && cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur ? cur.id : null;
  }

  /** All transitive descendants of a root (children, grandchildren, ...). */
  function familyOf(rootId) {
    const out = [];
    const queue = [rootId];
    const seen = new Set([rootId]);
    while (queue.length > 0) {
      const pid = queue.shift();
      for (const ent of byId.values()) {
        if (ent.parentId === pid && !seen.has(ent.id)) {
          seen.add(ent.id);
          out.push(ent);
          queue.push(ent.id);
        }
      }
    }
    return out;
  }

  /**
   * Upgrade-family grant rule. Returns null when granting `candidate`
   * is commercially valid, or { reason, conflicting } when another paid
   * upgrade in the family forbids it. Valid paid sets: {one-form},
   * {one-form, second-form}, {bundle} alone.
   */
  function familyGrantConflict(candidate) {
    const root = rootIdOf(candidate);
    if (!root) return null;
    const paid = familyOf(root).filter(
      (e) => e.paidAt != null && e.id !== candidate.id && UPGRADE_SKUS.has(e.sku),
    );
    if (candidate.sku === SKUS.BUNDLE) {
      if (paid.length > 0) {
        return { reason: 'family-already-paid', conflicting: paid.map((e) => e.id) };
      }
    } else if (candidate.sku === SKUS.ONE_FORM) {
      if (paid.some((e) => e.sku === SKUS.BUNDLE || e.sku === SKUS.ONE_FORM)) {
        return { reason: 'family-already-paid', conflicting: paid.map((e) => e.id) };
      }
    } else if (candidate.sku === SKUS.SECOND_FORM) {
      if (paid.some((e) => e.sku === SKUS.BUNDLE || e.sku === SKUS.SECOND_FORM)) {
        return { reason: 'family-already-paid', conflicting: paid.map((e) => e.id) };
      }
      const parent = candidate.parentId ? byId.get(candidate.parentId) : null;
      if (!parent || parent.paidAt == null) {
        return { reason: 'parent-not-paid', conflicting: [] };
      }
    }
    return null;
  }

  function createException({ type, entitlementId, sessionId, eventId, amountCents, currency, reason, details }) {
    const ex = {
      id: `exc_${randomBytes(9).toString('hex')}`,
      type, entitlementId: entitlementId || null, sessionId: sessionId || null,
      eventId: eventId || null, amountCents: amountCents ?? null, currency: currency || null,
      reason, details: details || null, createdAt: now(),
      resolved: false, resolution: null, resolvedAt: null,
    };
    exceptions.push(ex);
    // Log ids + outcome only — never tokens, amounts-to-identity linkage beyond the session, or buyer data.
    console.error(`[iru] payment exception ${ex.id} type=${type} reason=${reason} entitlement=${ex.entitlementId} session=${ex.sessionId}`);
    return { ...ex };
  }

  function expireIfNeeded(ent) {
    if (!ent) return null;
    if (ent.state === 'RESERVED') {
      const deadline = ent.paidAt != null
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
     *
     * The event id is burned ONLY once the event has been adjudicated
     * (applied, duplicate, or exception). An event that arrives before
     * its session is attached — or for an unknown session — must remain
     * deliverable: Stripe redelivery can still fulfill.
     *
     * Synchronous by design: the check-then-mutate sequence below has
     * no await, so within one process two deliveries cannot interleave
     * between the family check and the grant. Cross-instance atomicity
     * is the provisioned durable backend's job (CAS versioning on the
     * snapshot; see lib/paymentStore.js) — the memory adapter proves
     * the in-process invariant only.
     */
    markPaidBySession(sessionId, eventId) {
      if (eventId && processedEvents.has(eventId)) return { applied: false, duplicate: true };
      const ent = rawBySessionId(sessionId);
      if (!ent) return { applied: false, duplicate: false, reason: 'unknown-session' };
      // Already paid (including a paid record past its claim window):
      // the payment was fulfilled once; a second event is a duplicate.
      if (ent.paidAt != null) {
        if (eventId) processedEvents.add(eventId);
        return { applied: false, duplicate: true };
      }
      const pastDeadline = ent.state === 'RESERVED'
        && now() > ent.createdAt + (ent.ttlMs ?? DEFAULT_TTL_MS);
      const late = ent.state === 'EXPIRED' || ent.state === 'VOID' || pastDeadline;
      if (!late && ent.state !== 'RESERVED') {
        return { applied: false, duplicate: false, reason: `state-${ent.state}` };
      }
      // Upgrade-family re-check at PAYMENT time (checkout creation
      // alone cannot stop two concurrently created upgrades).
      if (UPGRADE_SKUS.has(ent.sku)) {
        const conflict = familyGrantConflict(ent);
        if (conflict) {
          const ex = createException({
            type: 'duplicate-upgrade', entitlementId: ent.id, sessionId, eventId,
            amountCents: ent.amountCents, currency: ent.currency,
            reason: conflict.reason, details: { conflictingEntitlements: conflict.conflicting },
          });
          if (eventId) processedEvents.add(eventId);
          ent.lastEventId = eventId || null;
          return { applied: false, duplicate: false, reason: conflict.reason, exception: ex };
        }
      }
      if (eventId) processedEvents.add(eventId);
      ent.paidAt = now();
      // A late fulfillment re-opens the record with a fresh claim
      // window measured from payment (not from the lapsed checkout).
      ent.state = 'RESERVED';
      if (late) {
        ent.lateFulfilled = true;
        ent.fulfilledAfterExpiryAt = now();
      }
      ent.lastEventId = eventId || null;
      return { applied: true, duplicate: false, lateFulfilled: late || undefined, entitlement: ent };
    },

    /**
     * Adjudicate a verified payment event that cannot safely be
     * fulfilled (amount/currency/identity mismatch, found by the
     * webhook layer before markPaidBySession). Burns the event and
     * records a durable exception — the money is never silently kept
     * and the grant is never issued. Unknown sessions are NOT burned.
     */
    adjudicateMismatch(sessionId, eventId, mismatch) {
      if (eventId && processedEvents.has(eventId)) return { applied: false, duplicate: true };
      const ent = rawBySessionId(sessionId);
      if (!ent) return { applied: false, duplicate: false, reason: 'unknown-session' };
      const ex = createException({
        type: mismatch.type || 'unfulfillable-payment', entitlementId: ent.id, sessionId, eventId,
        amountCents: mismatch.amountCents ?? null, currency: mismatch.currency ?? null,
        reason: mismatch.reason, details: mismatch.details || null,
      });
      if (eventId) processedEvents.add(eventId);
      ent.lastEventId = eventId || null;
      return { applied: false, duplicate: false, reason: mismatch.reason, exception: ex };
    },

    /** Raw session record for webhook cross-checks (no expiry flip). */
    getSessionRecord(sessionId) {
      return rawBySessionId(sessionId);
    },

    /** Durable, observable payment exceptions (copies, newest last). */
    listExceptions() {
      return exceptions.map((e) => ({ ...e }));
    },

    /**
     * Mark an exception resolved by the documented manual procedure.
     * This records the resolution; it never issues a refund or a grant
     * (refunds happen in the Stripe dashboard by an authorized human).
     */
    resolveException(id, resolution) {
      const ex = exceptions.find((e) => e.id === id);
      if (!ex) return null;
      ex.resolved = true;
      ex.resolution = resolution || '';
      ex.resolvedAt = now();
      return { ...ex };
    },

    /** Checkout idempotency intents (token never stored — hash only). */
    saveIntent(key, record) {
      intents.set(key, { ...record, savedAt: now() });
      return { ...record };
    },
    getIntent(key) {
      const r = intents.get(key);
      return r ? { ...r } : null;
    },
    deleteIntent(key) {
      intents.delete(key);
    },

    /**
     * Full-state snapshot for the durable-backend interface
     * (lib/paymentStore.js): entitlements, processed events,
     * exceptions, and intents. Restore rebuilds every index.
     */
    snapshot() {
      return JSON.parse(JSON.stringify({
        version: 1,
        entitlements: [...byId.values()],
        processedEvents: [...processedEvents],
        exceptions: exceptions.map((e) => ({ ...e })),
        intents: [...intents.entries()],
      }));
    },
    restore(snap) {
      byId.clear(); byTokenHash.clear(); bySessionId.clear();
      processedEvents.clear(); exceptions.length = 0; intents.clear();
      for (const ent of snap.entitlements || []) {
        byId.set(ent.id, ent);
        byTokenHash.set(ent.tokenHash, ent.id);
        if (ent.sessionId) bySessionId.set(ent.sessionId, ent.id);
      }
      for (const e of snap.processedEvents || []) processedEvents.add(e);
      for (const e of snap.exceptions || []) exceptions.push({ ...e });
      for (const [k, v] of snap.intents || []) intents.set(k, { ...v });
    },

    hasProcessedEvent(eventId) {
      return processedEvents.has(eventId);
    },

    /**
     * Resolve an entitlement whose checkout session EXPIRED unpaid
     * (defect-closure directive 2026-10-23, Priority 6): an expired
     * session can never be paid, so the record is voided immediately
     * instead of dangling as RESERVED until its TTL lapses. Same
     * idempotency discipline as markPaidBySession (unknown-session
     * events are not burned; replays are duplicates). A paid or
     * consumed record is never touched.
     */
    voidByExpiredSession(sessionId, eventId) {
      if (eventId && processedEvents.has(eventId)) return { applied: false, duplicate: true };
      const ent = this.getBySessionId(sessionId);
      if (!ent) return { applied: false, duplicate: false, reason: 'unknown-session' };
      if (ent.paidAt != null || ent.state !== 'RESERVED') {
        if (eventId) processedEvents.add(eventId);
        return { applied: false, duplicate: false, reason: ent.paidAt != null ? 'already-paid' : `state-${ent.state}` };
      }
      if (eventId) processedEvents.add(eventId);
      ent.state = 'VOID';
      ent.voidedAt = now();
      ent.voidReason = 'checkout-session-expired';
      ent.lastEventId = eventId || null;
      return { applied: true, duplicate: false, entitlement: ent };
    },

    /**
     * Record a failed delayed payment (checkout.session.async_payment_failed)
     * for audit WITHOUT changing entitlement state: the buyer may retry
     * payment on the same still-open session, and a later
     * async_payment_succeeded for it must still mark the record paid.
     */
    notePaymentFailedBySession(sessionId, eventId) {
      if (eventId && processedEvents.has(eventId)) return { applied: false, duplicate: true };
      const ent = this.getBySessionId(sessionId);
      if (!ent) return { applied: false, duplicate: false, reason: 'unknown-session' };
      if (eventId) processedEvents.add(eventId);
      ent.failedPaymentEvents = (ent.failedPaymentEvents || 0) + 1;
      ent.lastPaymentFailureAt = now();
      ent.lastEventId = eventId || null;
      return { applied: true, duplicate: false, entitlement: ent };
    },

    /** Consume a PAID entitlement for delivery. Atomic within the process. */
    consumeByToken(token) {
      const ent = this.getByToken(token);
      if (!ent) return { ok: false, reason: 'unknown-token' };
      if (ent.paidAt == null) return { ok: false, reason: 'not-paid' };
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
      if (ent.paidAt == null) return { ok: false, reason: 'not-paid' };
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
      if (ent.paidAt == null) return { ok: false, reason: 'not-paid' };
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
      if (ent.paidAt == null) return { ok: false, reason: 'not-paid' };
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
        state: ent.state, paid: ent.paidAt != null,
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
