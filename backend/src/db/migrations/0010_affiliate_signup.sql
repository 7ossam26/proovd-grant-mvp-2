CREATE TYPE "public"."signup_field_supplier" AS ENUM('proovd', 'affiliate');--> statement-breakpoint
CREATE TYPE "public"."payout_onboarding_status" AS ENUM('not_started', 'in_progress', 'requirements_due', 'complete', 'restricted');--> statement-breakpoint
CREATE TABLE "affiliate_signup_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"association_id" uuid NOT NULL,
	"legal_name" text,
	"legal_name_prefilled" text,
	"legal_name_supplier" "signup_field_supplier",
	"legal_name_edited_at" timestamp with time zone,
	"public_handle" text,
	"public_handle_prefilled" text,
	"public_handle_supplier" "signup_field_supplier",
	"public_handle_edited_at" timestamp with time zone,
	"email" text,
	"email_prefilled" text,
	"email_supplier" "signup_field_supplier",
	"email_edited_at" timestamp with time zone,
	"phone" text,
	"phone_prefilled" text,
	"phone_supplier" "signup_field_supplier",
	"phone_edited_at" timestamp with time zone,
	"channel_reference" text,
	"channel_reference_prefilled" text,
	"channel_reference_supplier" "signup_field_supplier",
	"channel_reference_edited_at" timestamp with time zone,
	"audience_niche" text,
	"audience_niche_prefilled" text,
	"audience_niche_supplier" "signup_field_supplier",
	"audience_niche_edited_at" timestamp with time zone,
	"audience_size" text,
	"audience_size_prefilled" text,
	"audience_size_supplier" "signup_field_supplier",
	"audience_size_edited_at" timestamp with time zone,
	"bio" text,
	"bio_prefilled" text,
	"bio_supplier" "signup_field_supplier",
	"bio_edited_at" timestamp with time zone,
	"date_of_birth" text,
	"country" text,
	"state_region" text,
	"confirm_age_18_plus" boolean DEFAULT false NOT NULL,
	"confirm_us_based" boolean DEFAULT false NOT NULL,
	"confirm_actual_operator" boolean DEFAULT false NOT NULL,
	"confirm_no_duplicate_accounts" boolean DEFAULT false NOT NULL,
	"confirm_sanctions_eligible" boolean DEFAULT false NOT NULL,
	"payout_status" "payout_onboarding_status" DEFAULT 'not_started' NOT NULL,
	"connected_account_id" text,
	"payout_requirements" jsonb,
	"payout_status_updated_at" timestamp with time zone,
	"last_saved_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claimed_user_id" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_signup_profiles" ADD CONSTRAINT "affiliate_signup_prospect_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."affiliate_prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_signup_profiles" ADD CONSTRAINT "affiliate_signup_association_fk" FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_signup_prospect_idx" ON "affiliate_signup_profiles" USING btree ("prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_signup_association_idx" ON "affiliate_signup_profiles" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "affiliate_signup_claimed_idx" ON "affiliate_signup_profiles" USING btree ("claimed_user_id");--> statement-breakpoint

-- ── The claim is one-way (§11, and §10's reasoning) ────────────────────────
-- A claimed signup is an account that exists. Clearing `claimed_at` would
-- describe a person who has credentials as though they did not, which is the
-- same silent-failure shape §10's account claim refuses. Append-only in the
-- one direction that matters: NULL → set, never set → NULL, and never
-- reassigned to a different user.
CREATE OR REPLACE FUNCTION enforce_affiliate_signup_claim_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.claimed_at IS NOT NULL THEN
    IF NEW.claimed_at IS NULL THEN
      RAISE EXCEPTION 'affiliate_signup_profiles.claimed_at cannot be cleared once set';
    END IF;
    IF NEW.claimed_at <> OLD.claimed_at THEN
      RAISE EXCEPTION 'affiliate_signup_profiles.claimed_at cannot be changed once set';
    END IF;
    IF NEW.claimed_user_id IS DISTINCT FROM OLD.claimed_user_id THEN
      RAISE EXCEPTION 'affiliate_signup_profiles.claimed_user_id cannot be reassigned';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER affiliate_signup_claim_immutable
  BEFORE UPDATE ON "affiliate_signup_profiles"
  FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_signup_claim_immutable();--> statement-breakpoint

-- ── §5.3: Proovd stores statuses and IDs, never full bank details ──────────
-- There is no column here for an account number, a routing number, or a tax
-- identifier, and this constraint stops one arriving disguised as a status.
-- §11: "Proovd must not reproduce provider-controlled banking or identity
-- fields in a custom form" — the storage rule is what makes the form rule hard
-- to break by accident.
ALTER TABLE "affiliate_signup_profiles" ADD CONSTRAINT "affiliate_signup_no_bank_data" CHECK (
  "connected_account_id" IS NULL
  OR "connected_account_id" ~ '^acct_[A-Za-z0-9]+$'
);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "affiliate_signup_profiles" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "affiliate_signup_profiles" FROM proovd_app;
