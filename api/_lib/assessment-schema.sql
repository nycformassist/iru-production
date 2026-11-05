-- Assessment persistence schema
-- Separate from commerce/entitlement data

CREATE TABLE IF NOT EXISTS assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    client_key_hash TEXT NOT NULL,  -- SHA-256 of clientKey (hex)
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
