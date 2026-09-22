-- Full-text search over runbooks (guide Phase 5 step 1).
--
-- Incidents already have a generated `search_vector` column. Runbooks do not
-- need one: the table is small and rarely written, so an expression index over
-- to_tsvector(...) is enough and keeps the schema simpler. The 'english'
-- config is spelled out explicitly because to_tsvector is only IMMUTABLE --
-- and therefore only indexable -- when the config is a constant.
CREATE INDEX idx_runbooks_search
  ON runbooks
  USING gin (to_tsvector('english', title || ' ' || body_md));

-- Trigram index on incident titles, so search can fall back to fuzzy matching
-- when a query has no full-text hits (a typo, or a partial word).
CREATE INDEX idx_incidents_title_trgm
  ON incidents
  USING gin (title gin_trgm_ops);
