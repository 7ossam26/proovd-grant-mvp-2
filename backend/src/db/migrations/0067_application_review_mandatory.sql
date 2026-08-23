-- Application Review is mandatory for every Founder campaign.

ALTER TABLE "campaigns"
  ALTER COLUMN "application_review_required" SET DEFAULT true;
--> statement-breakpoint

UPDATE "campaigns"
SET "application_review_required" = true
WHERE "application_review_required" = false;
--> statement-breakpoint

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_application_review_required_true"
  CHECK ("application_review_required" = true);
--> statement-breakpoint

COMMENT ON COLUMN "campaigns"."application_review_required" IS
  'Always true: every Founder campaign requires an approved Application Review before listing preparation.';
