-- Per-campaign early Application Review gate — 2026-08-23.
--
-- Existing campaigns keep the behaviour they had before this switch existed:
-- the early review is skipped. Admin may enable it only while the campaign is
-- still before review/fee progression; the service owns that lifecycle guard.

ALTER TABLE "campaigns"
  ADD COLUMN "application_review_required" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

COMMENT ON COLUMN "campaigns"."application_review_required" IS
  'When true, Founder Application Review blocks listing preparation; false skips it.';
