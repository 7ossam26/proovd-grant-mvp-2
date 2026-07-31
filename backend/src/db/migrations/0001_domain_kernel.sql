CREATE TYPE "public"."affiliate_roster_status" AS ENUM('forming', 'launch_ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."association_status" AS ENUM('prospect', 'invited', 'signup_started', 'signed_up_waiting_for_founder', 'preparing', 'formal_decision_open', 'reviewing', 'proposal_pending', 'accepted', 'declined', 'expired_no_acceptance', 'readiness_blocked', 'ready', 'active', 'paused', 'ended', 'removed', 'successfully_completed', 'completion_disqualified');--> statement-breakpoint
CREATE TYPE "public"."campaign_build_status" AS ENUM('not_started', 'in_progress', 'complete');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('invited_draft', 'vetting_submitted', 'account_claimed', 'stripe_onboarding_pending', 'listing_fee_pending', 'affiliate_response_and_build', 'pending_review', 'changes_required', 'approved', 'creator_prep', 'creator_replacement', 'refunded_no_creator', 'live', 'closed_pending_capture', 'capture_retry_window', 'closed_reconciling', 'captured_pending_w9', 'single_payment_released', 'first_payment_released', 'day_14_review', 'remaining_payment_released', 'fulfilled', 'closed_resolved', 'ended_no_charge', 'suspended', 'killed', 'banned_founder');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('pre_build', 'pre_launch');--> statement-breakpoint
CREATE TYPE "public"."payment_flag" AS ENUM('retrying', 'founder_payment_eligible', 'founder_payment_paid', 'affiliate_earnings_adjusted', 'affiliate_transfer_eligible', 'affiliate_transfer_paid', 'results_ready', 'fulfillment_active');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('reserved_active', 'reserved_canceled', 'threshold_not_met_no_charge', 'pending_capture', 'capture_failed_retrying', 'capture_failed_dropped', 'captured', 'refunded', 'reversed', 'disputed', 'killed_no_charge');--> statement-breakpoint
CREATE TYPE "public"."roster_membership" AS ENUM('initial_roster', 'mid_campaign');--> statement-breakpoint
CREATE TABLE "association_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"from_status" "association_status",
	"to_status" "association_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_affiliate_associations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"status" "association_status" DEFAULT 'prospect' NOT NULL,
	"roster_membership" "roster_membership" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_payment_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"flag" "payment_flag" NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_cents" bigint,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"actor" text NOT NULL,
	"evidence" jsonb,
	"provider_object_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"from_status" "campaign_status",
	"to_status" "campaign_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "campaign_type",
	"type_locked_at" timestamp with time zone,
	"status" "campaign_status" DEFAULT 'invited_draft' NOT NULL,
	"affiliate_roster_status" "affiliate_roster_status" DEFAULT 'forming' NOT NULL,
	"campaign_build_status" "campaign_build_status" DEFAULT 'not_started' NOT NULL,
	"listing_paid_at" timestamp with time zone,
	"campaign_live_at" timestamp with time zone,
	"campaign_close_at" timestamp with time zone,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"reward_subtotal_captured_cents" bigint DEFAULT 0 NOT NULL,
	"sales_tax_captured_cents" bigint DEFAULT 0 NOT NULL,
	"total_captured_cents" bigint DEFAULT 0 NOT NULL,
	"proovd_fee_cents" bigint DEFAULT 0 NOT NULL,
	"affiliate_provisional_cents" bigint DEFAULT 0 NOT NULL,
	"affiliate_earned_cents" bigint DEFAULT 0 NOT NULL,
	"affiliate_unearned_returned_cents" bigint DEFAULT 0 NOT NULL,
	"founder_gross_share_cents" bigint DEFAULT 0 NOT NULL,
	"stripe_fee_cents" bigint DEFAULT 0 NOT NULL,
	"founder_net_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"from_status" "reservation_status",
	"to_status" "reservation_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"backer_identity_id" uuid NOT NULL,
	"status" "reservation_status" DEFAULT 'reserved_active' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"reward_subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"sales_tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_captured_cents" bigint DEFAULT 0 NOT NULL,
	"proovd_fee_cents" bigint DEFAULT 0 NOT NULL,
	"affiliate_provisional_cents" bigint DEFAULT 0 NOT NULL,
	"affiliate_earned_cents" bigint DEFAULT 0 NOT NULL,
	"affiliate_unearned_returned_cents" bigint DEFAULT 0 NOT NULL,
	"founder_gross_share_cents" bigint DEFAULT 0 NOT NULL,
	"stripe_fee_cents" bigint DEFAULT 0 NOT NULL,
	"founder_net_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"mfa_context" text,
	"reauth_context" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"internal_reason" text NOT NULL,
	"customer_explanation" text,
	"prior_value" jsonb,
	"new_value" jsonb,
	"amount_cents" bigint,
	"currency" char(3),
	"provider_object_ids" jsonb,
	"evidence_links" jsonb,
	"related_notification_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"target" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"notification_id" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "association_status_history" ADD CONSTRAINT "association_status_history_association_id_campaign_affiliate_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD CONSTRAINT "campaign_affiliate_associations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payment_flags" ADD CONSTRAINT "campaign_payment_flags_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_status_history" ADD CONSTRAINT "campaign_status_history_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_status_history" ADD CONSTRAINT "reservation_status_history_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "association_history_idx" ON "association_status_history" USING btree ("association_id","occurred_at");--> statement-breakpoint
CREATE INDEX "associations_campaign_idx" ON "campaign_affiliate_associations" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "associations_affiliate_idx" ON "campaign_affiliate_associations" USING btree ("affiliate_id");--> statement-breakpoint
CREATE INDEX "payment_flags_campaign_idx" ON "campaign_payment_flags" USING btree ("campaign_id","flag");--> statement-breakpoint
CREATE INDEX "campaign_history_idx" ON "campaign_status_history" USING btree ("campaign_id","occurred_at");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservation_history_idx" ON "reservation_status_history" USING btree ("reservation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "reservations_campaign_idx" ON "reservations" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "reservations_backer_idx" ON "reservations" USING btree ("backer_identity_id");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_key_idx" ON "idempotency_keys" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_dedup_idx" ON "notification_deliveries" USING btree ("event_key","target","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_event_idx" ON "provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written section (phase 03). drizzle-kit does not generate CHECK
-- constraints, roles, grants, or triggers — these are maintained here by
-- hand and kept under review. Do not regenerate over them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A transition history row records a real transition: from_status is NULL
-- only on the creation row, and a no-op "transition" is not a transition
-- (shared/states machine.ts enforces the same rule in the kernel).
ALTER TABLE "campaign_status_history" ADD CONSTRAINT "campaign_history_no_noop"
  CHECK ("from_status" IS NULL OR "from_status" <> "to_status");--> statement-breakpoint
ALTER TABLE "association_status_history" ADD CONSTRAINT "association_history_no_noop"
  CHECK ("from_status" IS NULL OR "from_status" <> "to_status");--> statement-breakpoint
ALTER TABLE "reservation_status_history" ADD CONSTRAINT "reservation_history_no_noop"
  CHECK ("from_status" IS NULL OR "from_status" <> "to_status");--> statement-breakpoint
-- ── Application role ────────────────────────────────────────────────────────
-- The app connects (from a later phase onward) as proovd_app, not as a
-- superuser. Spec §25.6 requires UPDATE/DELETE on audit to be revoked at the
-- database level; a permission nobody exercised is a permission nobody has,
-- so the integration suite SET ROLEs to proovd_app and proves the denial.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proovd_app') THEN
    CREATE ROLE proovd_app NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "campaigns",
  "campaign_affiliate_associations",
  "reservations",
  "campaign_payment_flags"
  TO proovd_app;--> statement-breakpoint
-- Integrity tables: duplicates may UPDATE audit fields (seen_count,
-- processed_at, delivered_at) but nothing is ever deleted (§28.3).
GRANT SELECT, INSERT, UPDATE ON
  "provider_events",
  "idempotency_keys",
  "notification_deliveries"
  TO proovd_app;--> statement-breakpoint
-- Audit and history are INSERT-only for the application (§25.6, §23).
GRANT SELECT, INSERT ON
  "audit_events",
  "campaign_status_history",
  "association_status_history",
  "reservation_status_history"
  TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "audit_events" FROM proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON
  "campaign_status_history",
  "association_status_history",
  "reservation_status_history"
  FROM proovd_app;--> statement-breakpoint
-- ── Terminal-state protection (§23.5: reversals must be IMPOSSIBLE) ────────
-- The full legal-transition maps live once, in shared/states (a second copy
-- in SQL would drift). What the database itself guarantees, for every role
-- including superusers and ad-hoc SQL, is the invariant the Spec names:
-- a terminal state never changes again. The terminal lists below equal
-- terminalStates() of each shared machine; machines.test.ts pins that.
CREATE OR REPLACE FUNCTION enforce_terminal_status() RETURNS trigger AS $fn$
BEGIN
  IF OLD.status::text = ANY (TG_ARGV) AND NEW.status::text IS DISTINCT FROM OLD.status::text THEN
    RAISE EXCEPTION 'illegal status reversal on %: % is terminal', TG_TABLE_NAME, OLD.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaigns_terminal_status
  BEFORE UPDATE ON "campaigns"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_terminal_status(
    'refunded_no_creator', 'closed_resolved', 'ended_no_charge', 'banned_founder'
  );--> statement-breakpoint
CREATE TRIGGER associations_terminal_status
  BEFORE UPDATE ON "campaign_affiliate_associations"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_terminal_status(
    'declined', 'expired_no_acceptance', 'removed',
    'successfully_completed', 'completion_disqualified'
  );--> statement-breakpoint
CREATE TRIGGER reservations_terminal_status
  BEFORE UPDATE ON "reservations"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_terminal_status(
    'reserved_canceled', 'threshold_not_met_no_charge', 'capture_failed_dropped',
    'refunded', 'reversed', 'killed_no_charge'
  );
