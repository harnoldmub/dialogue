ALTER TYPE contribution_status ADD VALUE IF NOT EXISTS 'NEEDS_FOLLOW_UP';
ALTER TYPE contribution_status ADD VALUE IF NOT EXISTS 'VALIDATED';
ALTER TYPE contribution_status ADD VALUE IF NOT EXISTS 'DUPLICATE';
ALTER TYPE contribution_status ADD VALUE IF NOT EXISTS 'OUT_OF_SCOPE';
ALTER TYPE contribution_status ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE contributions ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3);
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS secondary_theme TEXT;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS internal_note TEXT;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS audio_mime TEXT;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS audio_size BIGINT;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS transcription TEXT;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS detected_language TEXT;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS transcription_validated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS audio_summary TEXT;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE TYPE admin_role AS ENUM ('SUPER_ADMIN','ADMIN','ANALYST','VIEWER');
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL CHECK (email = lower(email)),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role admin_role NOT NULL DEFAULT 'ANALYST',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS admin_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS admin_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  color TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS contribution_tags (
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES admin_tags(id) ON DELETE CASCADE,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contribution_id, tag_id)
);
CREATE TABLE IF NOT EXISTS internal_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  author_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) <= 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS contribution_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  from_status contribution_status,
  to_status contribution_status NOT NULL,
  changed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS contribution_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  theme TEXT,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS summary_contributions (
  summary_id UUID NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  PRIMARY KEY (summary_id, contribution_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contributions_admin_list_idx ON contributions(status, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS contributions_admin_country_idx ON contributions(country, province);
CREATE INDEX IF NOT EXISTS contributions_admin_assigned_idx ON contributions(assigned_to, updated_at DESC);
CREATE INDEX IF NOT EXISTS contribution_tags_tag_idx ON contribution_tags(tag_id, contribution_id);
CREATE INDEX IF NOT EXISTS internal_comments_contribution_idx ON internal_comments(contribution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);

INSERT INTO admin_themes (name, slug, sort_order) VALUES
('Paix et sécurité','paix-securite',1),('Justice','justice',2),('Gouvernance','gouvernance',3),('Économie et emploi','economie-emploi',4),('Jeunesse','jeunesse',5),('Éducation','education',6),('Santé','sante',7),('Femmes','femmes',8),('Diaspora','diaspora',9),('Cohésion nationale','cohesion-nationale',10),('Décentralisation','decentralisation',11),('Culture','culture',12),('Numérique et innovation','numerique-innovation',13),('Environnement','environnement',14),('Autre','autre',15)
ON CONFLICT (name) DO NOTHING;
