-- Pro Net Shield — Schema SQL para Supabase
-- Execute em: supabase.com → SQL Editor → New Query

-- ── EXTENSÕES ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUM TIPOS ───────────────────────────────────────────────
CREATE TYPE user_plan   AS ENUM ('basic', 'pro', 'enterprise');
CREATE TYPE scan_status AS ENUM ('pending', 'running', 'done', 'failed');
CREATE TYPE severity    AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE attack_type AS ENUM ('sqli', 'xss', 'brute_force', 'port_scan', 'path_traversal', 'other');

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE users (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT        NOT NULL,
  email             TEXT        UNIQUE NOT NULL,
  password_hash     TEXT        NOT NULL,
  plan              user_plan   NOT NULL DEFAULT 'basic',
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  login_attempts    INT         NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  email_verified    BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── REFRESH TOKENS ───────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PROJECTS (clientes / sites monitorados) ──────────────────
CREATE TABLE projects (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  target_url  TEXT        NOT NULL,
  target_host TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── SCANS ────────────────────────────────────────────────────
CREATE TABLE scans (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          scan_status NOT NULL DEFAULT 'pending',
  type            TEXT        NOT NULL DEFAULT 'full',   -- full | ssl | headers | ports | deps
  score_total     INT,
  score_ssl       INT,
  score_headers   INT,
  score_ports     INT,
  score_deps      INT,
  result_json     JSONB,
  ai_summary      TEXT,       -- Explicação gerada por IA
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── SECURITY EVENTS (ataques detectados) ─────────────────────
CREATE TABLE security_events (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID        REFERENCES projects(id) ON DELETE SET NULL,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  type        attack_type NOT NULL DEFAULT 'other',
  source_ip   INET,
  payload     TEXT,
  severity    severity    NOT NULL DEFAULT 'medium',
  blocked     BOOLEAN     NOT NULL DEFAULT false,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
  resource    TEXT,
  ip          INET,
  user_agent  TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ALERTS ───────────────────────────────────────────────────
CREATE TABLE alerts (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  UUID        REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  severity    severity    NOT NULL DEFAULT 'medium',
  channel     TEXT        NOT NULL DEFAULT 'dashboard',  -- dashboard | email | discord | whatsapp
  sent        BOOLEAN     NOT NULL DEFAULT false,
  read        BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NIST SCORES ──────────────────────────────────────────────
CREATE TABLE nist_scores (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scan_id     UUID        REFERENCES scans(id) ON DELETE SET NULL,
  govern      INT NOT NULL DEFAULT 0,
  identify    INT NOT NULL DEFAULT 0,
  protect     INT NOT NULL DEFAULT 0,
  detect      INT NOT NULL DEFAULT 0,
  respond     INT NOT NULL DEFAULT 0,
  recover     INT NOT NULL DEFAULT 0,
  total       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ÍNDICES ───────────────────────────────────────────────────
CREATE INDEX idx_projects_user    ON projects(user_id);
CREATE INDEX idx_scans_project    ON scans(project_id);
CREATE INDEX idx_scans_status     ON scans(status);
CREATE INDEX idx_events_project   ON security_events(project_id);
CREATE INDEX idx_events_ip        ON security_events(source_ip);
CREATE INDEX idx_events_type      ON security_events(type);
CREATE INDEX idx_events_created   ON security_events(created_at);
CREATE INDEX idx_audit_user       ON audit_logs(user_id);
CREATE INDEX idx_audit_created    ON audit_logs(created_at);
CREATE INDEX idx_alerts_user      ON alerts(user_id);
CREATE INDEX idx_refresh_token    ON refresh_tokens(token_hash);
CREATE INDEX idx_nist_project     ON nist_scores(project_id);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE nist_scores    ENABLE ROW LEVEL SECURITY;

-- Usuários só veem seus próprios dados (acesso via service_role no backend)
-- O backend usa a service_role key que bypassa RLS

-- ── FUNÇÃO updated_at AUTOMÁTICO ─────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
