-- checkIn.ai schema, version 1.  Every business table carries tenant_id (one row = one organisation).
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy text matching for names

CREATE TABLE tenants (
    id             text PRIMARY KEY,                 -- short slug, e.g. 'uiet'
    name           text NOT NULL,
    config         jsonb NOT NULL,                   -- validated by app/config_schema.py
    config_version integer NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     text NOT NULL REFERENCES tenants(id),
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('guard', 'admin'))
);

-- People who can be visited (staff, or residents in a housing society).
CREATE TABLE hosts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES tenants(id),
    name       text NOT NULL,
    aliases    text[] NOT NULL DEFAULT '{}',         -- nicknames: 'aggarwal sir', 'a-101'
    department text,
    email      text,
    active     boolean NOT NULL DEFAULT true
);
CREATE INDEX hosts_tenant_idx ON hosts (tenant_id);

-- A visitor is a person; a visit is one arrival of that person.
CREATE TABLE visitors (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    text NOT NULL REFERENCES tenants(id),
    name         text NOT NULL,
    phone        text,                                -- E.164, e.g. +919876543210
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, phone)                         -- NULL phones are allowed many times
);
CREATE INDEX visitors_name_trgm ON visitors USING gin (lower(name) gin_trgm_ops);

CREATE TABLE blacklist (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL REFERENCES tenants(id),
    phone     text NOT NULL,
    reason    text NOT NULL,
    UNIQUE (tenant_id, phone)
);

CREATE TABLE visits (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       text NOT NULL REFERENCES tenants(id),
    visitor_id      uuid NOT NULL REFERENCES visitors(id),
    host_id         uuid NOT NULL REFERENCES hosts(id),
    purpose         text NOT NULL,
    status          text NOT NULL CHECK (status IN
                      ('checked_in', 'pending_approval', 'rejected', 'checked_out', 'auto_closed')),
    arrived_at      timestamptz NOT NULL DEFAULT now(),
    decided_by      text,
    decided_at      timestamptz,
    checked_out_at  timestamptz,
    idempotency_key text NOT NULL UNIQUE,             -- makes "confirm" safe to repeat
    config_version  integer NOT NULL,                 -- which rules were in force
    created_by      text NOT NULL,
    warnings        jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX visits_tenant_status_idx ON visits (tenant_id, status);

-- Transactional outbox: written in the same transaction as the visit, delivered later.
CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES tenants(id),
    visit_id   uuid REFERENCES visits(id),
    channel    text NOT NULL DEFAULT 'log',
    recipient  text NOT NULL,
    body       text NOT NULL,
    status     text NOT NULL DEFAULT 'queued',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Tamper-evident audit log: one hash chain per tenant.
CREATE TABLE audit_log (
    id         bigserial PRIMARY KEY,
    tenant_id  text NOT NULL REFERENCES tenants(id),
    seq        integer NOT NULL,
    ts         timestamptz NOT NULL,
    actor      text NOT NULL,
    event_type text NOT NULL,
    payload    jsonb NOT NULL,
    prev_hash  text NOT NULL,
    hash       text NOT NULL,
    UNIQUE (tenant_id, seq)
);
CREATE TABLE audit_heads (
    tenant_id text PRIMARY KEY REFERENCES tenants(id),
    last_seq  integer NOT NULL,
    last_hash text NOT NULL
);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
