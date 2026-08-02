-- ── Campaign building, roster readiness, review, materiality — §14.4, §15 ────
--
-- Phase 12b. The parallel track the Founder builds from `listing_paid_at`
-- (§14.4), the six-rule launch readiness (§15), the Admin review and its
-- grouped feedback, and the general materiality/reacceptance machine §15
-- describes and Phase 17 reuses verbatim.
--
-- Two schema instructions carry through:
--   §23.2 — `affiliate_roster_status` and `campaign_build_status` stay separate
--           columns on `campaigns`; `review_ready` is DERIVED and never stored.
--   §15   — a material change "creates a new version, invalidates affected
--           Creator readiness, and requires explicit acceptance of that exact
--           version before approval or live." That versioning lives here, in
--           `material_changes` + `material_change_reacceptances`, decoupled from
--           the 12a formal-decision agreement so it can be reused mid-campaign.

CREATE TYPE "public"."roster_decision" AS ENUM ('pending', 'included', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."review_outcome" AS ENUM ('pending', 'approved', 'changes_required');--> statement-breakpoint
CREATE TYPE "public"."feedback_group" AS ENUM ('required', 'optional');--> statement-breakpoint
CREATE TYPE "public"."materiality_class" AS ENUM ('non_material', 'material');--> statement-breakpoint
CREATE TYPE "public"."reacceptance_state" AS ENUM ('not_required', 'pending', 'complete');--> statement-breakpoint
CREATE TYPE "public"."reacceptance_decision" AS ENUM ('pending', 'accepted', 'declined');--> statement-breakpoint

-- ── campaign_build (§14.4) ───────────────────────────────────────────────────
-- The Founder's autosaved campaign-page content. One row per campaign. Content
-- columns are nullable because the build fills incrementally, one decision at a
-- time; `campaign_build_status` on `campaigns` is the derived progress and is
-- never set from a Founder-supplied flag (the §12 self-assertion rule, applied
-- to the build). Campaign type is read-only — it is not a column here, it lives
-- on `campaigns` and is locked by the §9 trigger.

CREATE TABLE "campaign_build" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	-- Shared ingredients (§14.4).
	"title" text,
	"founder_display_name" text,
	"founder_entity_display" text,
	"founder_country" text,
	"founder_profile_url" text,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	-- Idea order threshold OR Product internal momentum target (§14.4). One is
	-- meaningful per type; the CHECK below pins the Product cap.
	"order_threshold" integer,
	"internal_target_cents" bigint,
	"brand_perception" text,
	"brand_voice" text,
	"required_wording" text,
	"prohibited_claims" text,
	"community_url" text,
	"hero_preference" text,
	"public_story" text,

	-- Idea-specific (§14.4).
	"delivery_window" text,
	"early_product_disclaimer" text,
	"risks_and_challenges" text,

	-- Product-specific refund policy: exact operative text OR an immutable
	-- snapshot with title, source URL, version, effective date (§14.4).
	"refund_policy_text" text,
	"refund_policy_title" text,
	"refund_policy_source_url" text,
	"refund_policy_version" text,
	"refund_policy_effective_date" date,

	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_build" ADD CONSTRAINT "campaign_build_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_build_campaign_idx" ON "campaign_build" USING btree ("campaign_id");--> statement-breakpoint
-- §14.4: "Internal momentum target no greater than US$50,000." §24.3: the cap
-- excludes sales tax; this is a pre-tax internal figure, so the bound is exact.
ALTER TABLE "campaign_build" ADD CONSTRAINT "campaign_build_target_cap"
  CHECK ("internal_target_cents" IS NULL OR ("internal_target_cents" > 0 AND "internal_target_cents" <= 5000000));--> statement-breakpoint
ALTER TABLE "campaign_build" ADD CONSTRAINT "campaign_build_threshold_positive"
  CHECK ("order_threshold" IS NULL OR "order_threshold" > 0);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "campaign_build" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_build" FROM proovd_app;--> statement-breakpoint

-- ── campaign_reward_packages (§14.4) ─────────────────────────────────────────
-- "Every reward package contains: title, USD pre-tax price, exact contents,
-- fulfillment commitment, delivery month/year or window, optional limited
-- quantity, SKU/tier identifier." Money is integer cents in bigint (§24.3).

CREATE TABLE "campaign_reward_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"contents" text NOT NULL,
	"fulfillment_commitment" text NOT NULL,
	"delivery" text NOT NULL,
	"limited_quantity" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_reward_packages" ADD CONSTRAINT "campaign_reward_packages_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- §18: the SKU/tier identifier resolves attribution and reward selection, so it
-- is unique within a campaign.
CREATE UNIQUE INDEX "campaign_reward_packages_sku_idx" ON "campaign_reward_packages" USING btree ("campaign_id", "sku");--> statement-breakpoint
CREATE INDEX "campaign_reward_packages_campaign_idx" ON "campaign_reward_packages" USING btree ("campaign_id", "sort_order");--> statement-breakpoint
ALTER TABLE "campaign_reward_packages" ADD CONSTRAINT "campaign_reward_packages_price"
  CHECK ("price_cents" > 0 AND ("limited_quantity" IS NULL OR "limited_quantity" > 0));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_reward_packages" TO proovd_app;--> statement-breakpoint

-- ── campaign_faqs (§14.4) ────────────────────────────────────────────────────

CREATE TABLE "campaign_faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_faqs" ADD CONSTRAINT "campaign_faqs_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_faqs_campaign_idx" ON "campaign_faqs" USING btree ("campaign_id", "sort_order");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_faqs" TO proovd_app;--> statement-breakpoint

-- ── campaign_readiness (§15 rule 2) ──────────────────────────────────────────
-- One row per campaign. Rule 2 is "Admin marked the final initial launch
-- roster" — a campaign-level marker, recorded by a named Admin.

CREATE TABLE "campaign_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"initial_roster_finalized_at" timestamp with time zone,
	"initial_roster_finalized_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_readiness" ADD CONSTRAINT "campaign_readiness_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_readiness_campaign_idx" ON "campaign_readiness" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "campaign_readiness" ADD CONSTRAINT "campaign_readiness_finalized_pair"
  CHECK (("initial_roster_finalized_at" IS NULL) = ("initial_roster_finalized_by" IS NULL));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "campaign_readiness" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_readiness" FROM proovd_app;--> statement-breakpoint

-- ── association_readiness (§15 rules 5 & 6) ──────────────────────────────────
-- One row per association: the Admin's per-Creator roster decision (rule 5's
-- "required for planned launch", and the closure that stops a declined/removed/
-- non-required Creator from blocking) and the rule-6 readiness record. A
-- material change flips `reacceptance_required` (§15) until the Creator accepts
-- the new version.

CREATE TABLE "association_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	-- Admin's closure. `pending` = not yet decided (blocks if the Creator is
	-- otherwise unresolved); `included` = on the final roster; `excluded` =
	-- declined/removed/non-required and closed out.
	"roster_decision" "roster_decision" DEFAULT 'pending' NOT NULL,
	-- Rule 5: only a REQUIRED Creator that is still pending blocks readiness.
	"launch_required" boolean DEFAULT false NOT NULL,
	-- Rule 6: the readiness record itself. Set when Admin confirms the Creator's
	-- agreement, disclosure, and tracking are all in place.
	"readiness_confirmed_at" timestamp with time zone,
	-- §15 materiality: a material change invalidates this Creator's readiness
	-- until they accept the new version.
	"reacceptance_required" boolean DEFAULT false NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "association_readiness" ADD CONSTRAINT "association_readiness_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_readiness" ADD CONSTRAINT "association_readiness_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "association_readiness_association_idx" ON "association_readiness" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "association_readiness_campaign_idx" ON "association_readiness" USING btree ("campaign_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "association_readiness" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "association_readiness" FROM proovd_app;--> statement-breakpoint

-- ── campaign_reviews (§15) ───────────────────────────────────────────────────
-- One row per review round. A resubmit is a NEW round, so the history of what
-- was asked and answered survives (append-only apart from the decision fields).

CREATE TABLE "campaign_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text NOT NULL,
	"outcome" "review_outcome" DEFAULT 'pending' NOT NULL,
	-- §15/§27.1: the review owner and the next-update expectation the Founder sees.
	"reviewer" text,
	"next_update_expectation" text,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_reviews" ADD CONSTRAINT "campaign_reviews_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_reviews_round_idx" ON "campaign_reviews" USING btree ("campaign_id", "round");--> statement-breakpoint
-- At most one open review round per campaign (a submit while one is pending is a
-- duplicate, not a second review).
CREATE UNIQUE INDEX "campaign_reviews_one_pending" ON "campaign_reviews" USING btree ("campaign_id")
  WHERE "outcome" = 'pending';--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_campaign_review_decision()
RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.round IS DISTINCT FROM OLD.round
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a review submission is recorded, not edited';
  END IF;
  IF OLD.outcome <> 'pending' AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'a decided review round cannot be re-decided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_review_decision
  BEFORE UPDATE ON "campaign_reviews"
  FOR EACH ROW EXECUTE FUNCTION enforce_campaign_review_decision();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "campaign_reviews" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_reviews" FROM proovd_app;--> statement-breakpoint

-- ── review_feedback_items (§15) ──────────────────────────────────────────────
-- §15: group feedback into `Required before resubmission` and `Optional
-- improvements`, deep-link to affected content, identify owner and due
-- expectation, and state whether enforcement is involved. One row per item.

CREATE TABLE "review_feedback_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"feedback_group" "feedback_group" NOT NULL,
	"area" text NOT NULL,
	"body" text NOT NULL,
	-- The deep link into the affected content (a workspace/build anchor).
	"deep_link" text NOT NULL,
	"owner" text NOT NULL,
	"due_expectation" text,
	"enforcement_involved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_feedback_items" ADD CONSTRAINT "review_feedback_items_review_fk"
  FOREIGN KEY ("review_id") REFERENCES "public"."campaign_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_feedback_items" ADD CONSTRAINT "review_feedback_items_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_feedback_items_review_idx" ON "review_feedback_items" USING btree ("review_id");--> statement-breakpoint
GRANT SELECT, INSERT ON "review_feedback_items" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "review_feedback_items" FROM proovd_app;--> statement-breakpoint

-- ── material_changes (§15 materiality — the general machine, reused Phase 17) ─
-- Every required change is classified and audited: classification, reason,
-- affected fields, before/after, prior/new version, affected Creators, and
-- reacceptance state. A non-material change preserves readiness; a material one
-- versions and requires reacceptance.

CREATE TABLE "material_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	-- Nullable: a change may arise from a review round (12b) or mid-campaign
	-- (Phase 17), and the machine is the same either way.
	"review_id" uuid,
	"classification" "materiality_class" NOT NULL,
	"reason" text NOT NULL,
	"affected_fields" jsonb NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	-- §15: prior/new version. A monotonic terms version per campaign; the
	-- reacceptance below references the new number for each affected Creator.
	"prior_version" integer,
	"new_version" integer,
	"affected_creators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reacceptance_state" "reacceptance_state" NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_changes" ADD CONSTRAINT "material_changes_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_changes" ADD CONSTRAINT "material_changes_review_fk"
  FOREIGN KEY ("review_id") REFERENCES "public"."campaign_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_changes_campaign_idx" ON "material_changes" USING btree ("campaign_id", "created_at");--> statement-breakpoint
-- §15/§33.4.2: a non-material change never versions and never manufactures a
-- reacceptance task; a material change always versions.
ALTER TABLE "material_changes" ADD CONSTRAINT "material_changes_classification_consistency"
  CHECK (
    ("classification" = 'non_material'
      AND "new_version" IS NULL AND "prior_version" IS NULL
      AND "reacceptance_state" = 'not_required')
    OR
    ("classification" = 'material'
      AND "new_version" IS NOT NULL
      AND "reacceptance_state" IN ('pending', 'complete'))
  );--> statement-breakpoint
-- The classification is recorded once; only the reacceptance state may advance.
CREATE OR REPLACE FUNCTION enforce_material_change_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.review_id IS DISTINCT FROM OLD.review_id
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.affected_fields IS DISTINCT FROM OLD.affected_fields
     OR NEW.before_value IS DISTINCT FROM OLD.before_value
     OR NEW.after_value IS DISTINCT FROM OLD.after_value
     OR NEW.prior_version IS DISTINCT FROM OLD.prior_version
     OR NEW.new_version IS DISTINCT FROM OLD.new_version
     OR NEW.affected_creators IS DISTINCT FROM OLD.affected_creators
     OR NEW.actor IS DISTINCT FROM OLD.actor
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a material change is recorded, not edited: only reacceptance_state may advance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER material_change_immutable
  BEFORE UPDATE ON "material_changes"
  FOR EACH ROW EXECUTE FUNCTION enforce_material_change_immutable();--> statement-breakpoint
GRANT SELECT, INSERT ON "material_changes" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("reacceptance_state") ON "material_changes" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "material_changes" FROM proovd_app;--> statement-breakpoint

-- ── material_change_reacceptances (§15) ──────────────────────────────────────
-- "Affected Creators receive the precise changed fields and accept or decline
-- the new version." One row per (material change, affected Creator), carrying
-- the exact version they must accept before approval or live.

CREATE TABLE "material_change_reacceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_change_id" uuid NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"new_version" integer NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"decision" "reacceptance_decision" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_change_reacceptances" ADD CONSTRAINT "material_change_reacceptances_change_fk"
  FOREIGN KEY ("material_change_id") REFERENCES "public"."material_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_change_reacceptances" ADD CONSTRAINT "material_change_reacceptances_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_change_reacceptances_unique" ON "material_change_reacceptances" USING btree ("material_change_id", "association_id");--> statement-breakpoint
CREATE INDEX "material_change_reacceptances_association_idx" ON "material_change_reacceptances" USING btree ("association_id", "decision");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_reacceptance_once()
RETURNS trigger AS $$
BEGIN
  IF NEW.material_change_id IS DISTINCT FROM OLD.material_change_id
     OR NEW.association_id IS DISTINCT FROM OLD.association_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.new_version IS DISTINCT FROM OLD.new_version
     OR NEW.changed_fields IS DISTINCT FROM OLD.changed_fields
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a reacceptance task is recorded, not edited: only its decision may be set';
  END IF;
  IF OLD.decision <> 'pending' AND NEW.decision IS DISTINCT FROM OLD.decision THEN
    RAISE EXCEPTION 'a decided reacceptance cannot be re-decided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER reacceptance_once
  BEFORE UPDATE ON "material_change_reacceptances"
  FOR EACH ROW EXECUTE FUNCTION enforce_reacceptance_once();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "material_change_reacceptances" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "material_change_reacceptances" FROM proovd_app;--> statement-breakpoint

-- ── approved_campaign_snapshots (§15: "preserve immutable approved version") ──
-- On approval, an immutable snapshot of the approved campaign and the Creator
-- terms version. Insert-only; never edited.

CREATE TABLE "approved_campaign_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"creator_terms" jsonb NOT NULL,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approved_campaign_snapshots" ADD CONSTRAINT "approved_campaign_snapshots_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_campaign_snapshots" ADD CONSTRAINT "approved_campaign_snapshots_review_fk"
  FOREIGN KEY ("review_id") REFERENCES "public"."campaign_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approved_campaign_snapshots_review_idx" ON "approved_campaign_snapshots" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "approved_campaign_snapshots_campaign_idx" ON "approved_campaign_snapshots" USING btree ("campaign_id", "created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_approved_snapshot_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'an approved campaign snapshot is immutable (§15)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER approved_snapshot_immutable
  BEFORE UPDATE ON "approved_campaign_snapshots"
  FOR EACH ROW EXECUTE FUNCTION enforce_approved_snapshot_immutable();--> statement-breakpoint
GRANT SELECT, INSERT ON "approved_campaign_snapshots" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "approved_campaign_snapshots" FROM proovd_app;
