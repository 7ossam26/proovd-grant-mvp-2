-- Pre-claim identity and business fields on the prospect — Spec §7, §10, §25.6, §25.8.
--
-- ── Why these columns exist ─────────────────────────────────────────────────
-- The Admin workspace edits a Founder's record through one registered field
-- list, and four of its keys — date of birth, state, business type, legal
-- business name — had no home before the Founder claimed an account: their only
-- columns were on `founder_claim_profiles`, which is created by the claim flow.
-- The workspace therefore refused a pre-claim edit with "recorded when the
-- Founder creates their account", which made the surface read as broken for the
-- ordinary case of an Admin writing down what a discovery call produced.
--
-- These five columns are the pre-claim home (country joins the register with
-- them). §10's own words license the arrangement: "The account is prefilled
-- from invitation/discovery and every prefilled field is editable." Once a
-- claim profile exists, it wins wherever it has a value — the same
-- prospect-then-claim precedence the name, email, and phone fields have always
-- had — so there is one continuous answer rather than two to reconcile.
ALTER TABLE "founder_prospects" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "founder_prospects" ADD COLUMN "state_region" text;--> statement-breakpoint
ALTER TABLE "founder_prospects" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "founder_prospects" ADD COLUMN "business_entity_type" text;--> statement-breakpoint
ALTER TABLE "founder_prospects" ADD COLUMN "business_name" text;--> statement-breakpoint
--
COMMENT ON COLUMN "founder_prospects"."date_of_birth" IS
  'Pre-claim home for the Founder''s date of birth, Admin-recorded from discovery (§7). The claim profile wins once it holds a value. Anonymised by the §25.8 sweep.';--> statement-breakpoint
COMMENT ON COLUMN "founder_prospects"."state_region" IS
  'Pre-claim home for the Founder''s state/region (§7, §10). The claim profile wins once it holds a value. Anonymised by the §25.8 sweep.';--> statement-breakpoint
COMMENT ON COLUMN "founder_prospects"."country" IS
  'Pre-claim home for the Founder''s country (§7, §10). The claim profile wins once it holds a value. Anonymised by the §25.8 sweep.';--> statement-breakpoint
COMMENT ON COLUMN "founder_prospects"."business_entity_type" IS
  'Pre-claim home for the business entity type (§7, §10). No forced list (§26.2). Anonymised by the §25.8 sweep.';--> statement-breakpoint
COMMENT ON COLUMN "founder_prospects"."business_name" IS
  'Pre-claim home for the legal business name (§7, §10). Anonymised by the §25.8 sweep.';--> statement-breakpoint
--
-- ── The anonymisation trigger learns the new columns ────────────────────────
-- 0005 made anonymisation irreversible by refusing to write content back onto
-- an anonymised prospect, and 0039 recorded why a content column the trigger
-- does not know about is a hole in exactly that guarantee. A date of birth is
-- the most personal fact this table has ever held, so all five join the list.
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
    OR NEW."last_contact_at" IS NOT NULL
    OR NEW."date_of_birth" IS NOT NULL OR NEW."state_region" IS NOT NULL
    OR NEW."country" IS NOT NULL OR NEW."business_entity_type" IS NOT NULL
    OR NEW."business_name" IS NOT NULL
    THEN
      RAISE EXCEPTION 'this prospect has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
--
-- No new grant. `founder_prospects` already carries SELECT, INSERT, UPDATE for
-- proovd_app from 0005, and DELETE is still revoked there.
