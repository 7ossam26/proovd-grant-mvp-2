-- Phase 1 — first migration.
-- Enables pgcrypto so gen_random_uuid() is available for all future tables.
-- Creates no tables; its only job is proving the migration pipeline works.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
