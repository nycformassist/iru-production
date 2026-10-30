-- sql/schema.sql — Postgres DDL for the IRU commerce store (Phase 1).
-- Apply once per database (e.g. `psql $DATABASE_URL -f sql/schema.sql`).
-- Safe to re-run: uses IF NOT EXISTS.
--
-- Design: one versioned snapshot row holding the full entitlement-store
-- state (entitlements, credit ledger, webhook events, exceptions, intents,
-- recovery identities). Handlers load at request start and save after
-- mutation with compare-and-swap on `version`, so two instances cannot
-- both commit a grant. See api/_lib/paymentStore.js for the contract.
--
-- COMMERCE ONLY. This schema never holds immigration case data
-- (applicant info, documents, facts, assessments). The only link to the
-- case side is the buyer's opaque bearer token, which never appears in
-- case records.

CREATE TABLE IF NOT EXISTS store_snapshots (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The single commerce snapshot row. Inserted on first save; never deleted.
INSERT INTO store_snapshots (id, version, data)
VALUES ('entitlements', 0, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
