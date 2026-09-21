-- Extensions PulseWatch relies on.
-- pg_trgm powers similarity() used by the similar-incident ranker (guide 7.4).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
