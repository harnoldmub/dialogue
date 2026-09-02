-- Cycle de vie d'une synthèse : brouillon, relecture, publication.
ALTER TABLE summaries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE summaries DROP CONSTRAINT IF EXISTS summaries_status_check;
ALTER TABLE summaries ADD CONSTRAINT summaries_status_check CHECK (status IN ('DRAFT','REVIEW','PUBLISHED'));
CREATE INDEX IF NOT EXISTS summaries_status_updated_idx ON summaries(status, updated_at DESC);
