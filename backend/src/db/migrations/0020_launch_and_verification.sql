-- ── Coordinated launch, first-post verification, required Creator failure ────
--
-- Phase 14a (§17, §29.6, §33.4.5–§33.4.9). An approved campaign goes live in a
-- strict, idempotent, five-step order; Creator tracking links activate; Admin
-- verifies first posts; and a required launch Creator's failure opens a
-- non-resettable three-business-day replacement window.
--
-- Schema instructions that carry through:
--   §17  — "Post verification never launches or unlaunches the campaign page and
--          never releases fixed-payment money." creator_post_submissions carries
--          no amount, no percentage, and no ledger column: there is nowhere for
--          money to move (§33.4.7).
--   §29.6 — the replacement deadline is "calculated once … retries/edits cannot
--          reset it." due_at and due_calendar_version are immutable by trigger,
--          the listing-clock posture applied to §29.6.

CREATE TYPE "public"."post_verification_status" AS ENUM ('submitted', 'passed', 'correction_needed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."creator_failure_status" AS ENUM ('replacement_pending', 'replacement_ready', 'replacement_failed');--> statement-breakpoint

-- ── tracking_links: the §18 pause ────────────────────────────────────────────
-- §18: "Links used before activated_at, while paused, or after close cannot
-- create payable attribution." A paused link keeps its `active`/`activated_at`
-- (it WAS activated, and the 0017 CHECK that pairs them still holds) but stops
-- resolving to payable attribution. §33.4.8 pauses it; resuming clears paused_at.
ALTER TABLE "tracking_links" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD COLUMN "paused_by" text;--> statement-breakpoint
-- The 0017 column grant named only ("active","activated_at"); the pause columns
-- need their own grant. The identity trigger (0017) does not touch these.
GRANT UPDATE ("paused_at", "paused_reason", "paused_by") ON "tracking_links" TO proovd_app;--> statement-breakpoint

-- ── campaign_launches (§17, §33.4.5, §33.4.6) ────────────────────────────────
-- One row per campaign, written when the five-step activation runs. Its
-- uniqueness on the campaign is the backstop behind the idempotency key: a
-- launch run twice produces one row, one live state, and one set of messages.

CREATE TABLE "campaign_launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	-- §21: the campaign_live_at anchor the links activated at.
	"campaign_live_at" timestamp with time zone NOT NULL,
	"activated_link_count" integer DEFAULT 0 NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_launches" ADD CONSTRAINT "campaign_launches_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_launches_campaign_idx" ON "campaign_launches" USING btree ("campaign_id");--> statement-breakpoint
-- A launch record, once written, is the immutable fact that a campaign went live.
GRANT SELECT, INSERT ON "campaign_launches" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_launches" FROM proovd_app;--> statement-breakpoint

-- ── creator_post_submissions (§17, §33.4.7, §33.4.8) ─────────────────────────
-- A Creator's submitted post URL and the Admin verification that follows. No
-- amount, no percentage, no reservation id: verification is a compliance record,
-- not a payment one (§33.4.7).

CREATE TABLE "creator_post_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"post_url" text NOT NULL,
	"channel" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"submitted_by" text NOT NULL,
	"status" "post_verification_status" DEFAULT 'submitted' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"checklist" jsonb,
	"correction_detail" text,
	"correction_due_at" timestamp with time zone,
	"enforcement_reason" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_post_submissions" ADD CONSTRAINT "creator_post_submissions_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_post_submissions" ADD CONSTRAINT "creator_post_submissions_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A repeat submission of the exact same URL is idempotent, not a second post; a
-- different URL (a resubmission after a correction) is a new row.
CREATE UNIQUE INDEX "creator_post_submissions_association_url_idx" ON "creator_post_submissions" USING btree ("association_id", "post_url");--> statement-breakpoint
CREATE INDEX "creator_post_submissions_association_idx" ON "creator_post_submissions" USING btree ("association_id", "submitted_at");--> statement-breakpoint
CREATE INDEX "creator_post_submissions_campaign_idx" ON "creator_post_submissions" USING btree ("campaign_id", "status");--> statement-breakpoint
-- The submission facts are the Creator's statement and never change; only the
-- verification the Admin records may. §9's autosave rule, applied to a post.
CREATE OR REPLACE FUNCTION enforce_post_submission_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW.association_id IS DISTINCT FROM OLD.association_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.post_url IS DISTINCT FROM OLD.post_url
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a first-post submission''s facts are immutable; only its verification may change (§17)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER post_submission_identity
  BEFORE UPDATE ON "creator_post_submissions"
  FOR EACH ROW EXECUTE FUNCTION enforce_post_submission_identity();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "creator_post_submissions" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "creator_post_submissions" FROM proovd_app;--> statement-breakpoint

-- ── required_creator_failures (§29.6, §33.4.9, §33.12.2) ─────────────────────
-- The failure recorded once, the replacement designation, and the
-- three-business-day deadline computed once and carrying its calendar version.

CREATE TABLE "required_creator_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"failed_association_id" uuid NOT NULL,
	"creator_failure_recorded_at" timestamp with time zone NOT NULL,
	"replacement_designation" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"due_calendar_version" text NOT NULL,
	"recorded_by" text NOT NULL,
	"status" "creator_failure_status" DEFAULT 'replacement_pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "required_creator_failures" ADD CONSTRAINT "required_creator_failures_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "required_creator_failures" ADD CONSTRAINT "required_creator_failures_association_fk"
  FOREIGN KEY ("failed_association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "required_creator_failures" ADD CONSTRAINT "required_creator_failures_refund_fk"
  FOREIGN KEY ("refund_id") REFERENCES "public"."listing_fee_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- §29.6: the failure is recorded once per campaign.
CREATE UNIQUE INDEX "required_creator_failures_campaign_idx" ON "required_creator_failures" USING btree ("campaign_id");--> statement-breakpoint
-- §29.6: the recorded failure and its computed deadline are immutable — "retries
-- and edits cannot reset it." Only the replacement outcome and its refund link
-- may change. The listing-clock posture (§29.6), enforced at the database.
CREATE OR REPLACE FUNCTION enforce_creator_failure_deadline()
RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.failed_association_id IS DISTINCT FROM OLD.failed_association_id
     OR NEW.creator_failure_recorded_at IS DISTINCT FROM OLD.creator_failure_recorded_at
     OR NEW.replacement_designation IS DISTINCT FROM OLD.replacement_designation
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.due_calendar_version IS DISTINCT FROM OLD.due_calendar_version
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a required Creator failure and its replacement deadline are immutable once recorded (§29.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER creator_failure_deadline_guard
  BEFORE UPDATE ON "required_creator_failures"
  FOR EACH ROW EXECUTE FUNCTION enforce_creator_failure_deadline();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "required_creator_failures" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "required_creator_failures" FROM proovd_app;
