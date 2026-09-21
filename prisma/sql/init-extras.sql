-- Raw SQL that Prisma's schema language cannot express (guide section 6).
-- Append this to the generated init migration:
--   npx prisma migrate dev --create-only --name init
--   (paste this file at the end of prisma/migrations/<ts>_init/migration.sql)
--   npx prisma migrate dev

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CHECK constraints for the enum-ish text columns
ALTER TABLE users       ADD CONSTRAINT users_role_check       CHECK (role IN ('admin','engineer','viewer'));
ALTER TABLE monitors    ADD CONSTRAINT monitors_status_check  CHECK (status IN ('unknown','up','down','paused'));
ALTER TABLE monitors    ADD CONSTRAINT monitors_interval_check CHECK (interval_seconds >= 30);
ALTER TABLE incidents   ADD CONSTRAINT incidents_severity_check CHECK (severity IN ('SEV1','SEV2','SEV3','SEV4'));
ALTER TABLE incidents   ADD CONSTRAINT incidents_status_check   CHECK (status IN ('open','acknowledged','resolved'));
ALTER TABLE incidents   ADD CONSTRAINT incidents_source_check   CHECK (source IN ('monitor','manual','api'));
ALTER TABLE incident_commits ADD CONSTRAINT incident_commits_kind_check CHECK (kind IN ('caused_by','fixed_by'));

-- Only scan monitors that are actually schedulable
CREATE INDEX idx_monitors_due ON monitors (next_check_at) WHERE status <> 'paused';

-- Trigram index for similarity() in the similar-incident ranker
CREATE INDEX idx_fp_trgm ON fingerprints USING gin (normalized gin_trgm_ops);

-- Full-text search: a generated column stays in sync with zero application code
ALTER TABLE incidents ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  to_tsvector('english',
    coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(resolution_note,''))
) STORED;
CREATE INDEX idx_incidents_search ON incidents USING gin (search_vector);

-- Guarantees one active auto-incident per monitor even if two worker cycles race
CREATE UNIQUE INDEX idx_one_active_per_monitor
  ON incidents (monitor_id) WHERE status <> 'resolved' AND monitor_id IS NOT NULL;
