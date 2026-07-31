CREATE TYPE "public"."email_ownership" AS ENUM('invited_link', 'google_oauth', 'self_supplied_unverified');--> statement-breakpoint
CREATE TYPE "public"."field_supplier" AS ENUM('proovd', 'founder');--> statement-breakpoint
CREATE TABLE "campaign_vetting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"selected_type" "campaign_type",
	"type_chosen_at" timestamp with time zone,
	"problem_prefilled_text" text,
	"problem_prefilled_by" text,
	"problem_prefilled_at" timestamp with time zone,
	"problem_text" text,
	"problem_supplier" "field_supplier",
	"problem_first_edited_at" timestamp with time zone,
	"problem_last_edited_at" timestamp with time zone,
	"solution_prefilled_text" text,
	"solution_prefilled_by" text,
	"solution_prefilled_at" timestamp with time zone,
	"solution_text" text,
	"solution_supplier" "field_supplier",
	"solution_first_edited_at" timestamp with time zone,
	"solution_last_edited_at" timestamp with time zone,
	"competition_text" text,
	"competition_supplier" "field_supplier",
	"competition_first_edited_at" timestamp with time zone,
	"competition_last_edited_at" timestamp with time zone,
	"last_saved_at" timestamp with time zone,
	"resume_step" text,
	"submitted_at" timestamp with time zone,
	"anonymised_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_field_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"record" text NOT NULL,
	"field" text NOT NULL,
	"prior_value" text,
	"new_value" text,
	"supplier" "field_supplier" NOT NULL,
	"edited_by" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_claim_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"legal_name" text,
	"legal_name_supplier" "field_supplier",
	"legal_name_prefilled" text,
	"legal_name_edited_at" timestamp with time zone,
	"preferred_name" text,
	"preferred_name_supplier" "field_supplier",
	"preferred_name_prefilled" text,
	"preferred_name_edited_at" timestamp with time zone,
	"email" text,
	"email_supplier" "field_supplier",
	"email_prefilled" text,
	"email_edited_at" timestamp with time zone,
	"email_ownership" "email_ownership",
	"phone" text,
	"phone_supplier" "field_supplier",
	"phone_prefilled" text,
	"phone_edited_at" timestamp with time zone,
	"date_of_birth" date,
	"date_of_birth_supplier" "field_supplier",
	"date_of_birth_edited_at" timestamp with time zone,
	"country" text,
	"country_supplier" "field_supplier",
	"country_edited_at" timestamp with time zone,
	"state_region" text,
	"state_region_supplier" "field_supplier",
	"state_region_edited_at" timestamp with time zone,
	"sole_proprietor" boolean,
	"business_name" text,
	"business_entity_type" text,
	"business_supplier" "field_supplier",
	"business_edited_at" timestamp with time zone,
	"representation_us_person" boolean DEFAULT false NOT NULL,
	"representation_age_18_plus" boolean DEFAULT false NOT NULL,
	"representation_sanctions" boolean DEFAULT false NOT NULL,
	"last_saved_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claimed_user_id" text,
	"anonymised_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version" text NOT NULL,
	"accepted_via" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "possible_creator_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"count" integer NOT NULL,
	"basis" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "replaced_by_campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "replaces_campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_vetting" ADD CONSTRAINT "campaign_vetting_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_vetting" ADD CONSTRAINT "campaign_vetting_draft_id_campaign_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."campaign_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_field_edits" ADD CONSTRAINT "draft_field_edits_draft_id_campaign_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."campaign_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_claim_profiles" ADD CONSTRAINT "founder_claim_profiles_draft_id_campaign_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."campaign_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_claim_profiles" ADD CONSTRAINT "founder_claim_profiles_prospect_id_founder_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."founder_prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_claim_profiles" ADD CONSTRAINT "founder_claim_profiles_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_consents" ADD CONSTRAINT "policy_consents_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possible_creator_results" ADD CONSTRAINT "possible_creator_results_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_vetting_campaign_idx" ON "campaign_vetting" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_vetting_draft_idx" ON "campaign_vetting" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "draft_field_edits_draft_idx" ON "draft_field_edits" USING btree ("draft_id","occurred_at");--> statement-breakpoint
CREATE INDEX "draft_field_edits_field_idx" ON "draft_field_edits" USING btree ("draft_id","record","field");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_claim_profiles_draft_idx" ON "founder_claim_profiles" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_claim_profiles_campaign_idx" ON "founder_claim_profiles" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "policy_consents_subject_idx" ON "policy_consents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_consents_dedup_idx" ON "policy_consents" USING btree ("subject_type","subject_id","policy_version_id");--> statement-breakpoint
CREATE INDEX "possible_creator_results_campaign_idx" ON "possible_creator_results" USING btree ("campaign_id","recorded_at");
--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written section (phase 07). drizzle-kit does not generate CHECK
-- constraints, grants, or triggers — these are maintained here by hand and kept
-- under review. Do not regenerate over them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Competition is never Proovd's (§9, §33.1.5) ────────────────────────────
-- §9 states it twice: Competition/positioning is "Always blank", "Written by
-- the Founder", and "must never be prefilled or represented as AI-generated".
-- The table already gives it no prefill columns to be written into. This is the
-- second lock: even a hand-written UPDATE cannot record it as having come from
-- anywhere but the Founder.
ALTER TABLE "campaign_vetting" ADD CONSTRAINT "campaign_vetting_competition_is_founders" CHECK (
  "competition_supplier" IS NULL OR "competition_supplier" = 'founder'
);--> statement-breakpoint
--
-- ── Submitting means every answer is present (§9 State) ────────────────────
-- §9: "Submitting all vetting answers locks the type and sets
-- `vetting_submitted`." A submitted record with a missing answer would be a
-- locked campaign type chosen against incomplete information, so the database
-- refuses one. The anonymised case is exempt: §25.8 empties the content of an
-- unclaimed record long after it was legitimately complete.
ALTER TABLE "campaign_vetting" ADD CONSTRAINT "campaign_vetting_submitted_is_complete" CHECK (
  "submitted_at" IS NULL
  OR "anonymised_at" IS NOT NULL
  OR (
    "selected_type"    IS NOT NULL
    AND "problem_text"     IS NOT NULL AND btrim("problem_text")     <> ''
    AND "solution_text"    IS NOT NULL AND btrim("solution_text")    <> ''
    AND "competition_text" IS NOT NULL AND btrim("competition_text") <> ''
  )
);--> statement-breakpoint
--
-- ── The type lock is permanent, and there is no migration path (§9) ────────
-- §9: "The campaign type locks permanently when vetting is submitted… No
-- campaign-type migration exists." §33.1.7 tests that a wrong type archives and
-- restarts rather than converting. A trigger is the only place that rule can
-- live where an ORM call, a support script, and a future phase all obey it.
--
-- Archival is likewise one-way: a record that could be un-archived would let a
-- locked type come back into service by the side door.
CREATE OR REPLACE FUNCTION enforce_campaign_type_lock() RETURNS trigger AS $fn$
BEGIN
  IF OLD."type_locked_at" IS NOT NULL THEN
    IF NEW."type" IS DISTINCT FROM OLD."type" THEN
      RAISE EXCEPTION 'the campaign type locked at vetting submission and cannot be changed; archive this campaign and begin a new vetting record'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."type_locked_at" IS DISTINCT FROM OLD."type_locked_at" THEN
      RAISE EXCEPTION 'type_locked_at is append-only'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."archived_at" IS NOT NULL AND NEW."archived_at" IS DISTINCT FROM OLD."archived_at" THEN
    RAISE EXCEPTION 'archival is final; archived_at is append-only'
      USING ERRCODE = '23514';
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaigns_type_lock_is_permanent
  BEFORE UPDATE ON "campaigns"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_campaign_type_lock();--> statement-breakpoint
--
-- ── A locked type has a lock time, and vice versa ──────────────────────────
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_type_lock_pair" CHECK (
  ("type" IS NULL AND "type_locked_at" IS NULL)
  OR ("type" IS NOT NULL AND "type_locked_at" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_archive_pair" CHECK (
  ("archived_at" IS NULL AND "archived_reason" IS NULL AND "archived_by" IS NULL)
  OR ("archived_at" IS NOT NULL AND "archived_reason" IS NOT NULL AND "archived_by" IS NOT NULL)
);--> statement-breakpoint
--
-- ── Vetting: submission is final, anonymisation is irreversible, and every
--    change to a provenanced field writes its own history row (§9, §1.1) ────
-- The history is a trigger and not a service call, for the same reason
-- `app_setting_versions` is (Phase 06a): a service that wrote it is a service
-- one careless `db.update()` can bypass, and the row it would have written is
-- the only evidence of what the Founder originally said.
--
-- The anonymisation write is deliberately exempt from history. Recording
-- "problem_text changed from <the Founder's words> to NULL" would file a
-- verbatim copy of the deleted text in an append-only table, which is the
-- opposite of what §25.8 asks for.
CREATE OR REPLACE FUNCTION enforce_vetting_write() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."problem_text" IS NOT NULL OR NEW."solution_text" IS NOT NULL
    OR NEW."competition_text" IS NOT NULL
    OR NEW."problem_prefilled_text" IS NOT NULL OR NEW."solution_prefilled_text" IS NOT NULL
    THEN
      RAISE EXCEPTION 'this vetting record has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD."submitted_at" IS NOT NULL AND NEW."anonymised_at" IS NULL THEN
    IF NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at" THEN
      RAISE EXCEPTION 'vetting submission is final; submitted_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."selected_type"    IS DISTINCT FROM OLD."selected_type"
    OR NEW."problem_text"     IS DISTINCT FROM OLD."problem_text"
    OR NEW."solution_text"    IS DISTINCT FROM OLD."solution_text"
    OR NEW."competition_text" IS DISTINCT FROM OLD."competition_text"
    THEN
      RAISE EXCEPTION 'vetting has been submitted and its answers are now read-only'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_vetting_write_rules
  BEFORE UPDATE ON "campaign_vetting"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_vetting_write();--> statement-breakpoint
--
CREATE OR REPLACE FUNCTION record_vetting_edits() RETURNS trigger AS $fn$
BEGIN
  -- The retention sweep is not an edit. See the note above.
  IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
    RETURN NULL;
  END IF;

  IF NEW."selected_type" IS DISTINCT FROM OLD."selected_type" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','selected_type',
            OLD."selected_type"::text, NEW."selected_type"::text,'founder',NEW."updated_by");
  END IF;
  IF NEW."problem_prefilled_text" IS DISTINCT FROM OLD."problem_prefilled_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','problem_prefilled_text',
            OLD."problem_prefilled_text", NEW."problem_prefilled_text",'proovd',NEW."updated_by");
  END IF;
  IF NEW."problem_text" IS DISTINCT FROM OLD."problem_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','problem_text',
            OLD."problem_text", NEW."problem_text",
            COALESCE(NEW."problem_supplier",'founder'),NEW."updated_by");
  END IF;
  IF NEW."solution_prefilled_text" IS DISTINCT FROM OLD."solution_prefilled_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','solution_prefilled_text',
            OLD."solution_prefilled_text", NEW."solution_prefilled_text",'proovd',NEW."updated_by");
  END IF;
  IF NEW."solution_text" IS DISTINCT FROM OLD."solution_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','solution_text',
            OLD."solution_text", NEW."solution_text",
            COALESCE(NEW."solution_supplier",'founder'),NEW."updated_by");
  END IF;
  IF NEW."competition_text" IS DISTINCT FROM OLD."competition_text" THEN
    -- Hard-coded `founder`, not the column. §9 admits no other answer here and
    -- a history row is the last place that should be able to say otherwise.
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','competition_text',
            OLD."competition_text", NEW."competition_text",'founder',NEW."updated_by");
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_vetting_history
  AFTER UPDATE ON "campaign_vetting"
  FOR EACH ROW
  EXECUTE FUNCTION record_vetting_edits();--> statement-breakpoint
--
-- ── The claim profile: the same three rules ────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_claim_profile_write() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."legal_name" IS NOT NULL OR NEW."preferred_name" IS NOT NULL
    OR NEW."email" IS NOT NULL OR NEW."phone" IS NOT NULL
    OR NEW."date_of_birth" IS NOT NULL OR NEW."business_name" IS NOT NULL
    THEN
      RAISE EXCEPTION 'this claim profile has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD."claimed_at" IS NOT NULL AND NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" THEN
    RAISE EXCEPTION 'this draft has been claimed; claimed_at is append-only'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."claimed_user_id" IS NOT NULL
     AND NEW."claimed_user_id" IS DISTINCT FROM OLD."claimed_user_id" THEN
    RAISE EXCEPTION 'this draft has been claimed by an account; the account cannot be reassigned'
      USING ERRCODE = '23514';
  END IF;

  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER founder_claim_profiles_write_rules
  BEFORE UPDATE ON "founder_claim_profiles"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_claim_profile_write();--> statement-breakpoint
--
CREATE OR REPLACE FUNCTION record_claim_profile_edits() RETURNS trigger AS $fn$
DECLARE
  f text;
  prior text;
  next_value text;
BEGIN
  IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
    RETURN NULL;
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'legal_name','preferred_name','email','phone','date_of_birth',
    'country','state_region','business_name','business_entity_type','sole_proprietor'
  ] LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', f, f)
      INTO prior, next_value USING OLD, NEW;
    IF next_value IS DISTINCT FROM prior THEN
      INSERT INTO "draft_field_edits"
        ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
      VALUES (NEW."draft_id",'claim_profile',f,prior,next_value,'founder',NEW."updated_by");
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER founder_claim_profiles_history
  AFTER UPDATE ON "founder_claim_profiles"
  FOR EACH ROW
  EXECUTE FUNCTION record_claim_profile_edits();--> statement-breakpoint
--
-- ── A count is never negative, and never unexplained (§10) ─────────────────
ALTER TABLE "possible_creator_results" ADD CONSTRAINT "possible_creator_results_count_is_natural" CHECK (
  "count" >= 0
);--> statement-breakpoint
ALTER TABLE "possible_creator_results" ADD CONSTRAINT "possible_creator_results_basis_is_stated" CHECK (
  btrim("basis") <> ''
);--> statement-breakpoint
--
-- ── A consent may cite only a published version (§29.8, §31.4) ─────────────
-- A draft document is text Proovd's own lawyers have not agreed. A signature on
-- one records agreement to nothing, and §29.8's reacceptance flow — which
-- compares a stored consent against the current version — would be comparing
-- against a moving target. This is a trigger rather than a service rule because
-- the failure is silent: nothing looks wrong until the day it matters.
CREATE OR REPLACE FUNCTION enforce_consent_cites_published() RETURNS trigger AS $fn$
DECLARE
  v_status text;
  v_slug text;
  v_version text;
BEGIN
  SELECT "status"::text, "slug", "version" INTO v_status, v_slug, v_version
    FROM "policy_versions" WHERE "id" = NEW."policy_version_id";
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'no such policy version' USING ERRCODE = '23503';
  END IF;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'a consent may cite only a published policy version; % % is still a draft', v_slug, v_version
      USING ERRCODE = '23514';
  END IF;
  IF NEW."slug" <> v_slug OR NEW."version" <> v_version THEN
    RAISE EXCEPTION 'the recorded slug/version must match the cited policy version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER policy_consents_cite_published_only
  BEFORE INSERT ON "policy_consents"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_consent_cites_published();--> statement-breakpoint
--
-- ── Application role grants ────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "campaign_vetting", "founder_claim_profiles" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_vetting", "founder_claim_profiles" FROM proovd_app;--> statement-breakpoint
--
-- The recorded assessment and the consent record are both evidence. Neither is
-- ever edited: a revised count is a new row, and a withdrawn consent is a
-- §29.8 event, not the deletion of the fact that one was given.
GRANT SELECT, INSERT ON "possible_creator_results", "policy_consents" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "possible_creator_results", "policy_consents" FROM proovd_app;--> statement-breakpoint
--
-- The edit history is append-only, with exactly one carve-out: §25.8 requires
-- the *content* of an unclaimed draft to go after 30 days, and this table holds
-- a verbatim copy of every version of it. So the sweep may empty the two value
-- columns and nothing else — `field`, `supplier`, `edited_by`, and `occurred_at`
-- are outside the grant, so the fact that an edit happened, who made it, and
-- when, survives the text of it going. The same column-grant shape migration
-- 0005 uses for the send recipient.
GRANT SELECT, INSERT ON "draft_field_edits" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "draft_field_edits" FROM proovd_app;--> statement-breakpoint
GRANT UPDATE ("prior_value", "new_value") ON "draft_field_edits" TO proovd_app;
