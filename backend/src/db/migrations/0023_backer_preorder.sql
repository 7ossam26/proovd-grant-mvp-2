-- ── Backer pre-order, card save, and the atomic cap ─────────────────────────
--
-- Phase 15 (§19, §24.2, §25.2, §25.3, §4.1, §2.2, §28.4). A real person saves a
-- real card, is charged nothing, and holds campaign-scoped access. The
-- reservation row already exists (Phase 03 skeleton in domain.ts); this adds
-- §25.2's facts to it and the records that surround it.
--
-- Schema instructions that carry through:
--   §23.5 — a successful SetupIntent stays historical even after cancellation.
--           A trigger refuses to change setup_intent_id, the consent hash, or the
--           authorized total once set.
--   §19   — the later charge may occur only for exactly the stored total; the
--           authorized total and its consent are immutable. Operational sharing
--           is immediate, mandatory, and cannot be retracted — only flipped to
--           `do not fulfill`.
--   §2.2  — the US$50,000 pre-tax cap is atomic at the database level: a CHECK is
--           the ceiling and a conditional UPDATE is the gate (§33.5.10).
--   §4.1  — suspected duplicates enter an Admin queue; a decided case is final;
--           shared IP alone never opens a merge (the service enforces the last).

CREATE TYPE "public"."deduplication_case_status" AS ENUM ('open', 'merged', 'separated');--> statement-breakpoint
CREATE TYPE "public"."operational_fulfillment_state" AS ENUM ('active', 'do_not_fulfill');--> statement-breakpoint

-- ── backer_identities (§28.1, §5.4 — no account) ────────────────────────────
CREATE TABLE "backer_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"email_normalized" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── reservation_deduplication (§25.3 — least privilege) ─────────────────────
CREATE TABLE "reservation_deduplication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"backer_identity_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"phone_hash" text NOT NULL,
	"dedup_key" text NOT NULL,
	"payment_fingerprint" text,
	"device_hash" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── deduplication_cases (§4.1 Admin queue) ──────────────────────────────────
CREATE TABLE "deduplication_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"primary_backer_identity_id" uuid NOT NULL,
	"suspected_backer_identity_id" uuid NOT NULL,
	"signals" jsonb NOT NULL,
	"status" "deduplication_case_status" DEFAULT 'open' NOT NULL,
	"decided_reason" text,
	"decided_evidence" jsonb,
	"prior_value" jsonb,
	"new_value" jsonb,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- §4.1: two DIFFERENT backers are the subject of a case; IP alone never merges.
	CONSTRAINT "deduplication_cases_distinct_pair"
	  CHECK ("primary_backer_identity_id" <> "suspected_backer_identity_id")
);--> statement-breakpoint

-- ── founder_operational_shares (§19) ────────────────────────────────────────
CREATE TABLE "founder_operational_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"founder_user_id" text NOT NULL,
	"backer_email" text NOT NULL,
	"reward_sku" text NOT NULL,
	"reward_title" text NOT NULL,
	"purchase_detail" jsonb NOT NULL,
	"fulfillment_state" "operational_fulfillment_state" DEFAULT 'active' NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"do_not_fulfill_at" timestamp with time zone,
	"delivery_status" text DEFAULT 'shared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── campaign_reservation_capacity (§2.2, §33.5.10) ──────────────────────────
CREATE TABLE "campaign_reservation_capacity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cap_cents" bigint NOT NULL,
	"reserved_subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The ceiling, at the database level. A conditional UPDATE never crosses it,
	-- and even hand-written SQL cannot (§2.2: "never partly accept").
	CONSTRAINT "campaign_reservation_capacity_within_cap"
	  CHECK ("reserved_subtotal_cents" >= 0 AND "reserved_subtotal_cents" <= "cap_cents")
);--> statement-breakpoint

-- ── §25.2 columns on the existing reservations skeleton ─────────────────────
ALTER TABLE "reservations" ADD COLUMN "reward_package_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reward_sku" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reward_title" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reward_delivery" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "backer_email" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "backer_phone" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "billing_country" char(2);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "billing_postal_code" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "billing_line1" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "billing_city" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "billing_state" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "age_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "age_confirmed_version" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "age_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "tax_calculation_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "tax_jurisdiction" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "tax_rate" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "taxability_reason" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "tax_calculation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "tax_calculated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "tax_close_usable" boolean;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "total_authorized_cents" bigint;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "setup_intent_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_method_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_method_fingerprint" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_method_brand" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_method_last4" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "consent_appendix" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "consent_version" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "consent_hash" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "consent_text" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "campaign_disclosure_version" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "policy_versions" jsonb;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "survey_why" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "survey_recommend" integer;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "operational_sharing_ack" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "operational_sharing_ack_version" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "operational_sharing_ack_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "founder_marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "founder_marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "newsletter_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "newsletter_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "attribution_source" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "attribution_tracking_link_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "attribution_association_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "attribution_clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "attribution_status" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "same_device_limitation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "statement_descriptor" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "replaces_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "replaced_by_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reserved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint

-- §2.2: US-only billing. A reservation only exists for a US Backer, and the
-- database refuses anything else even if a route forgot to.
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_billing_country_us"
  CHECK ("billing_country" IS NULL OR "billing_country" = 'US');--> statement-breakpoint
-- §19 step 2: the recommend rating is 1–10 inclusive.
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_survey_recommend_range"
  CHECK ("survey_recommend" IS NULL OR ("survey_recommend" BETWEEN 1 AND 10));--> statement-breakpoint

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "backer_identities" ADD CONSTRAINT "backer_identities_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_deduplication" ADD CONSTRAINT "reservation_dedup_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_deduplication" ADD CONSTRAINT "reservation_dedup_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_deduplication" ADD CONSTRAINT "reservation_dedup_backer_fk"
  FOREIGN KEY ("backer_identity_id") REFERENCES "public"."backer_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduplication_cases" ADD CONSTRAINT "deduplication_cases_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduplication_cases" ADD CONSTRAINT "deduplication_cases_primary_fk"
  FOREIGN KEY ("primary_backer_identity_id") REFERENCES "public"."backer_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduplication_cases" ADD CONSTRAINT "deduplication_cases_suspected_fk"
  FOREIGN KEY ("suspected_backer_identity_id") REFERENCES "public"."backer_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_operational_shares" ADD CONSTRAINT "founder_operational_shares_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_operational_shares" ADD CONSTRAINT "founder_operational_shares_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reservation_capacity" ADD CONSTRAINT "campaign_reservation_capacity_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_reward_package_fk"
  FOREIGN KEY ("reward_package_id") REFERENCES "public"."campaign_reward_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- `backer_identity_id` stays an unreferenced UUID, the Phase 03 skeleton posture
-- (like `affiliate_id`): the pre-order service always creates or finds the
-- identity first, and a DB-level FK here would incidentally couple every bare
-- reservation insert — e.g. the terminal-status invariant test — to a backer row.
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_replaces_fk"
  FOREIGN KEY ("replaces_reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_replaced_by_fk"
  FOREIGN KEY ("replaced_by_reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "backer_identities_campaign_dedup_idx" ON "backer_identities" USING btree ("campaign_id", "dedup_key");--> statement-breakpoint
CREATE INDEX "reservation_dedup_campaign_idx" ON "reservation_deduplication" USING btree ("campaign_id", "dedup_key");--> statement-breakpoint
CREATE INDEX "reservation_dedup_fingerprint_idx" ON "reservation_deduplication" USING btree ("campaign_id", "payment_fingerprint");--> statement-breakpoint
CREATE INDEX "reservation_dedup_reservation_idx" ON "reservation_deduplication" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deduplication_cases_campaign_idx" ON "deduplication_cases" USING btree ("campaign_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "deduplication_cases_pair_idx" ON "deduplication_cases" USING btree ("campaign_id", "primary_backer_identity_id", "suspected_backer_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_operational_shares_reservation_idx" ON "founder_operational_shares" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "founder_operational_shares_campaign_idx" ON "founder_operational_shares" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_reservation_capacity_campaign_idx" ON "campaign_reservation_capacity" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "reservations_reward_idx" ON "reservations" USING btree ("reward_package_id");--> statement-breakpoint

-- ── §23.5: a successful SetupIntent and the total it authorized are historical ─
-- forever. Once set, the SetupIntent, the consent under which the card is
-- charged, the authorized total, and the reward are immutable. Status may still
-- transition (cancel), the tax-close-usability result may be recorded at close,
-- and Phase 18's capture ledger columns may fill — none of those are guarded.
CREATE OR REPLACE FUNCTION enforce_reservation_authorization_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.setup_intent_id IS NOT NULL AND NEW.setup_intent_id IS DISTINCT FROM OLD.setup_intent_id THEN
    RAISE EXCEPTION 'a successful SetupIntent stays historical (§23.5); setup_intent_id cannot change';
  END IF;
  IF OLD.consent_hash IS NOT NULL AND NEW.consent_hash IS DISTINCT FROM OLD.consent_hash THEN
    RAISE EXCEPTION 'the consent under which a card is charged is immutable (§19, §25.2)';
  END IF;
  IF OLD.total_authorized_cents IS NOT NULL AND NEW.total_authorized_cents IS DISTINCT FROM OLD.total_authorized_cents THEN
    RAISE EXCEPTION 'the authorized total is immutable and never substituted (§19)';
  END IF;
  IF OLD.reward_package_id IS NOT NULL AND NEW.reward_package_id IS DISTINCT FROM OLD.reward_package_id THEN
    RAISE EXCEPTION 'a reservation reward is fixed; an Idea reward change is a new reservation (§19)';
  END IF;
  IF NEW.backer_identity_id IS DISTINCT FROM OLD.backer_identity_id THEN
    RAISE EXCEPTION 'reservation backer identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER reservations_authorization_immutable
  BEFORE UPDATE ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION enforce_reservation_authorization_immutable();--> statement-breakpoint

-- §19: previously shared operational data cannot be retracted or altered; only
-- the fulfillment state flips to `do_not_fulfill`, and never back.
CREATE OR REPLACE FUNCTION enforce_operational_share_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.founder_user_id IS DISTINCT FROM OLD.founder_user_id
     OR NEW.backer_email IS DISTINCT FROM OLD.backer_email
     OR NEW.reward_sku IS DISTINCT FROM OLD.reward_sku
     OR NEW.reward_title IS DISTINCT FROM OLD.reward_title
     OR NEW.purchase_detail IS DISTINCT FROM OLD.purchase_detail
     OR NEW.shared_at IS DISTINCT FROM OLD.shared_at THEN
    RAISE EXCEPTION 'shared operational data cannot be retracted or altered (§19)';
  END IF;
  IF OLD.fulfillment_state = 'do_not_fulfill' AND NEW.fulfillment_state = 'active' THEN
    RAISE EXCEPTION 'a do-not-fulfill share cannot be reactivated (§19)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER founder_operational_shares_immutable
  BEFORE UPDATE ON "founder_operational_shares"
  FOR EACH ROW EXECUTE FUNCTION enforce_operational_share_immutable();--> statement-breakpoint

-- §4.1: a decided deduplication case is final; a re-detection reopens as a new
-- case, so the recorded reason/prior/new values are never overwritten.
CREATE OR REPLACE FUNCTION enforce_dedup_case_decided_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.decided_at IS NOT NULL THEN
    RAISE EXCEPTION 'a decided deduplication case is final (§4.1)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER deduplication_cases_decided_immutable
  BEFORE UPDATE ON "deduplication_cases"
  FOR EACH ROW EXECUTE FUNCTION enforce_dedup_case_decided_immutable();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Backer identity and the dedup signal record are append-only (§25.3, §25.6).
GRANT SELECT, INSERT ON "backer_identities" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "backer_identities" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "reservation_deduplication" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "reservation_deduplication" FROM proovd_app;--> statement-breakpoint
-- The Admin decision updates a case once; nothing is ever deleted.
GRANT SELECT, INSERT, UPDATE ON "deduplication_cases" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "deduplication_cases" FROM proovd_app;--> statement-breakpoint
-- The share flips to do-not-fulfill (UPDATE) but is never retracted (no DELETE).
GRANT SELECT, INSERT, UPDATE ON "founder_operational_shares" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "founder_operational_shares" FROM proovd_app;--> statement-breakpoint
-- The capacity total moves by conditional UPDATE; it is never deleted.
GRANT SELECT, INSERT, UPDATE ON "campaign_reservation_capacity" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_reservation_capacity" FROM proovd_app;
