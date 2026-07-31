CREATE TYPE "public"."invitation_status" AS ENUM('draft', 'sent', 'revoked', 'claimed', 'expired');--> statement-breakpoint
CREATE TABLE "campaign_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"what_we_understood" text,
	"why_invited" text,
	"sender_name" text,
	"sender_email" text,
	"expected_setup_time" text,
	"status" "invitation_status" DEFAULT 'draft' NOT NULL,
	"anonymised_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_invitation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"recipient_email" text,
	"recipient_name" text,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"invitation_source" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notification_id" text,
	"token_id" uuid NOT NULL,
	"token_version" integer NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" "invitation_status" NOT NULL,
	"sent_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text,
	"preferred_name" text,
	"email" text,
	"phone" text,
	"product_name" text,
	"product_url" text,
	"launch_frame" text,
	"us_age_fit" text,
	"delivery_feasibility" text,
	"compensation_expectations" text,
	"affiliate_sourcing_hypothesis" text,
	"admin_notes" text,
	"discovery_evidence" jsonb,
	"invitation_source" text,
	"internal_owner" text,
	"claimed_user_id" text,
	"claimed_at" timestamp with time zone,
	"anonymised_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_prospect_id_founder_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."founder_prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_invitation_sends" ADD CONSTRAINT "campaign_invitation_sends_draft_id_campaign_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."campaign_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_drafts_campaign_idx" ON "campaign_drafts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_drafts_prospect_idx" ON "campaign_drafts" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "campaign_drafts_status_idx" ON "campaign_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invitation_sends_draft_sent_idx" ON "campaign_invitation_sends" USING btree ("draft_id","sent_at");--> statement-breakpoint
CREATE INDEX "founder_prospects_email_idx" ON "founder_prospects" USING btree ("email");--> statement-breakpoint
CREATE INDEX "founder_prospects_claimed_idx" ON "founder_prospects" USING btree ("claimed_user_id");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written section (phase 06b). drizzle-kit does not generate CHECK
-- constraints, grants, or triggers — these are maintained here by hand and
-- kept under review. Do not regenerate over them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Anonymisation is one-way (§25.8) ───────────────────────────────────────
-- §25.8: unclaimed draft content is deleted or IRREVERSIBLY anonymised. A row
-- that could be un-anonymised was never anonymised; it was hidden. So once
-- `anonymised_at` is set it cannot be cleared or moved, and no content column
-- may be written back into the row afterwards.
CREATE OR REPLACE FUNCTION enforce_draft_anonymisation() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."what_we_understood" IS NOT NULL
    OR NEW."why_invited"        IS NOT NULL
    THEN
      RAISE EXCEPTION 'this draft has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_drafts_anonymisation_is_final
  BEFORE UPDATE ON "campaign_drafts"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_draft_anonymisation();--> statement-breakpoint
--
CREATE OR REPLACE FUNCTION enforce_prospect_anonymisation() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."legal_name" IS NOT NULL OR NEW."preferred_name" IS NOT NULL
    OR NEW."email"      IS NOT NULL OR NEW."phone"          IS NOT NULL
    OR NEW."product_name" IS NOT NULL OR NEW."product_url"  IS NOT NULL
    THEN
      RAISE EXCEPTION 'this prospect has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER founder_prospects_anonymisation_is_final
  BEFORE UPDATE ON "founder_prospects"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_prospect_anonymisation();--> statement-breakpoint
--
-- ── A claimed prospect is never anonymised ─────────────────────────────────
-- §25.8 keeps Founder account data for account life + 7 years. The 30-day
-- sweep is for drafts nobody ever claimed; a claimed one has become an account
-- and leaves the sweep's scope entirely.
ALTER TABLE "founder_prospects" ADD CONSTRAINT "founder_prospects_claimed_is_not_anonymised" CHECK (
  "claimed_user_id" IS NULL OR "anonymised_at" IS NULL
);--> statement-breakpoint
ALTER TABLE "founder_prospects" ADD CONSTRAINT "founder_prospects_claim_pair" CHECK (
  ("claimed_user_id" IS NULL AND "claimed_at" IS NULL)
  OR ("claimed_user_id" IS NOT NULL AND "claimed_at" IS NOT NULL)
);--> statement-breakpoint
--
-- ── Application role grants ────────────────────────────────────────────────
-- proovd_app is created in 0001. Drafts and prospects are read, written, and
-- anonymised in place; nothing here is ever deleted, because §25.8 keeps the
-- minimum audit evidence and audit_events references these ids.
GRANT SELECT, INSERT, UPDATE ON "founder_prospects", "campaign_drafts" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "founder_prospects", "campaign_drafts" FROM proovd_app;--> statement-breakpoint
-- Sends are INSERT-only, with one exception carved out by column.
--
-- This is the record §33.1.3 measures the retention window from, so `sent_at`,
-- `token_version`, `draft_id`, and `status` must be immutable: a send that
-- could be edited is a retention clock that could be moved. But the row also
-- carries the recipient's name and address, and §25.8 requires those to be
-- anonymised after 30 calendar days without a claim — so the sweep needs to
-- null exactly those two columns and nothing else.
--
-- A column-level grant says that precisely. `REVOKE UPDATE` removes the
-- table-wide privilege first; the column grant that follows is the whole of
-- what the application may change.
GRANT SELECT, INSERT ON "campaign_invitation_sends" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_invitation_sends" FROM proovd_app;--> statement-breakpoint
GRANT UPDATE ("recipient_email", "recipient_name") ON "campaign_invitation_sends" TO proovd_app;
