-- ── §12's Founder campaign workspace: five optional items, the evidence that
-- completes them, the interview booking record, high-effort, and the listing fee
--
-- §12 gives this phase one substance and one trap. The substance is that each
-- item "completes only on objective evidence" — §12 lists what does not qualify:
-- "Empty files, placeholders, duplicate uploads, inaccessible URLs, unapproved
-- drafts, and unconfirmed appointments." The trap is that an item which
-- completes because a Founder said so defeats the discount entirely.
--
-- So the database holds CONTENT the Founder controls and DECISIONS it does not.
-- No grant below lets application code write `complete` in isolation of the
-- evaluation that produced it, the history is a trigger rather than a service
-- call, and everything §12 asks Admin to be able to see is insert-only.
--
-- Nothing here sets `locked_at`. §12 locks the calculation and the evidence
-- snapshot at payment, which is Phase 11; this migration installs the trigger
-- that refuses to edit a locked row so that Phase 11 sets one timestamp rather
-- than writing a guard under deadline.

-- ── Enums ───────────────────────────────────────────────────────────────────
-- Values mirror `shared/src/workspace/`. `campaign-workspace.test.ts` asserts
-- exact equality with the shared arrays, the same way the state enums are
-- drift-tested — the backend cannot import shared at runtime.

CREATE TYPE "optional_item" AS ENUM ('visuals', 'branding', 'interview', 'story', 'socials');--> statement-breakpoint
CREATE TYPE "decision_source" AS ENUM ('founder_approval', 'provider_event', 'admin_override');--> statement-breakpoint
CREATE TYPE "interview_status" AS ENUM ('selected', 'confirmed', 'canceled', 'abandoned');--> statement-breakpoint
CREATE TYPE "meeting_provider" AS ENUM ('google_meet', 'zoom', 'microsoft_teams');--> statement-breakpoint
CREATE TYPE "asset_purpose" AS ENUM ('visual', 'logo');--> statement-breakpoint
CREATE TYPE "upload_state" AS ENUM ('pending', 'stored', 'rejected');--> statement-breakpoint

-- ── campaigns: the current high-effort answer (§25.1) ───────────────────────
-- §25.1 requires the campaign record to store "high-effort inputs/result".
-- The inputs and every past result live in `high_effort_classifications`; this
-- is the current answer, so Phase 12's compensation matrix reads one column.
-- It is NOT a lifecycle value and is deliberately not in `campaigns.status`
-- (§23.1: lifecycle only).
ALTER TABLE "campaigns" ADD COLUMN "high_effort" boolean;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "high_effort_calculated_at" timestamp with time zone;--> statement-breakpoint

-- ── campaign_workspace ─────────────────────────────────────────────────────
CREATE TABLE "campaign_workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"brand_colors" text,
	"brand_typography" text,
	"brand_notes" text,
	"brand_approved_at" timestamp with time zone,
	"brand_approved_by" text,
	"story_text" text,
	"story_approved_at" timestamp with time zone,
	"story_approved_by" text,
	"last_saved_at" timestamp with time zone,
	"resume_step" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_workspace" ADD CONSTRAINT "campaign_workspace_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_workspace_campaign_idx" ON "campaign_workspace" USING btree ("campaign_id");--> statement-breakpoint

-- An approval names a person. §12's completing act for Branding and Story is
-- "Founder-approved", and an approval with no approver is not one.
ALTER TABLE "campaign_workspace" ADD CONSTRAINT "campaign_workspace_brand_approval_attributed"
  CHECK (("brand_approved_at" IS NULL) = ("brand_approved_by" IS NULL));--> statement-breakpoint
ALTER TABLE "campaign_workspace" ADD CONSTRAINT "campaign_workspace_story_approval_attributed"
  CHECK (("story_approved_at" IS NULL) = ("story_approved_by" IS NULL));--> statement-breakpoint

-- ── campaign_assets ────────────────────────────────────────────────────────
-- tech-stack §9: "Presigned PUT from the browser; no file touches the VPS
-- disk." Metadata only. There is no bytea column here and there must never be.
CREATE TABLE "campaign_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"purpose" "asset_purpose" NOT NULL,
	"storage_key" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"original_filename" text,
	"content_type" text NOT NULL,
	"byte_size" bigint,
	"checksum_sha256" text,
	"width" integer,
	"height" integer,
	"state" "upload_state" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"rejection" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_assets_campaign_idx" ON "campaign_assets" USING btree ("campaign_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_assets_storage_key_idx" ON "campaign_assets" USING btree ("storage_key");--> statement-breakpoint

-- §12: "duplicate uploads" do not qualify. Enforced by the database rather than
-- by a SELECT a concurrent request could race past. Scoped to live rows, so
-- removing a file and uploading it again is a correction rather than a refusal.
CREATE UNIQUE INDEX "campaign_assets_duplicate_idx" ON "campaign_assets" USING btree ("campaign_id","checksum_sha256")
  WHERE "checksum_sha256" IS NOT NULL AND "removed_at" IS NULL;--> statement-breakpoint

-- A Founder may only approve something we have actually stored and checked.
-- §12's Visuals rule is "uploaded, accessible, and Founder-approved" — approval
-- of a `pending` or `rejected` object would satisfy the word and not the rule.
ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_approval_requires_stored"
  CHECK ("approved_at" IS NULL OR "state" = 'stored');--> statement-breakpoint
ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_approval_attributed"
  CHECK (("approved_at" IS NULL) = ("approved_by" IS NULL));--> statement-breakpoint

-- ── campaign_social_profiles ───────────────────────────────────────────────
CREATE TABLE "campaign_social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"url" text NOT NULL,
	"platform" text,
	"handle" text,
	"controls_confirmed" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"http_status" integer,
	"accessible" boolean,
	"rejection" text,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_social_profiles" ADD CONSTRAINT "campaign_social_profiles_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_social_profiles_campaign_idx" ON "campaign_social_profiles" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_social_profiles_url_idx" ON "campaign_social_profiles" USING btree ("campaign_id","url") WHERE "removed_at" IS NULL;--> statement-breakpoint

-- ── founder_interview_bookings (§12) ───────────────────────────────────────
CREATE TABLE "founder_interview_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"status" "interview_status" DEFAULT 'selected' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"founder_timezone" text,
	"meeting_provider" "meeting_provider",
	"meeting_link" text,
	"interviewer" text,
	"confirmed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"canceled_by" text,
	"cancellation_reason" text,
	"external_source" text,
	"external_booking_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "founder_interview_bookings" ADD CONSTRAINT "founder_interview_bookings_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "founder_interview_bookings_campaign_idx" ON "founder_interview_bookings" USING btree ("campaign_id","status");--> statement-breakpoint

-- One live booking per campaign. Two would make "the booking has `confirmed`
-- status" ambiguous, and the high-effort input with it. Canceled and abandoned
-- rows fall outside the index, so rebooking works and the old row survives.
CREATE UNIQUE INDEX "founder_interview_bookings_live_idx" ON "founder_interview_bookings" USING btree ("campaign_id")
  WHERE "status" IN ('selected','confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "founder_interview_bookings_external_idx" ON "founder_interview_bookings" USING btree ("external_source","external_booking_id")
  WHERE "external_booking_id" IS NOT NULL;--> statement-breakpoint

-- §12 requires the record to carry the canonical UTC value, the timezone, the
-- provider, the link, and the interviewer. A CONFIRMED booking missing any of
-- them is a booking nobody can attend — and it would earn a US$2 discount and
-- clear a high-effort input on the strength of a record that says nothing.
-- Unconfirmed rows are exempt: a Founder halfway through choosing a slot has
-- not claimed anything yet.
ALTER TABLE "founder_interview_bookings" ADD CONSTRAINT "founder_interview_bookings_confirmed_is_complete"
  CHECK (
    "status" <> 'confirmed'
    OR (
      "scheduled_at" IS NOT NULL
      AND "founder_timezone" IS NOT NULL
      AND "meeting_provider" IS NOT NULL
      AND "meeting_link" IS NOT NULL
      AND "interviewer" IS NOT NULL
      AND "confirmed_at" IS NOT NULL
    )
  );--> statement-breakpoint
ALTER TABLE "founder_interview_bookings" ADD CONSTRAINT "founder_interview_bookings_cancellation_recorded"
  CHECK ("status" <> 'canceled' OR ("canceled_at" IS NOT NULL AND "canceled_by" IS NOT NULL));--> statement-breakpoint

-- ── interview_booking_events (§12 reschedule history, cancellation) ────────
CREATE TABLE "interview_booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"event" text NOT NULL,
	"prior_status" "interview_status",
	"new_status" "interview_status",
	"prior_scheduled_at" timestamp with time zone,
	"new_scheduled_at" timestamp with time zone,
	"reason" text,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"notification_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_booking_events" ADD CONSTRAINT "interview_booking_events_booking_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."founder_interview_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_booking_events" ADD CONSTRAINT "interview_booking_events_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_booking_events_booking_idx" ON "interview_booking_events" USING btree ("booking_id","occurred_at");--> statement-breakpoint
CREATE INDEX "interview_booking_events_campaign_idx" ON "interview_booking_events" USING btree ("campaign_id","occurred_at");--> statement-breakpoint

-- ── campaign_optional_items ────────────────────────────────────────────────
CREATE TABLE "campaign_optional_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"item" "optional_item" NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"decision_source" "decision_source",
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rejections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"invalidated_explanation" text,
	"invalidated_by" text,
	"locked_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_optional_items" ADD CONSTRAINT "campaign_optional_items_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_optional_items_campaign_item_idx" ON "campaign_optional_items" USING btree ("campaign_id","item");--> statement-breakpoint

-- A completion is a timestamp AND a source. §12 asks for both, and a row saying
-- `complete = true` with neither is a discount nobody can account for.
ALTER TABLE "campaign_optional_items" ADD CONSTRAINT "campaign_optional_items_completion_accounted"
  CHECK (
    ("complete" = false AND "completed_at" IS NULL AND "decision_source" IS NULL)
    OR ("complete" = true AND "completed_at" IS NOT NULL AND "decision_source" IS NOT NULL)
  );--> statement-breakpoint

-- §12: "Admin may invalidate an item before payment with a reason." A reason,
-- an explanation the Founder can read, and a named Admin — §25.6 keeps the
-- internal reason and the customer-facing wording in separate columns, and an
-- invalidation with no reason is the thing §12 forbids.
ALTER TABLE "campaign_optional_items" ADD CONSTRAINT "campaign_optional_items_invalidation_reasoned"
  CHECK (
    "invalidated_at" IS NULL
    OR ("invalidated_reason" IS NOT NULL AND "invalidated_explanation" IS NOT NULL AND "invalidated_by" IS NOT NULL)
  );--> statement-breakpoint

-- An invalidated item is not complete. §12 makes invalidation the act that
-- takes the discount back, so the two states cannot coexist on one row.
ALTER TABLE "campaign_optional_items" ADD CONSTRAINT "campaign_optional_items_invalidated_not_complete"
  CHECK ("invalidated_at" IS NULL OR "complete" = false);--> statement-breakpoint

-- ── optional_item_events (§12 Admin: invalidation history and override) ────
CREATE TABLE "optional_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"item" "optional_item" NOT NULL,
	"event" text NOT NULL,
	"prior_complete" boolean,
	"new_complete" boolean,
	"prior_decision_source" "decision_source",
	"new_decision_source" "decision_source",
	"reason" text,
	"customer_explanation" text,
	"evidence" jsonb,
	"rejections" jsonb,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "optional_item_events" ADD CONSTRAINT "optional_item_events_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "optional_item_events_campaign_idx" ON "optional_item_events" USING btree ("campaign_id","occurred_at");--> statement-breakpoint
CREATE INDEX "optional_item_events_item_idx" ON "optional_item_events" USING btree ("campaign_id","item","occurred_at");--> statement-breakpoint

-- ── high_effort_classifications (§12) ──────────────────────────────────────
CREATE TABLE "high_effort_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"visuals_completed" boolean NOT NULL,
	"branding_completed" boolean NOT NULL,
	"interview_scheduled_or_confirmed" boolean NOT NULL,
	"high_effort" boolean NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"trigger" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "high_effort_classifications" ADD CONSTRAINT "high_effort_classifications_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "high_effort_classifications_campaign_idx" ON "high_effort_classifications" USING btree ("campaign_id","calculated_at");--> statement-breakpoint

-- §12's rule, in the database. `high_effort = true` ONLY when all three inputs
-- are absent. A stored row that says otherwise is not a classification, it is a
-- bug that has already been written down — and this is the one number Phase
-- 12's compensation matrix reads.
ALTER TABLE "high_effort_classifications" ADD CONSTRAINT "high_effort_classifications_rule"
  CHECK (
    "high_effort" = (
      "visuals_completed" = false
      AND "branding_completed" = false
      AND "interview_scheduled_or_confirmed" = false
    )
  );--> statement-breakpoint

-- ── listing_fee_calculations (§12, §24.6) ──────────────────────────────────
CREATE TABLE "listing_fee_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"base_cents" bigint NOT NULL,
	"item_discount_cents" bigint NOT NULL,
	"max_discount_cents" bigint NOT NULL,
	"min_subtotal_cents" bigint NOT NULL,
	"completed_items" integer NOT NULL,
	"discount_cents" bigint NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"discount_lines" jsonb NOT NULL,
	"items_snapshot" jsonb NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"trigger" text NOT NULL,
	"locked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "listing_fee_calculations" ADD CONSTRAINT "listing_fee_calculations_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_fee_calculations_campaign_idx" ON "listing_fee_calculations" USING btree ("campaign_id","calculated_at");--> statement-breakpoint

-- §12's arithmetic, in the database:
--   discount = min(item_discount × completed, cap)
--   subtotal = max(floor, base − discount)
-- The service computes it from the §6 settings; this refuses to store a result
-- that does not follow from the inputs stored beside it. §33.3.2 walks all 32
-- combinations through the service, and this is what makes a 33rd path
-- impossible.
ALTER TABLE "listing_fee_calculations" ADD CONSTRAINT "listing_fee_calculations_arithmetic"
  CHECK (
    "completed_items" BETWEEN 0 AND 5
    AND "discount_cents" = LEAST("item_discount_cents" * "completed_items", "max_discount_cents")
    AND "subtotal_cents" = GREATEST("min_subtotal_cents", "base_cents" - "discount_cents")
  );--> statement-breakpoint

-- ── Item history is a trigger, not a service call ──────────────────────────
-- The `app_setting_versions` reasoning (Phase 06a) and the `draft_field_edits`
-- reasoning (Phase 07), applied to the thing §12 explicitly asks Admin to be
-- able to read: "invalidation history, and override". A history written by
-- application code is a history one careless `db.update()` skips, and the row it
-- would skip is exactly the override someone later has to explain.
CREATE OR REPLACE FUNCTION record_optional_item_events()
RETURNS trigger AS $$
DECLARE
  event_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The five rows are created together when a workspace opens. Recording
    -- five "evaluated" events before the Founder has done anything would bury
    -- the first real decision under noise.
    RETURN NEW;
  END IF;

  IF NEW.invalidated_at IS NOT NULL AND OLD.invalidated_at IS NULL THEN
    event_name := 'invalidated';
  ELSIF NEW.invalidated_at IS NULL AND OLD.invalidated_at IS NOT NULL THEN
    event_name := 'reinstated';
  ELSIF NEW.complete AND NOT OLD.complete THEN
    event_name := 'completed';
  ELSIF OLD.complete AND NOT NEW.complete THEN
    event_name := 'uncompleted';
  ELSIF NEW.evidence IS DISTINCT FROM OLD.evidence OR NEW.rejections IS DISTINCT FROM OLD.rejections THEN
    event_name := 'evaluated';
  ELSE
    -- Nothing an Admin would need to read changed.
    RETURN NEW;
  END IF;

  INSERT INTO "optional_item_events" (
    campaign_id, item, event,
    prior_complete, new_complete,
    prior_decision_source, new_decision_source,
    reason, customer_explanation,
    evidence, rejections, actor
  ) VALUES (
    NEW.campaign_id, NEW.item, event_name,
    OLD.complete, NEW.complete,
    OLD.decision_source, NEW.decision_source,
    NEW.invalidated_reason, NEW.invalidated_explanation,
    NEW.evidence, NEW.rejections, NEW.updated_by
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER optional_item_history
  AFTER INSERT OR UPDATE ON "campaign_optional_items"
  FOR EACH ROW EXECUTE FUNCTION record_optional_item_events();--> statement-breakpoint

-- ── The lock (§12: "After payment, the calculation and evidence snapshot lock")
-- Phase 11 stamps `locked_at`. From that moment the decision and its evidence
-- are what the Founder was charged against, and §33.3.3's second direction —
-- "canceling after successful payment does not change the amount already paid"
-- — is this trigger rather than a condition someone remembered to write in a
-- service. Nothing in Phase 09 sets the stamp.
CREATE OR REPLACE FUNCTION enforce_optional_item_lock()
RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      RAISE EXCEPTION 'campaign_optional_items.locked_at is set once';
    END IF;
    IF NEW.complete IS DISTINCT FROM OLD.complete
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.decision_source IS DISTINCT FROM OLD.decision_source
       OR NEW.evidence IS DISTINCT FROM OLD.evidence
       OR NEW.rejections IS DISTINCT FROM OLD.rejections THEN
      RAISE EXCEPTION 'campaign_optional_items is locked: the evidence snapshot was fixed at listing-fee payment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER optional_item_lock
  BEFORE UPDATE ON "campaign_optional_items"
  FOR EACH ROW EXECUTE FUNCTION enforce_optional_item_lock();--> statement-breakpoint

-- The same lock on the calculation. §24.6 stores the listing fee as its own
-- stream with its own receipt and refund object; a locked calculation that
-- could be edited would make the receipt a claim about nothing.
CREATE OR REPLACE FUNCTION enforce_listing_fee_calculation_lock()
RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'listing_fee_calculations is locked: this is the calculation that was charged';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER listing_fee_calculation_lock
  BEFORE UPDATE ON "listing_fee_calculations"
  FOR EACH ROW EXECUTE FUNCTION enforce_listing_fee_calculation_lock();--> statement-breakpoint

-- ── The storage key is immutable ───────────────────────────────────────────
-- Repointing an approved visual at a different object would move a Founder's
-- approval — and a US$2 discount — onto material they never saw. There is no
-- correction that needs this: a different file is a different upload.
CREATE OR REPLACE FUNCTION enforce_asset_key_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
    RAISE EXCEPTION 'campaign_assets.storage_key cannot be changed; upload a new file instead';
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
    RAISE EXCEPTION 'campaign_assets.campaign_id cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_assets_key_immutable
  BEFORE UPDATE ON "campaign_assets"
  FOR EACH ROW EXECUTE FUNCTION enforce_asset_key_immutable();--> statement-breakpoint

-- ── Grants ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "campaign_workspace" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "campaign_assets" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "campaign_social_profiles" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "founder_interview_bookings" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "campaign_optional_items" TO proovd_app;--> statement-breakpoint

-- Insert-only, like `audit_events` and `app_setting_versions`. §12 requires
-- Admin to read this history and §25.6 requires it to be trustworthy; a log a
-- later statement can rewrite is neither.
GRANT SELECT, INSERT ON "optional_item_events" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "optional_item_events" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "interview_booking_events" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "interview_booking_events" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "high_effort_classifications" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "high_effort_classifications" FROM proovd_app;--> statement-breakpoint

-- One exception, granted by name: Phase 11 stamps `locked_at` on the
-- calculation it charges. Every other column is outside the grant, so the
-- numbers on a receipt cannot be edited after the fact.
GRANT SELECT, INSERT ON "listing_fee_calculations" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("locked_at") ON "listing_fee_calculations" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "listing_fee_calculations" FROM proovd_app;
