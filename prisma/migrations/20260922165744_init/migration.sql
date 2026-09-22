-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'engineer',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "interval_seconds" INTEGER NOT NULL DEFAULT 60,
    "timeout_ms" INTEGER NOT NULL DEFAULT 5000,
    "expected_status" INTEGER NOT NULL DEFAULT 200,
    "failure_threshold" INTEGER NOT NULL DEFAULT 3,
    "recovery_threshold" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "consecutive_successes" INTEGER NOT NULL DEFAULT 0,
    "next_check_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMPTZ(6),

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_results" (
    "id" BIGSERIAL NOT NULL,
    "monitor_id" INTEGER NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "status_code" INTEGER,
    "response_time_ms" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fingerprints" (
    "id" SERIAL NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "normalized" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "monitor_id" INTEGER,
    "fingerprint_id" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "error_type" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'SEV3',
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" BIGSERIAL NOT NULL,
    "incident_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbooks" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER,
    "title" TEXT NOT NULL,
    "body_md" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_runbooks" (
    "incident_id" INTEGER NOT NULL,
    "runbook_id" INTEGER NOT NULL,
    "worked" BOOLEAN,

    CONSTRAINT "incident_runbooks_pkey" PRIMARY KEY ("incident_id","runbook_id")
);

-- CreateTable
CREATE TABLE "incident_commits" (
    "id" SERIAL NOT NULL,
    "incident_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "commit_sha" TEXT,
    "pr_url" TEXT,

    CONSTRAINT "incident_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "prefix" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uptime_daily" (
    "monitor_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "successful" INTEGER NOT NULL,
    "avg_response_ms" INTEGER,

    CONSTRAINT "uptime_daily_pkey" PRIMARY KEY ("monitor_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE INDEX "idx_results_monitor_time" ON "check_results"("monitor_id", "checked_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "fingerprints_hash_key" ON "fingerprints"("hash");

-- CreateIndex
CREATE INDEX "idx_incidents_service" ON "incidents"("service_id", "opened_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_fingerprint_id_fkey" FOREIGN KEY ("fingerprint_id") REFERENCES "fingerprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_runbooks" ADD CONSTRAINT "incident_runbooks_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_runbooks" ADD CONSTRAINT "incident_runbooks_runbook_id_fkey" FOREIGN KEY ("runbook_id") REFERENCES "runbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_commits" ADD CONSTRAINT "incident_commits_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uptime_daily" ADD CONSTRAINT "uptime_daily_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------
-- Raw DDL from prisma/sql/init-extras.sql (guide section 6)
-- ---------------------------------------------------------------

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

