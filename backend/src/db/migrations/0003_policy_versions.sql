CREATE TYPE "public"."policy_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"route" text NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"status" "policy_status" NOT NULL,
	"effective_date" date,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_slug_version_idx" ON "policy_versions" USING btree ("slug","version");--> statement-breakpoint
CREATE INDEX "policy_versions_status_idx" ON "policy_versions" USING btree ("status");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written section (phase 05). drizzle-kit does not generate CHECK
-- constraints, grants, triggers, or seed rows — these are maintained here by
-- hand and kept under review. Do not regenerate over them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── A published version has an effective date; a draft has none (§31.4) ────
-- §18 forbids placeholder or summary-only policy content at launch, and §29.8
-- compares versions by what took effect when. A "published" row with no
-- effective date is a document that claims to be in force on no particular
-- day, which is precisely the half-published state the gate exists to catch.
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_effective_date_matches_status" CHECK (
  ("status" = 'published' AND "effective_date" IS NOT NULL AND "published_at" IS NOT NULL)
  OR
  ("status" = 'draft'     AND "effective_date" IS NULL     AND "published_at" IS NULL)
);--> statement-breakpoint
-- ── Application role grants ────────────────────────────────────────────────
-- proovd_app is created in 0001. Rows are inserted by migration and published
-- by the §34 release; they are never deleted, because a consent record can
-- cite a superseded version and must still resolve it.
GRANT SELECT, INSERT, UPDATE ON "policy_versions" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "policy_versions" FROM proovd_app;--> statement-breakpoint
-- ── Version identity is immutable; publication is one-way (§23, §29.8) ─────
-- §23: "illegal reversals must be impossible." A published policy may already
-- have consent records citing it, so it cannot become a draft again, its
-- effective date cannot move, and its slug/route/version cannot be repointed
-- at different text while keeping the identifier those consent records hold.
-- A revision is a new row with a new version — which is exactly what §29.8's
-- reacceptance comparison is looking for.
CREATE OR REPLACE FUNCTION enforce_policy_version_immutability() RETURNS trigger AS $fn$
BEGIN
  IF NEW."slug"    IS DISTINCT FROM OLD."slug"
  OR NEW."route"   IS DISTINCT FROM OLD."route"
  OR NEW."version" IS DISTINCT FROM OLD."version"
  THEN
    RAISE EXCEPTION 'policy_versions identity is immutable; insert a new version instead'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'published' AND NEW."status" = 'draft' THEN
    RAISE EXCEPTION 'a published policy version cannot return to draft'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."effective_date" IS NOT NULL
     AND NEW."effective_date" IS DISTINCT FROM OLD."effective_date" THEN
    RAISE EXCEPTION 'policy_versions.effective_date is append-only'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."published_at" IS NOT NULL
     AND NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
    RAISE EXCEPTION 'policy_versions.published_at is append-only'
      USING ERRCODE = '23514';
  END IF;

  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER policy_versions_immutable_identity
  BEFORE UPDATE ON "policy_versions"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_policy_version_immutability();--> statement-breakpoint
-- ── The eight canonical documents of §31.4, at the eight §18 routes ────────
-- Seeded as drafts. The text is Track A2 and under counsel review; §1 rule 6
-- forbids inventing it and §31.4 forbids substituting a summary, so what ships
-- today is the versioned record and an honest in-review surface. Every row
-- here mirrors shared/src/policies/documents.ts, and
-- src/tests/policy-versions.test.ts fails the suite if the two diverge.
--
-- Phase 24 releases §34 condition 4 by publishing these — setting status,
-- effective_date, and published_at, and landing the canonical text in the
-- shared register in the same change. Not by deleting the rows, and not by
-- bypassing the gate.
INSERT INTO "policy_versions" ("slug", "route", "title", "version", "status")
VALUES
  ('terms',         '/terms',         'Terms of Service',                        '1.0.0-draft', 'draft'),
  ('privacy',       '/privacy',       'Privacy Policy',                          '1.0.0-draft', 'draft'),
  ('cookies',       '/cookies',       'Cookie Policy',                           '1.0.0-draft', 'draft'),
  ('refunds',       '/refunds',       'Refund Policy',                           '1.0.0-draft', 'draft'),
  ('fulfillment',   '/fulfillment',   'Fulfillment Policy',                      '1.0.0-draft', 'draft'),
  ('aup',           '/aup',           'Founder Acceptable Use Policy',           '1.0.0-draft', 'draft'),
  ('affiliate-aup', '/affiliate-aup', 'Creator Acceptable Use Policy',           '1.0.0-draft', 'draft'),
  ('ip-agreement',  '/ip-agreement',  'Creator IP and Confidentiality Agreement','1.0.0-draft', 'draft');