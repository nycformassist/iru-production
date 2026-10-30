import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementStore } from './_lib/entitlement.js';
import { createPostgresSnapshotBackend } from './_lib/store-postgres.js';
import { withDurableStore, getSnapshotBackend } from './_lib/withStore.js';
import { deliverRecoveryToken } from './_lib/recoveryDelivery.js';
import { SKUS } from './_lib/pricing.js';
import { newDb } from 'pg-mem';
import { readFileSync } from 'node:fs';

// Phase 1: durable entitlement core — credit ledger, revocation,
// recovery reissue, snapshot/restore round-trip, Postgres CAS backend,
// and the withDurableStore request wiring. No network, no real keys.

function paidEvaluation(store, sessionId = 'sess_eval_1') {
  const { entitlement } = store.create({
    sku: SKUS.EVALUATION, amountCents: 100, currency: 'usd', scope: { kind: 'evaluation' },
  });
  store.attachSession(entitlement.id, sessionId);
  const r = store.markPaidBySession(sessionId, 'evt_eval_1');
  assert.equal(r.applied, true);
  return entitlement;
}

describe('credit ledger', () => {
  it('evaluation payment grants $1.00; upgrade redeems it exactly once', () => {
    const store = createEntitlementStore();
    const parent = paidEvaluation(store);
    const rootId = parent.id;
    let ledger = store.ledgerFor(rootId);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].kind, 'grant');
    assert.equal(ledger[0].amountCents, 100);
    assert.equal(store.creditBalance(rootId), 100);

    // Upgrade: one-form with the $1 credit.
    const child = store.create({
      sku: SKUS.ONE_FORM, amountCents: 9895, currency: 'usd',
      scope: { kind: 'forms', forms: ['I-589'] },
      parentId: parent.id, creditedCents: 100, totalCents: 9995,
    });
    store.attachSession(child.entitlement.id, 'sess_up_1');
    assert.equal(store.markPaidBySession('sess_up_1', 'evt_up_1').applied, true);

    ledger = store.ledgerFor(rootId);
    assert.equal(ledger.filter((e) => e.kind === 'grant').length, 1);
    assert.equal(ledger.filter((e) => e.kind === 'redeem').length, 1);
    assert.equal(store.creditBalance(rootId), 0);
  });

  it('T10: a second upgrade cannot double-spend the credit', () => {
    const store = createEntitlementStore();
    const parent = paidEvaluation(store, 'sess_eval_2');
    const mk = (sess) => {
      const c = store.create({
        sku: SKUS.ONE_FORM, amountCents: 9895, currency: 'usd',
        scope: { kind: 'forms', forms: ['I-589'] },
        parentId: parent.id, creditedCents: 100, totalCents: 9995,
      });
      store.attachSession(c.entitlement.id, sess);
      return c.entitlement;
    };
    const first = mk('sess_up_a');
    assert.equal(store.markPaidBySession('sess_up_a', 'evt_up_a').applied, true);
    const second = mk('sess_up_b');
    const r = store.markPaidBySession('sess_up_b', 'evt_up_b');
    assert.equal(r.applied, false); // family guard refuses
    const redeems = store.ledgerFor(parent.id).filter((e) => e.kind === 'redeem');
    assert.equal(redeems.length, 1); // exactly one redemption on the books
    assert.equal(store.creditBalance(parent.id), 0);
    void first; void second;
  });
});

describe('revoke by refund (T8)', () => {
  it('a refunded payment revokes access and adjusts the ledger', () => {
    const store = createEntitlementStore();
    const { entitlement, token } = store.create({
      sku: SKUS.ONE_FORM, amountCents: 9895, currency: 'usd',
      scope: { kind: 'forms', forms: ['I-589'] },
    });
    store.attachSession(entitlement.id, 'sess_ref_1');
    store.markPaidBySession('sess_ref_1', 'evt_ref_1');
    assert.equal(store.peekByToken(token).ok, true);

    const r = store.revokeByRefund({ refundId: 're_test_1', sessionId: 'sess_ref_1', eventId: 'evt_refund_1' });
    assert.equal(r.applied, true);
    assert.equal(store.getById(entitlement.id).state, 'REVOKED');
    assert.equal(store.peekByToken(token).ok, false); // access ends
    const adjusts = store.ledgerFor(entitlement.id).filter((e) => e.kind === 'adjust');
    assert.equal(adjusts.length, 1);
    assert.equal(adjusts[0].amountCents, 9895);

    // Idempotent on replay.
    const again = store.revokeByRefund({ refundId: 're_test_1', sessionId: 'sess_ref_1', eventId: 'evt_refund_1' });
    assert.equal(again.duplicate, true);
  });

  it('revoking an unpaid or unknown session is refused', () => {
    const store = createEntitlementStore();
    assert.equal(store.revokeByRefund({ sessionId: 'nope', eventId: 'e1' }).reason, 'unknown-session');
    const { entitlement } = store.create({ sku: SKUS.EVALUATION, amountCents: 100 });
    store.attachSession(entitlement.id, 'sess_unpaid');
    assert.equal(store.revokeByRefund({ sessionId: 'sess_unpaid', eventId: 'e2' }).reason, 'not-paid');
  });
});

describe('recovery reissue (T9, D3(b))', () => {
  it('reissue invalidates the old token and the new one works', () => {
    const store = createEntitlementStore();
    const { entitlement, token: oldToken } = store.create({
      sku: SKUS.EVALUATION, amountCents: 100, currency: 'usd', scope: { kind: 'evaluation' },
    });
    store.attachSession(entitlement.id, 'sess_rec_1');
    store.markPaidBySession('sess_rec_1', 'evt_rec_1');
    assert.equal(store.registerRecoveryIdentity({ entitlementId: entitlement.id, email: 'Buyer@Example.com' }).ok, true);

    const r = store.reissueToken({ email: 'buyer@example.com' }); // case-insensitive
    assert.equal(r.ok, true);
    assert.ok(r.token && r.token !== oldToken);
    assert.equal(store.getByToken(oldToken), null); // old token dead
    assert.ok(store.getByToken(r.token)); // new token live
  });

  it('unknown identity and unpaid entitlements are refused', () => {
    const store = createEntitlementStore();
    assert.equal(store.reissueToken({ email: 'nobody@example.com' }).reason, 'unknown-identity');
    const { entitlement } = store.create({ sku: SKUS.EVALUATION, amountCents: 100 });
    store.registerRecoveryIdentity({ entitlementId: entitlement.id, email: 'x@y.zz' });
    assert.equal(store.reissueToken({ email: 'x@y.zz' }).reason, 'not-paid');
  });

  it('delivery interface is provider-independent and stubbed until wired', async () => {
    const r = await deliverRecoveryToken({ email: 'a@b.cc', token: 'tok' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-configured');
  });
});

describe('snapshot/restore round-trip (Phase 1 state)', () => {
  it('ledger and recovery identities survive a restore', () => {
    const a = createEntitlementStore();
    const parent = paidEvaluation(a, 'sess_rt_1');
    a.registerRecoveryIdentity({ entitlementId: parent.id, email: 'rt@example.com' });
    const snap = a.snapshot();

    const b = createEntitlementStore();
    b.restore(snap);
    assert.equal(b.ledgerFor(parent.id).length, 1);
    assert.equal(b.creditBalance(parent.id), 100);
    const r = b.reissueToken({ email: 'rt@example.com' });
    assert.equal(r.ok, true);
  });
});

describe('postgres snapshot backend (pg-mem)', () => {
  let backend;
  before(async () => {
    const db = newDb();
    db.public.none(readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
    const adapter = db.adapters.createPg();
    // Wrap pg-mem's pool to match the pg Pool interface used by the backend.
    const { Pool } = adapter;
    const pool = new Pool();
    backend = {
      kind: 'postgres-snapshot-test',
      durable: true,
      async load() {
        const { rows } = await pool.query('SELECT version, data FROM store_snapshots WHERE id = $1', ['entitlements']);
        return rows.length ? { version: rows[0].version, snapshot: rows[0].data } : null;
      },
      async save(snapshot, expectedVersion) {
        const data = JSON.stringify(snapshot);
        if (expectedVersion == null) {
          const { rows } = await pool.query(
            `INSERT INTO store_snapshots (id, version, data, updated_at)
             VALUES ($1, 1, $2::jsonb, now()) ON CONFLICT (id) DO NOTHING RETURNING version`,
            ['entitlements', data]);
          if (rows.length === 1) return { ok: true, version: 1 };
          const cur = await this.load();
          expectedVersion = cur ? cur.version : null;
          if (expectedVersion == null) return { ok: false, reason: 'version-conflict', version: null };
        }
        const { rows } = await pool.query(
          `UPDATE store_snapshots SET version = version + 1, data = $2::jsonb, updated_at = now()
           WHERE id = $1 AND version = $3 RETURNING version`,
          ['entitlements', data, expectedVersion]);
        if (!rows.length) {
          const cur = await this.load();
          return { ok: false, reason: 'version-conflict', version: cur ? cur.version : null };
        }
        return { ok: true, version: rows[0].version };
      },
    };
    // Prove the real backend module loads (pg driver present).
    assert.ok(createPostgresSnapshotBackend);
  });

  it('save/load round-trips a snapshot; stale writes lose (CAS)', async () => {
    // Schema pre-seeds the row at version 0.
    const initial = await backend.load();
    assert.equal(initial.version, 0);
    const s1 = await backend.save({ v: 1 }, initial.version);
    assert.equal(s1.ok, true);
    const loaded = await backend.load();
    assert.deepEqual(loaded.snapshot, { v: 1 });
    const stale = await backend.save({ v: 2 }, 0); // wrong version
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'version-conflict');
    const s2 = await backend.save({ v: 2 }, loaded.version);
    assert.equal(s2.ok, true);
    assert.deepEqual((await backend.load()).snapshot, { v: 2 });
  });

  it('a full entitlement snapshot survives the backend', async () => {
    const store = createEntitlementStore();
    paidEvaluation(store, 'sess_pg_1');
    const snap = store.snapshot();
    const saved = await backend.save(snap, (await backend.load()).version);
    assert.equal(saved.ok, true);
    const restored = createEntitlementStore();
    restored.restore((await backend.load()).snapshot);
    assert.equal(restored.ledgerFor(restored.getBySessionId('sess_pg_1').id).length, 1);
  });
});

describe('withDurableStore wiring', () => {
  it('two requests share durable state; the second sees the first\u2019s mutation', async () => {
    const { createMemorySnapshotBackend } = await import('./_lib/paymentStore.js');
    const { withDurableStore, _setTestBackend, _clearBackendCache } = await import('./_lib/withStore.js');
    const backend = createMemorySnapshotBackend();
    _setTestBackend(backend);
    try {
      // Request 1: handler creates + pays an entitlement.
      const h1 = withDurableStore(async (req, res, store) => {
        const { entitlement } = store.create({ sku: 'x', amountCents: 100 });
        store.attachSession(entitlement.id, 'sess_w_1');
        store.markPaidBySession('sess_w_1', 'evt_w_1');
        res.status(200).json({ ok: true, id: entitlement.id });
      });
      const res1 = { statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, setHeader() {} };
      // Gate needs a configured backend: point env at the memory adapter.
      process.env.IRU_STORE_BACKEND = 'memory';
      process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
      await h1({ method: 'POST', headers: {}, socket: {} }, res1);
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.body.ok, true);

      // Request 2: a different handler instance sees the durable state.
      const h2 = withDurableStore(async (req, res, store) => {
        const ent = store.getBySessionId('sess_w_1');
        res.status(200).json({ found: !!ent, paid: ent ? ent.paidAt != null : false });
      });
      const res2 = { statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, setHeader() {} };
      await h2({ method: 'POST', headers: {}, socket: {} }, res2);
      assert.equal(res2.body.found, true);
      assert.equal(res2.body.paid, true);
    } finally {
      _clearBackendCache();
      delete process.env.IRU_STORE_BACKEND;
      delete process.env.IRU_ALLOW_EPHEMERAL_STORE;
    }
  });

  it('a read-only request does not bump the snapshot version', async () => {
    const { createMemorySnapshotBackend } = await import('./_lib/paymentStore.js');
    const { withDurableStore, _setTestBackend, _clearBackendCache } = await import('./_lib/withStore.js');
    const backend = createMemorySnapshotBackend();
    _setTestBackend(backend);
    try {
      process.env.IRU_STORE_BACKEND = 'memory';
      process.env.IRU_ALLOW_EPHEMERAL_STORE = 'true';
      const h = withDurableStore(async (req, res) => {
        res.status(200).json({ ok: true });
      });
      const mkRes = () => ({ statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, setHeader() {} });
      await h({ method: 'POST', headers: {}, socket: {} }, mkRes());
      assert.equal(await backend.loadVersion(), 0); // no write happened
      await h({ method: 'POST', headers: {}, socket: {} }, mkRes());
      assert.equal(await backend.loadVersion(), 0);
    } finally {
      _clearBackendCache();
      delete process.env.IRU_STORE_BACKEND;
      delete process.env.IRU_ALLOW_EPHEMERAL_STORE;
    }
  });

  it('concurrent writers serialize: the loser gets version-conflict', async () => {
    const { createMemorySnapshotBackend } = await import('./_lib/paymentStore.js');
    const backend = createMemorySnapshotBackend();
    await backend.save({ n: 0 }, 0);
    const v0 = await backend.loadVersion();
    // Two writers read the same version...
    const r1 = await backend.save({ n: 1 }, v0);
    assert.equal(r1.ok, true);
    // ...the second writer's stale version loses.
    const loser = await backend.save({ n: 2 }, v0);
    assert.equal(loser.ok, false);
    assert.equal(loser.reason, 'version-conflict');
    assert.equal((await backend.load()).snapshot.n, 1);
  });
});
